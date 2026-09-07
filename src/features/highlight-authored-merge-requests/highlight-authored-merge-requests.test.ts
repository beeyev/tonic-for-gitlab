import { afterEach, describe, expect, test } from "bun:test";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readMergeRequestListFixture,
	readObservedGitLab18MergeRequestListFixture,
	settleGitLabDom,
} from "../../../tests/helpers/gitlab-dom";
import { createFeatureContext } from "../../content/runtime/feature-context";
import { activateFeatureRuntime } from "../../content/runtime/feature-lifecycle";
import { dimDraftMergeRequests } from "../dim-draft-merge-requests/dim-draft-merge-requests";
import { DRAFT_ROW_ATTRIBUTE } from "../dim-draft-merge-requests/selectors";
import { highlightAuthoredMergeRequests } from "./highlight-authored-merge-requests";
import {
	AUTHORED_ROW_ATTRIBUTE,
	CURRENT_USER_LINK_SELECTOR,
	FEATURE_ROOT_ATTRIBUTE,
} from "./selectors";

afterEach(() => {
	closeGitLabTestWindows();
});

describe("highlight-authored-merge-requests", () => {
	/*
	 * The page, not the DOM. A list page with no root yet is still a list page,
	 * and reconciliation clears what the feature owns when the root is missing,
	 * so requiring the root here made activation flap every time GitLab replaced
	 * the container.
	 */
	test("matches merge request list pages, root present or not", async () => {
		const markup = await readMergeRequestListFixture("19");
		const listWindow = createGitLabTestWindow(markup);
		const detailWindow = createGitLabTestWindow(
			markup,
			"https://gitlab.com/example/project/-/merge_requests/1",
		);
		const missingRootWindow = createGitLabTestWindow(
			'<section id="loading-state"></section>',
		);

		expect(
			highlightAuthoredMergeRequests.matches(
				createFeatureContext(asBrowserWindow(listWindow)),
			),
		).toBe(true);
		expect(
			highlightAuthoredMergeRequests.matches(
				createFeatureContext(asBrowserWindow(detailWindow)),
			),
		).toBe(false);
		expect(
			highlightAuthoredMergeRequests.matches(
				createFeatureContext(asBrowserWindow(missingRootWindow)),
			),
		).toBe(true);
	});

	test.each(["18", "19"] as const)(
		"marks only rows authored by the current user in the GitLab %s contract",
		async (version) => {
			const testWindow = createGitLabTestWindow(
				await readMergeRequestListFixture(version),
			);
			const controller = new AbortController();

			highlightAuthoredMergeRequests.activate(
				createFeatureContext(asBrowserWindow(testWindow)),
				controller.signal,
			);

			expect(
				testWindow.document.querySelectorAll(`[${AUTHORED_ROW_ATTRIBUTE}]`),
			).toHaveLength(1);
			expect(
				testWindow.document.querySelector(`[${AUTHORED_ROW_ATTRIBUTE}]`)?.id,
			).toBe(version === "18" ? "issuable_1801" : "issuable_1901");
			expect(
				testWindow.document
					.getElementById(version === "18" ? "issuable_1802" : "issuable_1902")
					?.hasAttribute(AUTHORED_ROW_ATTRIBUTE),
			).toBe(false);
		},
	);

	test("uses the author contract observed on the public GitLab 18 instance", async () => {
		const testWindow = createGitLabTestWindow(
			await readObservedGitLab18MergeRequestListFixture(),
		);
		testWindow.document.body.insertAdjacentHTML(
			"afterbegin",
			'<a data-testid="user-menu-toggle" href="/observed.author">Current user</a>',
		);
		const controller = new AbortController();

		highlightAuthoredMergeRequests.activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);

		expect(
			testWindow.document
				.getElementById("issuable_observed_18")
				?.hasAttribute(AUTHORED_ROW_ATTRIBUTE),
		).toBe(true);
	});

	test("signed-out and ambiguous current-user identity are safe no-ops", async () => {
		const markup = await readMergeRequestListFixture("19");
		const signedOutWindow = createGitLabTestWindow(markup);
		signedOutWindow.document
			.querySelector(CURRENT_USER_LINK_SELECTOR)
			?.remove();
		const ambiguousWindow = createGitLabTestWindow(markup);
		ambiguousWindow.document.body.insertAdjacentHTML(
			"afterbegin",
			'<a data-testid="user-menu-toggle" href="/another.user">Another account</a>',
		);

		for (const testWindow of [signedOutWindow, ambiguousWindow]) {
			const controller = new AbortController();
			highlightAuthoredMergeRequests.activate(
				createFeatureContext(asBrowserWindow(testWindow)),
				controller.signal,
			);

			expect(
				testWindow.document.querySelector(`[${FEATURE_ROOT_ATTRIBUTE}]`),
			).toBe(null);
			expect(
				testWindow.document.querySelector(`[${AUTHORED_ROW_ATTRIBUTE}]`),
			).toBe(null);
		}
	});

	test.each([
		"https://other.example/current.user",
		"/current.user?tab=activity",
		"/current.user#activity",
		"http://[invalid",
	])("rejects a non-profile current-user URL: %s", async (href) => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		testWindow.document
			.querySelector(CURRENT_USER_LINK_SELECTOR)
			?.setAttribute("href", href);
		const controller = new AbortController();

		highlightAuthoredMergeRequests.activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);

		expect(
			testWindow.document.querySelector(`[${FEATURE_ROOT_ATTRIBUTE}]`),
		).toBe(null);
		expect(
			testWindow.document.querySelector(`[${AUTHORED_ROW_ATTRIBUTE}]`),
		).toBe(null);
	});

	test.each(["/gitlab/current.user", "/o/example/current.user"])(
		"accepts a prefixed GitLab profile URL: %s",
		async (href) => {
			const testWindow = createGitLabTestWindow(
				await readMergeRequestListFixture("19"),
			);
			testWindow.document
				.querySelector(CURRENT_USER_LINK_SELECTOR)
				?.setAttribute("href", href);
			testWindow.document
				.querySelector('#issuable_1901 [data-testid="issuable-author"]')
				?.setAttribute("href", href);
			const controller = new AbortController();

			highlightAuthoredMergeRequests.activate(
				createFeatureContext(asBrowserWindow(testWindow)),
				controller.signal,
			);

			expect(
				testWindow.document
					.getElementById("issuable_1901")
					?.hasAttribute(AUTHORED_ROW_ATTRIBUTE),
			).toBe(true);
		},
	);

	test("does not partially mutate a list with an unsupported author field", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const currentUserRow = testWindow.document.getElementById("issuable_1901");
		currentUserRow
			?.querySelector('[data-testid="issuable-author"]')
			?.removeAttribute("data-username");
		const controller = new AbortController();

		highlightAuthoredMergeRequests.activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);

		expect(currentUserRow?.hasAttribute(AUTHORED_ROW_ATTRIBUTE)).toBe(false);
		expect(
			testWindow.document.querySelector(`[${FEATURE_ROOT_ATTRIBUTE}]`),
		).toBeNull();
		expect(
			testWindow.document.querySelectorAll(`[${AUTHORED_ROW_ATTRIBUTE}]`),
		).toHaveLength(0);
	});

	test("activation is idempotent", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const controller = new AbortController();
		const context = createFeatureContext(asBrowserWindow(testWindow));

		highlightAuthoredMergeRequests.activate(context, controller.signal);
		highlightAuthoredMergeRequests.activate(context, controller.signal);

		expect(
			testWindow.document.querySelectorAll(`[${FEATURE_ROOT_ATTRIBUTE}]`),
		).toHaveLength(1);
		expect(
			testWindow.document.querySelectorAll(`[${AUTHORED_ROW_ATTRIBUTE}]`),
		).toHaveLength(1);
	});

	test("aborting removes owned state from attached and detached rows", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const controller = new AbortController();
		const detachedRow = testWindow.document.getElementById("issuable_1901");

		highlightAuthoredMergeRequests.activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);
		detachedRow?.remove();
		controller.abort();

		expect(
			testWindow.document.querySelector(`[${FEATURE_ROOT_ATTRIBUTE}]`),
		).toBe(null);
		expect(detachedRow?.hasAttribute(AUTHORED_ROW_ATTRIBUTE)).toBe(false);
	});

	test("runtime reconciles late identity and merge request list replacement", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		testWindow.document.querySelector(CURRENT_USER_LINK_SELECTOR)?.remove();
		const controller = new AbortController();

		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[highlightAuthoredMergeRequests],
			controller.signal,
		);

		expect(
			testWindow.document.querySelector(`[${AUTHORED_ROW_ATTRIBUTE}]`),
		).toBe(null);

		testWindow.document.body.insertAdjacentHTML(
			"afterbegin",
			'<a data-testid="user-menu-toggle" href="/current.user">Current user</a>',
		);
		await settleGitLabDom(testWindow);

		expect(
			testWindow.document
				.getElementById("issuable_1901")
				?.hasAttribute(AUTHORED_ROW_ATTRIBUTE),
		).toBe(true);

		const currentList = testWindow.document.querySelector(
			".issuable-list-container",
		);
		const detachedRow = testWindow.document.getElementById("issuable_1901");
		const replacement = testWindow.document.createElement("div");
		replacement.className = "issuable-list-container";
		replacement.innerHTML = `
			<ul class="issuable-list">
				<li id="replacement-authored" data-testid="issuable-container">
					<a
						data-testid="issuable-title-link"
						href="/example/project/-/merge_requests/3"
					>
						Replacement merge request
					</a>
					<a
						data-testid="issuable-author"
						data-user-id="19003"
						data-username="current.user"
						href="/current.user"
					>
						Current User
					</a>
				</li>
			</ul>
		`;
		currentList?.replaceWith(replacement);
		await settleGitLabDom(testWindow);

		expect(
			testWindow.document
				.getElementById("replacement-authored")
				?.hasAttribute(AUTHORED_ROW_ATTRIBUTE),
		).toBe(true);
		expect(detachedRow?.hasAttribute(AUTHORED_ROW_ATTRIBUTE)).toBe(false);

		controller.abort();

		expect(
			testWindow.document
				.getElementById("replacement-authored")
				?.hasAttribute(AUTHORED_ROW_ATTRIBUTE),
		).toBe(false);
		expect(detachedRow?.hasAttribute(AUTHORED_ROW_ATTRIBUTE)).toBe(false);
	});

	test("clears prior markers when current-user identity disappears", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const controller = new AbortController();
		const context = createFeatureContext(asBrowserWindow(testWindow));

		highlightAuthoredMergeRequests.activate(context, controller.signal);
		testWindow.document.querySelector(CURRENT_USER_LINK_SELECTOR)?.remove();
		highlightAuthoredMergeRequests.reconcile?.(context, controller.signal);

		expect(
			testWindow.document.querySelector(`[${FEATURE_ROOT_ATTRIBUTE}]`),
		).toBe(null);
		expect(
			testWindow.document.querySelector(`[${AUTHORED_ROW_ATTRIBUTE}]`),
		).toBe(null);
	});

	test("runtime reconciles a changed current-user profile URL", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const controller = new AbortController();

		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[highlightAuthoredMergeRequests],
			controller.signal,
		);
		expect(
			testWindow.document.querySelector(`[${AUTHORED_ROW_ATTRIBUTE}]`),
		).not.toBeNull();

		testWindow.document
			.querySelector(CURRENT_USER_LINK_SELECTOR)
			?.setAttribute("href", "/other.user");
		await settleGitLabDom(testWindow);

		expect(
			testWindow.document
				.getElementById("issuable_1901")
				?.hasAttribute(AUTHORED_ROW_ATTRIBUTE),
		).toBe(false);
		expect(
			testWindow.document
				.getElementById("issuable_1902")
				?.hasAttribute(AUTHORED_ROW_ATTRIBUTE),
		).toBe(true);
	});

	test("preserves unrelated host DOM and composes with Draft state", async () => {
		const markup = `${await readMergeRequestListFixture("19")}
			<aside id="host-owned" class="existing-class" data-existing="value">
				Host-owned content
			</aside>`;
		const testWindow = createGitLabTestWindow(markup);
		const context = createFeatureContext(asBrowserWindow(testWindow));
		const draftController = new AbortController();
		const authoredController = new AbortController();
		const hostElement = testWindow.document.getElementById("host-owned");
		expect(hostElement).not.toBeNull();
		const hostBefore = hostElement?.outerHTML;
		const composedRow = testWindow.document.getElementById("issuable_1901");

		dimDraftMergeRequests.activate(context, draftController.signal);
		highlightAuthoredMergeRequests.activate(context, authoredController.signal);

		expect(composedRow?.hasAttribute(DRAFT_ROW_ATTRIBUTE)).toBe(true);
		expect(composedRow?.hasAttribute(AUTHORED_ROW_ATTRIBUTE)).toBe(true);
		expect(hostElement?.outerHTML).toBe(hostBefore);

		authoredController.abort();

		expect(composedRow?.hasAttribute(AUTHORED_ROW_ATTRIBUTE)).toBe(false);
		expect(composedRow?.hasAttribute(DRAFT_ROW_ATTRIBUTE)).toBe(true);
		expect(hostElement?.outerHTML).toBe(hostBefore);
	});
});
