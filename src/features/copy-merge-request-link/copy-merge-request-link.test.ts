import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type {
	Element as HappyDOMElement,
	Window as HappyDOMWindow,
} from "happy-dom";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readMergeRequestHeaderFixture,
	settleGitLabDom,
} from "../../../tests/helpers/gitlab-dom";
import { createFeatureContext } from "../../content/runtime/feature-context";
import { activateFeatureRuntime } from "../../content/runtime/feature-lifecycle";
import {
	buildMergeRequestLink,
	copyMergeRequestLink,
	getCopyMergeRequestLinkCompatibility,
} from "./copy-merge-request-link";
import {
	COPY_MERGE_REQUEST_LINK_ATTRIBUTE,
	COPY_MERGE_REQUEST_LINK_STATUS_ATTRIBUTE,
	MERGE_REQUEST_ACTIONS_SELECTOR,
	MERGE_REQUEST_CODE_CONTROL_SELECTOR,
	MERGE_REQUEST_HEADER_ACTIONS_SELECTOR,
} from "./selectors";

const MERGE_REQUEST_URL =
	"https://gitlab.com/example/project/-/merge_requests/7";
const BUTTON = `[${COPY_MERGE_REQUEST_LINK_ATTRIBUTE}]`;
type HeaderFixture = "18" | "19" | "gitlab-com-public";
const HEADER_FIXTURES: HeaderFixture[] = ["18", "19", "gitlab-com-public"];

afterEach(() => {
	closeGitLabTestWindows();
});

async function openHeader(
	version: HeaderFixture = "19",
	url = MERGE_REQUEST_URL,
): Promise<HappyDOMWindow> {
	return createGitLabTestWindow(
		await readMergeRequestHeaderFixture(version),
		url,
		"projects:merge_requests:show",
	);
}

function directChildContaining(
	ancestor: HappyDOMElement,
	descendant: HappyDOMElement,
): HappyDOMElement | undefined {
	let current = descendant;

	while (current.parentElement && current.parentElement !== ancestor) {
		current = current.parentElement;
	}

	return current.parentElement === ancestor ? current : undefined;
}

function context(testWindow: HappyDOMWindow) {
	return createFeatureContext(asBrowserWindow(testWindow));
}

function activate(testWindow: HappyDOMWindow): AbortController {
	const controller = new AbortController();
	copyMergeRequestLink.activate(context(testWindow), controller.signal);
	return controller;
}

function requireButton(
	testWindow: HappyDOMWindow,
): globalThis.HTMLButtonElement {
	const button = testWindow.document.querySelector(BUTTON);

	if (!(button instanceof testWindow.HTMLButtonElement)) {
		throw new Error("Copy merge request link button was not mounted");
	}

	return button as unknown as globalThis.HTMLButtonElement;
}

function captureExecCommandCopies(testWindow: HappyDOMWindow): string[] {
	const copies: string[] = [];

	Object.defineProperty(testWindow.document, "execCommand", {
		configurable: true,
		value(command: string) {
			const textarea = testWindow.document.querySelector("body > textarea");

			if (command !== "copy" || !textarea) {
				return false;
			}

			copies.push((textarea as unknown as HTMLTextAreaElement).value);
			return true;
		},
	});

	return copies;
}

async function settleClipboardAttempt(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("buildMergeRequestLink", () => {
	test.each([
		[MERGE_REQUEST_URL, MERGE_REQUEST_URL],
		[`${MERGE_REQUEST_URL}/diffs`, MERGE_REQUEST_URL],
		[`${MERGE_REQUEST_URL}/commits`, MERGE_REQUEST_URL],
		[`${MERGE_REQUEST_URL}/pipelines`, MERGE_REQUEST_URL],
		[`${MERGE_REQUEST_URL}/reports`, MERGE_REQUEST_URL],
		[`${MERGE_REQUEST_URL}/diffs?view=parallel#note_12`, MERGE_REQUEST_URL],
		[
			"https://gitlab.example/gitlab/example/project/-/merge_requests/81/commits?x=1#y",
			"https://gitlab.example/gitlab/example/project/-/merge_requests/81",
		],
	] as const)("normalizes %s", (url, expected) => {
		const testWindow = createGitLabTestWindow("", url);

		expect(
			buildMergeRequestLink(testWindow.location as unknown as Location),
		).toBe(expected);
	});

	test.each([
		"https://gitlab.com/example/project/-/merge_requests",
		"https://gitlab.com/example/project/-/merge_requests/new",
		"https://gitlab.com/example/project/-/merge_requests/7invalid",
		"https://gitlab.com/-/merge_requests/7",
		"https://gitlab.com/example/-/merge_requests/7//diffs",
		"https://gitlab.com/example/-/merge_requests/7/-/merge_requests/8",
		"ftp://gitlab.com/example/project/-/merge_requests/7",
		"https://user:secret@gitlab.com/example/project/-/merge_requests/7",
	] as const)("rejects invalid path or origin input %s", (url) => {
		const testWindow = createGitLabTestWindow("", url);

		expect(
			buildMergeRequestLink(testWindow.location as unknown as Location),
		).toBeUndefined();
	});
});

describe("copy-merge-request-link", () => {
	test("matches every merge request detail tab", async () => {
		const testWindow = await openHeader();

		for (const suffix of ["", "/diffs", "/commits", "/pipelines", "/reports"]) {
			testWindow.happyDOM.setURL(`${MERGE_REQUEST_URL}${suffix}`);
			expect(copyMergeRequestLink.matches(context(testWindow))).toBe(true);
		}

		testWindow.happyDOM.setURL(
			"https://gitlab.com/example/project/-/merge_requests",
		);
		expect(copyMergeRequestLink.matches(context(testWindow))).toBe(false);
	});

	test.each(HEADER_FIXTURES)(
		"injects an accessible native-shaped action in the GitLab %s header",
		async (version) => {
			const testWindow = await openHeader(
				version,
				`${MERGE_REQUEST_URL}/diffs`,
			);
			activate(testWindow);
			const button = requireButton(testWindow);
			const actions = testWindow.document.querySelector(
				MERGE_REQUEST_HEADER_ACTIONS_SELECTOR,
			);
			const codeControl = testWindow.document.querySelector(
				MERGE_REQUEST_CODE_CONTROL_SELECTOR,
			);
			const codeContainer =
				actions && codeControl
					? directChildContaining(actions, codeControl)
					: undefined;
			const more = testWindow.document.querySelector(
				MERGE_REQUEST_ACTIONS_SELECTOR,
			);
			const use = button.querySelector("use");
			const spriteUse = more
				? more.querySelector('[data-testid="ellipsis_v-icon"] use')
				: codeControl?.querySelector('[data-testid="chevron-down-icon"] use');
			const expectedIconHref = spriteUse
				?.getAttribute("href")
				?.replace(/#[^#]+$/, "#copy-to-clipboard");

			expect((button.parentElement as unknown) === (actions as unknown)).toBe(
				true,
			);
			if (more) {
				expect(
					(button.nextElementSibling as unknown) === (more as unknown),
				).toBe(true);
			} else {
				expect(
					(codeContainer?.nextElementSibling as unknown) ===
						(button as unknown),
				).toBe(true);
			}
			expect(button.type).toBe("button");
			expect(button.title).toBe("Copy merge request link");
			expect(button.getAttribute("aria-label")).toBe("Copy merge request link");
			expect(button.hasAttribute("aria-live")).toBe(false);
			expect(button.getAttribute("data-toggle")).toBe("tooltip");
			expect(button.getAttribute("data-placement")).toBe("bottom");
			expect(button.getAttribute("data-container")).toBe("body");
			expect(button.hasAttribute("data-clipboard-text")).toBe(false);
			expect(button.classList.contains("gl-button")).toBe(true);
			expect(button.classList.contains("btn-md")).toBe(true);
			expect(button.classList.contains("btn-icon")).toBe(true);
			expect(button.classList.contains("btn-default-tertiary")).toBe(
				Boolean(more),
			);
			expect(button.classList.contains("gl-h-fit")).toBe(!more);
			expect(
				button.querySelector('[data-testid="copy-to-clipboard-icon"]'),
			).not.toBeNull();
			const status = actions?.querySelector(
				`[${COPY_MERGE_REQUEST_LINK_STATUS_ATTRIBUTE}]`,
			);
			expect(status?.classList.contains("gl-sr-only")).toBe(true);
			expect(status?.getAttribute("aria-live")).toBe("polite");
			expect(status?.getAttribute("aria-atomic")).toBe("true");
			expect(use?.getAttribute("href")).toBe(expectedIconHref);
		},
	);

	test.each(HEADER_FIXTURES)(
		"reports the hydrated GitLab %s contract as supported",
		async (version) => {
			const testWindow = await openHeader(version);

			expect(getCopyMergeRequestLinkCompatibility(context(testWindow))).toBe(
				"supported",
			);
		},
	);

	test("supports the current Code wrapper when signed-in actions are present", async () => {
		const testWindow = await openHeader("gitlab-com-public");
		const donor = testWindow.document.createElement("div");
		donor.innerHTML = await readMergeRequestHeaderFixture("19");
		const more = donor.querySelector(MERGE_REQUEST_ACTIONS_SELECTOR);
		const actions = testWindow.document.querySelector(
			MERGE_REQUEST_HEADER_ACTIONS_SELECTOR,
		);
		const sidebarToggle = actions?.querySelector(".gutter-toggle");

		if (!actions || !more || !sidebarToggle) {
			throw new Error("Current signed-in header test contract is incomplete");
		}

		actions.insertBefore(more, sidebarToggle);
		activate(testWindow);
		const button = requireButton(testWindow);

		expect((button.nextElementSibling as unknown) === (more as unknown)).toBe(
			true,
		);
		expect(getCopyMergeRequestLinkCompatibility(context(testWindow))).toBe(
			"supported",
		);
	});

	test("is idempotent, follows URL changes, and cleans up on abort", async () => {
		const testWindow = await openHeader();
		const copies = captureExecCommandCopies(testWindow);
		const controller = activate(testWindow);

		copyMergeRequestLink.activate(context(testWindow), controller.signal);
		expect(testWindow.document.querySelectorAll(BUTTON)).toHaveLength(1);

		testWindow.happyDOM.setURL(
			"https://gitlab.com/example/project/-/merge_requests/8/commits?x=1#y",
		);
		copyMergeRequestLink.reconcile?.(context(testWindow), controller.signal);
		requireButton(testWindow).click();
		expect(copies).toEqual([
			"https://gitlab.com/example/project/-/merge_requests/8",
		]);

		controller.abort();
		expect(testWindow.document.querySelector(BUTTON)).toBeNull();
	});

	test("mounts after hydration and reconciles a replaced header root", async () => {
		const markup = await readMergeRequestHeaderFixture("19");
		const testWindow = createGitLabTestWindow(
			'<div class="detail-page-header"><div class="js-issuable-actions"><div class="js-mr-more-dropdown"></div></div></div>',
			MERGE_REQUEST_URL,
			"projects:merge_requests:show",
		);
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[copyMergeRequestLink],
			controller.signal,
		);
		expect(testWindow.document.querySelector(BUTTON)).toBeNull();

		testWindow.document.querySelector(".detail-page-header")?.remove();
		testWindow.document.body.insertAdjacentHTML("beforeend", markup);
		await settleGitLabDom(testWindow);
		const firstButton = requireButton(testWindow);

		const replacement = testWindow.document.createElement("div");
		replacement.innerHTML = markup;
		const currentHeader = testWindow.document.querySelector(
			".detail-page-header",
		);
		const replacementHeader = replacement.firstElementChild;

		if (currentHeader && replacementHeader) {
			currentHeader.replaceWith(replacementHeader);
		}
		await settleGitLabDom(testWindow);

		expect(testWindow.document.querySelectorAll(BUTTON)).toHaveLength(1);
		expect(requireButton(testWindow)).toBe(firstButton);
		expect(firstButton.parentElement?.matches(".js-issuable-actions")).toBe(
			true,
		);
		controller.abort();
	});

	test("repairs child and sprite mutations without erasing live feedback", async () => {
		const testWindow = await openHeader();
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[copyMergeRequestLink],
			controller.signal,
		);
		const button = requireButton(testWindow);
		const use = button.querySelector("use");
		const expectedHref = use?.getAttribute("href");

		testWindow.document
			.querySelector(`[${COPY_MERGE_REQUEST_LINK_STATUS_ATTRIBUTE}]`)
			?.remove();
		use?.setAttribute(
			"href",
			"https://evil.example/icons.svg#copy-to-clipboard",
		);
		await settleGitLabDom(testWindow);

		expect(button.classList.contains("gl-button")).toBe(true);
		expect(
			testWindow.document.querySelector(
				`[${COPY_MERGE_REQUEST_LINK_STATUS_ATTRIBUTE}]`,
			),
		).not.toBeNull();
		expect(use?.getAttribute("href")).toBe(expectedHref);

		button.title = "Localized copied";
		button.setAttribute("aria-label", "Localized copied");
		copyMergeRequestLink.reconcile?.(context(testWindow), controller.signal);
		expect(button.title).toBe("Localized copied");
		expect(button.getAttribute("aria-label")).toBe("Localized copied");
		controller.abort();
	});

	test("copies the canonical merge request URL without GitLab clipboard delegation", async () => {
		const testWindow = await openHeader("19", `${MERGE_REQUEST_URL}/diffs`);
		const copies = captureExecCommandCopies(testWindow);
		const controller = activate(testWindow);
		const button = requireButton(testWindow);
		let clearVisibleFeedback: (() => void) | undefined;
		Object.defineProperty(testWindow, "setTimeout", {
			configurable: true,
			value(callback: TimerHandler) {
				if (typeof callback === "function") {
					clearVisibleFeedback = () => callback();
				}

				return 1;
			},
		});

		button.setAttribute("data-clipboard-text", "https://evil.example/");
		button.click();
		await settleClipboardAttempt();

		expect(copies).toEqual([MERGE_REQUEST_URL]);
		expect(button.getAttribute("aria-label")).toBe("Merge request link copied");
		expect(
			button.querySelector("use")?.getAttribute("href")?.endsWith("#check"),
		).toBe(true);
		expect(
			testWindow.document.querySelector(
				`[${COPY_MERGE_REQUEST_LINK_STATUS_ATTRIBUTE}]`,
			)?.textContent,
		).toBe("Merge request link copied");

		copyMergeRequestLink.reconcile?.(context(testWindow), controller.signal);
		expect(
			button.querySelector("use")?.getAttribute("href")?.endsWith("#check"),
		).toBe(true);

		clearVisibleFeedback?.();
		expect(
			button
				.querySelector("use")
				?.getAttribute("href")
				?.endsWith("#copy-to-clipboard"),
		).toBe(true);
		controller.abort();
	});

	test("falls back to navigator.clipboard when execCommand cannot copy", async () => {
		const testWindow = await openHeader();
		const copies: string[] = [];
		Object.defineProperty(testWindow.document, "execCommand", {
			configurable: true,
			value: () => false,
		});
		Object.defineProperty(testWindow.navigator, "clipboard", {
			configurable: true,
			value: {
				async writeText(text: string) {
					copies.push(text);
				},
			},
		});
		const controller = activate(testWindow);

		requireButton(testWindow).click();
		await settleClipboardAttempt();

		expect(copies).toEqual([MERGE_REQUEST_URL]);
		expect(requireButton(testWindow).getAttribute("aria-label")).toBe(
			"Merge request link copied",
		);
		controller.abort();
	});

	test("reports clipboard failure to the user and console", async () => {
		const testWindow = await openHeader();
		Object.defineProperty(testWindow.document, "execCommand", {
			configurable: true,
			value: () => false,
		});
		Object.defineProperty(testWindow.navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: () => Promise.reject(new Error("denied")),
			},
		});
		const consoleError = spyOn(console, "error").mockImplementation(() => {});
		const controller = activate(testWindow);

		requireButton(testWindow).click();
		await settleClipboardAttempt();

		expect(requireButton(testWindow).getAttribute("aria-label")).toBe(
			"Could not copy merge request link",
		);
		expect(
			requireButton(testWindow)
				.querySelector("use")
				?.getAttribute("href")
				?.endsWith("#error"),
		).toBe(true);
		expect(
			testWindow.document.querySelector(
				`[${COPY_MERGE_REQUEST_LINK_STATUS_ATTRIBUTE}]`,
			)?.textContent,
		).toBe("Could not copy merge request link");
		expect(consoleError).toHaveBeenCalledTimes(1);
		consoleError.mockRestore();
		controller.abort();
	});

	test("blocks a stale button click after leaving a merge request route", async () => {
		const testWindow = await openHeader();
		const controller = activate(testWindow);
		const button = requireButton(testWindow);
		let bubbled = false;
		testWindow.document.addEventListener("click", () => {
			bubbled = true;
		});

		testWindow.happyDOM.setURL(
			"https://gitlab.com/example/project/-/merge_requests",
		);
		button.click();

		expect(button.isConnected).toBe(false);
		expect(bubbled).toBe(false);
		controller.abort();
	});

	test("does not treat the native copy-reference dropdown item as equivalent", async () => {
		const testWindow = await openHeader();
		activate(testWindow);

		expect(testWindow.document.querySelector(BUTTON)).not.toBeNull();
	});

	test("does not adopt or remove a foreign owned marker", async () => {
		const testWindow = await openHeader();
		const actions = testWindow.document.querySelector(
			MERGE_REQUEST_HEADER_ACTIONS_SELECTOR,
		);
		const more = testWindow.document.querySelector(
			MERGE_REQUEST_ACTIONS_SELECTOR,
		);
		const foreign = testWindow.document.createElement("button");
		foreign.setAttribute(COPY_MERGE_REQUEST_LINK_ATTRIBUTE, "");
		foreign.textContent = "Foreign";
		actions?.insertBefore(foreign, more);
		const controller = activate(testWindow);

		expect(testWindow.document.querySelectorAll(BUTTON)).toHaveLength(1);
		expect(foreign.textContent).toBe("Foreign");
		expect(getCopyMergeRequestLinkCompatibility(context(testWindow))).toBe(
			"unsupported",
		);
		controller.abort();
		expect(foreign.isConnected).toBe(true);
	});

	test("reports foreign markers outside the header and duplicate markers as unsupported", async () => {
		for (const placement of ["outside", "duplicate"] as const) {
			const testWindow = await openHeader();
			const first = testWindow.document.createElement("button");
			first.setAttribute(COPY_MERGE_REQUEST_LINK_ATTRIBUTE, "");
			testWindow.document.body.append(first);

			if (placement === "duplicate") {
				const second = first.cloneNode();
				testWindow.document.body.append(second);
			}

			activate(testWindow);
			expect(testWindow.document.querySelectorAll(BUTTON)).toHaveLength(
				placement === "duplicate" ? 2 : 1,
			);
			expect(getCopyMergeRequestLinkCompatibility(context(testWindow))).toBe(
				"unsupported",
			);
		}
	});

	test("observes only sprite href changes", () => {
		expect(copyMergeRequestLink.observedAttributes).toEqual(["href"]);
	});

	test("missing, ambiguous, reordered, and unsafe contracts are safe no-ops", async () => {
		const cases: Array<(testWindow: HappyDOMWindow) => void> = [
			(testWindow) => {
				testWindow.document
					.querySelector(MERGE_REQUEST_CODE_CONTROL_SELECTOR)
					?.remove();
			},
			(testWindow) => {
				testWindow.document
					.querySelector(MERGE_REQUEST_ACTIONS_SELECTOR)
					?.remove();
			},
			(testWindow) => {
				const actions = testWindow.document.querySelector(
					MERGE_REQUEST_HEADER_ACTIONS_SELECTOR,
				);

				if (actions) {
					actions.parentElement?.append(actions.cloneNode(true));
				}
			},
			(testWindow) => {
				const actions = testWindow.document.querySelector(
					MERGE_REQUEST_HEADER_ACTIONS_SELECTOR,
				);
				const code = testWindow.document.querySelector(
					MERGE_REQUEST_CODE_CONTROL_SELECTOR,
				);
				const more = testWindow.document.querySelector(
					MERGE_REQUEST_ACTIONS_SELECTOR,
				);
				const codeContainer =
					actions && code ? directChildContaining(actions, code) : undefined;
				if (actions && codeContainer && more) {
					actions.insertBefore(more, codeContainer);
				}
			},
			(testWindow) => {
				testWindow.document
					.querySelector('[data-testid="ellipsis_v-icon"] use')
					?.setAttribute("href", "/assets/icons.svg#wrong");
			},
		];

		for (const mutate of cases) {
			const testWindow = await openHeader();
			mutate(testWindow);
			activate(testWindow);
			expect(testWindow.document.querySelector(BUTTON)).toBeNull();
			expect(getCopyMergeRequestLinkCompatibility(context(testWindow))).toBe(
				"unsupported",
			);
		}
	});

	test("rejects an unsafe Code sprite when permission-dependent actions are absent", async () => {
		const testWindow = await openHeader("gitlab-com-public");
		testWindow.document
			.querySelector('[data-testid="chevron-down-icon"] use')
			?.setAttribute("href", "https://evil.example/icons.svg#chevron-down");
		activate(testWindow);

		expect(testWindow.document.querySelector(BUTTON)).toBeNull();
		expect(getCopyMergeRequestLinkCompatibility(context(testWindow))).toBe(
			"unsupported",
		);
	});

	test("reports other pages as not applicable", async () => {
		const testWindow = await openHeader(
			"19",
			"https://gitlab.com/example/project/-/merge_requests",
		);

		expect(getCopyMergeRequestLinkCompatibility(context(testWindow))).toBe(
			"not-applicable",
		);
	});
});
