import { beforeEach, describe, expect, test } from "bun:test";
import { fakeBrowser } from "@webext-core/fake-browser";
import {
	createListFiltersRepository,
	LIST_FILTERS_SCHEMA_VERSION,
	LIST_FILTERS_STORAGE_KEY,
	type ListFilterEntry,
	ListFiltersQueryTooLongError,
	MAX_REMEMBERED_ORIGINS,
	MAX_REMEMBERED_QUERY_LENGTH,
	MAX_REMEMBERED_SCOPES_PER_ORIGIN,
	NewerListFiltersSchemaError,
	resolveListFilters,
	type TonicListFilters,
} from "./list-filters-repository";

const GITLAB_COM = "https://gitlab.com";
const SELF_MANAGED = "https://gitlab.example.com";
const PROJECT_PATH = "/group/project/-/merge_requests";

beforeEach(() => {
	fakeBrowser.reset();
});

function createRepository(
	onDropped: (dropped: unknown[]) => void = () => {},
	now: () => number = () => 1000,
) {
	return createListFiltersRepository(
		fakeBrowser.storage.local,
		fakeBrowser.storage.onChanged,
		onDropped,
		now,
	);
}

/**
 * A stored entry, with overrides so a test can also express a value this build
 * must refuse. The cast is what lets one helper serve both.
 */
function entry(overrides: Record<string, unknown> = {}): ListFilterEntry {
	return {
		path: PROJECT_PATH,
		state: "opened",
		query: "author_username=ada",
		updatedAt: 1000,
		...overrides,
	} as ListFilterEntry;
}

function listFilters(
	origins: Record<string, ListFilterEntry[]>,
): TonicListFilters {
	return { schemaVersion: 1, origins };
}

async function readStored(): Promise<unknown> {
	return (await fakeBrowser.storage.local.get(LIST_FILTERS_STORAGE_KEY))[
		LIST_FILTERS_STORAGE_KEY
	];
}

describe("list filters resolution", () => {
	test("uses an empty set when nothing is stored", () => {
		expect(resolveListFilters(undefined)).toEqual({
			outcome: "default",
			listFilters: { schemaVersion: 1, origins: {} },
			dropped: [],
		});
	});

	test("keeps stored entries per origin", () => {
		const stored = listFilters({
			[GITLAB_COM]: [entry()],
			[SELF_MANAGED]: [entry({ query: "milestone_title=16.0" })],
		});

		expect(resolveListFilters(stored)).toEqual({
			outcome: "stored",
			listFilters: stored,
			dropped: [],
		});
	});

	test("defers to a newer schema and resets an unusable container", () => {
		expect(resolveListFilters({ schemaVersion: 2, origins: {} }).outcome).toBe(
			"newer-schema",
		);
		expect(resolveListFilters({ schemaVersion: 1, origins: [] }).outcome).toBe(
			"reset",
		);
		expect(resolveListFilters("nope").outcome).toBe("reset");
	});

	/*
	 * Deliberately unlike the settings reset policy and identical to the targets
	 * one: entries are independent, so a value this build cannot use must not
	 * take every other remembered list with it.
	 */
	test("drops only the unusable entries and origins", () => {
		const resolution = resolveListFilters({
			schemaVersion: 1,
			origins: {
				[GITLAB_COM]: [
					entry(),
					// Not a merge request list scope.
					entry({ path: "/group/project/-/issues" }),
					// A detail page, which the scope path predicate must exclude.
					entry({ path: "/group/project/-/merge_requests/7" }),
					// A trailing slash is not the normalized form.
					entry({ path: `${PROJECT_PATH}/`, state: "merged" }),
					// A state this build does not know.
					entry({ state: "locked" }),
					// A non-canonical query cannot have been written by this build.
					entry({ state: "closed", query: "b=2&a=1" }),
					// A duplicate scope would make lookups ambiguous.
					entry({ query: "author_username=grace" }),
					entry({ updatedAt: -1 }),
					"not-an-entry",
				],
				"gitlab.example.org": [entry()],
				[SELF_MANAGED]: "not-a-list",
			},
		});

		expect(resolution.outcome).toBe("stored");
		expect(resolution.listFilters.origins).toEqual({
			[GITLAB_COM]: [entry()],
		});
		expect(resolution.dropped).toHaveLength(10);
	});

	test("drops an over-long stored query", () => {
		const resolution = resolveListFilters({
			schemaVersion: 1,
			origins: {
				[GITLAB_COM]: [
					entry({ query: `a=${"x".repeat(MAX_REMEMBERED_QUERY_LENGTH)}` }),
				],
			},
		});

		expect(resolution.listFilters.origins).toEqual({});
		expect(resolution.dropped).toHaveLength(1);
	});

	test("keeps an empty query, which means the user cleared their filters", () => {
		const stored = listFilters({ [GITLAB_COM]: [entry({ query: "" })] });

		expect(resolveListFilters(stored).listFilters).toEqual(stored);
	});
});

describe("list filters repository", () => {
	test("persists and reads one scope", async () => {
		const repository = createRepository();

		await repository.remember(
			GITLAB_COM,
			{ path: PROJECT_PATH, state: "opened" },
			"author_username=ada",
		);

		expect((await repository.read()).listFilters).toEqual(
			listFilters({ [GITLAB_COM]: [entry()] }),
		);
	});

	/*
	 * The same project path exists on every GitLab, and a username or label from
	 * one instance is meaningless on another, so an origin is part of scope
	 * identity rather than a detail of where the data came from.
	 */
	test("keeps two origins with the same path independent", async () => {
		const repository = createRepository();
		const scope = { path: PROJECT_PATH, state: "opened" } as const;

		await repository.remember(GITLAB_COM, scope, "author_username=ada");
		await repository.remember(SELF_MANAGED, scope, "author_username=grace");

		const { origins } = (await repository.read()).listFilters;
		expect(origins[GITLAB_COM]?.[0]?.query).toBe("author_username=ada");
		expect(origins[SELF_MANAGED]?.[0]?.query).toBe("author_username=grace");
	});

	test("keeps each state's filters separate", async () => {
		const repository = createRepository();

		await repository.remember(
			GITLAB_COM,
			{ path: PROJECT_PATH, state: "opened" },
			"author_username=ada",
		);
		await repository.remember(
			GITLAB_COM,
			{ path: PROJECT_PATH, state: "merged" },
			"milestone_title=16.0",
		);

		const entries = (await repository.read()).listFilters.origins[GITLAB_COM];
		expect(entries).toHaveLength(2);
		expect(entries?.find((stored) => stored.state === "merged")?.query).toBe(
			"milestone_title=16.0",
		);
	});

	test("forgets a scope when the query is undefined", async () => {
		const repository = createRepository();
		const scope = { path: PROJECT_PATH, state: "opened" } as const;

		await repository.remember(GITLAB_COM, scope, "author_username=ada");
		await repository.remember(GITLAB_COM, scope, undefined);

		expect((await repository.read()).listFilters.origins).toEqual({});
	});

	/*
	 * Refused, never coerced. An over-long query used to become `undefined`,
	 * which is the value that means "forget", so a control labelled Save deleted
	 * the set it was asked to replace.
	 */
	test("caps entries per origin and origins on read, keeping the newest", () => {
		const origins: Record<string, unknown[]> = {};

		for (let index = 0; index < MAX_REMEMBERED_ORIGINS + 3; index += 1) {
			origins[`https://gitlab-${index}.example.com`] = [
				entry({ updatedAt: 1000 + index }),
			];
		}

		origins[GITLAB_COM] = Array.from(
			{ length: MAX_REMEMBERED_SCOPES_PER_ORIGIN + 5 },
			(_unused, index) =>
				entry({
					path: `/group/project-${index}/-/merge_requests`,
					updatedAt: 5000 + index,
				}),
		);

		const resolution = resolveListFilters({
			schemaVersion: LIST_FILTERS_SCHEMA_VERSION,
			origins,
		});

		expect(Object.keys(resolution.listFilters.origins)).toHaveLength(
			MAX_REMEMBERED_ORIGINS,
		);
		expect(resolution.listFilters.origins[GITLAB_COM]).toHaveLength(
			MAX_REMEMBERED_SCOPES_PER_ORIGIN,
		);
		// Newest survives the per-origin cap.
		expect(resolution.listFilters.origins[GITLAB_COM]?.[0]?.updatedAt).toBe(
			5000 + MAX_REMEMBERED_SCOPES_PER_ORIGIN + 4,
		);
		expect(resolution.dropped.length).toBeGreaterThan(0);
	});

	test("refuses an over-long query and keeps the stored set", async () => {
		const repository = createRepository();
		const scope = { path: PROJECT_PATH, state: "opened" } as const;

		await repository.remember(GITLAB_COM, scope, "author_username=ada");

		await expect(
			repository.remember(
				GITLAB_COM,
				scope,
				`a=${"x".repeat(MAX_REMEMBERED_QUERY_LENGTH)}`,
			),
		).rejects.toBeInstanceOf(ListFiltersQueryTooLongError);

		expect((await repository.read()).listFilters.origins).toEqual({
			[GITLAB_COM]: [
				{
					path: PROJECT_PATH,
					state: "opened",
					query: "author_username=ada",
					updatedAt: expect.any(Number),
				},
			],
		});
	});

	test("still forgets a scope when asked to explicitly", async () => {
		const repository = createRepository();
		const scope = { path: PROJECT_PATH, state: "opened" } as const;

		await repository.remember(GITLAB_COM, scope, "author_username=ada");
		await repository.remember(GITLAB_COM, scope, undefined);

		expect((await repository.read()).listFilters.origins).toEqual({});
	});

	test("evicts the least recently changed scope of that origin only", async () => {
		let clock = 0;
		const repository = createRepository(
			() => {},
			() => {
				clock += 1;
				return clock;
			},
		);

		await repository.remember(
			SELF_MANAGED,
			{ path: "/other/project/-/merge_requests", state: "opened" },
			"author_username=grace",
		);

		for (let index = 0; index <= MAX_REMEMBERED_SCOPES_PER_ORIGIN; index += 1) {
			await repository.remember(
				GITLAB_COM,
				{ path: `/group/project-${index}/-/merge_requests`, state: "opened" },
				"author_username=ada",
			);
		}

		const { origins } = (await repository.read()).listFilters;
		expect(origins[GITLAB_COM]).toHaveLength(MAX_REMEMBERED_SCOPES_PER_ORIGIN);
		expect(
			origins[GITLAB_COM]?.some(
				(stored) => stored.path === "/group/project-0/-/merge_requests",
			),
		).toBe(false);
		// A busy instance must not be able to evict a quiet one's entries.
		expect(origins[SELF_MANAGED]).toHaveLength(1);
	});

	test("evicts the least recently changed origin past the origin cap", async () => {
		let clock = 0;
		const repository = createRepository(
			() => {},
			() => {
				clock += 1;
				return clock;
			},
		);

		for (let index = 0; index <= MAX_REMEMBERED_ORIGINS; index += 1) {
			await repository.remember(
				`https://gitlab-${index}.example.com`,
				{ path: PROJECT_PATH, state: "opened" },
				"author_username=ada",
			);
		}

		const { origins } = (await repository.read()).listFilters;
		expect(Object.keys(origins)).toHaveLength(MAX_REMEMBERED_ORIGINS);
		expect(origins["https://gitlab-0.example.com"]).toBeUndefined();
	});

	test("refuses to write against a newer schema", async () => {
		const newerState = { schemaVersion: 99, origins: {} };
		await fakeBrowser.storage.local.set({
			[LIST_FILTERS_STORAGE_KEY]: newerState,
		});

		await expect(
			createRepository().remember(
				GITLAB_COM,
				{ path: PROJECT_PATH, state: "opened" },
				"author_username=ada",
			),
		).rejects.toThrow(NewerListFiltersSchemaError);
		expect(await readStored()).toEqual(newerState);
	});

	test("reports dropped entries once per read", async () => {
		const dropped: unknown[][] = [];
		await fakeBrowser.storage.local.set({
			[LIST_FILTERS_STORAGE_KEY]: {
				schemaVersion: 1,
				origins: { [GITLAB_COM]: [entry({ state: "locked" })] },
			},
		});

		await createRepository((entries) => dropped.push(entries)).read();

		expect(dropped).toHaveLength(1);
	});

	/*
	 * The outcome travels with the change because an empty value means two
	 * opposite things: nothing is stored, or a newer build owns what is. A
	 * subscriber that only saw `listFilters` had to treat the second as the
	 * first, which is exactly the state this build must not act on.
	 */
	test("reports a newer schema arriving from another build as its own outcome", async () => {
		const received: string[] = [];
		const controller = new AbortController();
		createRepository().subscribe(
			(resolution) => received.push(resolution.outcome),
			controller.signal,
		);

		await fakeBrowser.storage.local.set({
			[LIST_FILTERS_STORAGE_KEY]: {
				schemaVersion: 99,
				origins: { [GITLAB_COM]: [entry()] },
			},
		});

		expect(received).toEqual(["newer-schema"]);
		controller.abort();
	});

	test("notifies subscribers of a change from another tab", async () => {
		const received: TonicListFilters[] = [];
		const controller = new AbortController();
		createRepository().subscribe(
			(resolution) => received.push(resolution.listFilters),
			controller.signal,
		);

		await fakeBrowser.storage.local.set({
			[LIST_FILTERS_STORAGE_KEY]: {
				schemaVersion: 1,
				origins: { [GITLAB_COM]: [entry()] },
			},
		});

		expect(received.at(-1)?.origins[GITLAB_COM]).toEqual([entry()]);

		controller.abort();
		await fakeBrowser.storage.local.set({
			[LIST_FILTERS_STORAGE_KEY]: { schemaVersion: 1, origins: {} },
		});

		expect(received).toHaveLength(1);
	});
});
