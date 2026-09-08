import { describe, expect, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { HostAccessApis } from "../host-access/registration";
import { toContentScriptId } from "../host-access/target-origin";
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
					{ matches: ["https://gitlab.com/*"], js: ["content.js"] },
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
						{ matches: ["https://gitlab.com/*"], js: ["content.js"] },
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

	test("persists an origin without spending the add click's user activation", async () => {
		const order: string[] = [];
		const stored: string[] = [];
		installSessionStorage();
		const { apis, repository } = createCountingDependencies();

		repository.add = async (origin: string) => {
			order.push("persist");
			stored.push(origin);
			return { schemaVersion: 1, origins: [...stored] };
		};
		apis.permissions.request = async () => {
			order.push("request");
			return true;
		};

		const view = renderHook(() => useHostAccess(repository, apis));

		await waitFor(() => {
			expect(view.result.current.isLoading).toBe(false);
		});

		expect(view.result.current.addOrigin("gitlab.example.com")).toBeUndefined();
		await waitFor(() => {
			expect(view.result.current.targets).toEqual([
				{ origin: "https://gitlab.example.com", access: "permission-required" },
			]);
		});

		expect(order).toEqual(["persist"]);
		expect(stored).toEqual(["https://gitlab.example.com"]);
	});

	test("keeps a new origin visible as permission-required", async () => {
		installSessionStorage();
		const { apis, repository } = createCountingDependencies();
		const origins: string[] = [];

		repository.add = async (origin: string) => {
			origins.push(origin);
			return { schemaVersion: 1, origins: [...origins] };
		};
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

	test("requests permission immediately from the separate Grant click", async () => {
		installSessionStorage();
		const { apis, repository } = createCountingDependencies();
		const origins: string[] = [];
		const order: string[] = [];

		repository.add = async (origin: string) => {
			origins.push(origin);
			return { schemaVersion: 1, origins: [...origins] };
		};
		let requestAttempts = 0;
		apis.permissions.request = () => {
			requestAttempts++;
			order.push("request");

			if (requestAttempts === 1) {
				throw new Error("This function must be called during a user gesture");
			}

			return Promise.resolve(false);
		};
		repository.read = async () => {
			order.push("read");
			return {
				outcome: "stored",
				targets: { schemaVersion: 1, origins: [...origins] },
				droppedOrigins: [],
			};
		};

		const view = renderHook(() => useHostAccess(repository, apis));
		await waitFor(() => {
			expect(view.result.current.isLoading).toBe(false);
		});

		view.result.current.addOrigin("gitlab.example.com");
		await waitFor(() => {
			expect(view.result.current.targets).toHaveLength(1);
		});
		order.length = 0;

		view.result.current.grantOrigin("https://gitlab.example.com");
		expect(order).toEqual(["request"]);

		await waitFor(() => {
			expect(view.result.current.failure).toBe("grant-failed");
		});
		expect(view.result.current.targets).toEqual([
			{ origin: "https://gitlab.example.com", access: "permission-required" },
		]);

		view.result.current.grantOrigin("https://gitlab.example.com");
		expect(requestAttempts).toBe(2);
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

	test("rejects an add that races an access mutation without persisting it", async () => {
		installSessionStorage();
		const origin = "https://gitlab.example.com";
		const { apis, repository } = createCountingDependencies([origin]);
		let finishRequest: ((granted: boolean) => void) | undefined;
		let adds = 0;

		apis.permissions.request = () =>
			new Promise<boolean>((resolve) => {
				finishRequest = resolve;
			});
		repository.add = async () => {
			adds++;
			return { schemaVersion: 1, origins: [origin] };
		};

		const view = renderHook(() => useHostAccess(repository, apis));
		await waitFor(() => {
			expect(view.result.current.isLoading).toBe(false);
		});

		act(() => view.result.current.grantOrigin(origin));
		expect(view.result.current.addOrigin("new.example.com")).toBe("busy");
		expect(adds).toBe(0);

		await act(async () => finishRequest?.(false));
		await waitFor(() => {
			expect(view.result.current.busyOrigin).toBeUndefined();
		});
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

	test("reads current stored siblings before releasing shared access", async () => {
		installSessionStorage();
		const first = "https://gitlab.example.com:8443";
		const second = "https://gitlab.example.com:9443";
		let origins = [first];
		let unregisters = 0;
		let permissionRemovals = 0;
		const { apis, repository } = createCountingDependencies();

		repository.read = async () => ({
			outcome: "stored",
			targets: { schemaVersion: 1, origins: [...origins] },
			droppedOrigins: [],
		});
		repository.remove = async (origin: string) => {
			origins = origins.filter((entry) => entry !== origin);
			return { schemaVersion: 1, origins: [...origins] };
		};
		apis.permissions.contains = async () => true;
		apis.permissions.remove = async () => {
			permissionRemovals++;
			return true;
		};
		apis.scripting.getRegisteredContentScripts = async () => [
			{
				id: toContentScriptId(first),
				matches: ["https://gitlab.example.com/*"],
			},
		];
		apis.scripting.unregisterContentScripts = async () => {
			unregisters++;
		};

		const view = renderHook(() => useHostAccess(repository, apis));
		await waitFor(() => {
			expect(view.result.current.targets).toHaveLength(1);
		});

		origins = [first, second];
		act(() => view.result.current.removeOrigin(first));

		await waitFor(() => {
			expect(
				view.result.current.targets.map((target) => target.origin),
			).toEqual([second]);
		});
		expect(unregisters).toBe(0);
		expect(permissionRemovals).toBe(0);
	});

	test("does not release or remove when current stored targets are untrusted", async () => {
		installSessionStorage();
		const origin = "https://gitlab.example.com";
		let outcome: "stored" | "newer-schema" = "stored";
		let removals = 0;
		let releases = 0;
		const { apis, repository } = createCountingDependencies();

		repository.read = async () => ({
			outcome,
			targets: { schemaVersion: 1, origins: [origin] },
			droppedOrigins: [],
		});
		repository.remove = async () => {
			removals++;
			return { schemaVersion: 1, origins: [] };
		};
		apis.scripting.unregisterContentScripts = async () => {
			releases++;
		};
		apis.permissions.remove = async () => {
			releases++;
			return true;
		};

		const view = renderHook(() => useHostAccess(repository, apis));
		await waitFor(() => {
			expect(view.result.current.isLoading).toBe(false);
		});

		outcome = "newer-schema";
		act(() => view.result.current.removeOrigin(origin));

		await waitFor(() => {
			expect(view.result.current.failure).toBe("untrusted-targets");
		});
		expect(removals).toBe(0);
		expect(releases).toBe(0);
	});

	test("does not release or remove when current stored targets cannot be read", async () => {
		installSessionStorage();
		const origin = "https://gitlab.example.com";
		let failRead = false;
		let removals = 0;
		let releases = 0;
		const { apis, repository } = createCountingDependencies();

		repository.read = async () => {
			if (failRead) {
				throw new Error("storage unavailable");
			}

			return {
				outcome: "stored",
				targets: { schemaVersion: 1, origins: [origin] },
				droppedOrigins: [],
			};
		};
		repository.remove = async () => {
			removals++;
			return { schemaVersion: 1, origins: [] };
		};
		apis.scripting.unregisterContentScripts = async () => {
			releases++;
		};
		apis.permissions.remove = async () => {
			releases++;
			return true;
		};

		const view = renderHook(() => useHostAccess(repository, apis));
		await waitFor(() => {
			expect(view.result.current.isLoading).toBe(false);
		});

		failRead = true;
		act(() => view.result.current.removeOrigin(origin));

		await waitFor(() => {
			expect(view.result.current.failure).toBe("remove-failed");
		});
		expect(removals).toBe(0);
		expect(releases).toBe(0);
	});

	test("blocks concurrent sibling-port removals so their shared permission is revoked", async () => {
		installSessionStorage();
		const first = "https://gitlab.example.com:8443";
		const second = "https://gitlab.example.com:9443";
		let origins = [first, second];
		const registered = new Set([toContentScriptId(first)]);
		let permissionRemovals = 0;
		const { apis, repository } = createCountingDependencies(origins);

		repository.read = async () => ({
			outcome: "stored",
			targets: { schemaVersion: 1, origins: [...origins] },
			droppedOrigins: [],
		});
		repository.remove = async (origin: string) => {
			origins = origins.filter((entry) => entry !== origin);
			return { schemaVersion: 1, origins: [...origins] };
		};
		apis.permissions.contains = async () => true;
		apis.permissions.remove = async () => {
			permissionRemovals++;
			return true;
		};
		apis.scripting.getRegisteredContentScripts = async () =>
			[...registered].map((id) => ({
				id,
				matches: ["https://gitlab.example.com/*"],
			}));
		apis.scripting.unregisterContentScripts = async ({ ids }) => {
			for (const id of ids) {
				registered.delete(id);
			}
		};

		const view = renderHook(() => useHostAccess(repository, apis));
		await waitFor(() => {
			expect(view.result.current.targets).toHaveLength(2);
		});

		act(() => {
			view.result.current.removeOrigin(first);
			view.result.current.removeOrigin(second);
		});

		await waitFor(() => {
			expect(
				view.result.current.targets.map((target) => target.origin),
			).toEqual([second]);
		});
		expect(permissionRemovals).toBe(0);
		expect(registered).toEqual(new Set([toContentScriptId(first)]));

		act(() => view.result.current.removeOrigin(second));
		await waitFor(() => {
			expect(view.result.current.targets).toEqual([]);
		});
		expect(permissionRemovals).toBe(1);
		expect(registered).toEqual(new Set());
	});
});
