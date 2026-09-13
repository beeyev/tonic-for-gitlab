import { afterEach, describe, expect, test } from "bun:test";
import type { Window as HappyDOMWindow } from "happy-dom";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readMergeRequestMergeWidgetFixture,
	SUPPORTED_GITLAB_MAJORS,
	settleGitLabDom,
} from "../../../tests/helpers/gitlab-dom";
import {
	createFeatureContext,
	type FeatureContext,
} from "../../content/runtime/feature-context";
import { activateFeatureRuntime } from "../../content/runtime/feature-lifecycle";
import {
	confirmMergeRequest,
	getConfirmMergeRequestCompatibility,
} from "./confirm-merge-request";
import {
	CONFIRM_MERGE_REQUEST_CANCEL_ATTRIBUTE,
	CONFIRM_MERGE_REQUEST_CONTINUE_ATTRIBUTE,
	CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE,
	READY_TO_MERGE_STATE_SELECTOR,
} from "./selectors";

const MERGE_REQUEST_URL =
	"https://gitlab.com/example/project/-/merge_requests/2";
const MERGE_REQUEST_PAGE = "projects:merge_requests:show";

afterEach(() => {
	closeGitLabTestWindows();
});

interface MergeWidgetPage {
	context: FeatureContext;
	document: Document;
	runtimeWindow: Window;
	testWindow: HappyDOMWindow;
}

function createMergeWidgetPage(
	markup: string,
	url = MERGE_REQUEST_URL,
): MergeWidgetPage {
	const testWindow = createGitLabTestWindow(markup, url, MERGE_REQUEST_PAGE);
	const runtimeWindow = asBrowserWindow(testWindow);

	return {
		context: createFeatureContext(runtimeWindow),
		document: runtimeWindow.document,
		runtimeWindow,
		testWindow,
	};
}

function requireElement<T extends HTMLElement = HTMLElement>(
	document: Document,
	selector: string,
): T {
	const element = document.querySelector<T>(selector);

	if (!element) {
		throw new Error(`Fixture is missing ${selector}`);
	}

	return element;
}

function countClicks(element: Element): () => number {
	let clicks = 0;
	element.addEventListener("click", () => {
		clicks += 1;
	});

	return () => clicks;
}

function activate(page: MergeWidgetPage): AbortController {
	const controller = new AbortController();
	confirmMergeRequest.activate(page.context, controller.signal);
	return controller;
}

interface MergeActionCase {
	actionSelector: string;
	confirmLabel: string;
	scenario: "auto-merge" | "immediate" | "merge-train";
}

const primaryMergeActionCases: readonly MergeActionCase[] = [
	{
		actionSelector: '[data-testid="merge-button"]',
		confirmLabel: "Merge",
		scenario: "immediate",
	},
	{
		actionSelector: '[data-testid="merge-button"]',
		confirmLabel: "Set to auto-merge",
		scenario: "auto-merge",
	},
];

const gitLabOwnedDropdownActionCases: readonly Omit<
	MergeActionCase,
	"confirmLabel"
>[] = [
	{
		actionSelector: '[data-testid="merge-immediately-button"] button',
		scenario: "auto-merge",
	},
	{
		actionSelector: '[data-testid="mt-merge-now-restart-button"] button',
		scenario: "merge-train",
	},
	{
		actionSelector: '[data-testid="mt-merge-now-skip-restart-button"] button',
		scenario: "merge-train",
	},
];

describe("confirm-merge-request", () => {
	test("matches merge request detail pages and their tabs", async () => {
		const markup = await readMergeRequestMergeWidgetFixture("19", "immediate");
		const matchesUrl = (url: string) =>
			confirmMergeRequest.matches(createMergeWidgetPage(markup, url).context);

		expect(matchesUrl(MERGE_REQUEST_URL)).toBe(true);
		expect(matchesUrl(`${MERGE_REQUEST_URL}/diffs`)).toBe(true);
		expect(matchesUrl(`${MERGE_REQUEST_URL}/commits`)).toBe(true);
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

	test("does not mount dialog UI before a supported merge action is used", async () => {
		const page = createMergeWidgetPage(
			await readMergeRequestMergeWidgetFixture("19", "immediate"),
		);

		activate(page);

		expect(
			page.document.querySelector(
				`[${CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE}]`,
			),
		).toBeNull();
	});

	for (const version of SUPPORTED_GITLAB_MAJORS) {
		for (const actionCase of primaryMergeActionCases) {
			test(`confirms ${actionCase.confirmLabel} once in the GitLab ${version} contract`, async () => {
				const page = createMergeWidgetPage(
					await readMergeRequestMergeWidgetFixture(
						version,
						actionCase.scenario,
					),
				);
				const action = requireElement(page.document, actionCase.actionSelector);
				const root = requireElement(
					page.document,
					READY_TO_MERGE_STATE_SELECTOR,
				);
				const actionClicks = countClicks(action);
				activate(page);

				action.click();

				const dialog = requireElement<HTMLDialogElement>(
					page.document,
					`dialog[${CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE}]`,
				);
				const cancel = requireElement<HTMLButtonElement>(
					page.document,
					`[${CONFIRM_MERGE_REQUEST_CANCEL_ATTRIBUTE}]`,
				);
				const confirm = requireElement<HTMLButtonElement>(
					page.document,
					`[${CONFIRM_MERGE_REQUEST_CONTINUE_ATTRIBUTE}]`,
				);

				expect(actionClicks()).toBe(0);
				expect(dialog.open).toBe(true);
				expect(dialog.getAttribute("aria-labelledby")).not.toBeNull();
				expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
				expect(confirm.textContent).toBe(actionCase.confirmLabel);
				expect(page.document.activeElement).toBe(cancel);

				confirm.click();

				expect(dialog.open).toBe(false);
				expect(actionClicks()).toBe(1);
				expect(page.document.activeElement).toBe(root);
				expect(root.getAttribute("tabindex")).toBe("-1");
			});
		}

		test(`leaves GitLab ${version} merge-moment dropdown actions to GitLab`, async () => {
			for (const actionCase of gitLabOwnedDropdownActionCases) {
				const page = createMergeWidgetPage(
					await readMergeRequestMergeWidgetFixture(
						version,
						actionCase.scenario,
					),
				);
				const action = requireElement(page.document, actionCase.actionSelector);
				const actionClicks = countClicks(action);
				activate(page);

				action.click();

				expect(actionClicks()).toBe(1);
				expect(
					page.document.querySelector(
						`dialog[${CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE}]`,
					),
				).toBeNull();
			}
		});

		test(`reports the primary GitLab ${version} merge action contract as supported`, async () => {
			for (const scenario of [
				"immediate",
				"auto-merge",
				"merge-train",
			] as const) {
				const page = createMergeWidgetPage(
					await readMergeRequestMergeWidgetFixture(version, scenario),
				);

				expect(getConfirmMergeRequestCompatibility(page.context)).toBe(
					"supported",
				);
			}
		});
	}

	test("cancels without continuing and keeps focus after the queued close event", async () => {
		const page = createMergeWidgetPage(
			await readMergeRequestMergeWidgetFixture("19", "immediate"),
		);
		const action = requireElement(
			page.document,
			'[data-testid="merge-button"]',
		);
		const actionClicks = countClicks(action);
		activate(page);

		action.click();
		const dialog = requireElement<HTMLDialogElement>(
			page.document,
			`dialog[${CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE}]`,
		);
		requireElement<HTMLButtonElement>(
			page.document,
			`[${CONFIRM_MERGE_REQUEST_CANCEL_ATTRIBUTE}]`,
		).click();

		expect(actionClicks()).toBe(0);
		expect(dialog.open).toBe(false);
		// Browsers queue `close`; Happy DOM dispatches it synchronously. A second
		// event reproduces the browser ordering and must not steal focus later.
		dialog.dispatchEvent(
			new page.testWindow.Event("close") as unknown as Event,
		);
		expect(page.document.activeElement).toBe(action);
	});

	test("Escape and a backdrop click dismiss without continuing", async () => {
		const page = createMergeWidgetPage(
			await readMergeRequestMergeWidgetFixture("19", "immediate"),
		);
		const action = requireElement(
			page.document,
			'[data-testid="merge-button"]',
		);
		const actionClicks = countClicks(action);
		activate(page);
		action.click();
		const dialog = requireElement<HTMLDialogElement>(
			page.document,
			`dialog[${CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE}]`,
		);

		dialog.dispatchEvent(
			new page.testWindow.Event("cancel", {
				cancelable: true,
			}) as unknown as Event,
		);

		expect(dialog.open).toBe(false);
		expect(actionClicks()).toBe(0);

		action.click();
		dialog.dispatchEvent(
			new page.testWindow.MouseEvent("click", {
				bubbles: true,
			}) as unknown as MouseEvent,
		);

		expect(dialog.open).toBe(false);
		expect(actionClicks()).toBe(0);
	});

	test("coalesces repeated clicks while confirmation is open", async () => {
		const page = createMergeWidgetPage(
			await readMergeRequestMergeWidgetFixture("19", "immediate"),
		);
		const action = requireElement(
			page.document,
			'[data-testid="merge-button"]',
		);
		const actionClicks = countClicks(action);
		activate(page);

		action.click();
		action.click();
		requireElement<HTMLButtonElement>(
			page.document,
			`[${CONFIRM_MERGE_REQUEST_CONTINUE_ATTRIBUTE}]`,
		).click();

		expect(actionClicks()).toBe(1);
	});

	test("keeps focus on the merge widget when GitLab removes the confirmed action", async () => {
		const page = createMergeWidgetPage(
			await readMergeRequestMergeWidgetFixture("19", "immediate"),
		);
		const root = requireElement(page.document, READY_TO_MERGE_STATE_SELECTOR);
		const action = requireElement(
			page.document,
			'[data-testid="merge-button"]',
		);
		action.addEventListener("click", () => {
			action.remove();
		});
		const controller = activate(page);

		action.click();
		requireElement<HTMLButtonElement>(
			page.document,
			`[${CONFIRM_MERGE_REQUEST_CONTINUE_ATTRIBUTE}]`,
		).click();

		expect(action.isConnected).toBe(false);
		expect(page.document.activeElement).toBe(root);
		expect(root.getAttribute("tabindex")).toBe("-1");

		controller.abort();
		expect(root.hasAttribute("tabindex")).toBe(false);
	});

	test("confirms an aria-disabled action instead of letting its click bypass protection", async () => {
		const page = createMergeWidgetPage(
			await readMergeRequestMergeWidgetFixture("19", "immediate"),
		);
		const action = requireElement(
			page.document,
			'[data-testid="merge-button"]',
		);
		const actionClicks = countClicks(action);
		action.setAttribute("aria-disabled", "true");
		activate(page);

		action.click();
		expect(actionClicks()).toBe(0);

		requireElement<HTMLButtonElement>(
			page.document,
			`[${CONFIRM_MERGE_REQUEST_CONTINUE_ATTRIBUTE}]`,
		).click();
		expect(actionClicks()).toBe(1);
	});

	test("does not suppress later document capture listeners", async () => {
		const page = createMergeWidgetPage(
			await readMergeRequestMergeWidgetFixture("19", "auto-merge"),
		);
		const action = requireElement(
			page.document,
			'[data-testid="merge-button"]',
		);
		const actionClicks = countClicks(action);
		let documentClicks = 0;
		activate(page);
		page.document.addEventListener(
			"click",
			() => {
				documentClicks += 1;
			},
			{ capture: true },
		);

		action.click();

		expect(actionClicks()).toBe(0);
		expect(documentClicks).toBe(1);
	});

	test("a stale or replaced action cannot be continued", async () => {
		const markup = await readMergeRequestMergeWidgetFixture("19", "immediate");
		const page = createMergeWidgetPage(markup);
		const controller = new AbortController();
		activateFeatureRuntime(
			page.runtimeWindow,
			[confirmMergeRequest],
			controller.signal,
		);
		const firstAction = requireElement(
			page.document,
			'[data-testid="merge-button"]',
		);
		const firstActionClicks = countClicks(firstAction);

		firstAction.click();
		requireElement(page.document, READY_TO_MERGE_STATE_SELECTOR).outerHTML =
			markup;
		await settleGitLabDom(page.testWindow);

		const dialog = requireElement<HTMLDialogElement>(
			page.document,
			`dialog[${CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE}]`,
		);
		expect(dialog.open).toBe(false);
		expect(firstActionClicks()).toBe(0);

		const replacementAction = requireElement(
			page.document,
			'[data-testid="merge-button"]',
		);
		const replacementClicks = countClicks(replacementAction);
		replacementAction.click();
		requireElement<HTMLButtonElement>(
			page.document,
			`[${CONFIRM_MERGE_REQUEST_CONTINUE_ATTRIBUTE}]`,
		).click();

		expect(replacementClicks()).toBe(1);
		controller.abort();
	});

	test("an action disabled while confirmation is open cannot be continued", async () => {
		const page = createMergeWidgetPage(
			await readMergeRequestMergeWidgetFixture("19", "immediate"),
		);
		const action = requireElement<HTMLButtonElement>(
			page.document,
			'[data-testid="merge-button"]',
		);
		const actionClicks = countClicks(action);
		activate(page);

		action.click();
		action.disabled = true;
		requireElement<HTMLButtonElement>(
			page.document,
			`[${CONFIRM_MERGE_REQUEST_CONTINUE_ATTRIBUTE}]`,
		).click();

		expect(actionClicks()).toBe(0);
		expect(
			requireElement<HTMLDialogElement>(
				page.document,
				`dialog[${CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE}]`,
			).open,
		).toBe(false);
	});

	test("abort removes the dialog and interception", async () => {
		const page = createMergeWidgetPage(
			await readMergeRequestMergeWidgetFixture("19", "immediate"),
		);
		const action = requireElement(
			page.document,
			'[data-testid="merge-button"]',
		);
		const actionClicks = countClicks(action);
		const controller = activate(page);

		action.click();
		controller.abort();

		expect(
			page.document.querySelector(
				`[${CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE}]`,
			),
		).toBeNull();
		expect(actionClicks()).toBe(0);

		action.click();
		expect(actionClicks()).toBe(1);
	});

	test("missing, ambiguous, or changed GitLab contracts are safe no-ops", async () => {
		const validMarkup = await readMergeRequestMergeWidgetFixture(
			"19",
			"immediate",
		);
		const cases = [
			'<button type="button" data-testid="merge-button">Merge</button>',
			`${validMarkup}${validMarkup}`,
			'<div data-testid="ready_to_merge_state"><div data-testid="merge-button"><button>Merge one</button><button>Merge two</button></div></div>',
		];

		for (const markup of cases) {
			const page = createMergeWidgetPage(markup);
			const action = requireElement<HTMLButtonElement>(
				page.document,
				'[data-testid="merge-button"] button,button[data-testid="merge-button"]',
			);
			const clicks = countClicks(action);
			activate(page);

			action.click();

			expect(clicks()).toBe(1);
			expect(
				page.document.querySelector(
					`[${CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE}]`,
				),
			).toBeNull();
		}

		const changedPage = createMergeWidgetPage(cases[2] as string);
		expect(getConfirmMergeRequestCompatibility(changedPage.context)).toBe(
			"unsupported",
		);
		expect(
			getConfirmMergeRequestCompatibility(
				createMergeWidgetPage('<div id="loading"></div>').context,
			),
		).toBe("not-applicable");
	});
});
