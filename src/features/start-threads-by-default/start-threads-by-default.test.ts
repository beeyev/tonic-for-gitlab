import { afterEach, describe, expect, test } from "bun:test";
import type { Window as HappyDOMWindow } from "happy-dom";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readMergeRequestCommentFormFixture,
	settleGitLabDom,
} from "../../../tests/helpers/gitlab-dom";
import {
	createFeatureContext,
	type FeatureContext,
} from "../../content/runtime/feature-context";
import { activateFeatureRuntime } from "../../content/runtime/feature-lifecycle";
import {
	COMMENT_BUTTON_GROUP_SELECTOR,
	COMMENT_TYPE_ITEM_SELECTOR,
	THREAD_DEFAULT_FORM_ATTRIBUTE,
	THREAD_TYPE_ITEM_SELECTOR,
} from "./selectors";
import {
	getStartThreadsByDefaultCompatibility,
	startThreadsByDefault,
} from "./start-threads-by-default";

const MERGE_REQUEST_URL =
	"https://gitlab.com/example/project/-/merge_requests/2";
const MERGE_REQUEST_PAGE = "projects:merge_requests:show";

afterEach(() => {
	closeGitLabTestWindows();
});

interface CommentFormPage {
	context: FeatureContext;
	document: Document;
	runtimeWindow: Window;
	testWindow: HappyDOMWindow;
}

function createCommentFormPage(
	markup: string,
	url = MERGE_REQUEST_URL,
): CommentFormPage {
	const testWindow = createGitLabTestWindow(markup, url, MERGE_REQUEST_PAGE);
	const runtimeWindow = asBrowserWindow(testWindow);

	return {
		context: createFeatureContext(runtimeWindow),
		document: runtimeWindow.document,
		runtimeWindow,
		testWindow,
	};
}

function requireElement(document: Document, selector: string): HTMLElement {
	const element = document.querySelector<HTMLElement>(selector);

	if (!element) {
		throw new Error(`Fixture is missing ${selector}`);
	}

	return element;
}

/**
 * Happy DOM does not reproduce GlListbox, so the observable contract is the
 * click the feature sends to GitLab's own option, not a changed selection.
 */
function countClicks(element: Element): () => number {
	let clicks = 0;
	element.addEventListener("click", () => {
		clicks += 1;
	});

	return () => clicks;
}

describe("start-threads-by-default", () => {
	/*
	 * The page, not the DOM. GitLab mounts the comment form after page load, so
	 * a DOM check here would make activation flap between runtime passes, and
	 * reconciliation already treats a missing form as a safe no-op.
	 */
	test("matches merge request detail pages, comment form present or not", async () => {
		const markup = await readMergeRequestCommentFormFixture("19");
		const matchesUrl = (url: string, pageMarkup = markup) =>
			startThreadsByDefault.matches(
				createCommentFormPage(pageMarkup, url).context,
			);

		expect(matchesUrl(MERGE_REQUEST_URL)).toBe(true);
		// Before Vue mounts the form, which is most of the runtime's passes.
		expect(
			matchesUrl(MERGE_REQUEST_URL, '<div id="loading-state"></div>'),
		).toBe(true);
		expect(
			matchesUrl("https://gitlab.com/example/project/-/merge_requests/2/diffs"),
		).toBe(true);
		expect(
			matchesUrl(
				"https://intranet.example/gitlab/example/project/-/merge_requests/2",
			),
		).toBe(true);
		expect(
			matchesUrl("https://gitlab.com/example/project/-/merge_requests"),
		).toBe(false);
		expect(
			matchesUrl("https://gitlab.com/example/project/-/merge_requests/new"),
		).toBe(false);
	});

	test.each(["18", "19"] as const)(
		"selects Start thread once in the GitLab %s contract",
		async (version) => {
			const page = createCommentFormPage(
				await readMergeRequestCommentFormFixture(version),
			);
			const threadItem = requireElement(
				page.document,
				THREAD_TYPE_ITEM_SELECTOR,
			);
			const commentItem = requireElement(
				page.document,
				COMMENT_TYPE_ITEM_SELECTOR,
			);
			const threadClicks = countClicks(threadItem);
			const commentClicks = countClicks(commentItem);
			const controller = new AbortController();

			startThreadsByDefault.activate(page.context, controller.signal);

			expect(threadClicks()).toBe(1);
			expect(commentClicks()).toBe(0);
			expect(
				page.document.querySelectorAll(`[${THREAD_DEFAULT_FORM_ATTRIBUTE}]`),
			).toHaveLength(1);
			// GitLab's own control is left in place, both choices included.
			expect(
				page.document.querySelector(
					`${COMMENT_BUTTON_GROUP_SELECTOR} button[type="submit"]`,
				)?.textContent,
			).toContain("Comment");
			expect(commentItem.isConnected).toBe(true);
			expect(threadItem.isConnected).toBe(true);
		},
	);

	test.each(["18", "19"] as const)(
		"reports the GitLab %s comment-type contract as supported",
		async (version) => {
			const page = createCommentFormPage(
				await readMergeRequestCommentFormFixture(version),
			);

			expect(getStartThreadsByDefaultCompatibility(page.context)).toBe(
				"supported",
			);
		},
	);

	test("reports a page without a comment form as not applicable", async () => {
		const markup = await readMergeRequestCommentFormFixture("19");
		// A signed-out reader, and every pass before Vue mounts the form.
		const beforeMount = createCommentFormPage('<div id="loading-state"></div>');
		const list = createCommentFormPage(
			markup,
			"https://gitlab.com/example/project/-/merge_requests",
		);

		expect(getStartThreadsByDefaultCompatibility(beforeMount.context)).toBe(
			"not-applicable",
		);
		expect(getStartThreadsByDefaultCompatibility(list.context)).toBe(
			"not-applicable",
		);
	});

	test("reports a comment form without the comment-type contract as unsupported", async () => {
		const page = createCommentFormPage(
			await readMergeRequestCommentFormFixture("19"),
		);
		requireElement(page.document, THREAD_TYPE_ITEM_SELECTOR).remove();

		expect(getStartThreadsByDefaultCompatibility(page.context)).toBe(
			"unsupported",
		);
	});

	test("repeated activation and reconciliation do not select again", async () => {
		const page = createCommentFormPage(
			await readMergeRequestCommentFormFixture("19"),
		);
		const threadClicks = countClicks(
			requireElement(page.document, THREAD_TYPE_ITEM_SELECTOR),
		);
		const controller = new AbortController();

		startThreadsByDefault.activate(page.context, controller.signal);
		startThreadsByDefault.activate(page.context, controller.signal);
		startThreadsByDefault.reconcile?.(page.context, controller.signal);

		expect(threadClicks()).toBe(1);
		expect(
			page.document.querySelectorAll(`[${THREAD_DEFAULT_FORM_ATTRIBUTE}]`),
		).toHaveLength(1);
	});

	/*
	 * The user is free to switch back to "Comment". Reconciliation runs on every
	 * observed mutation, so re-applying while the marker is present would
	 * overrule that choice instead of setting a default once.
	 */
	test("does not override a choice the user made after the form was marked", async () => {
		const page = createCommentFormPage(
			await readMergeRequestCommentFormFixture("19"),
		);
		const threadItem = requireElement(page.document, THREAD_TYPE_ITEM_SELECTOR);
		const threadClicks = countClicks(threadItem);
		const controller = new AbortController();

		startThreadsByDefault.activate(page.context, controller.signal);
		// GitLab moves the selection back when the user picks "Comment" again.
		threadItem.removeAttribute("aria-selected");
		startThreadsByDefault.reconcile?.(page.context, controller.signal);

		expect(threadClicks()).toBe(1);
	});

	test("marks the form without clicking when Start thread is already selected", async () => {
		const page = createCommentFormPage(
			await readMergeRequestCommentFormFixture("19"),
		);
		const threadItem = requireElement(page.document, THREAD_TYPE_ITEM_SELECTOR);
		threadItem.setAttribute("aria-selected", "true");
		const threadClicks = countClicks(threadItem);
		const controller = new AbortController();

		startThreadsByDefault.activate(page.context, controller.signal);

		expect(threadClicks()).toBe(0);
		expect(
			requireElement(page.document, "form").hasAttribute(
				THREAD_DEFAULT_FORM_ATTRIBUTE,
			),
		).toBe(true);
	});

	test.each([
		["no comment form", "form"],
		["no comment button group", COMMENT_BUTTON_GROUP_SELECTOR],
		["no Comment option", COMMENT_TYPE_ITEM_SELECTOR],
		["no Start thread option", THREAD_TYPE_ITEM_SELECTOR],
	])("is a safe no-op with %s", async (_case, removedSelector) => {
		const page = createCommentFormPage(
			await readMergeRequestCommentFormFixture("19"),
		);
		const threadClicks = countClicks(
			requireElement(page.document, THREAD_TYPE_ITEM_SELECTOR),
		);
		page.document.querySelector(removedSelector)?.remove();
		const controller = new AbortController();

		startThreadsByDefault.activate(page.context, controller.signal);

		expect(threadClicks()).toBe(0);
		expect(
			page.document.querySelector(`[${THREAD_DEFAULT_FORM_ATTRIBUTE}]`),
		).toBeNull();
	});

	test("an ambiguous comment form falls through to the main-form contract", async () => {
		const page = createCommentFormPage(
			await readMergeRequestCommentFormFixture("19"),
		);
		const mainForm = requireElement(page.document, "form");
		/*
		 * A hypothetical thread reply form carrying the same test ID, rendered
		 * before the main form, which is where GitLab renders thread replies. The
		 * ordered contract must still resolve the main form rather than the first
		 * match in document order.
		 */
		const replyForm = page.document.createElement("form");
		replyForm.setAttribute("data-testid", "comment-form");
		replyForm.id = "reply-form";
		page.document.body.prepend(replyForm);
		const controller = new AbortController();

		startThreadsByDefault.activate(page.context, controller.signal);

		expect(mainForm.hasAttribute(THREAD_DEFAULT_FORM_ATTRIBUTE)).toBe(true);
		expect(replyForm.hasAttribute(THREAD_DEFAULT_FORM_ATTRIBUTE)).toBe(false);
	});

	test("runtime selects again after GitLab replaces the comment form", async () => {
		const markup = await readMergeRequestCommentFormFixture("19");
		const page = createCommentFormPage('<div id="notes"></div>');
		const controller = new AbortController();

		activateFeatureRuntime(
			page.runtimeWindow,
			[startThreadsByDefault],
			controller.signal,
		);

		const notes = requireElement(page.document, "#notes");
		notes.innerHTML = markup;
		await settleGitLabDom(page.testWindow);

		const firstForm = requireElement(page.document, "form");
		expect(firstForm.hasAttribute(THREAD_DEFAULT_FORM_ATTRIBUTE)).toBe(true);

		notes.innerHTML = markup;
		await settleGitLabDom(page.testWindow);

		const replacementForm = requireElement(page.document, "form");
		expect(replacementForm).not.toBe(firstForm);
		expect(replacementForm.hasAttribute(THREAD_DEFAULT_FORM_ATTRIBUTE)).toBe(
			true,
		);
		expect(firstForm.hasAttribute(THREAD_DEFAULT_FORM_ATTRIBUTE)).toBe(false);

		controller.abort();

		expect(replacementForm.hasAttribute(THREAD_DEFAULT_FORM_ATTRIBUTE)).toBe(
			false,
		);
	});

	/*
	 * Disabling the setting aborts the feature, which clears the marker. Enabling
	 * it again on the same page must not select a second time: cleanup does not
	 * revert the selection, so the only state a second selection is visible in is
	 * the one where the user switched back to "Comment" in between.
	 */
	test("does not select again when the feature is reactivated on the same form", async () => {
		const page = createCommentFormPage(
			await readMergeRequestCommentFormFixture("19"),
		);
		const threadItem = requireElement(page.document, THREAD_TYPE_ITEM_SELECTOR);
		const threadClicks = countClicks(threadItem);
		const form = requireElement(page.document, "form");
		const firstActivation = new AbortController();

		startThreadsByDefault.activate(page.context, firstActivation.signal);
		// The user switches back, then turns the setting off and on again.
		threadItem.removeAttribute("aria-selected");
		firstActivation.abort();

		expect(form.hasAttribute(THREAD_DEFAULT_FORM_ATTRIBUTE)).toBe(false);

		const secondActivation = new AbortController();
		startThreadsByDefault.activate(page.context, secondActivation.signal);

		expect(threadClicks()).toBe(1);
		expect(threadItem.getAttribute("aria-selected")).toBeNull();
		// The marker is restored, so it still records what the feature has handled.
		expect(form.hasAttribute(THREAD_DEFAULT_FORM_ATTRIBUTE)).toBe(true);
	});

	/*
	 * Cleanup removes the marker and deliberately leaves the selection alone: by
	 * then the selected type may be the user's own later choice.
	 */
	test("aborting removes the marker attribute", async () => {
		const page = createCommentFormPage(
			await readMergeRequestCommentFormFixture("19"),
		);
		const controller = new AbortController();

		startThreadsByDefault.activate(page.context, controller.signal);
		controller.abort();

		expect(
			page.document.querySelector(`[${THREAD_DEFAULT_FORM_ATTRIBUTE}]`),
		).toBeNull();
	});

	test("preserves unrelated host DOM", async () => {
		const page = createCommentFormPage(
			`${await readMergeRequestCommentFormFixture("19")}
			<aside id="host-owned" class="existing-class" data-existing="value">
				Host-owned content
			</aside>`,
		);
		const hostElement = requireElement(page.document, "#host-owned");
		const before = hostElement.outerHTML;
		const controller = new AbortController();

		startThreadsByDefault.activate(page.context, controller.signal);

		expect(hostElement.outerHTML).toBe(before);
	});
});
