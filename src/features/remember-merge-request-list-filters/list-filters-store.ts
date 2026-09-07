import type {
	ListFiltersRepository,
	ListFiltersResolution,
	TonicListFilters,
} from "./list-filters-repository";
import { type ListFilterScope, toScopeKey } from "./scope";

/** In-memory filters for synchronous reconciliation, refreshed from storage changes. */
export interface ListFilterStore {
	/** The remembered canonical query, or `undefined` when nothing is stored. */
	read(origin: string, scope: ListFilterScope): string | undefined;
	/** Whether storage accepts writes from this build. Newer schemas are read-only. */
	isWritable(): boolean;
	/** Records a scope's filters. `undefined`, duplicate values and read-only storage are no-ops. */
	remember(
		origin: string,
		scope: ListFilterScope,
		query: string | undefined,
	): void;
}

export interface ListFilterStoreController extends ListFilterStore {
	/** Reads once, then notifies the runtime when later storage changes alter the snapshot. */
	start(signal: AbortSignal, onChanged: () => void): void;
}

export function createListFilterStore(
	repository: ListFiltersRepository,
	reportError: (error: unknown) => void = (error) => {
		console.error("Tonic could not save remembered list filters", error);
	},
): ListFilterStoreController {
	let queries = new Map<string, string>();
	let persistedQueries = new Map<string, string>();
	// An empty snapshot is ambiguous until the first read resolves.
	let isWritable = false;
	// Do not overwrite a newer change event with the initial read.
	let hasAdopted = false;
	/* A storage event is newer than any write result that started before it. */
	let storageVersion = 0;
	let nextWriteId = 0;
	let activeWrite: PendingWrite | undefined;
	const pendingWrites = new Map<number, PendingWrite>();
	// A failed optimistic write must trigger the same reconciliation that applied it.
	let notifyChanged: () => void = () => {};

	interface PendingWrite {
		id: number;
		key: string;
		origin: string;
		scope: ListFilterScope;
		query: string | undefined;
		storageVersion: number;
	}

	const snapshot = (listFilters: TonicListFilters): Map<string, string> => {
		const next = new Map<string, string>();

		for (const [origin, entries] of Object.entries(listFilters.origins)) {
			for (const entry of entries) {
				next.set(
					toScopeKey(origin, { path: entry.path, state: entry.state }),
					entry.query,
				);
			}
		}

		return next;
	};

	const rebuildOptimisticSnapshot = (): boolean => {
		const previous = queries;
		const next = new Map(persistedQueries);

		for (const write of pendingWrites.values()) {
			if (write.query === undefined) {
				next.delete(write.key);
			} else {
				next.set(write.key, write.query);
			}
		}

		queries = next;

		return (
			previous.size !== next.size ||
			[...previous].some(([key, value]) => next.get(key) !== value)
		);
	};

	// Preserve the current snapshot and disable writes for schemas this build cannot read.
	const adopt = (resolution: ListFiltersResolution): void => {
		hasAdopted = true;

		if (resolution.outcome === "newer-schema") {
			isWritable = false;
			return;
		}

		isWritable = true;
		persistedQueries = snapshot(resolution.listFilters);
		rebuildOptimisticSnapshot();
	};

	const startNextWrite = (): void => {
		if (activeWrite) {
			return;
		}

		const write = pendingWrites.values().next().value as
			| PendingWrite
			| undefined;

		if (!write) {
			return;
		}

		activeWrite = write;
		write.storageVersion = storageVersion;

		void repository
			.remember(write.origin, write.scope, write.query)
			.then((listFilters) => {
				pendingWrites.delete(write.id);

				if (storageVersion === write.storageVersion) {
					persistedQueries = snapshot(listFilters);
				}

				if (rebuildOptimisticSnapshot()) {
					notifyChanged();
				}
			})
			.catch((error: unknown) => {
				pendingWrites.delete(write.id);
				rebuildOptimisticSnapshot();
				reportError(error);
				notifyChanged();
			})
			.finally(() => {
				activeWrite = undefined;
				startNextWrite();
			});
	};

	return {
		read(origin, scope) {
			return queries.get(toScopeKey(origin, scope));
		},
		isWritable() {
			return isWritable;
		},
		remember(origin, scope, query) {
			if (!isWritable) {
				return;
			}

			const key = toScopeKey(origin, scope);
			if (queries.get(key) === query) {
				return;
			}

			// Replay pending writes over confirmed storage so each can roll back cleanly.
			const write: PendingWrite = {
				id: nextWriteId,
				key,
				origin,
				scope,
				query,
				storageVersion,
			};
			nextWriteId += 1;
			pendingWrites.set(write.id, write);
			rebuildOptimisticSnapshot();
			startNextWrite();
		},
		start(signal, onChanged) {
			notifyChanged = onChanged;

			repository.subscribe((resolution) => {
				if (signal.aborted) {
					return;
				}

				storageVersion += 1;
				adopt(resolution);
				onChanged();
			}, signal);

			void repository
				.read()
				.then((resolution) => {
					// A change event that already landed is newer than this read.
					if (signal.aborted || hasAdopted) {
						return;
					}

					adopt(resolution);
					onChanged();
				})
				.catch((error: unknown) => {
					console.error(
						"Tonic remembered list filters could not be read",
						error,
					);
				});
		},
	};
}
