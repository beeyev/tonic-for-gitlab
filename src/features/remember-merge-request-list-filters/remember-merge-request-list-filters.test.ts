import { afterEach, describe, expect, test } from "bun:test";
import type { Window } from "happy-dom";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readMergeRequestListFiltersFixture,
	settleGitLabDom,
} from "../../../tests/helpers/gitlab-dom";
import {
	createFeatureContext,
	type Feature,
} from "../../content/runtime/feature-context";
import { activateFeatureRuntime } from "../../content/runtime/feature-lifecycle";
import type { ListFilterStore } from "./list-filters-store";
import { createRememberMergeRequestListFiltersFeature } from "./remember-merge-request-list-filters";
import { type ListFilterScope, toScopeKey } from "./scope";

const LIST_URL = "https://gitlab.com/example/project/-/merge_requests";
const NAV_LINK_SELECTOR =
	'a[data-testid="nav-item-link"][href*="merge_requests"]';

afterEach(() => {
	closeGitLabTestWindows();
});

interface FakeStore extends ListFilterStore {
	entries: Map<string, string | undefined>;
	writes: { key: string; query: string | undefined }[];
	seed(origin: string, scope: ListFilterScope, query: string): void;
}

function createFakeStore(): FakeStore {
	const entries = new Map<string, string | undefined>();
	const writes: { key: string; query: string | undefined }[] = [];

	return {
		entries,
		writes,
		seed(origin, scope, query) {
			entries.set(toScopeKey(origin, scope), query);
		},
		read(origin, scope) {
			return entries.get(toScopeKey(origin, scope));
		},
		isWritable: () => true,
		remember(origin, scope, query) {
			const key = toScopeKey(origin, scope);

			if (entries.get(key) === query) {
				return;
			}

			entries.set(key, query);
			writes.push({ key, query });
		},
	};
}

function navHref(testWindow: Window): string | null {
	return testWindow.document
		.querySelector(NAV_LINK_SELECTOR)
		?.getAttribute("href") as string | null;
}

async function openList(version: "18" | "19", url = LIST_URL): Promise<Window> {
	return createGitLabTestWindow(
		await readMergeRequestListFiltersFixture(version),
		url,
	);
}

/*
 * The invariant the feature is built on: nothing is stored unless the user asks
 * for it. There is no automatic capture of any kind, so filtering a list the
 * ordinary way leaves any saved set for that scope exactly as it was. Without
 * this, an ad-hoc filter would silently overwrite a set the user had chosen to
 * keep, which is the failure the explicit model exists to remove.
 */
describe("remember-merge-request-list-filters never writes on its own", () => {
	test.each(["18", "19"] as const)(
		"stores nothing while browsing the GitLab %s contract",
		async (version) => {
			const store = createFakeStore();
			const scope = {
				path: "/example/project/-/merge_requests",
				state: "opened",
			} as const;

			store.seed("https://gitlab.com", scope, "label_name%5B%5D=Mine");

			const testWindow = await openList(version, LIST_URL);
			const controller = new AbortController();
			const feature = createRememberMergeRequestListFiltersFeature(store);

			feature.activate(
				createFeatureContext(asBrowserWindow(testWindow)),
				controller.signal,
			);

			// A filter applied the ordinary way, a state tab change, and paging.
			for (const url of [
				`${LIST_URL}?label_name%5B%5D=Urgent`,
				`${LIST_URL}/?state=merged&milestone_title=16.0`,
				`${LIST_URL}/?label_name%5B%5D=Urgent&first_page_size=20`,
				`${LIST_URL}/`,
			]) {
				testWindow.happyDOM.setURL(url);
				feature.reconcile?.(
					createFeatureContext(asBrowserWindow(testWindow)),
					controller.signal,
				);
			}

			expect(store.writes).toEqual([]);
			expect(store.read("https://gitlab.com", scope)).toBe(
				"label_name%5B%5D=Mine",
			);
			controller.abort();
		},
	);

	test("attaches no document listeners of its own", async () => {
		const store = createFakeStore();
		const testWindow = await openList("19", `${LIST_URL}?label_name%5B%5D=Bug`);
		const added: string[] = [];

		// Recorded rather than forwarded: the assertion is that nothing registers
		// at all, so a listener that never runs cannot hide a regression.
		testWindow.document.addEventListener = ((type: string) => {
			added.push(type);
		}) as typeof testWindow.document.addEventListener;

		const controller = new AbortController();

		createRememberMergeRequestListFiltersFeature(store).activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);

		expect(added).toEqual([]);
		controller.abort();
	});
});

describe("remember-merge-request-list-filters restore", () => {
	function seeded(): FakeStore {
		const store = createFakeStore();
		store.seed(
			"https://gitlab.com",
			{ path: "/example/project/-/merge_requests", state: "opened" },
			"label_name%5B%5D=Bug",
		);
		return store;
	}

	test.each(["18", "19"] as const)(
		"rewrites the navigation link in the GitLab %s contract and keeps it relative",
		async (version) => {
			const store = seeded();
			const testWindow = await openList(
				version,
				"https://gitlab.com/example/project",
			);
			const feature = createRememberMergeRequestListFiltersFeature(store);

			feature.activate(
				createFeatureContext(asBrowserWindow(testWindow)),
				new AbortController().signal,
			);

			expect(navHref(testWindow)).toBe(
				"/example/project/-/merge_requests?label_name%5B%5D=Bug",
			);
		},
	);

	test("leaves links this feature must not own untouched", async () => {
		const store = seeded();
		store.seed(
			"https://other.example.com",
			{ path: "/example/project/-/merge_requests", state: "opened" },
			"label_name%5B%5D=Bug",
		);
		const testWindow = await openList(
			"19",
			"https://gitlab.com/example/project",
		);
		const before = new Map(
			[...testWindow.document.querySelectorAll("a[href]")].map((link) => [
				link,
				link.getAttribute("href"),
			]),
		);

		createRememberMergeRequestListFiltersFeature(store).activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			new AbortController().signal,
		);

		for (const [link, href] of before) {
			if (link.getAttribute("data-testid") === "nav-item-link") {
				continue;
			}

			expect(link.getAttribute("href")).toBe(href);
		}
	});

	/*
	 * GitLab's state tabs are `<a role="tab" href="#">`, and a bare fragment
	 * resolves to the current URL. On a list page that is the list itself, so an
	 * unguarded rewrite would turn a tab into a full list URL.
	 */
	test("does not rewrite a fragment-only link on the list page itself", async () => {
		const store = seeded();
		const testWindow = await openList("19", LIST_URL);
		const tabs = [
			...testWindow.document.querySelectorAll('a[role="tab"]'),
		] as unknown as HTMLAnchorElement[];
		expect(tabs).toHaveLength(4);

		createRememberMergeRequestListFiltersFeature(store).activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			new AbortController().signal,
		);

		for (const tab of tabs) {
			expect(tab.getAttribute("href")).toBe("#");
		}
	});

	test("does not rewrite a paging link", async () => {
		const store = seeded();
		const testWindow = await openList(
			"19",
			"https://gitlab.com/example/project",
		);
		const paging = testWindow.document.createElement("a");
		paging.setAttribute(
			"href",
			"/example/project/-/merge_requests?first_page_size=20&page_after=abc",
		);
		testWindow.document.body.append(paging);

		createRememberMergeRequestListFiltersFeature(store).activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			new AbortController().signal,
		);

		expect(paging.getAttribute("href")).toBe(
			"/example/project/-/merge_requests?first_page_size=20&page_after=abc",
		);
	});

	test("keeps the link's own state and appends only that state's filters", async () => {
		const store = createFakeStore();
		store.seed(
			"https://gitlab.com",
			{ path: "/example/project/-/merge_requests", state: "merged" },
			"milestone_title=16.0",
		);
		const testWindow = await openList(
			"19",
			"https://gitlab.com/example/project",
		);
		const stateLink = testWindow.document.createElement("a");
		stateLink.setAttribute(
			"href",
			"/example/project/-/merge_requests?state=merged",
		);
		testWindow.document.body.append(stateLink);

		createRememberMergeRequestListFiltersFeature(store).activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			new AbortController().signal,
		);

		expect(stateLink.getAttribute("href")).toBe(
			"/example/project/-/merge_requests?state=merged&milestone_title=16.0",
		);
		// The Open scope has nothing stored, so the sidebar link is left alone.
		expect(navHref(testWindow)).toBe("/example/project/-/merge_requests");
	});

	test("keeps an absolute href absolute", async () => {
		const store = seeded();
		const testWindow = await openList(
			"19",
			"https://gitlab.com/example/project",
		);
		const absolute = testWindow.document.createElement("a");
		absolute.setAttribute(
			"href",
			"https://gitlab.com/example/project/-/merge_requests",
		);
		testWindow.document.body.append(absolute);

		createRememberMergeRequestListFiltersFeature(store).activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			new AbortController().signal,
		);

		expect(absolute.getAttribute("href")).toBe(
			"https://gitlab.com/example/project/-/merge_requests?label_name%5B%5D=Bug",
		);
	});

	test("restores the original href when the remembered filters become empty", async () => {
		const store = seeded();
		const scope = {
			path: "/example/project/-/merge_requests",
			state: "opened",
		} as const;
		const testWindow = await openList(
			"19",
			"https://gitlab.com/example/project",
		);
		const controller = new AbortController();
		const feature = createRememberMergeRequestListFiltersFeature(store);
		const context = createFeatureContext(asBrowserWindow(testWindow));

		feature.activate(context, controller.signal);
		expect(navHref(testWindow)).not.toBe("/example/project/-/merge_requests");

		store.seed("https://gitlab.com", scope, "");
		feature.reconcile?.(context, controller.signal);

		expect(navHref(testWindow)).toBe("/example/project/-/merge_requests");
	});

	test("repeated activation does not stack rewrites", async () => {
		const store = seeded();
		const testWindow = await openList(
			"19",
			"https://gitlab.com/example/project",
		);
		const controller = new AbortController();
		const feature = createRememberMergeRequestListFiltersFeature(store);
		const context = createFeatureContext(asBrowserWindow(testWindow));

		feature.activate(context, controller.signal);
		feature.activate(context, controller.signal);
		feature.reconcile?.(context, controller.signal);

		expect(navHref(testWindow)).toBe(
			"/example/project/-/merge_requests?label_name%5B%5D=Bug",
		);
	});

	test("aborting restores every original href", async () => {
		const store = seeded();
		const testWindow = await openList(
			"19",
			"https://gitlab.com/example/project",
		);
		const controller = new AbortController();

		createRememberMergeRequestListFiltersFeature(store).activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);
		controller.abort();

		expect(navHref(testWindow)).toBe("/example/project/-/merge_requests");
	});
});

describe("remember-merge-request-list-filters runtime", () => {
	function configured(
		store: ListFilterStore,
		isEnabled: () => boolean,
	): Feature {
		const feature = createRememberMergeRequestListFiltersFeature(store);
		return { ...feature, matches: () => isEnabled() };
	}

	test("rewrites a navigation link GitLab renders after activation", async () => {
		const store = createFakeStore();
		store.seed(
			"https://gitlab.com",
			{ path: "/example/project/-/merge_requests", state: "opened" },
			"label_name%5B%5D=Bug",
		);
		const testWindow = createGitLabTestWindow(
			'<div id="sidebar"></div>',
			"https://gitlab.com/example/project",
		);
		const controller = new AbortController();

		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[createRememberMergeRequestListFiltersFeature(store)],
			controller.signal,
		);

		testWindow.document
			.getElementById("sidebar")
			?.insertAdjacentHTML(
				"beforeend",
				'<a data-testid="nav-item-link" href="/example/project/-/merge_requests">Merge requests</a>',
			);
		await settleGitLabDom(testWindow);

		expect(navHref(testWindow)).toBe(
			"/example/project/-/merge_requests?label_name%5B%5D=Bug",
		);

		controller.abort();
		expect(navHref(testWindow)).toBe("/example/project/-/merge_requests");
	});

	test("disabling the setting restores GitLab's own hrefs", async () => {
		const store = createFakeStore();
		store.seed(
			"https://gitlab.com",
			{ path: "/example/project/-/merge_requests", state: "opened" },
			"label_name%5B%5D=Bug",
		);
		const testWindow = await openList(
			"19",
			"https://gitlab.com/example/project",
		);
		const controller = new AbortController();
		let isEnabled = true;

		const runtime = activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[configured(store, () => isEnabled)],
			controller.signal,
		);
		expect(navHref(testWindow)).toBe(
			"/example/project/-/merge_requests?label_name%5B%5D=Bug",
		);

		isEnabled = false;
		runtime.reconcile();

		expect(navHref(testWindow)).toBe("/example/project/-/merge_requests");

		isEnabled = true;
		runtime.reconcile();

		expect(navHref(testWindow)).toBe(
			"/example/project/-/merge_requests?label_name%5B%5D=Bug",
		);
		controller.abort();
	});

	/*
	 * GitLab reuses anchor nodes across same-document navigation, so the sidebar
	 * entry gets retargeted in place after a project switch. Tonic must treat
	 * that value as the new truth rather than reassert the old destination.
	 */
	test("adopts GitLab retargeting a link Tonic had already rewritten", async () => {
		const store = createFakeStore();
		store.seed(
			"https://gitlab.com",
			{ path: "/example/project/-/merge_requests", state: "opened" },
			"label_name%5B%5D=Bug",
		);
		store.seed(
			"https://gitlab.com",
			{ path: "/example/other-project/-/merge_requests", state: "opened" },
			"milestone_title=16.0",
		);
		const testWindow = await openList(
			"19",
			"https://gitlab.com/example/project/-/merge_requests/1",
		);
		const controller = new AbortController();

		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[createRememberMergeRequestListFiltersFeature(store)],
			controller.signal,
		);
		await settleGitLabDom(testWindow);
		expect(navHref(testWindow)).toBe(
			"/example/project/-/merge_requests?label_name%5B%5D=Bug",
		);

		testWindow.document
			.querySelector(NAV_LINK_SELECTOR)
			?.setAttribute("href", "/example/other-project/-/merge_requests");
		await settleGitLabDom(testWindow);

		expect(navHref(testWindow)).toBe(
			"/example/other-project/-/merge_requests?milestone_title=16.0",
		);
		controller.abort();
	});

	test("leaves a retargeted link alone when its new target has no filters", async () => {
		const store = createFakeStore();
		store.seed(
			"https://gitlab.com",
			{ path: "/example/project/-/merge_requests", state: "opened" },
			"label_name%5B%5D=Bug",
		);
		const testWindow = await openList(
			"19",
			"https://gitlab.com/example/project/-/merge_requests/1",
		);
		const controller = new AbortController();

		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[createRememberMergeRequestListFiltersFeature(store)],
			controller.signal,
		);
		await settleGitLabDom(testWindow);

		testWindow.document
			.querySelector(NAV_LINK_SELECTOR)
			?.setAttribute("href", "/example/other-project/-/merge_requests");
		await settleGitLabDom(testWindow);
		expect(navHref(testWindow)).toBe("/example/other-project/-/merge_requests");

		// Aborting must not put back an href GitLab itself replaced.
		controller.abort();
		expect(navHref(testWindow)).toBe("/example/other-project/-/merge_requests");
	});

	test("restores a replaced navigation container without losing the original", async () => {
		const store = createFakeStore();
		store.seed(
			"https://gitlab.com",
			{ path: "/example/project/-/merge_requests", state: "opened" },
			"label_name%5B%5D=Bug",
		);
		const testWindow = await openList(
			"19",
			"https://gitlab.com/example/project",
		);
		const controller = new AbortController();

		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[createRememberMergeRequestListFiltersFeature(store)],
			controller.signal,
		);
		const detachedLink = testWindow.document.querySelector(NAV_LINK_SELECTOR);

		const sidebar = testWindow.document.querySelector("aside.super-sidebar");
		const replacement = testWindow.document.createElement("aside");
		replacement.className = "super-sidebar";
		replacement.innerHTML =
			'<a data-testid="nav-item-link" href="/example/project/-/merge_requests">Merge requests</a>';
		sidebar?.replaceWith(replacement);
		await settleGitLabDom(testWindow);

		expect(navHref(testWindow)).toBe(
			"/example/project/-/merge_requests?label_name%5B%5D=Bug",
		);

		controller.abort();

		expect(navHref(testWindow)).toBe("/example/project/-/merge_requests");
		// The detached link keeps the value it was aborted with, never a stacked one.
		expect(detachedLink?.getAttribute("href")).toBe(
			"/example/project/-/merge_requests",
		);
	});
});
