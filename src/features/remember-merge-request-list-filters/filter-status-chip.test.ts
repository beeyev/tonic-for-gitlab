import { afterEach, describe, expect, test } from "bun:test";
import type { Window } from "happy-dom";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readMergeRequestListFiltersFixture,
	settleGitLabDom,
} from "../../../tests/helpers/gitlab-dom";
import { activateFeatureRuntime } from "../../content/runtime/feature-lifecycle";
import type { ListFilterStore } from "./list-filters-store";
import { createRememberMergeRequestListFiltersFeature } from "./remember-merge-request-list-filters";
import { type ListFilterScope, toScopeKey } from "./scope";

const LIST_URL = "https://gitlab.com/example/project/-/merge_requests";
const SCOPE: ListFilterScope = {
	path: "/example/project/-/merge_requests",
	state: "opened",
};
const CHIP = "[data-tonic-for-gitlab-list-filter-status]";
const LABEL = "[data-tonic-for-gitlab-list-filter-label]";
const action = (name: string) =>
	`[data-tonic-for-gitlab-list-filter-action="${name}"]`;

afterEach(() => {
	closeGitLabTestWindows();
});

interface FakeStore extends ListFilterStore {
	entries: Map<string, string | undefined>;
	writes: (string | undefined)[];
	writtenKeys: string[];
}

function createFakeStore(seeded?: string, isWritable = true): FakeStore {
	const entries = new Map<string, string | undefined>();
	const writes: (string | undefined)[] = [];
	const writtenKeys: string[] = [];

	if (seeded !== undefined) {
		entries.set(toScopeKey("https://gitlab.com", SCOPE), seeded);
	}

	return {
		entries,
		writes,
		writtenKeys,
		read: (origin, scope) => entries.get(toScopeKey(origin, scope)),
		isWritable: () => isWritable,
		remember(origin, scope, query) {
			const key = toScopeKey(origin, scope);

			writes.push(query);
			writtenKeys.push(key);

			if (query === undefined) {
				entries.delete(key);
			} else {
				entries.set(key, query);
			}
		},
	};
}

async function mount(
	store: ListFilterStore,
	url: string,
	version: "18" | "19" = "19",
): Promise<{ testWindow: Window; controller: AbortController }> {
	const testWindow = await createGitLabTestWindow(
		await readMergeRequestListFiltersFixture(version),
		url,
	);
	const controller = new AbortController();

	activateFeatureRuntime(
		asBrowserWindow(testWindow),
		[createRememberMergeRequestListFiltersFeature(store)],
		controller.signal,
	);
	await settleGitLabDom(testWindow);

	return { testWindow, controller };
}

/**
 * Dispatches the click a real user makes.
 *
 * The handlers refuse anything the page could have synthesized, so a test that
 * dispatched a plain event would only ever prove the guard fires. `isTrusted` is
 * read-only and set by the browser, so it is defined explicitly here; every
 * other property is what a real click carries.
 */
function userClick(testWindow: Window, selector: string): void {
	const element = testWindow.document.querySelector(selector);

	expect(element).not.toBeNull();

	const event = new testWindow.Event("click", {
		bubbles: true,
		cancelable: true,
	});

	Object.defineProperty(event, "isTrusted", { value: true });
	element?.dispatchEvent(event);
}

function chipText(testWindow: Window): string | undefined {
	return testWindow.document.querySelector(LABEL)?.textContent ?? undefined;
}

describe("filter status chip", () => {
	test.each(["18", "19"] as const)(
		"discloses a remembered set in the GitLab %s contract",
		async (version) => {
			const store = createFakeStore("label_name%5B%5D=Bug");
			const { testWindow, controller } = await mount(
				store,
				`${LIST_URL}?label_name%5B%5D=Bug`,
				version,
			);

			expect(chipText(testWindow)).toBe("Filters remembered");
			expect(
				testWindow.document.querySelector(action("forget")),
			).not.toBeNull();
			expect(testWindow.document.querySelector(action("save"))).toBeNull();
			controller.abort();
		},
	);

	/*
	 * The state that makes remembering reachable for filters capture never sees:
	 * a link, a bookmark, or a label chip clicked inside a row.
	 */
	test("offers to remember filters that arrived without an edit", async () => {
		const store = createFakeStore();
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Urgent`,
		);

		// The button is the whole message; a label beside it would only restate it.
		expect(
			testWindow.document.querySelector(action("remember"))?.textContent,
		).toBe("Remember filters");
		expect(testWindow.document.querySelector(LABEL)).toBeNull();
		controller.abort();
	});

	test("remembering from the unsaved state stores the shown filters", async () => {
		const store = createFakeStore();
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Urgent`,
		);

		userClick(testWindow, action("remember"));
		await settleGitLabDom(testWindow);

		expect(store.writes).toEqual(["label_name%5B%5D=Urgent"]);
		expect(chipText(testWindow)).toBe("Filters remembered");
		controller.abort();
	});

	test("treats a stored empty set as unsaved on a filtered list", async () => {
		const store = createFakeStore("");
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Urgent`,
		);

		expect(
			testWindow.document.querySelector(action("remember")),
		).not.toBeNull();
		controller.abort();
	});

	test("stays hidden when nothing is stored", async () => {
		const store = createFakeStore();
		const { testWindow, controller } = await mount(store, LIST_URL);

		expect(testWindow.document.querySelector(CHIP)).toBeNull();
		controller.abort();
	});

	test("stays hidden when the stored set is empty", async () => {
		const store = createFakeStore("");
		const { testWindow, controller } = await mount(store, LIST_URL);

		expect(testWindow.document.querySelector(CHIP)).toBeNull();
		controller.abort();
	});

	test("is placed after GitLab's filter bar, not inside it", async () => {
		const store = createFakeStore("label_name%5B%5D=Bug");
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Bug`,
		);
		const bar = testWindow.document.querySelector(
			'[data-testid="issuable-search-container"]',
		);
		const chip = testWindow.document.querySelector(CHIP);
		const actionRow = testWindow.document.querySelector(
			"[data-tonic-for-gitlab-merge-request-list-actions]",
		);

		expect(chip).not.toBeNull();
		// The shared action row is the sibling; the feature owns only its child.
		expect(actionRow?.parentElement === bar?.parentElement).toBe(true);
		expect(bar?.nextElementSibling === actionRow).toBe(true);
		expect(chip?.parentElement === actionRow).toBe(true);
		controller.abort();
	});

	test("removes and restores its actions as the filter bar becomes ambiguous", async () => {
		const store = createFakeStore("label_name%5B%5D=Bug");
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Bug`,
		);
		const duplicate = testWindow.document.createElement("div");
		duplicate.setAttribute("data-testid", "issuable-search-container");

		expect(testWindow.document.querySelector(CHIP)).not.toBeNull();
		testWindow.document.querySelector("main")?.append(duplicate);
		await settleGitLabDom(testWindow);

		expect(testWindow.document.querySelector(CHIP)).toBeNull();
		expect(store.writes).toEqual([]);

		duplicate.remove();
		await settleGitLabDom(testWindow);
		expect(testWindow.document.querySelector(CHIP)).not.toBeNull();
		expect(store.writes).toEqual([]);
		controller.abort();
	});

	test("offers both choices when a link's filters differ from the saved set", async () => {
		const store = createFakeStore("label_name%5B%5D=Mine");
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Urgent`,
		);

		expect(chipText(testWindow)).toBe("Showing different filters");
		expect(
			testWindow.document
				.querySelector(action("use-saved"))
				?.getAttribute("href"),
		).toBe("/example/project/-/merge_requests?label_name%5B%5D=Mine");
		expect(testWindow.document.querySelector(action("save"))).not.toBeNull();
		controller.abort();
	});

	test("keeps the scope's own state in the saved link", async () => {
		const store = createFakeStore();
		store.entries.set(
			toScopeKey("https://gitlab.com", { ...SCOPE, state: "merged" }),
			"label_name%5B%5D=Mine",
		);
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?state=merged&label_name%5B%5D=Urgent&first_page_size=20`,
		);
		const href = testWindow.document
			.querySelector(action("use-saved"))
			?.getAttribute("href");
		const url = new URL(href ?? "", LIST_URL);

		expect(url.searchParams.get("state")).toBe("merged");
		expect(url.searchParams.getAll("label_name[]")).toEqual(["Mine"]);
		// Paging must not travel to the saved view.
		expect(url.searchParams.has("first_page_size")).toBe(false);
		controller.abort();
	});

	test("forgetting restores GitLab's own hrefs and offers the set back", async () => {
		const store = createFakeStore("label_name%5B%5D=Bug");
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Bug`,
		);
		const nav = 'a[data-testid="nav-item-link"][href*="merge_requests"]';

		expect(testWindow.document.querySelector(nav)?.getAttribute("href")).toBe(
			"/example/project/-/merge_requests?label_name%5B%5D=Bug",
		);

		userClick(testWindow, action("forget"));
		await settleGitLabDom(testWindow);

		expect(store.writes).toEqual([undefined]);
		expect(testWindow.document.querySelector(nav)?.getAttribute("href")).toBe(
			"/example/project/-/merge_requests",
		);
		/*
		 * The list still shows those filters, so the chip stays and offers them
		 * back rather than vanishing. Forgetting is undoable in one click, which
		 * is what keeps it from being a trap.
		 */
		expect(
			testWindow.document.querySelector(action("remember")),
		).not.toBeNull();
		controller.abort();
	});

	/*
	 * A saved set with an unfiltered list on screen used to render as diverged,
	 * which was wrong twice: nothing different was being shown, and the
	 * `Save these` it offered wrote the empty query, which reads back as nothing
	 * saved. One click on a control labelled Save destroyed the set with no undo.
	 * The state that replaced it cannot offer that control at all.
	 */
	test("never offers to save an empty query over a saved set", async () => {
		const store = createFakeStore("label_name%5B%5D=Bug");
		const { testWindow, controller } = await mount(store, LIST_URL);

		expect(chipText(testWindow)).toBe("Saved filters not applied");
		expect(testWindow.document.querySelector(action("save"))).toBeNull();
		expect(testWindow.document.querySelector(action("remember"))).toBeNull();
		expect(
			testWindow.document
				.querySelector(action("use-saved"))
				?.getAttribute("href"),
		).toBe("/example/project/-/merge_requests?label_name%5B%5D=Bug");
		expect(testWindow.document.querySelector(action("forget"))).not.toBeNull();
		expect(store.writes).toEqual([]);
		controller.abort();
	});

	test("forgetting from an unfiltered list drops the set and the chip", async () => {
		const store = createFakeStore("label_name%5B%5D=Bug");
		const { testWindow, controller } = await mount(store, LIST_URL);

		userClick(testWindow, action("forget"));
		await settleGitLabDom(testWindow);

		expect(store.writes).toEqual([undefined]);
		expect(testWindow.document.querySelector(CHIP)).toBeNull();
		controller.abort();
	});

	test("saving the shown filters replaces the stored set and settles", async () => {
		const store = createFakeStore("label_name%5B%5D=Mine");
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Urgent`,
		);

		userClick(testWindow, action("save"));
		await settleGitLabDom(testWindow);

		expect(store.writes).toEqual(["label_name%5B%5D=Urgent"]);
		expect(chipText(testWindow)).toBe("Filters remembered");
		controller.abort();
	});

	test("does not rewrite its own saved link as a candidate", async () => {
		const store = createFakeStore("label_name%5B%5D=Mine");
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Urgent`,
		);
		const before = testWindow.document
			.querySelector(action("use-saved"))
			?.getAttribute("href");

		await settleGitLabDom(testWindow);

		expect(
			testWindow.document
				.querySelector(action("use-saved"))
				?.getAttribute("href"),
		).toBe(before);
		controller.abort();
	});

	test("survives GitLab replacing the filter bar container", async () => {
		const store = createFakeStore("label_name%5B%5D=Bug");
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Bug`,
		);
		const container = testWindow.document.querySelector(
			".vue-filtered-search-bar-container",
		);
		const replacement = testWindow.document.createElement("div");

		replacement.className = "vue-filtered-search-bar-container";
		replacement.innerHTML =
			'<div data-testid="issuable-search-container"><input data-testid="filtered-search-input" /></div>';
		container?.replaceWith(replacement);
		await settleGitLabDom(testWindow);

		expect(testWindow.document.querySelectorAll(CHIP)).toHaveLength(1);
		expect(chipText(testWindow)).toBe("Filters remembered");
		controller.abort();
	});

	/*
	 * Scope identity is origin plus path plus state, but the rendered view is
	 * not: an unsaved list looks identical on every state tab. The chip is
	 * therefore not re-rendered across a tab change, and handlers that closed
	 * over the scope of the pass that built them kept writing to the tab the user
	 * had left. Observed on `?state=merged`, where `Remember filters` wrote the
	 * `opened` scope.
	 */
	test("writes to the state tab on screen after a same-document tab change", async () => {
		const store = createFakeStore();
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Urgent`,
		);

		testWindow.happyDOM.setURL(
			`${LIST_URL}?state=merged&label_name%5B%5D=Urgent`,
		);
		testWindow.dispatchEvent(new testWindow.PopStateEvent("popstate"));
		await settleGitLabDom(testWindow);

		userClick(testWindow, action("remember"));
		await settleGitLabDom(testWindow);

		expect(store.writtenKeys).toEqual([
			toScopeKey("https://gitlab.com", { ...SCOPE, state: "merged" }),
		]);
		expect(
			store.entries.get(toScopeKey("https://gitlab.com", SCOPE)),
		).toBeUndefined();
		expect(chipText(testWindow)).toBe("Filters remembered");
		controller.abort();
	});

	/*
	 * Every action replaces the control that triggered it, so a render that
	 * rebuilt the whole chip left `document.activeElement` on `<body>` and a
	 * keyboard user lost their place on the page after every single click.
	 */
	test("moves focus to the successor control after an action", async () => {
		const store = createFakeStore("label_name%5B%5D=Mine");
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Urgent`,
		);
		const save = testWindow.document.querySelector(action("save"));

		(save as unknown as HTMLElement | null)?.focus();
		userClick(testWindow, action("save"));
		await settleGitLabDom(testWindow);

		expect(
			testWindow.document.activeElement?.getAttribute(
				"data-tonic-for-gitlab-list-filter-action",
			),
		).toBe("forget");
		controller.abort();
	});

	test("announces the state and names what each control acts on", async () => {
		const store = createFakeStore("label_name%5B%5D=Mine");
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Urgent`,
		);

		// The label alone, so the button set does not re-announce with it.
		expect(testWindow.document.querySelector(LABEL)?.getAttribute("role")).toBe(
			"status",
		);
		expect(
			testWindow.document.querySelectorAll('[role="status"]'),
		).toHaveLength(1);

		for (const name of ["use-saved", "save"]) {
			expect(
				testWindow.document
					.querySelector(action(name))
					?.getAttribute("aria-label"),
			).toContain("merge request list");
		}

		controller.abort();
	});

	/*
	 * A newer build owns the stored value, so every write the repository would
	 * receive is refused. Disclosure stays; the offers that cannot succeed go.
	 */
	test("offers no write while storage holds a newer schema", async () => {
		const store = createFakeStore("label_name%5B%5D=Bug", false);
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Bug`,
		);

		expect(chipText(testWindow)).toBe("Filters remembered");
		expect(testWindow.document.querySelector(action("forget"))).toBeNull();
		controller.abort();
	});

	test("stays hidden on an unsaved list while storage holds a newer schema", async () => {
		const store = createFakeStore(undefined, false);
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Urgent`,
		);

		expect(testWindow.document.querySelector(CHIP)).toBeNull();
		controller.abort();
	});

	/*
	 * The chip is light DOM, so GitLab script can reach these controls. Only the
	 * browser sets `isTrusted`, and these buttons are the only bridge from the
	 * page to extension storage.
	 */
	test("refuses a click the page synthesized", async () => {
		const store = createFakeStore("label_name%5B%5D=Bug");
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Bug`,
		);

		testWindow.document
			.querySelector(action("forget"))
			?.dispatchEvent(new testWindow.Event("click", { bubbles: true }));
		await settleGitLabDom(testWindow);

		expect(store.writes).toEqual([]);
		expect(chipText(testWindow)).toBe("Filters remembered");
		controller.abort();
	});

	/*
	 * Controls used to be looked up with `host.querySelector`, which finds only
	 * what is attached, so every state change rebuilt the control it had just
	 * removed and bound another click listener to an activation signal that
	 * outlives every transition. Measured at one new button per transition,
	 * unbounded for a user moving between filtered and unfiltered lists.
	 */
	test("builds each control once across repeated state changes", async () => {
		const store = createFakeStore("label_name%5B%5D=Bug");
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Other`,
		);
		let built = 0;
		const document = testWindow.document as unknown as {
			createElement: (tag: string) => unknown;
		};
		const create = document.createElement.bind(testWindow.document);

		document.createElement = (tag: string) => {
			if (tag === "button" || tag === "a") {
				built += 1;
			}

			return create(tag);
		};

		for (let pass = 0; pass < 12; pass += 1) {
			testWindow.happyDOM.setURL(
				pass % 2 === 0 ? `${LIST_URL}/` : `${LIST_URL}/?label_name%5B%5D=Other`,
			);
			await settleGitLabDom(testWindow);
		}

		// `use-saved`, `save`, and `forget` across both states, and no more.
		expect(built).toBeLessThanOrEqual(3);
		expect(
			testWindow.document.querySelectorAll(
				"[data-tonic-for-gitlab-list-filter-action]",
			).length,
		).toBeLessThanOrEqual(2);
		controller.abort();
	});

	test("removes the chip on abort", async () => {
		const store = createFakeStore("label_name%5B%5D=Bug");
		const { testWindow, controller } = await mount(
			store,
			`${LIST_URL}?label_name%5B%5D=Bug`,
		);

		expect(testWindow.document.querySelector(CHIP)).not.toBeNull();
		controller.abort();
		expect(testWindow.document.querySelector(CHIP)).toBeNull();
	});
});
