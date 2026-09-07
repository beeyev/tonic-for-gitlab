import { describe, expect, test } from "bun:test";
import type {
	StorageArea,
	StorageChangeEvent,
	StorageChangeListener,
} from "../../storage/storage-key";
import {
	BROADCAST_DISMISSALS_SCHEMA_VERSION,
	BROADCAST_DISMISSALS_STORAGE_KEY,
	createBroadcastDismissalsRepository,
	MAX_BROADCAST_DISMISSAL_ORIGINS,
	NewerBroadcastDismissalsSchemaError,
	resolveBroadcastDismissals,
	type TonicBroadcastDismissals,
} from "./broadcast-dismissals-repository";

const FINGERPRINT_A = "a".repeat(64);
const FINGERPRINT_B = "b".repeat(64);

function createStorage(initial?: unknown): {
	area: StorageArea;
	changes: StorageChangeEvent;
	emit(value: unknown): void;
	read(): unknown;
	writes: unknown[];
	listeners: Set<StorageChangeListener>;
} {
	let value = initial;
	const writes: unknown[] = [];
	const listeners = new Set<StorageChangeListener>();

	return {
		area: {
			async get() {
				return { [BROADCAST_DISMISSALS_STORAGE_KEY]: value };
			},
			async set(items) {
				value = items[BROADCAST_DISMISSALS_STORAGE_KEY];
				writes.push(value);
			},
		},
		changes: {
			addListener(listener) {
				listeners.add(listener);
			},
			removeListener(listener) {
				listeners.delete(listener);
			},
		},
		emit(next) {
			value = next;
			for (const listener of listeners) {
				listener(
					{ [BROADCAST_DISMISSALS_STORAGE_KEY]: { newValue: next } },
					"local",
				);
			}
		},
		read: () => value,
		writes,
		listeners,
	};
}

describe("broadcast dismissal resolution", () => {
	test("distinguishes absent, valid, newer, and unusable containers", () => {
		expect(resolveBroadcastDismissals(undefined).outcome).toBe("default");
		expect(
			resolveBroadcastDismissals({
				schemaVersion: BROADCAST_DISMISSALS_SCHEMA_VERSION,
				origins: {
					"https://gitlab.com": {
						fingerprint: FINGERPRINT_A,
						dismissed: true,
						extra: "ignored",
					},
				},
				extra: "ignored",
			}).outcome,
		).toBe("stored");
		expect(
			resolveBroadcastDismissals({
				schemaVersion: BROADCAST_DISMISSALS_SCHEMA_VERSION + 1,
				origins: {},
			}).outcome,
		).toBe("newer-schema");
		expect(resolveBroadcastDismissals(null).outcome).toBe("reset");
		expect(
			resolveBroadcastDismissals({
				schemaVersion: BROADCAST_DISMISSALS_SCHEMA_VERSION,
				origins: [],
			}).outcome,
		).toBe("reset");
	});

	test("drops unusable entries while preserving valid origins", () => {
		const resolution = resolveBroadcastDismissals({
			schemaVersion: BROADCAST_DISMISSALS_SCHEMA_VERSION,
			origins: {
				"HTTPS://GITLAB.COM": {
					fingerprint: FINGERPRINT_A,
					dismissed: true,
				},
				"https://gitlab.example": {
					fingerprint: "not-a-sha-256-fingerprint",
					dismissed: true,
				},
				"https://valid.example": {
					fingerprint: FINGERPRINT_B,
					dismissed: false,
				},
			},
		});

		expect(resolution.broadcastDismissals.origins).toEqual({
			"https://valid.example": {
				fingerprint: FINGERPRINT_B,
				dismissed: false,
			},
		});
		expect(resolution.dropped).toEqual([
			"HTTPS://GITLAB.COM",
			"https://gitlab.example",
		]);
	});

	test("bounds stored origin maps without reporting valid evictions as unusable", () => {
		const entries = Array.from(
			{ length: MAX_BROADCAST_DISMISSAL_ORIGINS + 2 },
			(_, index) => [
				`https://gitlab-${index}.example`,
				{ fingerprint: FINGERPRINT_A, dismissed: false },
			],
		);
		const resolution = resolveBroadcastDismissals({
			schemaVersion: BROADCAST_DISMISSALS_SCHEMA_VERSION,
			origins: Object.fromEntries(entries),
		});

		expect(Object.keys(resolution.broadcastDismissals.origins)).toHaveLength(
			MAX_BROADCAST_DISMISSAL_ORIGINS,
		);
		expect(resolution.dropped).toEqual([]);
	});
});

describe("broadcast dismissal repository", () => {
	test("records one latest state per origin and makes changed content visible", async () => {
		const storage = createStorage();
		const repository = createBroadcastDismissalsRepository(
			storage.area,
			storage.changes,
		);

		await repository.observe("https://gitlab.com", FINGERPRINT_A, false);
		await repository.dismiss("https://gitlab.com", FINGERPRINT_A);
		await repository.observe("https://gitlab.com", FINGERPRINT_B, true);
		await repository.dismiss("https://gitlab.com", FINGERPRINT_B);
		const cycled = await repository.observe(
			"https://gitlab.com",
			FINGERPRINT_A,
			true,
		);

		expect(cycled.origins).toEqual({
			"https://gitlab.com": {
				fingerprint: FINGERPRINT_A,
				dismissed: false,
			},
		});
		expect(Object.keys(cycled.origins)).toHaveLength(1);
	});

	test("preserves dismissal for unchanged content on initial observation", async () => {
		const initial: TonicBroadcastDismissals = {
			schemaVersion: BROADCAST_DISMISSALS_SCHEMA_VERSION,
			origins: {
				"https://gitlab.com": {
					fingerprint: FINGERPRINT_A,
					dismissed: true,
				},
			},
		};
		const storage = createStorage(initial);
		const repository = createBroadcastDismissalsRepository(
			storage.area,
			storage.changes,
		);

		const result = await repository.observe(
			"https://gitlab.com",
			FINGERPRINT_A,
			false,
		);

		expect(result).toEqual(initial);
		expect(storage.writes).toEqual([]);
	});

	test("serializes overlapping observation and dismissal writes", async () => {
		const storage = createStorage();
		const repository = createBroadcastDismissalsRepository(
			storage.area,
			storage.changes,
		);

		const observed = repository.observe(
			"https://gitlab.com",
			FINGERPRINT_A,
			false,
		);
		const dismissed = repository.dismiss("https://gitlab.com", FINGERPRINT_A);
		await Promise.all([observed, dismissed]);

		expect(
			resolveBroadcastDismissals(storage.read()).broadcastDismissals.origins[
				"https://gitlab.com"
			],
		).toEqual({ fingerprint: FINGERPRINT_A, dismissed: true });
		expect(storage.writes).toHaveLength(2);
	});

	test("refuses invalid inputs and a schema owned by a newer build", async () => {
		const storage = createStorage({
			schemaVersion: BROADCAST_DISMISSALS_SCHEMA_VERSION + 1,
			origins: {},
		});
		const repository = createBroadcastDismissalsRepository(
			storage.area,
			storage.changes,
		);

		expect(
			repository.observe("https://gitlab.com/path", FINGERPRINT_A, false),
		).rejects.toBeInstanceOf(TypeError);
		expect(
			repository.observe("https://gitlab.com", "invalid", false),
		).rejects.toBeInstanceOf(TypeError);
		expect(
			repository.dismiss("https://gitlab.com", FINGERPRINT_A),
		).rejects.toBeInstanceOf(NewerBroadcastDismissalsSchemaError);
		expect(storage.writes).toEqual([]);
	});

	test("resolves subscribed values and releases the listener on abort", () => {
		const storage = createStorage();
		const repository = createBroadcastDismissalsRepository(
			storage.area,
			storage.changes,
		);
		const controller = new AbortController();
		const resolutions: string[] = [];
		repository.subscribe(
			(resolution) => resolutions.push(resolution.outcome),
			controller.signal,
		);

		storage.emit({
			schemaVersion: BROADCAST_DISMISSALS_SCHEMA_VERSION,
			origins: {},
		});
		expect(resolutions).toEqual(["stored"]);
		expect(storage.listeners.size).toBe(1);

		controller.abort();
		storage.emit(undefined);
		expect(resolutions).toEqual(["stored"]);
		expect(storage.listeners.size).toBe(0);
	});
});
