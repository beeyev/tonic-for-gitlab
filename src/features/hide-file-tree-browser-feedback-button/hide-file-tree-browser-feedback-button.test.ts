import { afterEach, describe, expect, test } from "bun:test";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readFileTreeBrowserFeedbackFixture,
	settleGitLabDom,
} from "../../../tests/helpers/gitlab-dom";
import { createFeatureContext } from "../../content/runtime/feature-context";
import { activateFeatureRuntime } from "../../content/runtime/feature-lifecycle";
import {
	getHideFileTreeBrowserFeedbackButtonCompatibility,
	hideFileTreeBrowserFeedbackButton,
} from "./hide-file-tree-browser-feedback-button";
import {
	FILE_TREE_BROWSER_SELECTOR,
	HIDDEN_FEEDBACK_LINK_ATTRIBUTE,
	PANEL_SIBLING_FEEDBACK_LINK_SELECTOR,
} from "./selectors";

const BLOB_URL = "https://gitlab.com/example/project/-/blob/main/versions.tf";
const BLOB_PAGE = "projects:blob:show";

afterEach(() => {
	closeGitLabTestWindows();
});

async function createFileTreeBrowserWindow(
	version: "18" | "19",
	url = BLOB_URL,
): Promise<ReturnType<typeof createGitLabTestWindow>> {
	return createGitLabTestWindow(
		await readFileTreeBrowserFeedbackFixture(version),
		url,
		BLOB_PAGE,
	);
}

function getDocument(
	testWindow: ReturnType<typeof createGitLabTestWindow>,
): Document {
	return asBrowserWindow(testWindow).document;
}

function getFeedbackLink(
	testWindow: ReturnType<typeof createGitLabTestWindow>,
): HTMLAnchorElement {
	return getDocument(testWindow).querySelector(
		'a[href="https://gitlab.com/gitlab-org/gitlab/-/issues/581271"]',
	) as HTMLAnchorElement;
}

function countHiddenLinks(
	testWindow: ReturnType<typeof createGitLabTestWindow>,
): number {
	return getDocument(testWindow).querySelectorAll(
		`[${HIDDEN_FEEDBACK_LINK_ATTRIBUTE}]`,
	).length;
}

describe("hide-file-tree-browser-feedback-button", () => {
	test.each([
		["18", "inside the panel"],
		["19", "beside the panel"],
	] as const)(
		"hides the GitLab %s feedback link rendered %s",
		async (version) => {
			const testWindow = await createFileTreeBrowserWindow(version);
			const controller = new AbortController();
			const context = createFeatureContext(asBrowserWindow(testWindow));

			expect(getHideFileTreeBrowserFeedbackButtonCompatibility(context)).toBe(
				"supported",
			);
			hideFileTreeBrowserFeedbackButton.activate(context, controller.signal);

			expect(
				getFeedbackLink(testWindow).hasAttribute(
					HIDDEN_FEEDBACK_LINK_ATTRIBUTE,
				),
			).toBe(true);
			expect(countHiddenLinks(testWindow)).toBe(1);
		},
	);

	test.each([
		["/-/blob/main/versions.tf", true],
		["/-/tree/main/modules", true],
		["/-/merge_requests/7", false],
		["", false],
	] as const)("activates for %s: %p", async (path, expected) => {
		const testWindow = await createFileTreeBrowserWindow(
			"18",
			`https://gitlab.com/example/project${path}`,
		);

		expect(
			hideFileTreeBrowserFeedbackButton.matches(
				createFeatureContext(asBrowserWindow(testWindow)),
			),
		).toBe(expected);
	});

	test("leaves the panel's own repository links alone", async () => {
		const testWindow = await createFileTreeBrowserWindow("18");
		const controller = new AbortController();

		hideFileTreeBrowserFeedbackButton.activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);

		expect(
			getDocument(testWindow)
				.querySelector('a[href="/example/project/-/blob/main/versions.tf"]')
				?.hasAttribute(HIDDEN_FEEDBACK_LINK_ATTRIBUTE),
		).toBe(false);
	});

	test("ignores an external panel link that carries no feedback icon", async () => {
		const testWindow = await createFileTreeBrowserWindow("18");
		getDocument(testWindow)
			.querySelector(FILE_TREE_BROWSER_SELECTOR)
			?.insertAdjacentHTML(
				"beforeend",
				'<a href="https://docs.gitlab.com/" target="_blank">Documentation</a>',
			);
		const controller = new AbortController();
		const context = createFeatureContext(asBrowserWindow(testWindow));

		expect(getHideFileTreeBrowserFeedbackButtonCompatibility(context)).toBe(
			"supported",
		);
		hideFileTreeBrowserFeedbackButton.activate(context, controller.signal);

		expect(countHiddenLinks(testWindow)).toBe(1);
		expect(
			getFeedbackLink(testWindow).hasAttribute(HIDDEN_FEEDBACK_LINK_ATTRIBUTE),
		).toBe(true);
	});

	test.each([
		[
			"GitLab 19.2 removed the link",
			(document: Document) => {
				document.querySelector('a[target="_blank"]')?.remove();
			},
		],
		[
			"the page renders no file tree browser",
			(document: Document) => {
				document.querySelector(FILE_TREE_BROWSER_SELECTOR)?.remove();
			},
		],
	] as const)("is not applicable when %s", async (_name, change) => {
		const testWindow = await createFileTreeBrowserWindow("19");
		change(getDocument(testWindow));

		expect(
			getHideFileTreeBrowserFeedbackButtonCompatibility(
				createFeatureContext(asBrowserWindow(testWindow)),
			),
		).toBe("not-applicable");
	});

	test.each([
		[
			"duplicate panel",
			(document: Document) => {
				const panel = document.querySelector(FILE_TREE_BROWSER_SELECTOR);
				panel?.after(panel.cloneNode(true));
			},
		],
		[
			"duplicate feedback link",
			(document: Document) => {
				const link = document.querySelector('a[target="_blank"]');
				link?.after(link.cloneNode(true));
			},
		],
	] as const)("is a safe no-op for a %s contract", async (_name, change) => {
		const testWindow = await createFileTreeBrowserWindow("18");
		change(getDocument(testWindow));
		const controller = new AbortController();
		const context = createFeatureContext(asBrowserWindow(testWindow));

		expect(getHideFileTreeBrowserFeedbackButtonCompatibility(context)).toBe(
			"unsupported",
		);
		hideFileTreeBrowserFeedbackButton.activate(context, controller.signal);

		expect(countHiddenLinks(testWindow)).toBe(0);
	});

	test("activation is idempotent and abort restores attached and detached state", async () => {
		const testWindow = await createFileTreeBrowserWindow("18");
		const controller = new AbortController();
		const context = createFeatureContext(asBrowserWindow(testWindow));

		hideFileTreeBrowserFeedbackButton.activate(context, controller.signal);
		hideFileTreeBrowserFeedbackButton.activate(context, controller.signal);

		const link = getFeedbackLink(testWindow);
		expect(countHiddenLinks(testWindow)).toBe(1);

		link.remove();
		controller.abort();

		expect(link.hasAttribute(HIDDEN_FEEDBACK_LINK_ATTRIBUTE)).toBe(false);
	});

	test("clears a prior marker when the contract becomes ambiguous", async () => {
		const testWindow = await createFileTreeBrowserWindow("19");
		const controller = new AbortController();
		const context = createFeatureContext(asBrowserWindow(testWindow));
		hideFileTreeBrowserFeedbackButton.activate(context, controller.signal);
		const link = getFeedbackLink(testWindow);

		// A fresh second link, not a clone: cloning would copy the owned attribute
		// onto DOM the registry never tracked, which is not a state GitLab reaches.
		link.insertAdjacentHTML(
			"afterend",
			'<a href="https://gitlab.com/gitlab-org/gitlab/-/issues/999999" target="_blank"><svg data-testid="comment-dots-icon"></svg>Provide feedback</a>',
		);
		hideFileTreeBrowserFeedbackButton.reconcile?.(context, controller.signal);

		expect(countHiddenLinks(testWindow)).toBe(0);
	});

	test("runtime hides the link when Vue mounts the browser late", async () => {
		const testWindow = await createFileTreeBrowserWindow("19");
		const root = getDocument(testWindow).querySelector(".navigation-root")
			?.firstElementChild as HTMLElement;
		root.remove();
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[hideFileTreeBrowserFeedbackButton],
			controller.signal,
		);

		expect(countHiddenLinks(testWindow)).toBe(0);

		getDocument(testWindow).querySelector(".navigation-root")?.append(root);
		await settleGitLabDom(testWindow);

		expect(countHiddenLinks(testWindow)).toBe(1);
	});

	test("runtime reconciles a replaced panel", async () => {
		const testWindow = await createFileTreeBrowserWindow("18");
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[hideFileTreeBrowserFeedbackButton],
			controller.signal,
		);
		const panel = getDocument(testWindow).querySelector(
			FILE_TREE_BROWSER_SELECTOR,
		) as HTMLElement;
		expect(countHiddenLinks(testWindow)).toBe(1);

		const replacement = panel.cloneNode(true) as HTMLElement;
		replacement
			.querySelector(`[${HIDDEN_FEEDBACK_LINK_ATTRIBUTE}]`)
			?.removeAttribute(HIDDEN_FEEDBACK_LINK_ATTRIBUTE);
		panel.replaceWith(replacement);
		await settleGitLabDom(testWindow);

		expect(countHiddenLinks(testWindow)).toBe(1);
		expect(
			replacement
				.querySelector('a[target="_blank"]')
				?.hasAttribute(HIDDEN_FEEDBACK_LINK_ATTRIBUTE),
		).toBe(true);
	});

	test("runtime hides a link GitLab adds beside an already-mounted panel", async () => {
		const testWindow = await createFileTreeBrowserWindow("19");
		const link = getFeedbackLink(testWindow);
		const parent = link.parentElement as HTMLElement;
		link.remove();
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[hideFileTreeBrowserFeedbackButton],
			controller.signal,
		);

		expect(countHiddenLinks(testWindow)).toBe(0);

		// The 19.1 placement is a sibling of the panel, so this child-list record
		// names the shared parent and touches no panel-anchored selector.
		parent.append(link);
		await settleGitLabDom(testWindow);

		expect(countHiddenLinks(testWindow)).toBe(1);
	});

	test("reports not-applicable off a repository file path, where it never runs", async () => {
		const testWindow = await createFileTreeBrowserWindow(
			"18",
			"https://gitlab.com/example/project/-/merge_requests/7/diffs",
		);
		const context = createFeatureContext(asBrowserWindow(testWindow));

		expect(hideFileTreeBrowserFeedbackButton.matches(context)).toBe(false);
		expect(getHideFileTreeBrowserFeedbackButtonCompatibility(context)).toBe(
			"not-applicable",
		);
	});

	test("manifest injects the feature stylesheet", async () => {
		const manifest = await Bun.file(
			new URL("../../manifest.json", import.meta.url),
		).json();
		const gitLabContentScript = manifest.content_scripts.find(
			(script: { matches?: string[] }) =>
				script.matches?.includes("https://gitlab.com/*"),
		);

		expect(gitLabContentScript?.css).toContain(
			"features/hide-file-tree-browser-feedback-button/styles.css",
		);
	});

	test("observes no attributes and only its own three subtrees", async () => {
		const testWindow = await createFileTreeBrowserWindow("19");

		expect(
			hideFileTreeBrowserFeedbackButton.observedAttributes,
		).toBeUndefined();
		expect(hideFileTreeBrowserFeedbackButton.mutationSelectors).toEqual([
			FILE_TREE_BROWSER_SELECTOR,
			PANEL_SIBLING_FEEDBACK_LINK_SELECTOR,
			`[${HIDDEN_FEEDBACK_LINK_ATTRIBUTE}]`,
		]);
		// The union is built across every registered feature before `matches` is
		// consulted, so none of these may match the rendered file content beside
		// the panel, or every feature wakes on it even with this one switched off.
		expect(
			hideFileTreeBrowserFeedbackButton.mutationSelectors?.some((selector) =>
				testWindow.document.querySelector(`#tree-holder ${selector}`),
			),
		).toBe(false);
		// Following-sibling, not any sibling: the peek overlay precedes the panel.
		expect(
			getDocument(testWindow)
				.querySelector(".file-tree-browser-overlay")
				?.matches(PANEL_SIBLING_FEEDBACK_LINK_SELECTOR),
		).toBe(false);
	});
});
