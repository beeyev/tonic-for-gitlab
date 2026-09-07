import { describe, expect, test } from "bun:test";
import {
	type StorageChangeEvent,
	type StorageChangeListener,
	subscribeToStorageKey,
} from "./storage-key";

describe("storage key subscription", () => {
	test("does not register a listener for an already-aborted signal", () => {
		const listeners = new Set<StorageChangeListener>();
		const storageChanges: StorageChangeEvent = {
			addListener(listener) {
				listeners.add(listener);
			},
			removeListener(listener) {
				listeners.delete(listener);
			},
		};
		const controller = new AbortController();
		controller.abort();

		subscribeToStorageKey(
			storageChanges,
			"example",
			() => {},
			controller.signal,
		);

		expect(listeners.size).toBe(0);
	});
});
