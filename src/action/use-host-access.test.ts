import { describe, expect, test } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import type { HostAccessApis } from "../host-access/registration";
import type {
	TargetsRepository,
	TonicTargets,
} from "../host-access/targets-repository";
import { useHostAccess } from "./use-host-access";

/**
 * The hook consumes the worker's stale-tab flag from session storage on load,
 * so every test needs that area to exist. Without it the load effect takes its
 * error path and the test still looks green while proving nothing.
 */
function installSessionStorage(initial: Record<string, unknown> = {}) {
	const session: Record<string, unknown> = { ...initial };

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

	return session;
}

function createCountingDependencies(origins: string[] = []) {
	const counts = { reads: 0, registrationQueries: 0 };
	const targets: TonicTargets = { schemaVersion: 1, origins };

	const repository: TargetsRepository = {
		async read() {
			counts.reads++;
			return { outcome: "stored", targets, droppedOrigins: [] };
		},
		async add() {
			return targets;
		},
		async remove() {
			return targets;
		},
	};

	const apis: HostAccessApis = {
		permissions: {
			async contains() {
				return false;
			},
			async getAll() {
				return { origins: [] };
			},
			async request() {
				return false;
			},
			async remove() {
				return true;
			},
		},
		scripting: {
			async getRegisteredContentScripts() {
				counts.registrationQueries++;
				return [];
			},
			async registerContentScripts() {},
			async unregisterContentScripts() {},
		},
		runtime: {
			getManifest: () => ({
				content_scripts: [
					{ matches: ["https://gitlab.com:443/*"], js: ["content.js"] },
				],
			}),
		},
	};

	return { counts, repository, apis };
}

describe("host access hook", () => {
	/*
	 * Regression guard, and it has to call the hook the way the popup does, with
	 * no arguments. The dependencies used to be plain default arguments, which
	 * React re-evaluates on every render: each new identity invalidated the load
	 * effect, the effect re-read storage and re-reconciled, and its own setState
	 * scheduled the next render. A live popup measured about 1100 storage reads
	 * per second. Passing dependencies in from a test hides the whole thing,
	 * because then the defaults never run.
	 */
	test("loads once from its own defaults and does not loop on re-render", async () => {
		const counts = { reads: 0, registrationQueries: 0 };
		const originalChrome = globalThis.chrome;

		globalThis.chrome = {
			storage: {
				local: {
					async get() {
						counts.reads++;
						return {
							"tonic.targets": {
								schemaVersion: 1,
								origins: ["https://gitlab.example.com"],
							},
						};
					},
					async set() {},
				},
			},
			permissions: {
				async contains() {
					return false;
				},
				async getAll() {
					return { origins: [] };
				},
				async request() {
					return false;
				},
				async remove() {
					return true;
				},
			},
			scripting: {
				async getRegisteredContentScripts() {
					counts.registrationQueries++;
					return [];
				},
				async registerContentScripts() {},
				async unregisterContentScripts() {},
			},
			runtime: {
				getManifest: () => ({
					content_scripts: [
						{ matches: ["https://gitlab.com:443/*"], js: ["content.js"] },
					],
				}),
			},
		} as unknown as typeof chrome;

		try {
			const view = renderHook(() => useHostAccess());

			await waitFor(() => {
				expect(view.result.current.isLoading).toBe(false);
			});

			view.rerender();
			view.rerender();
			view.rerender();
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(counts.reads).toBe(1);
			expect(counts.registrationQueries).toBe(1);
			expect(view.result.current.targets).toEqual([
				{ origin: "https://gitlab.example.com", access: "permission-required" },
			]);
		} finally {
			globalThis.chrome = originalChrome;
		}
	});

	test("reports a refused address without persisting or requesting anything", async () => {
		installSessionStorage();
		installSessionStorage();
		const { counts, repository, apis } = createCountingDependencies();
		const view = renderHook(() => useHostAccess(repository, apis));

		await waitFor(() => {
			expect(view.result.current.isLoading).toBe(false);
		});

		expect(view.result.current.addOrigin("ftp://gitlab.example.com")).toBe(
			"unsupported-protocol",
		);
		expect(view.result.current.hasStaleTabs).toBe(false);
		expect(counts.reads).toBe(1);
	});

	/*
	 * Regression guard for a defect that only appears in a real toolbar popup.
	 *
	 * Chrome closes the popup when it raises the permission prompt, destroying
	 * the document and every promise still running in it. The add flow used to
	 * request first and persist "in parallel", so the storage write (a read then
	 * a write) was still in flight when the popup died: the user saw the prompt,
	 * granted it, and found an empty list. Driving a popup rendered as a tab did
	 * not reproduce it, because a tab does not close.
	 *
	 * The permission request here never settles, standing in for a prompt that
	 * outlives the document.
	 */
	test("persists the origin before the permission prompt can close the popup", async () => {
		const order: string[] = [];
		const stored: string[] = [];
		installSessionStorage();
		const { apis, repository } = createCountingDependencies();

		repository.add = async (origin: string) => {
			order.push("persist");
			stored.push(origin);
			return { schemaVersion: 1, origins: [...stored] };
		};
		apis.permissions.request = () => {
			order.push("request");
			return new Promise<boolean>(() => {});
		};

		const view = renderHook(() => useHostAccess(repository, apis));

		await waitFor(() => {
			expect(view.result.current.isLoading).toBe(false);
		});

		expect(view.result.current.addOrigin("gitlab.example.com")).toBeUndefined();
		await waitFor(() => {
			expect(order).toEqual(["persist", "request"]);
		});

		expect(stored).toEqual(["https://gitlab.example.com"]);
	});

	/*
	 * A denial must leave the origin visible and grantable rather than half-added
	 * or gone, because it is already persisted before the prompt is answered.
	 */
	test("keeps a denied origin visible as permission-required", async () => {
		installSessionStorage();
		const { apis, repository } = createCountingDependencies();
		const origins: string[] = [];

		repository.add = async (origin: string) => {
			origins.push(origin);
			return { schemaVersion: 1, origins: [...origins] };
		};
		// Denial resolves false; it does not throw.
		apis.permissions.request = async () => false;

		const view = renderHook(() => useHostAccess(repository, apis));
		await waitFor(() => {
			expect(view.result.current.isLoading).toBe(false);
		});

		view.result.current.addOrigin("gitlab.example.com");

		await waitFor(() => {
			expect(view.result.current.targets).toEqual([
				{ origin: "https://gitlab.example.com", access: "permission-required" },
			]);
		});
		expect(view.result.current.failure).toBeUndefined();
	});

	test("still shows the origin when the permission request rejects", async () => {
		installSessionStorage();
		const { apis, repository } = createCountingDependencies();
		const origins: string[] = [];

		repository.add = async (origin: string) => {
			origins.push(origin);
			return { schemaVersion: 1, origins: [...origins] };
		};
		apis.permissions.request = async () => {
			throw new Error("This function must be called during a user gesture");
		};

		const view = renderHook(() => useHostAccess(repository, apis));
		await waitFor(() => {
			expect(view.result.current.isLoading).toBe(false);
		});

		view.result.current.addOrigin("gitlab.example.com");

		await waitFor(() => {
			expect(view.result.current.failure).toBe("grant-failed");
		});
		/*
		 * Reporting a failure while the list shows no trace of the origin would
		 * tell the user the opposite of what storage holds.
		 */
		expect(view.result.current.targets).toEqual([
			{ origin: "https://gitlab.example.com", access: "permission-required" },
		]);
	});

	test("reports add-failed when the origin could not be persisted", async () => {
		installSessionStorage();
		const { apis, repository } = createCountingDependencies();
		repository.add = async () => {
			throw new Error("storage unavailable");
		};

		const view = renderHook(() => useHostAccess(repository, apis));
		await waitFor(() => {
			expect(view.result.current.isLoading).toBe(false);
		});

		view.result.current.addOrigin("gitlab.example.com");

		await waitFor(() => {
			expect(view.result.current.failure).toBe("add-failed");
		});
		expect(view.result.current.targets).toEqual([]);
	});

	test("surfaces the worker's stale-tab flag on open", async () => {
		const session = installSessionStorage({ "tonic.staleTabs": true });
		const { apis, repository } = createCountingDependencies([
			"https://gitlab.example.com",
		]);

		const view = renderHook(() => useHostAccess(repository, apis));

		await waitFor(() => {
			expect(view.result.current.hasStaleTabs).toBe(true);
		});
		// Consumed, so the notice does not follow the user around.
		expect(session["tonic.staleTabs"]).toBeUndefined();
	});

	/*
	 * Add and remove fail closed on a newer schema through the repository. Grant
	 * only reads, so it needs the guard explicitly: reconciling against the empty
	 * list a newer-schema read yields would unregister that build's scripts.
	 */
	test("grant does not reconcile against a list it cannot trust", async () => {
		installSessionStorage();
		const { apis, repository } = createCountingDependencies();
		const unregistered: string[][] = [];

		repository.read = async () => ({
			outcome: "newer-schema",
			targets: { schemaVersion: 1, origins: [] },
			droppedOrigins: [],
		});
		apis.scripting.getRegisteredContentScripts = async () => [
			{ id: "tonic-origin-aHR0cHM6Ly9nbC5leGFtcGxl" },
		];
		apis.scripting.unregisterContentScripts = async ({ ids }) => {
			unregistered.push(ids);
		};

		const view = renderHook(() => useHostAccess(repository, apis));
		await waitFor(() => {
			expect(view.result.current.isLoading).toBe(false);
		});

		view.result.current.grantOrigin("https://gl.example");

		await waitFor(() => {
			expect(view.result.current.failure).toBe("untrusted-targets");
		});
		expect(unregistered).toEqual([]);
	});

	/*
	 * An unusable container resolves to an empty list exactly as a newer schema
	 * does, and empty means "unknown" in both cases. Reconciling against it would
	 * unregister every custom script and strand the granted permissions.
	 */
	test("does not unregister anything when stored targets are unusable", async () => {
		installSessionStorage();
		const { apis, repository } = createCountingDependencies();
		const unregistered: string[][] = [];

		repository.read = async () => ({
			outcome: "reset",
			targets: { schemaVersion: 1, origins: [] },
			droppedOrigins: [],
		});
		apis.scripting.getRegisteredContentScripts = async () => [
			{ id: "tonic-origin-aHR0cHM6Ly9nbC5leGFtcGxl" },
		];
		apis.scripting.unregisterContentScripts = async ({ ids }) => {
			unregistered.push(ids);
		};

		const view = renderHook(() => useHostAccess(repository, apis));

		await waitFor(() => {
			expect(view.result.current.failure).toBe("untrusted-targets");
		});
		expect(unregistered).toEqual([]);
	});
});
