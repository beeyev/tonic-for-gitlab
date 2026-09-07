import { describe, expect, test } from "bun:test";
import type {
	ListFiltersRepository,
	ListFiltersResolution,
	TonicListFilters,
} from "./list-filters-repository";
import { createListFilterStore } from "./list-filters-store";

const ORIGIN = "https://gitlab.com";
const SCOPE = {
	path: "/group/project/-/merge_requests",
	state: "opened",
} as const;
const OTHER_SCOPE = {
	path: "/group/other/-/merge_requests",
	state: "closed",
} as const;

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((settle, fail) => {
		resolve = settle;
		reject = fail;
	});

	return { promise, reject, resolve };
}

const settlePromises = () =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});

function listFiltersWith(
	entries: Array<{
		path: string;
		state: "opened" | "closed";
		query: string;
		updatedAt: number;
	}>,
): TonicListFilters {
	return {
		schemaVersion: 1,
		origins: entries.length === 0 ? {} : { [ORIGIN]: entries },
	};
}

function stored(listFilters: TonicListFilters): ListFiltersResolution {
	return { outcome: "stored", listFilters, dropped: [] };
}

interface RecordingRepository {
	repository: ListFiltersRepository;
	writes: (string | undefined)[];
	/** Publishes a change to subscribers, as another tab's write would. */
	emit(listFilters: TonicListFilters): void;
	/** Publishes a raw resolution, for the outcomes a change can also carry. */
	emitResolution(resolution: ListFiltersResolution): void;
	/** Resolution the next and every later `read` answers with. */
	setResolution(resolution: ListFiltersResolution): void;
	/** Makes every later write reject, as a storage failure would. */
	failWrites(error: Error): void;
	/** Holds the initial read open so event ordering can be driven exactly. */
	deferRead(): void;
	/** Settles a held read with the state storage had before any change. */
	resolveRead(listFilters: TonicListFilters): void;
	stored: TonicListFilters;
}

function createRecordingRepository(): RecordingRepository {
	const writes: (string | undefined)[] = [];
	const listeners = new Set<(resolution: ListFiltersResolution) => void>();
	const state = {
		stored: { schemaVersion: 1, origins: {} } as TonicListFilters,
		resolution: undefined as ListFiltersResolution | undefined,
		writeError: undefined as Error | undefined,
		deferredRead: undefined as
			| {
					promise: Promise<ListFiltersResolution>;
					resolve(resolution: ListFiltersResolution): void;
			  }
			| undefined,
	};

	return {
		writes,
		get stored() {
			return state.stored;
		},
		emit(listFilters) {
			state.stored = listFilters;

			for (const listener of listeners) {
				listener(stored(listFilters));
			}
		},
		emitResolution(resolution) {
			for (const listener of listeners) {
				listener(resolution);
			}
		},
		setResolution(resolution) {
			state.resolution = resolution;
		},
		failWrites(error) {
			state.writeError = error;
		},
		/** Holds the initial read open so event ordering can be driven exactly. */
		deferRead() {
			let resolve!: (resolution: ListFiltersResolution) => void;
			const promise = new Promise<ListFiltersResolution>((settle) => {
				resolve = settle;
			});

			state.deferredRead = { promise, resolve };
		},
		resolveRead(listFilters: TonicListFilters) {
			state.deferredRead?.resolve(stored(listFilters));
		},
		repository: {
			read: async () =>
				state.deferredRead?.promise ?? state.resolution ?? stored(state.stored),
			async remember(origin, scope, query) {
				writes.push(query);

				if (state.writeError) {
					throw state.writeError;
				}

				state.stored = {
					schemaVersion: 1,
					origins:
						query === undefined
							? {}
							: {
									[origin]: [
										{
											path: scope.path,
											state: scope.state,
											query,
											updatedAt: 1,
										},
									],
								},
				};

				return state.stored;
			},
			subscribe(listener, signal) {
				listeners.add(listener);
				signal.addEventListener("abort", () => listeners.delete(listener), {
					once: true,
				});
			},
		},
	};
}

describe("list filter store", () => {
	/**
	 * Starts a store the way the content runtime does and waits for its first
	 * resolution. Nothing is writable before that, because an empty snapshot
	 * means "not read yet" rather than "nothing stored".
	 */
	async function started(
		repository: Parameters<typeof createListFilterStore>[0],
		reportError?: Parameters<typeof createListFilterStore>[1],
	) {
		const store = createListFilterStore(repository, reportError);

		store.start(new AbortController().signal, () => {});
		await Promise.resolve();
		await Promise.resolve();

		return store;
	}

	test("refuses to write before its first read resolves", () => {
		const { repository, writes } = createRecordingRepository();
		const store = createListFilterStore(repository);

		store.remember(ORIGIN, SCOPE, "author_username=ada");

		expect(writes).toEqual([]);
		expect(store.isWritable()).toBe(false);
	});

	test("writes only when the canonical query actually changed", async () => {
		const { repository, writes } = createRecordingRepository();
		const store = await started(repository);

		store.remember(ORIGIN, SCOPE, "author_username=ada");
		store.remember(ORIGIN, SCOPE, "author_username=ada");
		await Promise.resolve();
		store.remember(ORIGIN, SCOPE, "author_username=ada");

		expect(writes).toEqual(["author_username=ada"]);
		expect(store.read(ORIGIN, SCOPE)).toBe("author_username=ada");
	});

	test("reads once at start and follows later changes", async () => {
		const { repository, emit } = createRecordingRepository();
		const store = createListFilterStore(repository);
		const controller = new AbortController();
		let reconciles = 0;

		emit({
			schemaVersion: 1,
			origins: {
				[ORIGIN]: [{ ...SCOPE, query: "author_username=ada", updatedAt: 1 }],
			},
		});
		store.start(controller.signal, () => {
			reconciles += 1;
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(store.read(ORIGIN, SCOPE)).toBe("author_username=ada");
		expect(reconciles).toBe(1);

		// A capture in another tab arrives through the change subscription.
		emit({
			schemaVersion: 1,
			origins: {
				[ORIGIN]: [{ ...SCOPE, query: "milestone_title=16.0", updatedAt: 2 }],
			},
		});

		expect(store.read(ORIGIN, SCOPE)).toBe("milestone_title=16.0");
		expect(reconciles).toBe(2);

		controller.abort();
		emit({ schemaVersion: 1, origins: {} });

		expect(reconciles).toBe(2);
	});

	/*
	 * A change event can land before the initial read resolves. The read then
	 * carries the state storage held *before* that change, so adopting it would
	 * roll the tab back to a stale snapshot until some later event happened to
	 * correct it.
	 */
	test("does not let a late initial read overwrite a newer change event", async () => {
		const { repository, emit, deferRead, resolveRead } =
			createRecordingRepository();
		const store = createListFilterStore(repository);

		deferRead();
		store.start(new AbortController().signal, () => {});
		emit({
			schemaVersion: 1,
			origins: {
				[ORIGIN]: [{ ...SCOPE, query: "milestone_title=16.0", updatedAt: 2 }],
			},
		});
		resolveRead({ schemaVersion: 1, origins: {} });
		await Promise.resolve();
		await Promise.resolve();

		expect(store.read(ORIGIN, SCOPE)).toBe("milestone_title=16.0");
	});

	test("forgetting a scope is a distinct value from an empty filter set", async () => {
		const { repository, writes } = createRecordingRepository();
		const store = await started(repository);

		store.remember(ORIGIN, SCOPE, "");
		await Promise.resolve();
		store.remember(ORIGIN, SCOPE, undefined);

		expect(writes).toEqual(["", undefined]);
		expect(store.read(ORIGIN, SCOPE)).toBeUndefined();
	});

	/*
	 * The optimistic snapshot is what lets the chip and the links answer a click
	 * in the same frame. It also means a rejected write leaves the snapshot
	 * holding a value nothing persisted, so the chip would report
	 * `Filters remembered` and GitLab hrefs would be rewritten from a state that
	 * exists only in this tab.
	 */
	test("rolls the snapshot back when the write is rejected", async () => {
		const { repository, failWrites, emit } = createRecordingRepository();
		const errors: unknown[] = [];
		const store = createListFilterStore(repository, (error) =>
			errors.push(error),
		);
		const controller = new AbortController();
		let reconciles = 0;

		emit({
			schemaVersion: 1,
			origins: {
				[ORIGIN]: [{ ...SCOPE, query: "author_username=ada", updatedAt: 1 }],
			},
		});
		store.start(controller.signal, () => {
			reconciles += 1;
		});
		await Promise.resolve();
		await Promise.resolve();

		failWrites(new Error("storage is unavailable"));
		store.remember(ORIGIN, SCOPE, "milestone_title=16.0");

		// Optimistic until the write settles.
		expect(store.read(ORIGIN, SCOPE)).toBe("milestone_title=16.0");

		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(store.read(ORIGIN, SCOPE)).toBe("author_username=ada");
		expect(errors).toHaveLength(1);
		// The UI is told, so it stops reporting a set that was never persisted.
		expect(reconciles).toBe(2);
		controller.abort();
	});

	test("rolls back to nothing stored when the first write for a scope fails", async () => {
		const { repository, failWrites } = createRecordingRepository();
		const store = createListFilterStore(repository, () => {});

		failWrites(new Error("storage is unavailable"));
		store.remember(ORIGIN, SCOPE, "author_username=ada");
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(store.read(ORIGIN, SCOPE)).toBeUndefined();
	});

	test.each([
		["reject", "reject", "author_username=alice", 2],
		["resolve", "reject", "author_username=bob", 1],
		["reject", "resolve", undefined, 1],
	] as const)(
		"handles queued %s then %s writes against confirmed state",
		async (firstOutcome, secondOutcome, expected, expectedErrors) => {
			const first = deferred<TonicListFilters>();
			const second = deferred<TonicListFilters>();
			const writes = [first, second];
			let writeCount = 0;
			const errors: unknown[] = [];
			const initial = listFiltersWith([
				{ ...SCOPE, query: "author_username=alice", updatedAt: 1 },
			]);
			const store = createListFilterStore(
				{
					async read() {
						return stored(initial);
					},
					remember() {
						const write = writes[writeCount];
						writeCount += 1;

						if (!write) {
							throw new Error("Unexpected write");
						}

						return write.promise;
					},
					subscribe() {},
				},
				(error) => errors.push(error),
			);
			const controller = new AbortController();
			store.start(controller.signal, () => {});
			await settlePromises();

			store.remember(ORIGIN, SCOPE, "author_username=bob");
			store.remember(ORIGIN, SCOPE, undefined);
			expect(writeCount).toBe(1);
			expect(store.read(ORIGIN, SCOPE)).toBeUndefined();

			if (firstOutcome === "resolve") {
				first.resolve(
					listFiltersWith([
						{ ...SCOPE, query: "author_username=bob", updatedAt: 2 },
					]),
				);
			} else {
				first.reject(new Error("First write failed"));
			}
			await settlePromises();
			expect(writeCount).toBe(2);

			if (secondOutcome === "resolve") {
				second.resolve(listFiltersWith([]));
			} else {
				second.reject(new Error("Second write failed"));
			}
			await settlePromises();

			expect(store.read(ORIGIN, SCOPE)).toBe(expected);
			expect(errors).toHaveLength(expectedErrors);
			controller.abort();
		},
	);

	test("keeps pending changes on other scopes while one write rolls back", async () => {
		const first = deferred<TonicListFilters>();
		const second = deferred<TonicListFilters>();
		const writes = [first, second];
		let writeCount = 0;
		const initial = listFiltersWith([
			{ ...SCOPE, query: "author_username=alice", updatedAt: 1 },
			{ ...OTHER_SCOPE, query: "label_name=backend", updatedAt: 1 },
		]);
		const store = createListFilterStore(
			{
				async read() {
					return stored(initial);
				},
				remember() {
					const write = writes[writeCount];
					writeCount += 1;
					return (
						write?.promise ?? Promise.reject(new Error("Unexpected write"))
					);
				},
				subscribe() {},
			},
			() => {},
		);
		store.start(new AbortController().signal, () => {});
		await settlePromises();

		store.remember(ORIGIN, SCOPE, "author_username=bob");
		store.remember(ORIGIN, OTHER_SCOPE, undefined);
		first.reject(new Error("First write failed"));
		await settlePromises();

		expect(store.read(ORIGIN, SCOPE)).toBe("author_username=alice");
		expect(store.read(ORIGIN, OTHER_SCOPE)).toBeUndefined();

		second.reject(new Error("Second write failed"));
		await settlePromises();
		expect(store.read(ORIGIN, OTHER_SCOPE)).toBe("label_name=backend");
	});

	test("keeps a storage event that arrives before a write result", async () => {
		const write = deferred<TonicListFilters>();
		let listener: ((resolution: ListFiltersResolution) => void) | undefined;
		let reconciles = 0;
		const initial = listFiltersWith([
			{ ...SCOPE, query: "author_username=alice", updatedAt: 1 },
		]);
		const store = createListFilterStore({
			async read() {
				return stored(initial);
			},
			remember() {
				return write.promise;
			},
			subscribe(nextListener) {
				listener = nextListener;
			},
		});
		store.start(new AbortController().signal, () => {
			reconciles += 1;
		});
		await settlePromises();
		store.remember(ORIGIN, SCOPE, "author_username=bob");

		listener?.(
			stored(
				listFiltersWith([
					{ ...SCOPE, query: "author_username=carol", updatedAt: 3 },
				]),
			),
		);
		expect(store.read(ORIGIN, SCOPE)).toBe("author_username=bob");

		write.resolve(
			listFiltersWith([
				{ ...SCOPE, query: "author_username=bob", updatedAt: 2 },
			]),
		);
		await settlePromises();

		expect(store.read(ORIGIN, SCOPE)).toBe("author_username=carol");
		expect(reconciles).toBe(3);
	});

	/*
	 * `newer-schema` resolves to an empty value because this build cannot read
	 * the stored shape. Adopting it would restore every rewritten link and then
	 * offer a write the repository refuses outright.
	 */
	test("leaves a newer schema alone at start instead of acting on it", async () => {
		const { repository, setResolution, writes } = createRecordingRepository();
		const store = createListFilterStore(repository);
		const controller = new AbortController();

		setResolution({
			outcome: "newer-schema",
			listFilters: { schemaVersion: 1, origins: {} },
			dropped: [],
		});
		store.start(controller.signal, () => {});
		await Promise.resolve();
		await Promise.resolve();

		expect(store.isWritable()).toBe(false);

		store.remember(ORIGIN, SCOPE, "author_username=ada");

		expect(writes).toEqual([]);
		controller.abort();
	});

	test("keeps the snapshot it had when a newer schema arrives later", async () => {
		const { repository, emit, emitResolution, writes } =
			createRecordingRepository();
		const store = createListFilterStore(repository);
		const controller = new AbortController();
		let reconciles = 0;

		store.start(controller.signal, () => {
			reconciles += 1;
		});
		await Promise.resolve();
		await Promise.resolve();
		emit({
			schemaVersion: 1,
			origins: {
				[ORIGIN]: [{ ...SCOPE, query: "author_username=ada", updatedAt: 1 }],
			},
		});

		emitResolution({
			outcome: "newer-schema",
			listFilters: { schemaVersion: 1, origins: {} },
			dropped: [],
		});

		expect(store.read(ORIGIN, SCOPE)).toBe("author_username=ada");
		expect(store.isWritable()).toBe(false);
		// The chip has to drop its write offers, so the runtime is reconciled.
		expect(reconciles).toBe(3);

		store.remember(ORIGIN, SCOPE, "milestone_title=16.0");

		expect(writes).toEqual([]);

		// A build that understands the value again makes writing possible again.
		emit({ schemaVersion: 1, origins: {} });

		expect(store.isWritable()).toBe(true);
		controller.abort();
	});
});
