import { describe, expect, test } from "bun:test";
import {
	type HostAccessApis,
	reconcileTargets,
	releaseTargetAccess,
	requestTargetAccess,
} from "./registration";
import { toContentScriptId, toOriginPattern } from "./target-origin";

interface FakeRegisteredScript {
	id: string;
	matches?: string[];
}

function registeredScript(origin: string): FakeRegisteredScript {
	return {
		id: toContentScriptId(origin),
		matches: [toOriginPattern(origin)],
	};
}

interface FakeApis extends HostAccessApis {
	calls: {
		registered: Array<{
			id: string;
			matches?: string[];
			js?: string[];
			css?: string[];
			runAt?: string;
			persistAcrossSessions?: boolean;
		}>;
		unregistered: string[][];
		requested: string[][];
		removed: string[][];
	};
}

function createFakeApis({
	granted = [],
	registered = [],
	contentScripts = [
		{
			matches: ["https://gitlab.com:443/*"],
			js: ["content/index.js"],
			css: ["features/dim-draft-merge-requests/styles.css"],
		},
	],
	failRegisterFor,
	containsThrowsFor,
}: {
	granted?: string[];
	registered?: FakeRegisteredScript[];
	contentScripts?: Array<{
		matches?: string[];
		js?: string[];
		css?: string[];
		run_at?: "document_start" | "document_end" | "document_idle";
	}>;
	failRegisterFor?: string;
	containsThrowsFor?: string;
} = {}): FakeApis {
	const grantedOrigins = new Set(granted);
	const registeredScripts = new Map(
		registered.map((script) => [script.id, script]),
	);
	const calls: FakeApis["calls"] = {
		registered: [],
		unregistered: [],
		requested: [],
		removed: [],
	};

	return {
		calls,
		permissions: {
			async contains({ origins }) {
				if (containsThrowsFor && origins.includes(containsThrowsFor)) {
					throw new Error("permission state unavailable");
				}

				return origins.every((origin) => grantedOrigins.has(origin));
			},
			async getAll() {
				return { origins: [...grantedOrigins] };
			},
			async request({ origins }) {
				calls.requested.push(origins);
				return true;
			},
			async remove({ origins }) {
				calls.removed.push(origins);

				for (const origin of origins) {
					grantedOrigins.delete(origin);
				}

				return true;
			},
		},
		scripting: {
			async getRegisteredContentScripts() {
				return [...registeredScripts.values()];
			},
			async registerContentScripts(scripts) {
				for (const script of scripts) {
					if (failRegisterFor && script.matches?.includes(failRegisterFor)) {
						throw new Error("registration refused");
					}

					calls.registered.push(script);
					registeredScripts.set(script.id, script);
				}
			},
			async unregisterContentScripts({ ids }) {
				for (const id of ids) {
					if (!registeredScripts.has(id)) {
						throw new Error(`Nonexistent script ID ${id}`);
					}

					registeredScripts.delete(id);
				}

				calls.unregistered.push(ids);
			},
		},
		runtime: {
			getManifest: () => ({ content_scripts: contentScripts }),
		},
	};
}

describe("target reconciliation", () => {
	/*
	 * Dynamic registration needs built paths, and the source manifest's paths are
	 * rewritten by the bundler. Reading them back from the built manifest is what
	 * stops a self-managed origin running a different bundle from GitLab.com.
	 */
	test("registers a permitted origin with the files the built manifest declares", async () => {
		const apis = createFakeApis({ granted: ["http://localhost:10019/*"] });
		const { targets: states, changed } = await reconcileTargets(
			["http://localhost:10019"],
			apis,
		);

		expect(states).toEqual([
			{ origin: "http://localhost:10019", access: "active" },
		]);
		expect(changed).toBe(true);
		expect(apis.calls.registered).toEqual([
			{
				id: toContentScriptId("http://localhost:10019"),
				matches: ["http://localhost:10019/*"],
				js: ["content/index.js"],
				css: ["features/dim-draft-merge-requests/styles.css"],
				runAt: "document_idle",
				persistAcrossSessions: true,
			},
		]);
	});

	test("does not register an origin the browser has no permission for", async () => {
		const apis = createFakeApis();
		const { targets: states } = await reconcileTargets(
			["https://gitlab.example.com"],
			apis,
		);

		expect(states).toEqual([
			{ origin: "https://gitlab.example.com", access: "permission-required" },
		]);
		expect(apis.calls.registered).toEqual([]);
	});

	test("treats an unreadable permission as missing, never as granted", async () => {
		const apis = createFakeApis({
			granted: ["https://gitlab.example.com:443/*"],
			containsThrowsFor: "https://gitlab.example.com:443/*",
		});
		const { targets: states } = await reconcileTargets(
			["https://gitlab.example.com"],
			apis,
		);

		expect(states).toEqual([
			{ origin: "https://gitlab.example.com", access: "permission-required" },
		]);
	});

	test("leaves an already registered origin alone", async () => {
		const apis = createFakeApis({
			granted: ["https://gitlab.example.com:443/*"],
			registered: [registeredScript("https://gitlab.example.com")],
		});
		const { targets: states, changed } = await reconcileTargets(
			["https://gitlab.example.com"],
			apis,
		);

		expect(states).toEqual([
			{ origin: "https://gitlab.example.com", access: "active" },
		]);
		// Nothing to do means nothing to reload for.
		expect(changed).toBe(false);
		expect(apis.calls.registered).toEqual([]);
		expect(apis.calls.unregistered).toEqual([]);
	});

	test("replaces a legacy wildcard-port registration under its existing ID", async () => {
		const origin = "https://gitlab.example.com";
		const id = toContentScriptId(origin);
		const apis = createFakeApis({
			granted: ["https://gitlab.example.com:443/*"],
			registered: [{ id, matches: ["https://gitlab.example.com/*"] }],
		});

		expect(await reconcileTargets([origin], apis)).toEqual({
			targets: [{ origin, access: "active" }],
			changed: true,
		});
		expect(apis.calls.unregistered).toEqual([[id]]);
		expect(apis.calls.registered[0]?.matches).toEqual([
			"https://gitlab.example.com:443/*",
		]);
	});

	test("revokes a legacy wildcard-port grant and keeps its configured row", async () => {
		const origin = "http://localhost";
		const id = toContentScriptId(origin);
		const apis = createFakeApis({
			granted: ["http://localhost/*"],
			registered: [{ id, matches: ["http://localhost/*"] }],
		});

		expect(await reconcileTargets([origin], apis)).toEqual({
			targets: [{ origin, access: "permission-required" }],
			changed: true,
		});
		expect(apis.calls.removed).toEqual([["http://localhost/*"]]);
		expect(apis.calls.unregistered).toEqual([[id]]);
		expect(apis.calls.registered).toEqual([]);
	});

	test("keeps sibling-port rows when Chrome revokes their grants with the legacy wildcard", async () => {
		const origins = ["http://localhost", "http://localhost:10019"];
		const apis = createFakeApis({
			granted: ["http://localhost/*", "http://localhost:10019/*"],
			registered: [
				{
					id: toContentScriptId(origins[0]),
					matches: ["http://localhost/*"],
				},
				registeredScript(origins[1]),
			],
		});
		let legacyGrantRemoved = false;
		const { remove } = apis.permissions;
		apis.permissions.remove = async (permissions) => {
			legacyGrantRemoved = true;
			return remove(permissions);
		};
		apis.permissions.contains = async () => !legacyGrantRemoved;

		expect(await reconcileTargets(origins, apis)).toEqual({
			targets: origins.map((origin) => ({
				origin,
				access: "permission-required",
			})),
			changed: true,
		});
		expect(apis.calls.removed).toEqual([["http://localhost/*"]]);
		expect(apis.calls.unregistered).toEqual([origins.map(toContentScriptId)]);
	});

	test("never accepts a stale wildcard registration after losing an unregister race", async () => {
		const origin = "https://gitlab.example.com";
		const stale = {
			id: toContentScriptId(origin),
			matches: ["https://gitlab.example.com/*"],
		};
		const apis = createFakeApis({
			granted: ["https://gitlab.example.com:443/*"],
			registered: [stale],
		});
		apis.scripting.unregisterContentScripts = async () => {
			throw new Error("Nonexistent script ID");
		};
		apis.scripting.getRegisteredContentScripts = async () => [stale];
		apis.scripting.registerContentScripts = async () => {
			throw new Error(`Duplicate script ID ${stale.id}`);
		};

		expect(await reconcileTargets([origin], apis)).toEqual({
			targets: [{ origin, access: "registration-failed" }],
			changed: false,
		});
	});

	test("unregisters a removed origin and one whose permission is gone", async () => {
		const apis = createFakeApis({
			granted: ["https://kept.example.com:443/*"],
			registered: [
				registeredScript("https://kept.example.com"),
				registeredScript("https://removed.example.com"),
				registeredScript("https://revoked.example.com"),
			],
		});
		const { targets: states, changed } = await reconcileTargets(
			["https://kept.example.com", "https://revoked.example.com"],
			apis,
		);

		expect(states).toEqual([
			{ origin: "https://kept.example.com", access: "active" },
			{ origin: "https://revoked.example.com", access: "permission-required" },
		]);
		expect(changed).toBe(true);
		expect(apis.calls.unregistered).toEqual([
			[
				toContentScriptId("https://removed.example.com"),
				toContentScriptId("https://revoked.example.com"),
			],
		]);
	});

	/*
	 * Chrome rejects the whole batch when any ID is already gone, and the action
	 * and worker reconcile independently. Unguarded this threw out of
	 * reconciliation and the popup fell back to showing only the built-in row.
	 */
	test("survives the other reconciler having already unregistered", async () => {
		const apis = createFakeApis({
			granted: ["https://kept.example.com:443/*"],
			registered: [
				registeredScript("https://kept.example.com"),
				registeredScript("https://removed.example.com"),
			],
		});
		apis.scripting.unregisterContentScripts = async () => {
			throw new Error("Nonexistent script ID");
		};
		apis.scripting.getRegisteredContentScripts = async () => [
			registeredScript("https://kept.example.com"),
		];

		const { targets } = await reconcileTargets(
			["https://kept.example.com"],
			apis,
		);

		expect(targets).toEqual([
			{ origin: "https://kept.example.com", access: "active" },
		]);
	});

	test("never touches a registration this feature does not own", async () => {
		const apis = createFakeApis({
			registered: [{ id: "someone-elses-script" }],
		});

		expect(await reconcileTargets([], apis)).toEqual({
			targets: [],
			changed: false,
		});
		expect(apis.calls.unregistered).toEqual([]);
	});

	/*
	 * Registration runs one origin at a time so a single failure is reported
	 * against that row instead of hiding the state of every other instance.
	 */
	test("reports a failed registration without losing the other rows", async () => {
		const apis = createFakeApis({
			granted: [
				"https://broken.example.com:443/*",
				"https://fine.example.com:443/*",
			],
			failRegisterFor: "https://broken.example.com:443/*",
		});
		const { targets: states } = await reconcileTargets(
			["https://broken.example.com", "https://fine.example.com"],
			apis,
		);

		expect(states).toEqual([
			{ origin: "https://broken.example.com", access: "registration-failed" },
			{ origin: "https://fine.example.com", access: "active" },
		]);
	});

	/*
	 * The entry is matched by its origin pattern, not by position. Reading
	 * `content_scripts[0]` would silently register some other bundle for every
	 * self-managed origin the moment a second static content script is added.
	 */
	/*
	 * Timing is part of "run the same script as GitLab.com". Hardcoding it here
	 * would let an edit to `src/manifest.json` inject at one moment on GitLab.com
	 * and another on every user-added origin, which is the divergence reading the
	 * built entry exists to prevent.
	 */
	test("takes run_at from the same manifest entry as the files", async () => {
		const apis = createFakeApis({
			granted: ["https://gitlab.example.com:443/*"],
			contentScripts: [
				{
					matches: ["https://gitlab.com:443/*"],
					js: ["content/index.js"],
					css: ["content/index.css"],
					run_at: "document_start",
				},
			],
		});

		await reconcileTargets(["https://gitlab.example.com"], apis);

		expect(apis.calls.registered[0]?.runAt).toBe("document_start");
	});

	test("finds the GitLab.com entry whatever its position in the manifest", async () => {
		const apis = createFakeApis({
			granted: ["https://gitlab.example.com:443/*"],
			contentScripts: [
				{ matches: ["https://example.com/*"], js: ["other/entry.js"] },
				{
					matches: ["https://gitlab.com:443/*"],
					js: ["content/index.js"],
					css: ["features/dim-draft-merge-requests/styles.css"],
				},
			],
		});
		await reconcileTargets(["https://gitlab.example.com"], apis);

		expect(apis.calls.registered[0]?.js).toEqual(["content/index.js"]);
	});

	/*
	 * The action and the worker reconcile independently and can overlap. Chrome
	 * rejects the second registration of an ID that now exists, and reporting
	 * that as a broken instance would be the opposite of the truth.
	 */
	test("treats a lost registration race as active, not as a failure", async () => {
		const apis = createFakeApis({
			granted: ["https://gitlab.example.com:443/*"],
		});
		const id = toContentScriptId("https://gitlab.example.com");
		let registeredElsewhere = false;

		apis.scripting.getRegisteredContentScripts = async () =>
			registeredElsewhere
				? [registeredScript("https://gitlab.example.com")]
				: [];
		apis.scripting.registerContentScripts = async () => {
			// The other reconciler won between the read above and this call.
			registeredElsewhere = true;
			throw new Error(`Duplicate script ID ${id}`);
		};

		const { targets } = await reconcileTargets(
			["https://gitlab.example.com"],
			apis,
		);

		expect(targets).toEqual([
			{ origin: "https://gitlab.example.com", access: "active" },
		]);
	});

	test("reports a build with no content script instead of claiming success", async () => {
		const apis = createFakeApis({
			granted: ["https://gitlab.example.com:443/*"],
			contentScripts: [],
		});
		const { targets: states } = await reconcileTargets(
			["https://gitlab.example.com"],
			apis,
		);

		expect(states).toEqual([
			{ origin: "https://gitlab.example.com", access: "registration-failed" },
		]);
	});
});

describe("granting and releasing access", () => {
	test("requests the exact origin, never a broader pattern", async () => {
		const apis = createFakeApis();

		expect(await requestTargetAccess("http://localhost", apis)).toBe(true);
		expect(await requestTargetAccess("https://gitlab.example.com", apis)).toBe(
			true,
		);
		expect(await requestTargetAccess("http://localhost:10019", apis)).toBe(
			true,
		);
		expect(apis.calls.requested).toEqual([
			["http://localhost:80/*"],
			["https://gitlab.example.com:443/*"],
			["http://localhost:10019/*"],
		]);
	});

	/*
	 * The reverse order can leave a granted permission with nothing in the UI
	 * pointing at it, which is access the user cannot see or take back.
	 */
	test("unregisters before revoking", async () => {
		const order: string[] = [];
		const apis = createFakeApis({
			registered: [registeredScript("https://gitlab.example.com")],
		});
		const { unregisterContentScripts } = apis.scripting;
		apis.scripting.unregisterContentScripts = async (filter) => {
			order.push("unregister");
			await unregisterContentScripts(filter);
		};
		const { remove } = apis.permissions;
		apis.permissions.remove = async (permissions) => {
			order.push("revoke");
			return remove(permissions);
		};

		await releaseTargetAccess("https://gitlab.example.com", apis);

		expect(order).toEqual(["unregister", "revoke"]);
		expect(apis.calls.removed).toEqual([["https://gitlab.example.com:443/*"]]);
	});

	/*
	 * Chrome's own site-access UI can grant "on all sites" against the optional
	 * envelope, and the per-origin revoke then returns false. Refusing removal
	 * there left the row undeletable; the script is already unregistered, so
	 * Tonic no longer injects for the origin either way.
	 */
	test("completes removal when a broader grant refuses the revoke", async () => {
		const apis = createFakeApis({
			registered: [registeredScript("https://gitlab.example.com")],
		});
		apis.permissions.remove = async () => false;

		await releaseTargetAccess("https://gitlab.example.com", apis);

		expect(apis.calls.unregistered).toEqual([
			[toContentScriptId("https://gitlab.example.com")],
		]);
	});

	test("still revokes when there was no registration to remove", async () => {
		const apis = createFakeApis();

		await releaseTargetAccess("https://gitlab.example.com", apis);

		expect(apis.calls.removed).toEqual([["https://gitlab.example.com:443/*"]]);
	});
});
