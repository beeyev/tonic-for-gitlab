/**
 * Records that open tabs no longer match the registered content scripts.
 *
 * Registering or unregistering a script never reaches a document that is
 * already loaded, so the user has to reload. Deriving that from one
 * reconciliation's result is not enough any more: the background worker usually
 * performs the registration that a grant enables, because Chrome dismisses the
 * popup when it raises the prompt. By the time the action reopens, the script is
 * already registered and its own reconciliation reports no change, so the
 * notice was never shown. This is the hand-off between the two contexts.
 *
 * `chrome.storage.session` rather than `local`: the fact is about tabs that are
 * open right now, and it should die with the browser session exactly as they do.
 */
export const STALE_TABS_STORAGE_KEY = "tonic.staleTabs";

interface SessionStorageArea {
	get(key: string): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
	remove(key: string): Promise<void>;
}

function defaultArea(): SessionStorageArea {
	return chrome.storage.session;
}

export async function markTabsStale(
	area: SessionStorageArea = defaultArea(),
): Promise<void> {
	await area.set({ [STALE_TABS_STORAGE_KEY]: true });
}

/**
 * Reads the flag and clears it, so the notice is shown once rather than on
 * every popup open until something else happens to change.
 */
export async function consumeStaleTabs(
	area: SessionStorageArea = defaultArea(),
): Promise<boolean> {
	const stored = await area.get(STALE_TABS_STORAGE_KEY);

	if (stored[STALE_TABS_STORAGE_KEY] !== true) {
		return false;
	}

	await area.remove(STALE_TABS_STORAGE_KEY);

	return true;
}
