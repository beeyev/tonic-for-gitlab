import { describe, expect, test } from "bun:test";
import type { HostAccessApis } from "../host-access/registration";
import { toContentScriptId } from "../host-access/target-origin";
import type { TargetsRepository } from "../host-access/targets-repository";
import { registerHostAccessReconciliation } from "./host-access-reconciliation";

/** The worker records stale tabs in session storage; give it somewhere to go. */
function installSessionStorage(): { session: Record<string, unknown> } {
	const session: Record<string, unknown> = {};

	globalThis.chrome = {
		storage: {
			session: {
				async get(key: string) {
					return key in session ? { [key]: session[key] } : {};
				},
				async set(items: Record<string, unknown>) {
					Object.assign(session, items);
				},
				async remove(key: string) {
					delete session[key];
				},
			},
		},
	} as unknown as typeof chrome;

	return { session };
}

function createEvents() {
	const listeners: Record<string, Array<() => void>> = {};
	const slot = (name: string) => ({
		addListener(listener: () => void) {
			listeners[name] = [...(listeners[name] ?? []), listener];
		},
	});

	return {
		listeners,
		fire(name: string) {
			for (const listener of listeners[name] ?? []) {
				listener();
			}
		},
		events: {
			runtime: {
				onInstalled: slot("onInstalled"),
				onStartup: slot("onStartup"),
			},
			permissions: {
				onAdded: slot("onAdded"),
				onRemoved: slot("onRemoved"),
			},
		} as unknown as Parameters<typeof registerHostAccessReconciliation>[0],
	};
}

function createDependencies(
	outcome: "stored" | "newer-schema" | "reset" = "stored",
	preRegistered: Array<{ id: string; matches?: string[] }> = [],
) {
	const registered: string[][] = [];
	const unregistered: string[][] = [];
	const live = new Map(preRegistered.map((script) => [script.id, script]));

	const repository = {
		async read() {
			return {
				outcome,
				targets: { schemaVersion: 1 as const, origins: ["https://gl.example"] },
				droppedOrigins: [],
			};
		},
	} as unknown as TargetsRepository;

	const apis: HostAccessApis = {
		permissions: {
			async contains() {
				return true;
			},
			async getAll() {
				return { origins: ["https://gl.example/*"] };
			},
			async request() {
				return true;
			},
			async remove() {
				return true;
			},
		},
		scripting: {
			async getRegisteredContentScripts() {
				return [...live.values()];
			},
			async registerContentScripts(scripts) {
				registered.push(scripts.map((s) => s.id));

				for (const script of scripts) {
					live.set(script.id, script);
				}
			},
			async unregisterContentScripts({ ids }) {
				unregistered.push(ids);

				for (const id of ids) {
					live.delete(id);
				}
			},
		},
		runtime: {
			getManifest: () => ({
				content_scripts: [
					{ matches: ["https://gitlab.com/*"], js: ["content.js"] },
				],
			}),
		},
	};

	return { apis, registered, repository, unregistered };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settlePromise) => {
		resolve = settlePromise;
	});

	return { promise, resolve };
}

describe("background reconciliation", () => {
	/*
	 * The reason this worker exists. Chrome discards dynamic content scripts on
	 * extension reload and update even with `persistAcrossSessions: true`,
	 * verified live, so every one of these events has to re-register.
	 */
	/*
	 * The action is closed when a grant completes, so the worker has to leave the
	 * reload notice behind for it. The signal is what actually changed, not which
	 * event fired: whichever of the worker-start reconcile and the event listener
	 * runs first is the one that registers.
	 */
	test.each(["onInstalled", "onAdded", "onRemoved"])(
		"marks stale when %s changes a registration",
		async (event) => {
			const { session } = installSessionStorage();
			const { apis, repository } = createDependencies("stored", [
				{ id: "tonic-origin-stale" },
			]);
			const harness = createEvents();
			registerHostAccessReconciliation(harness.events, repository, apis);

			harness.fire(event);
			await settle();

			expect(session["tonic.staleTabs"]).toBe(true);
		},
	);

	/*
	 * Browser startup must not nag. Registrations that survived the restart are
	 * found already present, so nothing changes and nothing is marked.
	 */
	test("does not mark stale when startup finds its registrations intact", async () => {
		const { session } = installSessionStorage();
		const { apis, repository } = createDependencies("stored", [
			{
				id: toContentScriptId("https://gl.example"),
				matches: ["https://gl.example/*"],
			},
		]);
		const harness = createEvents();
		registerHostAccessReconciliation(harness.events, repository, apis);

		harness.fire("onStartup");
		await settle();

		expect(session["tonic.staleTabs"]).toBeUndefined();
	});

	test("leaves a newer build's registrations alone", async () => {
		installSessionStorage();
		const { apis, registered, repository, unregistered } =
			createDependencies("newer-schema");
		const harness = createEvents();
		registerHostAccessReconciliation(harness.events, repository, apis);

		harness.fire("onStartup");
		await settle();

		expect(registered).toEqual([]);
		expect(unregistered).toEqual([]);
	});

	/*
	 * Disabling and re-enabling the extension drops dynamic registrations and
	 * fires neither `onInstalled` nor `onStartup`. Without this the instances
	 * stayed dead until the toolbar action was opened.
	 */
	test("reconciles when the worker starts, with no event at all", async () => {
		installSessionStorage();
		const { apis, registered, repository } = createDependencies();
		const harness = createEvents();

		registerHostAccessReconciliation(harness.events, repository, apis);
		await settle();

		expect(registered).toEqual([[toContentScriptId("https://gl.example")]]);
	});

	/*
	 * Manifest V3 starts a stopped worker by running module scope and *then*
	 * dispatching the event that woke it, so the startup reconcile and the
	 * event's queued reconcile can both run on a wake. They must run serially so
	 * the follow-up sees the registration made by the startup pass instead of
	 * making a duplicate registration attempt that Chrome rejects.
	 */
	test("avoids duplicate registration when the wake event overlaps startup", async () => {
		installSessionStorage();
		const { apis, registered, repository } = createDependencies();
		const harness = createEvents();

		registerHostAccessReconciliation(harness.events, repository, apis);
		// The event that started the worker, delivered after module scope ran.
		harness.fire("onAdded");
		await settle();

		expect(registered).toEqual([[toContentScriptId("https://gl.example")]]);
	});

	test("reconciles again when a permission event arrives during a pass", async () => {
		installSessionStorage();
		const permission = deferred<boolean>();
		const permissionRead = deferred<void>();
		let permissionReads = 0;
		const { apis, registered, repository } = createDependencies();
		apis.permissions.contains = () => {
			permissionReads += 1;
			permissionRead.resolve();
			return permissionReads === 1 ? permission.promise : Promise.resolve(true);
		};
		const harness = createEvents();

		registerHostAccessReconciliation(harness.events, repository, apis);
		await permissionRead.promise;
		expect(permissionReads).toBe(1);

		// The active pass already sampled the old permission before the grant.
		harness.fire("onAdded");
		permission.resolve(false);
		await settle();

		expect(permissionReads).toBe(2);
		expect(registered).toEqual([[toContentScriptId("https://gl.example")]]);
	});

	test("leaves an unusable stored list alone", async () => {
		installSessionStorage();
		const { apis, registered, repository, unregistered } =
			createDependencies("reset");
		const harness = createEvents();

		registerHostAccessReconciliation(harness.events, repository, apis);
		harness.fire("onInstalled");
		await settle();

		expect(registered).toEqual([]);
		expect(unregistered).toEqual([]);
	});
});
