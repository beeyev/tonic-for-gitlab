import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readMergeRequestListFiltersFixture,
} from "../../../tests/helpers/gitlab-dom";
import { createFeatureContext } from "../../content/runtime/feature-context";
import {
	MERGE_REQUEST_LIST_ACTION_CONTROL_ATTRIBUTE,
	MERGE_REQUEST_LIST_ACTIONS_ROOT_ATTRIBUTE,
} from "../../content/runtime/merge-request-list-actions";
import type { ListFilterStore } from "../remember-merge-request-list-filters/list-filters-store";
import { createRememberMergeRequestListFiltersFeature } from "../remember-merge-request-list-filters/remember-merge-request-list-filters";
import {
	buildMyAuthoredMergeRequestsHref,
	filterMyAuthoredMergeRequests,
	getFilterMyAuthoredMergeRequestsCompatibility,
} from "./filter-my-authored-merge-requests";
import {
	FILTER_MY_AUTHORED_MERGE_REQUESTS_ACTION_ATTRIBUTE,
	FILTER_MY_AUTHORED_MERGE_REQUESTS_ROOT_ATTRIBUTE,
} from "./selectors";

const PROJECT_URL = "https://gitlab.com/example/project/-/merge_requests";
const ACTION = `[${FILTER_MY_AUTHORED_MERGE_REQUESTS_ACTION_ATTRIBUTE}]`;
const ROOT = `[${FILTER_MY_AUTHORED_MERGE_REQUESTS_ROOT_ATTRIBUTE}]`;
const SHARED_ROOT = `[${MERGE_REQUEST_LIST_ACTIONS_ROOT_ATTRIBUTE}]`;

afterEach(() => {
	closeGitLabTestWindows();
});

async function openList(
	version: "18" | "19",
	url = PROJECT_URL,
	page = "projects:merge_requests:index",
): Promise<Window> {
	return createGitLabTestWindow(
		await readMergeRequestListFiltersFixture(version),
		url,
		page,
	);
}

function actionHref(testWindow: Window): string | null {
	return (
		testWindow.document.querySelector(ACTION)?.getAttribute("href") ?? null
	);
}

function activate(testWindow: Window): AbortController {
	const controller = new AbortController();
	filterMyAuthoredMergeRequests.activate(
		createFeatureContext(asBrowserWindow(testWindow)),
		controller.signal,
	);
	return controller;
}

describe("filter-my-authored-merge-requests", () => {
	test.each(["18", "19"] as const)(
		"builds a normal author-filter link for the GitLab %s contract",
		async (version) => {
			const testWindow = await openList(
				version,
				`${PROJECT_URL}?state=merged&label_name%5B%5D=Bug&sort=updated_desc&author_username=other.user&page_after=cursor&first_page_size=20#list`,
			);
			const controller = activate(testWindow);
			const href = actionHref(testWindow);

			expect(href).not.toBeNull();
			const target = new URL(href as string, PROJECT_URL);
			expect(target.searchParams.get("author_username")).toBe("current.user");
			expect(target.searchParams.get("state")).toBe("merged");
			expect(target.searchParams.get("label_name[]")).toBe("Bug");
			expect(target.searchParams.get("sort")).toBe("updated_desc");
			expect(target.searchParams.has("page_after")).toBe(false);
			expect(target.searchParams.has("first_page_size")).toBe(false);
			expect(target.hash).toBe("#list");
			expect(testWindow.document.querySelector(ACTION)?.textContent).toBe(
				"My merge requests",
			);
			controller.abort();
		},
	);

	test("replaces every author dimension and removes every paging form", async () => {
		const testWindow = await openList(
			"19",
			`${PROJECT_URL}?author_username=first&author_username=second&author_id=7&not%5Bauthor_id%5D=8&not%5Bauthor_username%5D=current.user&or%5Bauthor_username%5D=other.user&label_name%5B%5D=Bug&cursor=a&page=3&page_before=b&last_page_size=20`,
		);
		activate(testWindow);
		const target = new URL(actionHref(testWindow) as string, PROJECT_URL);

		expect(target.searchParams.getAll("author_username")).toEqual([
			"current.user",
		]);
		for (const parameter of [
			"author_id",
			"not[author_id]",
			"not[author_username]",
			"or[author_username]",
		]) {
			expect(target.searchParams.has(parameter)).toBe(false);
		}
		expect(target.searchParams.get("label_name[]")).toBe("Bug");
		for (const parameter of [
			"cursor",
			"page",
			"page_before",
			"last_page_size",
		]) {
			expect(target.searchParams.has(parameter)).toBe(false);
		}
	});

	test.each(["18", "19"] as const)(
		"reports the supported GitLab %s project contract independently of identity",
		async (version) => {
			const signedIn = await openList(version);
			const signedOut = await openList(version);
			signedOut.document
				.querySelector('[data-testid="user-menu-toggle"]')
				?.remove();

			expect(
				getFilterMyAuthoredMergeRequestsCompatibility(
					createFeatureContext(asBrowserWindow(signedIn)),
				),
			).toBe("supported");
			expect(
				getFilterMyAuthoredMergeRequestsCompatibility(
					createFeatureContext(asBrowserWindow(signedOut)),
				),
			).toBe("supported");
		},
	);

	test("reports only broken in-scope contracts as unsupported", async () => {
		const dashboard = await openList(
			"19",
			"https://gitlab.com/dashboard/merge_requests",
			"dashboard:merge_requests",
		);
		const detail = await openList(
			"19",
			"https://gitlab.com/example/project/-/merge_requests/1",
			"projects:merge_requests:show",
		);
		const missingList = await openList("19");
		missingList.document.querySelector(".issuable-list-container")?.remove();
		const ambiguousBar = await openList("19");
		const duplicate = ambiguousBar.document.createElement("div");
		duplicate.setAttribute("data-testid", "issuable-search-container");
		ambiguousBar.document.querySelector("main")?.append(duplicate);

		expect(
			getFilterMyAuthoredMergeRequestsCompatibility(
				createFeatureContext(asBrowserWindow(dashboard)),
			),
		).toBe("not-applicable");
		expect(
			getFilterMyAuthoredMergeRequestsCompatibility(
				createFeatureContext(asBrowserWindow(detail)),
			),
		).toBe("not-applicable");
		expect(
			getFilterMyAuthoredMergeRequestsCompatibility(
				createFeatureContext(asBrowserWindow(missingList)),
			),
		).toBe("unsupported");
		expect(
			getFilterMyAuthoredMergeRequestsCompatibility(
				createFeatureContext(asBrowserWindow(ambiguousBar)),
			),
		).toBe("unsupported");
	});

	test("supports group lists and relative-root GitLab paths", async () => {
		const testWindow = await openList(
			"19",
			"https://gitlab.example/gitlab/groups/example/-/merge_requests?state=all",
			"groups:merge_requests",
		);
		testWindow.document
			.querySelector('[data-testid="user-menu-toggle"]')
			?.setAttribute("href", "/gitlab/current.user");

		activate(testWindow);

		expect(actionHref(testWindow)).toBe(
			"/gitlab/groups/example/-/merge_requests?state=all&author_username=current.user",
		);
	});

	test("does not offer a no-op link for the exact current author", async () => {
		const testWindow = await openList(
			"19",
			`${PROJECT_URL}?author_username=current.user&label_name%5B%5D=Bug`,
		);

		activate(testWindow);

		expect(testWindow.document.querySelector(ACTION)).toBeNull();
		expect(testWindow.document.querySelector(SHARED_ROOT)).toBeNull();
	});

	test("still offers replacement when the current author appears with another value", async () => {
		const testWindow = await openList(
			"19",
			`${PROJECT_URL}?author_username=current.user&author_username=other.user`,
		);

		activate(testWindow);

		expect(testWindow.document.querySelector(ACTION)).not.toBeNull();
	});

	test.each([
		"author_id=7",
		"not%5Bauthor_id%5D=7",
		"not%5Bauthor_username%5D=current.user",
		"or%5Bauthor_username%5D=other.user",
	])(
		"still offers replacement when the current author conflicts with %s",
		async (conflict) => {
			const testWindow = await openList(
				"19",
				`${PROJECT_URL}?author_username=current.user&${conflict}`,
			);

			activate(testWindow);
			const target = new URL(actionHref(testWindow) as string, PROJECT_URL);

			expect(target.searchParams.getAll("author_username")).toEqual([
				"current.user",
			]);
			expect(target.searchParams.size).toBe(1);
		},
	);

	test("signed-out, conflicting, and malformed identity are safe no-ops", async () => {
		for (const mutate of [
			(testWindow: Window) => {
				testWindow.document
					.querySelector('[data-testid="user-menu-toggle"]')
					?.remove();
			},
			(testWindow: Window) => {
				const other = testWindow.document.createElement("a");
				other.setAttribute("data-testid", "user-menu-toggle");
				other.setAttribute("href", "/other.user");
				testWindow.document.body.append(other);
			},
			(testWindow: Window) => {
				testWindow.document
					.querySelector('[data-testid="user-menu-toggle"]')
					?.setAttribute("href", "https://other.example/current.user");
			},
			(testWindow: Window) => {
				testWindow.document
					.querySelector('[data-testid="user-menu-toggle"]')
					?.setAttribute("href", "/current.user?tab=activity");
			},
			(testWindow: Window) => {
				testWindow.document
					.querySelector('[data-testid="user-menu-toggle"]')
					?.setAttribute("href", "/%2F");
			},
		]) {
			const testWindow = await openList("19");
			mutate(testWindow);
			activate(testWindow);
			expect(testWindow.document.querySelector(ACTION)).toBeNull();
		}
	});

	test("omits dashboard and unsupported list contracts", async () => {
		const dashboard = await openList(
			"19",
			"https://gitlab.com/dashboard/merge_requests",
			"dashboard:merge_requests",
		);
		expect(
			filterMyAuthoredMergeRequests.matches(
				createFeatureContext(asBrowserWindow(dashboard)),
			),
		).toBe(false);
		activate(dashboard);
		expect(dashboard.document.querySelector(ACTION)).toBeNull();

		for (const selector of [
			".issuable-list-container",
			".vue-filtered-search-bar-container",
		]) {
			const unsupported = await openList("19");
			unsupported.document.querySelector(selector)?.remove();
			activate(unsupported);
			expect(unsupported.document.querySelector(ACTION)).toBeNull();
		}
	});

	test("rejects ambiguous independent filter bars", async () => {
		const testWindow = await openList("19");
		const duplicate = testWindow.document.createElement("div");
		duplicate.setAttribute("data-testid", "issuable-search-container");
		testWindow.document.querySelector("main")?.append(duplicate);

		activate(testWindow);

		expect(testWindow.document.querySelector(ACTION)).toBeNull();
	});

	test("does not adopt or remove a foreign action host", async () => {
		const testWindow = await openList("19");
		const foreignHost = testWindow.document.createElement("div");
		foreignHost.setAttribute(MERGE_REQUEST_LIST_ACTIONS_ROOT_ATTRIBUTE, "");
		foreignHost.textContent = "GitLab-owned content";
		testWindow.document
			.querySelector('[data-testid="issuable-search-container"]')
			?.after(foreignHost);
		const controller = activate(testWindow);

		expect(testWindow.document.querySelector(ACTION)).toBeNull();
		expect(foreignHost.textContent).toBe("GitLab-owned content");

		controller.abort();
		expect(foreignHost.isConnected).toBe(true);
		expect(foreignHost.textContent).toBe("GitLab-owned content");
	});

	test("supports GitLab's recognized empty-list contract", async () => {
		const testWindow = await openList("19");
		const container = testWindow.document.querySelector(
			".issuable-list-container",
		);
		container?.replaceChildren();
		const empty = testWindow.document.createElement("div");
		empty.setAttribute("data-testid", "issuable-empty-state");
		container?.append(empty);

		activate(testWindow);

		expect(testWindow.document.querySelector(ACTION)).not.toBeNull();
	});

	test("is idempotent, follows URL changes, and removes its row on abort", async () => {
		const testWindow = await openList("19");
		const controller = activate(testWindow);
		const context = createFeatureContext(asBrowserWindow(testWindow));

		filterMyAuthoredMergeRequests.activate(context, controller.signal);
		expect(testWindow.document.querySelectorAll(ROOT)).toHaveLength(1);

		testWindow.happyDOM.setURL(`${PROJECT_URL}?author_username=current.user`);
		filterMyAuthoredMergeRequests.reconcile?.(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);
		expect(testWindow.document.querySelector(ACTION)).toBeNull();

		testWindow.happyDOM.setURL(`${PROJECT_URL}?author_username=other.user`);
		filterMyAuthoredMergeRequests.reconcile?.(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);
		expect(testWindow.document.querySelector(ACTION)).not.toBeNull();

		controller.abort();
		expect(testWindow.document.querySelector(ROOT)).toBeNull();
		expect(testWindow.document.querySelector(SHARED_ROOT)).toBeNull();
	});

	test.each(["new-first", "remembered-first"] as const)(
		"keeps deterministic placement with remembered filters: %s",
		async (order) => {
			const testWindow = await openList(
				"19",
				`${PROJECT_URL}?label_name%5B%5D=Bug`,
			);
			const writes: unknown[] = [];
			const store: ListFilterStore = {
				isWritable: () => true,
				read: () => undefined,
				remember: (...args) => {
					writes.push(args);
				},
			};
			const remembered = createRememberMergeRequestListFiltersFeature(store);
			const myController = new AbortController();
			const rememberedController = new AbortController();
			const context = createFeatureContext(asBrowserWindow(testWindow));
			const mountMy = () =>
				filterMyAuthoredMergeRequests.activate(context, myController.signal);
			const mountRemembered = () =>
				remembered.activate(context, rememberedController.signal);

			if (order === "new-first") {
				mountMy();
				mountRemembered();
			} else {
				mountRemembered();
				mountMy();
			}

			const host = testWindow.document.querySelector(SHARED_ROOT);
			expect(host?.children).toHaveLength(2);
			expect(host?.children[0]?.textContent).toBe("My merge requests");
			expect(host?.children[1]?.textContent).toBe("Remember filters");
			expect(
				host?.querySelectorAll(
					`[${MERGE_REQUEST_LIST_ACTION_CONTROL_ATTRIBUTE}]`,
				),
			).toHaveLength(2);
			expect(writes).toEqual([]);

			myController.abort();
			expect(testWindow.document.querySelector(SHARED_ROOT)).not.toBeNull();
			rememberedController.abort();
			expect(testWindow.document.querySelector(SHARED_ROOT)).toBeNull();
		},
	);
});

describe("buildMyAuthoredMergeRequestsHref", () => {
	test("does not require storage or DOM state", () => {
		const testWindow = new Window({
			url: `${PROJECT_URL}?state=closed&sort=created_asc&page=2`,
		});

		expect(
			buildMyAuthoredMergeRequestsHref(
				testWindow.location as unknown as Location,
				"ada",
			),
		).toBe(
			"/example/project/-/merge_requests?state=closed&sort=created_asc&author_username=ada",
		);
		testWindow.close();
	});
});
