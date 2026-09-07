import { afterEach, describe, expect, test } from "bun:test";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readMergeRequestListFixture,
	settleGitLabDom,
} from "../../../tests/helpers/gitlab-dom";
import { createFeatureContext } from "../../content/runtime/feature-context";
import { activateFeatureRuntime } from "../../content/runtime/feature-lifecycle";
import { dimDraftMergeRequests } from "./dim-draft-merge-requests";
import { DRAFT_ROW_ATTRIBUTE, FEATURE_ROOT_ATTRIBUTE } from "./selectors";

afterEach(() => {
	closeGitLabTestWindows();
});

describe("dim-draft-merge-requests", () => {
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
			dimDraftMergeRequests.matches(
				createFeatureContext(asBrowserWindow(listWindow)),
			),
		).toBe(true);
		expect(
			dimDraftMergeRequests.matches(
				createFeatureContext(asBrowserWindow(detailWindow)),
			),
		).toBe(false);
		expect(
			dimDraftMergeRequests.matches(
				createFeatureContext(asBrowserWindow(missingRootWindow)),
			),
		).toBe(true);
	});

	test.each(["18", "19"] as const)(
		"marks only Draft rows in the GitLab %s contract",
		async (version) => {
			const testWindow = createGitLabTestWindow(
				await readMergeRequestListFixture(version),
			);
			const controller = new AbortController();

			dimDraftMergeRequests.activate(
				createFeatureContext(asBrowserWindow(testWindow)),
				controller.signal,
			);

			expect(
				testWindow.document.querySelectorAll(`[${DRAFT_ROW_ATTRIBUTE}]`),
			).toHaveLength(1);
			expect(
				testWindow.document.querySelector(`[${DRAFT_ROW_ATTRIBUTE}]`)?.id,
			).toBe(version === "18" ? "issuable_1801" : "issuable_1901");
			expect(
				testWindow.document
					.querySelector(version === "18" ? "#issuable_1802" : "#issuable_1902")
					?.hasAttribute(DRAFT_ROW_ATTRIBUTE),
			).toBe(false);
		},
	);

	test.each([
		"draft: lowercase prefix",
		"DRAFT: uppercase prefix",
		"[draft] lowercase brackets",
		"(DRAFT) uppercase parentheses",
		"Draft:without whitespace",
	])("matches GitLab Draft title semantics: %s", async (title) => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const row = testWindow.document.getElementById("issuable_1902");
		row?.setAttribute("data-qa-issuable-title", title);
		const controller = new AbortController();

		dimDraftMergeRequests.activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);

		expect(row?.hasAttribute(DRAFT_ROW_ATTRIBUTE)).toBe(true);
	});

	test("activation is idempotent", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const controller = new AbortController();
		const context = createFeatureContext(asBrowserWindow(testWindow));

		dimDraftMergeRequests.activate(context, controller.signal);
		dimDraftMergeRequests.activate(context, controller.signal);

		expect(
			testWindow.document.querySelectorAll(`[${FEATURE_ROOT_ATTRIBUTE}]`),
		).toHaveLength(1);
		expect(
			testWindow.document.querySelectorAll(`[${DRAFT_ROW_ATTRIBUTE}]`),
		).toHaveLength(1);
	});

	test("aborting removes all owned state", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const controller = new AbortController();

		dimDraftMergeRequests.activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);
		controller.abort();

		expect(
			testWindow.document.querySelector(`[${FEATURE_ROOT_ATTRIBUTE}]`),
		).toBe(null);
		expect(testWindow.document.querySelector(`[${DRAFT_ROW_ATTRIBUTE}]`)).toBe(
			null,
		);
	});

	test("missing list anchor is a safe no-op", () => {
		const testWindow = createGitLabTestWindow(
			'<section id="unrelated">Unrelated host content</section>',
		);
		const controller = new AbortController();

		dimDraftMergeRequests.activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);

		expect(
			testWindow.document.querySelector(`[${FEATURE_ROOT_ATTRIBUTE}]`),
		).toBe(null);
		expect(testWindow.document.getElementById("unrelated")?.textContent).toBe(
			"Unrelated host content",
		);
	});

	test("does not partially mutate a list with an unsupported row", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		testWindow.document
			.querySelector('#issuable_1902 [data-testid="issuable-title-link"]')
			?.remove();
		const controller = new AbortController();

		dimDraftMergeRequests.activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);

		expect(
			testWindow.document.querySelector(`[${FEATURE_ROOT_ATTRIBUTE}]`),
		).toBeNull();
		expect(
			testWindow.document.querySelectorAll(`[${DRAFT_ROW_ATTRIBUTE}]`),
		).toHaveLength(0);
	});

	test("runtime handles replacement of the merge request list", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const controller = new AbortController();

		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[dimDraftMergeRequests],
			controller.signal,
		);

		const currentList = testWindow.document.querySelector(
			".issuable-list-container",
		);
		const detachedDraftRow =
			testWindow.document.getElementById("issuable_1901");
		expect(currentList).not.toBeNull();

		const replacement = testWindow.document.createElement("div");
		replacement.className = "issuable-list-container";
		replacement.innerHTML = `
			<ul class="issuable-list">
				<li
					id="replacement-draft"
					data-testid="issuable-container"
					data-qa-issuable-title="(Draft) Replacement row"
				>
					<a
						data-testid="issuable-title-link"
						href="/example/project/-/merge_requests/3"
					>
						(Draft) Replacement row
					</a>
				</li>
			</ul>
		`;
		currentList?.replaceWith(replacement);

		await settleGitLabDom(testWindow);

		expect(
			testWindow.document
				.getElementById("replacement-draft")
				?.hasAttribute(DRAFT_ROW_ATTRIBUTE),
		).toBe(true);
		expect(detachedDraftRow?.hasAttribute(DRAFT_ROW_ATTRIBUTE)).toBe(false);

		controller.abort();

		expect(
			testWindow.document
				.getElementById("replacement-draft")
				?.hasAttribute(DRAFT_ROW_ATTRIBUTE),
		).toBe(false);
		expect(detachedDraftRow?.hasAttribute(DRAFT_ROW_ATTRIBUTE)).toBe(false);
	});

	test("runtime activates after GitLab renders the list anchor", async () => {
		const testWindow = createGitLabTestWindow(
			'<section id="loading-state">Loading merge requests</section>',
		);
		const controller = new AbortController();

		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[dimDraftMergeRequests],
			controller.signal,
		);

		testWindow.document.body.insertAdjacentHTML(
			"beforeend",
			await readMergeRequestListFixture("19"),
		);
		await settleGitLabDom(testWindow);

		expect(
			testWindow.document
				.getElementById("issuable_1901")
				?.hasAttribute(DRAFT_ROW_ATTRIBUTE),
		).toBe(true);
	});

	test("preserves unrelated host DOM", async () => {
		const markup = `${await readMergeRequestListFixture("19")}
			<aside id="host-owned" class="existing-class" data-existing="value">
				Host-owned content
			</aside>`;
		const testWindow = createGitLabTestWindow(markup);
		const controller = new AbortController();
		const hostElement = testWindow.document.getElementById("host-owned");
		expect(hostElement).not.toBeNull();
		const before = hostElement?.outerHTML;

		dimDraftMergeRequests.activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);

		expect(hostElement?.outerHTML).toBe(before);
	});
});
