import {
	BUILT_IN_ORIGIN,
	CONTENT_SCRIPT_ID_PREFIX,
	toContentScriptId,
	toOriginPattern,
} from "./target-origin";

/*
 * Derives access from stored origins, permissions and registrations. The popup
 * and worker may reconcile concurrently, so a failed registration is checked
 * again before it is reported as broken.
 */

/** The subset of the manifest this needs. */
interface HostAccessManifest {
	content_scripts?: Array<{
		matches?: string[];
		js?: string[];
		css?: string[];
		run_at?: "document_start" | "document_end" | "document_idle";
	}>;
}

interface RegisteredScript {
	id: string;
	matches?: string[];
	js?: string[];
	css?: string[];
	runAt?: "document_start" | "document_end" | "document_idle";
	persistAcrossSessions?: boolean;
}

export interface HostAccessApis {
	permissions: {
		contains(permissions: { origins: string[] }): Promise<boolean>;
		getAll(): Promise<{ origins?: string[] }>;
		request(permissions: { origins: string[] }): Promise<boolean>;
		remove(permissions: { origins: string[] }): Promise<boolean>;
	};
	scripting: {
		getRegisteredContentScripts(): Promise<RegisteredScript[]>;
		registerContentScripts(scripts: RegisteredScript[]): Promise<void>;
		unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
	};
	runtime: {
		getManifest(): HostAccessManifest;
	};
}

function registrationMatchesOrigin(
	script: RegisteredScript,
	origin: string,
): boolean {
	return (
		script.matches?.length === 1 &&
		script.matches[0] === toOriginPattern(origin)
	);
}

export function createHostAccessApis(): HostAccessApis {
	return {
		permissions: chrome.permissions,
		scripting: chrome.scripting,
		runtime: chrome.runtime,
	};
}

export type TargetAccess =
	/** Permission granted and the content script is registered. */
	| "active"
	/** Configured, but the browser has no host permission for it. */
	| "permission-required"
	/** Permission granted, but the script could not be registered. */
	| "registration-failed";

export interface TargetState {
	origin: string;
	access: TargetAccess;
}

export interface TargetReconciliation {
	targets: TargetState[];
	/**
	 * Whether a changed permission or registration requires existing tabs to reload.
	 * A permission grant closes the popup, so its registration runs on the next open.
	 */
	changed: boolean;
}

/*
 * Read bundler-rewritten paths and `run_at` from the built GitLab.com entry so
 * dynamic registrations run the same bundle at the same time. Match its origin
 * pattern, never array position, because another static script may be added first.
 */
function readInjectedFiles(manifest: HostAccessManifest):
	| {
			js: string[];
			css: string[];
			runAt: "document_start" | "document_end" | "document_idle";
	  }
	| undefined {
	const builtInPattern = toOriginPattern(BUILT_IN_ORIGIN);
	const entry = manifest.content_scripts?.find((script) =>
		script.matches?.includes(builtInPattern),
	);

	if (!entry?.js || entry.js.length === 0) {
		return undefined;
	}

	return {
		js: entry.js,
		css: entry.css ?? [],
		runAt: entry.run_at ?? "document_idle",
	};
}

/** Reconciles registrations one origin at a time and reports each effective state. */
export async function reconcileTargets(
	origins: readonly string[],
	apis: HostAccessApis,
): Promise<TargetReconciliation> {
	let changed = false;
	const desired = new Map(
		origins.map((origin) => [toContentScriptId(origin), origin]),
	);
	const registered = await apis.scripting.getRegisteredContentScripts();
	const owned = new Map(
		registered
			.filter((script) => script.id.startsWith(CONTENT_SCRIPT_ID_PREFIX))
			.map((script) => [script.id, script]),
	);

	const permitted = new Set<string>();

	await Promise.all(
		origins.map(async (origin) => {
			try {
				if (
					await apis.permissions.contains({
						origins: [toOriginPattern(origin)],
					})
				) {
					permitted.add(origin);
				}
			} catch {
				// An unreadable permission is reported as missing, never as granted.
			}
		}),
	);

	const obsoleteIds = [...owned].flatMap(([id, script]) => {
		const origin = desired.get(id);

		// Wrong matches include exact-port registrations from earlier builds.
		return origin === undefined ||
			!permitted.has(origin) ||
			!registrationMatchesOrigin(script, origin)
			? [id]
			: [];
	});

	if (obsoleteIds.length > 0) {
		// A concurrent reconciler may already have removed an ID. Re-read Chrome's state on failure.
		try {
			await apis.scripting.unregisterContentScripts({ ids: obsoleteIds });
			changed = true;

			for (const id of obsoleteIds) {
				owned.delete(id);
			}
		} catch (error) {
			console.error("Tonic could not unregister a content script", error);

			const current = await apis.scripting.getRegisteredContentScripts();
			const currentById = new Map(current.map((script) => [script.id, script]));

			for (const id of obsoleteIds) {
				const script = currentById.get(id);

				if (script === undefined) {
					owned.delete(id);
					changed = true;
				} else {
					owned.set(id, script);
				}
			}
		}
	}

	const injected = readInjectedFiles(apis.runtime.getManifest());
	const states: TargetState[] = [];
	let reportedMissingInjection = false;

	for (const origin of origins) {
		if (!permitted.has(origin)) {
			states.push({ origin, access: "permission-required" });
			continue;
		}

		const id = toContentScriptId(origin);

		const existing = owned.get(id);

		if (existing && registrationMatchesOrigin(existing, origin)) {
			states.push({ origin, access: "active" });
			continue;
		}

		if (injected === undefined) {
			// Reported once per reconciliation, and only when it actually blocks.
			if (!reportedMissingInjection) {
				reportedMissingInjection = true;
				console.error(
					"Tonic found no content script in its own manifest; self-managed origins cannot be registered",
				);
			}

			states.push({ origin, access: "registration-failed" });
			continue;
		}

		try {
			const registration = {
				id,
				matches: [toOriginPattern(origin)],
				js: injected.js,
				css: injected.css,
				runAt: injected.runAt,
				persistAcrossSessions: true,
			};
			await apis.scripting.registerContentScripts([registration]);
			owned.set(id, registration);
			changed = true;
			states.push({ origin, access: "active" });
		} catch (error) {
			// A concurrent reconciler may have registered this ID after our read.
			const current = await apis.scripting.getRegisteredContentScripts();

			if (
				current.some(
					(script) =>
						script.id === id && registrationMatchesOrigin(script, origin),
				)
			) {
				states.push({ origin, access: "active" });
				continue;
			}

			console.error("Tonic could not register a content script", origin, error);
			states.push({ origin, access: "registration-failed" });
		}
	}

	return { targets: states, changed };
}

/** Requests the origin's scheme and hostname on every port. Must follow a user gesture. */
export function requestTargetAccess(
	origin: string,
	apis: HostAccessApis,
): Promise<boolean> {
	return apis.permissions.request({ origins: [toOriginPattern(origin)] });
}

/**
 * Unregisters first, then revokes.
 *
 * The reverse order can leave a granted permission with nothing in the UI
 * pointing at it, which is access the user cannot see or take back from here.
 * Every state this order can stop in is visible and recoverable.
 */
export async function releaseTargetAccess(
	origin: string,
	retainedOrigins: readonly string[],
	apis: HostAccessApis,
): Promise<void> {
	const pattern = toOriginPattern(origin);
	if (retainedOrigins.some((entry) => toOriginPattern(entry) === pattern)) {
		return;
	}

	try {
		await apis.scripting.unregisterContentScripts({
			ids: [toContentScriptId(origin)],
		});
	} catch {
		// Chrome rejects an unknown script ID. Nothing to unregister is success.
	}

	/*
	 * A `false` result means the permission is still held by something broader,
	 * which a user can produce from Chrome's own site-access UI by choosing "on
	 * all sites" against the optional envelope. Refusing to remove there left the
	 * row undeletable, which is worse than the access it was guarding: the script
	 * is already unregistered above, so Tonic no longer injects anywhere for this
	 * origin regardless of what the browser still grants. Removal continues.
	 */
	const removed = await apis.permissions.remove({
		origins: [pattern],
	});

	if (!removed) {
		console.warn(
			"Tonic unregistered this instance, but the browser still grants access to it through a broader permission",
			origin,
		);
	}
}
