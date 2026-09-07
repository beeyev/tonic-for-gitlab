/**
 * Shared `chrome.storage` plumbing. Repositories own their keys, schema versions
 * and resolution policies, so one migration cannot force another to version.
 */

export interface StorageArea {
	get(key: string): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
}

export interface StorageChange {
	newValue?: unknown;
}

export type StorageChangeListener = (
	changes: Record<string, StorageChange>,
	areaName: string,
) => void;

export interface StorageChangeEvent {
	addListener(listener: StorageChangeListener): void;
	removeListener(listener: StorageChangeListener): void;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value announces a schema newer than this repository supports. */
export function isNewerSchema(value: unknown, currentVersion: number): boolean {
	return (
		isRecord(value) &&
		typeof value.schemaVersion === "number" &&
		value.schemaVersion > currentVersion
	);
}

/** Serializes read-modify-write cycles in one context. Cross-context writes stay last-writer-wins. */
export function createWriteQueue(): <T>(write: () => Promise<T>) => Promise<T> {
	let queue: Promise<unknown> = Promise.resolve();

	return <T>(write: () => Promise<T>): Promise<T> => {
		const result = queue.then(write, write);

		// A rejected write must not stall every later one.
		queue = result.catch(() => undefined);

		return result;
	};
}

/** Delivers raw `local` changes for one key and removes the listener on abort. */
export function subscribeToStorageKey(
	storageChanges: StorageChangeEvent,
	key: string,
	onValue: (newValue: unknown) => void,
	signal: AbortSignal,
): void {
	if (signal.aborted) {
		return;
	}

	const handleChange: StorageChangeListener = (changes, areaName) => {
		if (areaName !== "local" || !(key in changes)) {
			return;
		}

		onValue(changes[key]?.newValue);
	};

	storageChanges.addListener(handleChange);
	signal.addEventListener(
		"abort",
		() => {
			storageChanges.removeListener(handleChange);
		},
		{ once: true },
	);
}
