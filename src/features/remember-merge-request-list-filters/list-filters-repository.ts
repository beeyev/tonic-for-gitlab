import { isTargetOrigin } from "../../host-access/target-origin";
import {
	createWriteQueue,
	isNewerSchema,
	isRecord,
	type StorageArea,
	type StorageChangeEvent,
	subscribeToStorageKey,
} from "../../storage/storage-key";
import {
	isCanonicalFilterQuery,
	isMergeRequestScopePath,
	type ListFilterScope,
	MERGE_REQUEST_LIST_STATES,
	normalizeScopePath,
} from "./scope";

/**
 * Remembered merge request list filters live under their own storage key rather
 * than inside `tonic.settings`.
 *
 * `chrome.storage` has no compare-and-swap, so read-modify-write on one object
 * is last-writer-wins across tabs. These entries and the feature toggles belong
 * to different surfaces and are written by different actions, and sharing one
 * object would let a write from either surface drop the other's change.
 * Separate keys make that impossible.
 */
export const LIST_FILTERS_STORAGE_KEY = "tonic.list-filters";
export const LIST_FILTERS_SCHEMA_VERSION = 1;

/**
 * Bounds on stored data.
 *
 * The cap on scopes is *per origin*, with a separate cap on how many origins are
 * kept. A single global cap would let a work GitLab visited daily evict every
 * entry for a gitlab.com account used weekly, which is the failure this split
 * exists to prevent.
 *
 * 50 scopes covers a heavy user's recent lists across several projects and both
 * groups and projects, times the four state tabs. 10 origins is far above the
 * number of GitLab instances one person signs into. 1024 characters is longer
 * than any filter set GitLab's own filtered search produces from its UI; a query
 * past it is not remembered at all rather than truncated, because a truncated
 * query would restore a filter the user never chose.
 */
export const MAX_REMEMBERED_ORIGINS = 10;
export const MAX_REMEMBERED_SCOPES_PER_ORIGIN = 50;
export const MAX_REMEMBERED_QUERY_LENGTH = 1024;

export interface ListFilterEntry {
	/** Normalized list pathname with no trailing slash. */
	path: string;
	state: (typeof MERGE_REQUEST_LIST_STATES)[number];
	/** Canonical filter query. An empty string means "the user cleared them". */
	query: string;
	/** Epoch milliseconds of the last change, used for LRU eviction. */
	updatedAt: number;
}

/**
 * Keyed by origin at the top level so one instance's entries are addressable
 * together: the per-origin cap, eviction, and any future "forget this instance"
 * action are then a single lookup rather than a scan.
 *
 * Per-instance scoping is a correctness requirement, not tidiness.
 * `/group/project/-/merge_requests` exists identically on gitlab.com and on a
 * self-managed instance, and the filter values themselves - usernames, labels,
 * milestones, iteration IDs - are meaningless or wrong on a different GitLab.
 */
export interface TonicListFilters {
	schemaVersion: typeof LIST_FILTERS_SCHEMA_VERSION;
	origins: Record<string, ListFilterEntry[]>;
}

export const DEFAULT_LIST_FILTERS: TonicListFilters = {
	schemaVersion: LIST_FILTERS_SCHEMA_VERSION,
	origins: {},
};

/**
 * A query too long to store is refused, never coerced.
 *
 * Coercing it to `undefined` reused the value that means "forget", so a control
 * labelled Save deleted the set it was asked to replace. Refusing keeps the
 * stored value the user already had, and the store's rejection path rolls the
 * optimistic snapshot back so the chip stops claiming the new one.
 */
export class ListFiltersQueryTooLongError extends Error {
	constructor() {
		super("Filter query is too long for Tonic to remember");
		this.name = "ListFiltersQueryTooLongError";
	}
}

export class NewerListFiltersSchemaError extends Error {
	constructor() {
		super(
			"Stored Tonic list filters use a newer schema than this build supports",
		);
		this.name = "NewerListFiltersSchemaError";
	}
}

function parseEntry(value: unknown): ListFilterEntry | undefined {
	if (
		!isRecord(value) ||
		typeof value.path !== "string" ||
		typeof value.state !== "string" ||
		typeof value.query !== "string" ||
		typeof value.updatedAt !== "number"
	) {
		return undefined;
	}

	const { path, state, query, updatedAt } = value;

	/*
	 * Stored entries are re-emitted into an `href`, so they are validated as
	 * strictly as freshly observed ones: the path must still be a merge request
	 * list scope in its normalized form, the state must be one this build knows,
	 * and the query must already be canonical, which no hand-written or hostile
	 * value is.
	 */
	if (
		normalizeScopePath(path) !== path ||
		!isMergeRequestScopePath(path) ||
		!(MERGE_REQUEST_LIST_STATES as readonly string[]).includes(state) ||
		query.length > MAX_REMEMBERED_QUERY_LENGTH ||
		!isCanonicalFilterQuery(query) ||
		!Number.isFinite(updatedAt) ||
		updatedAt < 0
	) {
		return undefined;
	}

	return {
		path,
		state: state as ListFilterEntry["state"],
		query,
		updatedAt,
	};
}

export type ListFiltersOutcome =
	/** Nothing stored yet. */
	| "default"
	/** Storage held a value this build understands. */
	| "stored"
	/** A newer build owns the stored value; it is read-only to this one. */
	| "newer-schema"
	/** Unusable state that this build replaces with an empty set. */
	| "reset";

export interface ListFiltersResolution {
	outcome: ListFiltersOutcome;
	listFilters: TonicListFilters;
	/** Entries and origins dropped because this build cannot use them. */
	dropped: unknown[];
}

function emptyResolution(outcome: ListFiltersOutcome): ListFiltersResolution {
	return {
		outcome,
		listFilters: { schemaVersion: LIST_FILTERS_SCHEMA_VERSION, origins: {} },
		dropped: [],
	};
}

/**
 * Resolves a raw stored value.
 *
 * Follows the per-entry survival policy `tonic.targets` established rather than
 * the settings reset policy: one unusable remembered scope is dropped and
 * logged, and only an unusable container resets. Losing every remembered filter
 * because one entry was written by a build with a different idea of a canonical
 * query would be a much worse trade than losing that one entry. A dropped entry
 * is not written back, so a build that understands it again still sees it.
 */
export function resolveListFilters(value: unknown): ListFiltersResolution {
	if (value === undefined) {
		return emptyResolution("default");
	}

	if (isNewerSchema(value, LIST_FILTERS_SCHEMA_VERSION)) {
		return emptyResolution("newer-schema");
	}

	if (
		!isRecord(value) ||
		value.schemaVersion !== LIST_FILTERS_SCHEMA_VERSION ||
		!isRecord(value.origins)
	) {
		return emptyResolution("reset");
	}

	const origins: Record<string, ListFilterEntry[]> = {};
	const dropped: unknown[] = [];

	for (const [origin, storedEntries] of Object.entries(value.origins)) {
		if (!isTargetOrigin(origin) || !Array.isArray(storedEntries)) {
			dropped.push(origin);
			continue;
		}

		const entries: ListFilterEntry[] = [];

		for (const storedEntry of storedEntries) {
			const entry = parseEntry(storedEntry);

			if (
				!entry ||
				entries.some(
					(kept) => kept.path === entry.path && kept.state === entry.state,
				)
			) {
				dropped.push(storedEntry);
				continue;
			}

			entries.push(entry);
		}

		if (entries.length > 0) {
			/*
			 * Bounded on read, not only on write. A stored object is untrusted: it
			 * can come from a build with different limits, from a hand edit, or from
			 * a hostile write to the origin's storage, and `applyChange` caps only
			 * the one origin it touches. Without this the documented bounds describe
			 * what this build writes rather than what it will load, and an oversized
			 * object would inflate the in-memory snapshot of every tab.
			 */
			origins[origin] = [...entries]
				.sort((left, right) => right.updatedAt - left.updatedAt)
				.slice(0, MAX_REMEMBERED_SCOPES_PER_ORIGIN);

			if (entries.length > MAX_REMEMBERED_SCOPES_PER_ORIGIN) {
				dropped.push(
					...entries
						.slice(MAX_REMEMBERED_SCOPES_PER_ORIGIN)
						.map((entry) => entry.path),
				);
			}
		}
	}

	for (const origin of Object.keys(origins)
		.sort(
			(left, right) =>
				Math.max(...(origins[right] ?? []).map((entry) => entry.updatedAt)) -
				Math.max(...(origins[left] ?? []).map((entry) => entry.updatedAt)),
		)
		.slice(MAX_REMEMBERED_ORIGINS)) {
		dropped.push(origin);
		delete origins[origin];
	}

	return {
		outcome: "stored",
		listFilters: { schemaVersion: LIST_FILTERS_SCHEMA_VERSION, origins },
		dropped,
	};
}

/**
 * Applies one change and enforces both bounds.
 *
 * Eviction is by last change, not last visit, because a scope whose filters did
 * not change is never written; keeping recency current would mean a storage
 * write on every navigation, which is exactly the traffic this feature avoids.
 */
function applyChange(
	listFilters: TonicListFilters,
	origin: string,
	scope: ListFilterScope,
	query: string | undefined,
	now: number,
): TonicListFilters {
	const kept = (listFilters.origins[origin] ?? []).filter(
		(entry) => entry.path !== scope.path || entry.state !== scope.state,
	);

	if (query !== undefined) {
		kept.unshift({
			path: scope.path,
			state: scope.state,
			query,
			updatedAt: now,
		});
	}

	const origins: Record<string, ListFilterEntry[]> = { ...listFilters.origins };

	if (kept.length === 0) {
		delete origins[origin];
	} else {
		origins[origin] = [...kept]
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.slice(0, MAX_REMEMBERED_SCOPES_PER_ORIGIN);
	}

	const originNames = Object.keys(origins);

	if (originNames.length > MAX_REMEMBERED_ORIGINS) {
		const newestFirst = originNames.sort(
			(left, right) =>
				Math.max(...(origins[right] ?? []).map((entry) => entry.updatedAt)) -
				Math.max(...(origins[left] ?? []).map((entry) => entry.updatedAt)),
		);

		for (const evicted of newestFirst.slice(MAX_REMEMBERED_ORIGINS)) {
			delete origins[evicted];
		}
	}

	return { schemaVersion: LIST_FILTERS_SCHEMA_VERSION, origins };
}

export interface ListFiltersRepository {
	read(): Promise<ListFiltersResolution>;
	/**
	 * Persists the filters for one scope and resolves with what was stored.
	 *
	 * `query` of `undefined` forgets the scope. An empty string is a stored
	 * value meaning the user cleared their filters, which is what makes clearing
	 * them the escape hatch from a remembered filter set.
	 */
	remember(
		origin: string,
		scope: ListFilterScope,
		query: string | undefined,
	): Promise<TonicListFilters>;
	/**
	 * Reports every change to the stored value, resolution and all.
	 *
	 * The outcome travels with it because a subscriber has to be able to tell a
	 * genuinely empty store from one this build must not act on: `newer-schema`
	 * resolves to an empty value that is not the user's state.
	 */
	subscribe(
		listener: (resolution: ListFiltersResolution) => void,
		signal: AbortSignal,
	): void;
}

export function createListFiltersRepository(
	storageArea: StorageArea = chrome.storage.local,
	storageChanges: StorageChangeEvent = chrome.storage.onChanged,
	reportDropped: (dropped: unknown[]) => void = (dropped) => {
		console.error("Tonic dropped unusable remembered list filters", dropped);
	},
	now: () => number = Date.now,
): ListFiltersRepository {
	const readResolved = async (): Promise<ListFiltersResolution> => {
		const stored = await storageArea.get(LIST_FILTERS_STORAGE_KEY);
		const resolution = resolveListFilters(stored[LIST_FILTERS_STORAGE_KEY]);

		if (resolution.dropped.length > 0) {
			reportDropped(resolution.dropped);
		}

		return resolution;
	};

	const write = async (
		origin: string,
		scope: ListFilterScope,
		query: string | undefined,
	): Promise<TonicListFilters> => {
		const resolution = await readResolved();

		/*
		 * This build cannot see a newer build's extra fields, so merging into that
		 * state would silently delete them. Refuse rather than downgrade.
		 */
		if (resolution.outcome === "newer-schema") {
			throw new NewerListFiltersSchemaError();
		}

		if (query !== undefined && query.length > MAX_REMEMBERED_QUERY_LENGTH) {
			throw new ListFiltersQueryTooLongError();
		}

		const next = applyChange(
			resolution.listFilters,
			origin,
			scope,
			query,
			now(),
		);

		await storageArea.set({ [LIST_FILTERS_STORAGE_KEY]: next });

		return next;
	};

	/*
	 * Across tabs storage is still last-writer-wins, and losing one remembered
	 * filter to that race is a cost this data can carry.
	 */
	const serialize = createWriteQueue();

	return {
		read: readResolved,
		remember(origin, scope, query) {
			return serialize(() => write(origin, scope, query));
		},
		subscribe(listener, signal) {
			subscribeToStorageKey(
				storageChanges,
				LIST_FILTERS_STORAGE_KEY,
				(newValue) => {
					const resolution = resolveListFilters(newValue);

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
