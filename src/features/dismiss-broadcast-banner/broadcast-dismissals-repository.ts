import { isTargetOrigin } from "../../host-access/target-origin";
import {
	createWriteQueue,
	isNewerSchema,
	isRecord,
	type StorageArea,
	type StorageChangeEvent,
	subscribeToStorageKey,
} from "../../storage/storage-key";

export const BROADCAST_DISMISSALS_STORAGE_KEY = "tonic.broadcast-dismissals";
export const BROADCAST_DISMISSALS_SCHEMA_VERSION = 1;
export const MAX_BROADCAST_DISMISSAL_ORIGINS = 50;

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export interface BroadcastDismissalState {
	fingerprint: string;
	dismissed: boolean;
}

export interface TonicBroadcastDismissals {
	schemaVersion: typeof BROADCAST_DISMISSALS_SCHEMA_VERSION;
	origins: Record<string, BroadcastDismissalState>;
}

export const DEFAULT_BROADCAST_DISMISSALS: TonicBroadcastDismissals = {
	schemaVersion: BROADCAST_DISMISSALS_SCHEMA_VERSION,
	origins: {},
};

export class NewerBroadcastDismissalsSchemaError extends Error {
	constructor() {
		super(
			"Stored Tonic broadcast dismissals use a newer schema than this build supports",
		);
		this.name = "NewerBroadcastDismissalsSchemaError";
	}
}

export type BroadcastDismissalsOutcome =
	| "default"
	| "stored"
	| "newer-schema"
	| "reset";

export interface BroadcastDismissalsResolution {
	outcome: BroadcastDismissalsOutcome;
	broadcastDismissals: TonicBroadcastDismissals;
	dropped: unknown[];
}

function emptyResolution(
	outcome: BroadcastDismissalsOutcome,
): BroadcastDismissalsResolution {
	return {
		outcome,
		broadcastDismissals: {
			schemaVersion: BROADCAST_DISMISSALS_SCHEMA_VERSION,
			origins: {},
		},
		dropped: [],
	};
}

function parseDismissalState(
	value: unknown,
): BroadcastDismissalState | undefined {
	if (
		!isRecord(value) ||
		typeof value.fingerprint !== "string" ||
		!FINGERPRINT_PATTERN.test(value.fingerprint) ||
		typeof value.dismissed !== "boolean"
	) {
		return undefined;
	}

	return {
		fingerprint: value.fingerprint,
		dismissed: value.dismissed,
	};
}

/** Resolves the one latest content state retained for each normalized origin. */
export function resolveBroadcastDismissals(
	value: unknown,
): BroadcastDismissalsResolution {
	if (value === undefined) {
		return emptyResolution("default");
	}

	if (isNewerSchema(value, BROADCAST_DISMISSALS_SCHEMA_VERSION)) {
		return emptyResolution("newer-schema");
	}

	if (
		!isRecord(value) ||
		value.schemaVersion !== BROADCAST_DISMISSALS_SCHEMA_VERSION ||
		!isRecord(value.origins)
	) {
		return emptyResolution("reset");
	}

	const validEntries: [string, BroadcastDismissalState][] = [];
	const dropped: unknown[] = [];

	for (const [origin, rawState] of Object.entries(value.origins)) {
		const state = parseDismissalState(rawState);

		if (!isTargetOrigin(origin) || !state) {
			dropped.push(origin);
			continue;
		}

		validEntries.push([origin, state]);
	}

	return {
		outcome: "stored",
		broadcastDismissals: {
			schemaVersion: BROADCAST_DISMISSALS_SCHEMA_VERSION,
			origins: Object.fromEntries(
				validEntries.slice(-MAX_BROADCAST_DISMISSAL_ORIGINS),
			),
		},
		dropped,
	};
}

function replaceOriginState(
	current: TonicBroadcastDismissals,
	origin: string,
	state: BroadcastDismissalState,
): TonicBroadcastDismissals {
	const retained = Object.entries(current.origins).filter(
		([storedOrigin]) => storedOrigin !== origin,
	);
	const origins = Object.fromEntries([
		...retained.slice(-(MAX_BROADCAST_DISMISSAL_ORIGINS - 1)),
		[origin, state],
	]);

	return {
		schemaVersion: BROADCAST_DISMISSALS_SCHEMA_VERSION,
		origins,
	};
}

export interface BroadcastDismissalsRepository {
	read(): Promise<BroadcastDismissalsResolution>;
	observe(
		origin: string,
		fingerprint: string,
		forceVisible: boolean,
	): Promise<TonicBroadcastDismissals>;
	dismiss(
		origin: string,
		fingerprint: string,
	): Promise<TonicBroadcastDismissals>;
	subscribe(
		listener: (resolution: BroadcastDismissalsResolution) => void,
		signal: AbortSignal,
	): void;
}

export function createBroadcastDismissalsRepository(
	storageArea: StorageArea = chrome.storage.local,
	storageChanges: StorageChangeEvent = chrome.storage.onChanged,
	reportDropped: (dropped: unknown[]) => void = (dropped) => {
		console.error("Tonic dropped unusable broadcast dismissal state", dropped);
	},
): BroadcastDismissalsRepository {
	const resolveStored = async (): Promise<BroadcastDismissalsResolution> => {
		const stored = await storageArea.get(BROADCAST_DISMISSALS_STORAGE_KEY);
		const resolution = resolveBroadcastDismissals(
			stored[BROADCAST_DISMISSALS_STORAGE_KEY],
		);

		if (resolution.dropped.length > 0) {
			reportDropped(resolution.dropped);
		}

		return resolution;
	};

	const writeState = async (
		origin: string,
		fingerprint: string,
		dismissed: boolean,
		forceVisible: boolean,
	): Promise<TonicBroadcastDismissals> => {
		if (!isTargetOrigin(origin) || !FINGERPRINT_PATTERN.test(fingerprint)) {
			throw new TypeError("Broadcast dismissal state is invalid");
		}

		const resolution = await resolveStored();

		if (resolution.outcome === "newer-schema") {
			throw new NewerBroadcastDismissalsSchemaError();
		}

		const current = resolution.broadcastDismissals.origins[origin];

		if (
			current?.fingerprint === fingerprint &&
			current.dismissed === dismissed
		) {
			return resolution.broadcastDismissals;
		}

		/*
		 * Observing unchanged content preserves its dismissal. Only a verified DOM
		 * content transition sets `forceVisible`, including A -> B -> A cycles.
		 */
		if (!dismissed && !forceVisible && current?.fingerprint === fingerprint) {
			return resolution.broadcastDismissals;
		}

		const next = replaceOriginState(resolution.broadcastDismissals, origin, {
			fingerprint,
			dismissed,
		});
		await storageArea.set({ [BROADCAST_DISMISSALS_STORAGE_KEY]: next });
		return next;
	};
	const serialize = createWriteQueue();

	return {
		read: resolveStored,
		observe(origin, fingerprint, forceVisible) {
			return serialize(() =>
				writeState(origin, fingerprint, false, forceVisible),
			);
		},
		dismiss(origin, fingerprint) {
			return serialize(() => writeState(origin, fingerprint, true, false));
		},
		subscribe(listener, signal) {
			subscribeToStorageKey(
				storageChanges,
				BROADCAST_DISMISSALS_STORAGE_KEY,
				(newValue) => {
					const resolution = resolveBroadcastDismissals(newValue);

					if (resolution.dropped.length > 0) {
						reportDropped(resolution.dropped);
					}

					listener(resolution);
				},
				signal,
			);
		},
	};
}
