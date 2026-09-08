import {
	createWriteQueue,
	isNewerSchema,
	isRecord,
	type StorageArea,
} from "../storage/storage-key";
import {
	BUILT_IN_ORIGIN,
	isTargetOrigin,
	toOriginPattern,
} from "./target-origin";

/**
 * User-configured self-managed origins live under their own storage key rather
 * than inside `tonic.settings`.
 *
 * `chrome.storage` has no compare-and-swap, so read-modify-write on one object
 * is last-writer-wins across tabs. Feature toggles are written often, from
 * every open GitLab tab; this list is written rarely, only from the toolbar
 * action. Sharing one object would let a toggle flipped in a stale tab delete
 * an origin the user had just added. Separate keys make that impossible.
 */
export const TARGETS_STORAGE_KEY = "tonic.targets";
export const TARGETS_SCHEMA_VERSION = 1;

export interface TonicTargets {
	schemaVersion: typeof TARGETS_SCHEMA_VERSION;
	origins: string[];
}

export const DEFAULT_TARGETS: TonicTargets = {
	schemaVersion: TARGETS_SCHEMA_VERSION,
	origins: [],
};

export class NewerTargetsSchemaError extends Error {
	constructor() {
		super("Stored Tonic targets use a newer schema than this build supports");
		this.name = "NewerTargetsSchemaError";
	}
}

export type TargetsOutcome =
	/** Nothing stored yet. */
	| "default"
	/** Storage held a value this build understands. */
	| "stored"
	/** A newer build owns the stored value; it is read-only to this one. */
	| "newer-schema"
	/** Unusable state that this build replaces with an empty list. */
	| "reset";

/**
 * True when the resolved list does not describe what the user configured.
 *
 * A newer build's schema and an unusable container both resolve to an empty
 * list, and empty means "unknown" in both cases, not "none configured".
 * Reconciling against it unregisters every custom script and leaves granted
 * permissions with no row to revoke them from.
 */
export function isUntrustedTargets(outcome: TargetsOutcome): boolean {
	return outcome === "newer-schema" || outcome === "reset";
}

export interface TargetsResolution {
	outcome: TargetsOutcome;
	targets: TonicTargets;
	/** Entries that were dropped because they are not normalized origins. */
	droppedOrigins: unknown[];
}

/**
 * Resolves a raw stored value.
 *
 * Deliberately different from the settings reset policy in one place: entries
 * are independent of each other, so one unusable origin drops that entry rather
 * than wiping every instance the user configured. Only an unusable container
 * resets. A dropped entry is not written back, so a build that understands it
 * again still sees it.
 */
export function resolveTargets(value: unknown): TargetsResolution {
	if (value === undefined) {
		return {
			outcome: "default",
			targets: { ...DEFAULT_TARGETS, origins: [] },
			droppedOrigins: [],
		};
	}

	if (isNewerSchema(value, TARGETS_SCHEMA_VERSION)) {
		return {
			outcome: "newer-schema",
			targets: { ...DEFAULT_TARGETS, origins: [] },
			droppedOrigins: [],
		};
	}

	if (
		!isRecord(value) ||
		value.schemaVersion !== TARGETS_SCHEMA_VERSION ||
		!Array.isArray(value.origins)
	) {
		return {
			outcome: "reset",
			targets: { ...DEFAULT_TARGETS, origins: [] },
			droppedOrigins: [],
		};
	}

	const origins: string[] = [];
	const droppedOrigins: unknown[] = [];

	for (const entry of value.origins) {
		/*
		 * A duplicate would create two UI rows. Any origin in GitLab.com's built-in
		 * scheme-and-host scope would also overlap its static content script. Adding
		 * either is refused; dropping them here means older or hand-edited storage
		 * cannot reintroduce them.
		 */
		if (
			isTargetOrigin(entry) &&
			toOriginPattern(entry) !== toOriginPattern(BUILT_IN_ORIGIN) &&
			!origins.includes(entry)
		) {
			origins.push(entry);
			continue;
		}

		droppedOrigins.push(entry);
	}

	return {
		outcome: "stored",
		targets: { schemaVersion: TARGETS_SCHEMA_VERSION, origins },
		droppedOrigins,
	};
}

export interface TargetsRepository {
	/**
	 * Resolves the stored list *with* its outcome, not just the origins.
	 *
	 * Callers need the outcome because a `newer-schema` read yields an empty
	 * list that means "unknown", not "none configured". Reconciling against it
	 * would unregister the newer build's content scripts, which is the opposite
	 * of leaving newer state alone.
	 */
	read(): Promise<TargetsResolution>;
	add(origin: string): Promise<TonicTargets>;
	remove(origin: string): Promise<TonicTargets>;
}

export function createTargetsRepository(
	storageArea: StorageArea = chrome.storage.local,
	reportDropped: (dropped: unknown[]) => void = (dropped) => {
		console.error("Tonic dropped unusable stored GitLab origins", dropped);
	},
): TargetsRepository {
	const readResolved = async (): Promise<TargetsResolution> => {
		const stored = await storageArea.get(TARGETS_STORAGE_KEY);
		const resolution = resolveTargets(stored[TARGETS_STORAGE_KEY]);

		if (resolution.droppedOrigins.length > 0) {
			reportDropped(resolution.droppedOrigins);
		}

		return resolution;
	};

	const write = async (
		change: (origins: string[]) => string[],
	): Promise<TonicTargets> => {
		const resolution = await readResolved();

		/*
		 * This build cannot see a newer build's extra fields, so merging into that
		 * state would silently delete them. Refuse rather than downgrade.
		 */
		if (resolution.outcome === "newer-schema") {
			throw new NewerTargetsSchemaError();
		}

		const next: TonicTargets = {
			schemaVersion: TARGETS_SCHEMA_VERSION,
			origins: change(resolution.targets.origins),
		};

		await storageArea.set({ [TARGETS_STORAGE_KEY]: next });

		return next;
	};

	/*
	 * Serialized for the same reason settings updates are: two overlapping
	 * writes would both read the same list and the second would drop the first
	 * one's change. Only the toolbar action writes here, so this closes the
	 * realistic window entirely.
	 */
	const serialize = createWriteQueue();

	const enqueue = (change: (origins: string[]) => string[]) =>
		serialize(() => write(change));

	return {
		read: readResolved,
		add(origin) {
			return enqueue((origins) =>
				origins.includes(origin) ? origins : [...origins, origin],
			);
		},
		remove(origin) {
			return enqueue((origins) => origins.filter((entry) => entry !== origin));
		},
	};
}
