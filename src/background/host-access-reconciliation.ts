import {
	type HostAccessApis,
	reconcileTargets,
} from "../host-access/registration";
import { markTabsStale } from "../host-access/stale-tabs";
import {
	isUntrustedTargets,
	type TargetsRepository,
} from "../host-access/targets-repository";

/**
 * Keeps dynamic content-script registrations alive for self-managed origins.
 *
 * This worker exists because the documented gate for adding one failed. Chrome
 * discards dynamically registered content scripts when the extension is
 * reloaded or updated, even with `persistAcrossSessions: true`: a script
 * registered for a granted origin was verified present, then gone after
 * `chrome.runtime.reload()`. Without this, a self-managed instance silently
 * stopped working after every extension update until the user happened to open
 * the toolbar action, and nothing told them to.
 *
 * It owns no state. Every run derives the answer from stored origins, the
 * browser's permissions, and the browser's current registrations, which is the
 * same reconciliation the toolbar action runs. Manifest V3 may stop this worker
 * between events, and nothing here cares.
 *
 * `permissions.onAdded` also closes a gap the action cannot: Chrome dismisses
 * the popup when it raises a permission prompt, so the grant usually lands with
 * no popup left to register the script.
 */
export function registerHostAccessReconciliation(
	events: {
		runtime: Pick<typeof chrome.runtime, "onInstalled" | "onStartup">;
		permissions: Pick<typeof chrome.permissions, "onAdded" | "onRemoved">;
	},
	repository: TargetsRepository,
	apis: HostAccessApis,
): void {
	const reconcile = async (): Promise<void> => {
		try {
			const resolution = await repository.read();

			/*
			 * The empty list a newer schema or an unusable container resolves to
			 * means "unknown", not "none configured". Unregistering on it would
			 * strand granted permissions with nothing pointing at them.
			 */
			if (isUntrustedTargets(resolution.outcome)) {
				return;
			}

			const reconciliation = await reconcileTargets(
				resolution.targets.origins,
				apis,
			);

			/*
			 * Marked whenever a registration actually changed, rather than per
			 * event. Having to register means tabs loaded without the script, and
			 * unregistering means they are still running one; both need a reload.
			 *
			 * This is also self-correcting for browser startup, which must not nag.
			 * Registrations that survived the restart are found already present, so
			 * nothing changed and nothing is marked. Only a startup that had to
			 * rebuild them marks, and there the open tabs really are stale.
			 *
			 * The action is normally closed when this runs and its own later
			 * reconciliation will report no change, so this is the only place the
			 * fact survives.
			 */
			if (reconciliation.changed) {
				await markTabsStale();
			}
		} catch (error) {
			console.error("Tonic could not reconcile GitLab instance access", error);
		}
	};

	/*
	 * Serialized rather than concurrent. A permission event can arrive after an
	 * active pass has sampled the old permission state, so it queues one fresh
	 * pass. Multiple events during the same pass coalesce into that one follow-up.
	 * This also avoids duplicate registration attempts when module scope runs
	 * before Chrome dispatches the event that woke the worker.
	 */
	let inFlight: Promise<void> | undefined;
	let queued = false;

	const run = () => {
		queued = true;

		if (inFlight) {
			return;
		}

		const drain = async (): Promise<void> => {
			while (queued) {
				queued = false;
				await reconcile();
			}
		};

		inFlight = drain().finally(() => {
			inFlight = undefined;

			// Covers an event delivered after the drain's final loop condition.
			if (queued) {
				run();
			}
		});

		void inFlight;
	};

	// Registered synchronously at module scope: Manifest V3 dispatches these to a
	// worker that may have been stopped, and a listener added after an await
	// would miss the event that started it.
	events.runtime.onInstalled.addListener(run);
	events.runtime.onStartup.addListener(run);
	events.permissions.onAdded.addListener(run);
	events.permissions.onRemoved.addListener(run);

	/*
	 * Also reconcile whenever this worker starts. Chrome drops dynamic
	 * registrations when the extension is disabled and re-enabled, and that path
	 * fires neither `onInstalled` nor `onStartup`, so the events alone left the
	 * instances dead until the toolbar action happened to be opened.
	 *
	 * This also has to come before the event listeners can do their work, which
	 * is why the stale-tab decision hangs off what changed rather than off which
	 * event fired: whichever of the two runs first is the one that registers.
	 */
	run();
}
