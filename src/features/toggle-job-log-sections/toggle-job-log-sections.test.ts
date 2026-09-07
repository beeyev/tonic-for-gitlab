import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type {
	Element as HappyDOMElement,
	Window as HappyDOMWindow,
} from "happy-dom";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readJobLogFixture,
	settleGitLabDom,
} from "../../../tests/helpers/gitlab-dom";
import { createFeatureContext } from "../../content/runtime/feature-context";
import { activateFeatureRuntime } from "../../content/runtime/feature-lifecycle";
import {
	JOB_LOG_SEARCH_BOX_SELECTOR,
	JOB_LOG_SECTION_CLOSED_ICON_SELECTOR,
	JOB_LOG_SECTION_HEADER_SELECTOR,
	JOB_LOG_SECTION_OPEN_ICON_SELECTOR,
	JOB_LOG_TOP_BAR_ANCHOR_SELECTOR,
	JOB_LOG_TOP_BAR_SELECTOR,
	TOGGLE_JOB_LOG_SECTIONS_ATTRIBUTE,
	TOGGLE_JOB_LOG_SECTIONS_STATUS_ATTRIBUTE,
} from "./selectors";
import {
	createToggleJobLogSectionsFeature,
	getToggleJobLogSectionsCompatibility,
} from "./toggle-job-log-sections";

const JOB_URL = "https://gitlab.com/example/project/-/jobs/1234";
const JOB_PAGE = "projects:jobs:show";
const WRAPPER = `[${TOGGLE_JOB_LOG_SECTIONS_ATTRIBUTE}]`;
const STATUS = `[${TOGGLE_JOB_LOG_SECTIONS_STATUS_ATTRIBUTE}]`;
const SPRITE_PREFIX =
	"/assets/icons-0000000000000000000000000000000000000000000000000000000000000000.svg";
const LOG_CONTENT_SELECTOR = '[data-testid="job-log-content"]';

/**
 * The collapsed job log default, as the content runtime answers it: `undefined`
 * while the stored settings are still being read. Per-activation state is keyed
 * to the activation signal, so one feature instance serves every test.
 */
let collapseByDefault: boolean | undefined = false;
const toggleJobLogSections = createToggleJobLogSectionsFeature(
	() => collapseByDefault,
);

beforeEach(() => {
	collapseByDefault = false;
});

afterEach(() => {
	closeGitLabTestWindows();
});

async function openJobLog(url = JOB_URL): Promise<HappyDOMWindow> {
	return createGitLabTestWindow(await readJobLogFixture(), url, JOB_PAGE);
}

function context(testWindow: HappyDOMWindow) {
	return createFeatureContext(asBrowserWindow(testWindow));
}

function activate(testWindow: HappyDOMWindow): AbortController {
	const controller = new AbortController();
	toggleJobLogSections.activate(context(testWindow), controller.signal);
	return controller;
}

function requireButton(
	testWindow: HappyDOMWindow,
): globalThis.HTMLButtonElement {
	const button = testWindow.document.querySelector(`${WRAPPER} button`);

	if (!(button instanceof testWindow.HTMLButtonElement)) {
		throw new Error("Job log section toggle was not mounted");
	}

	return button as unknown as globalThis.HTMLButtonElement;
}

/**
 * GitLab disables the controls in this group with `aria-disabled` and a class,
 * never the `disabled` property, so that is what the button has to report.
 */
function isDisabled(button: globalThis.HTMLButtonElement): boolean {
	return (
		button.getAttribute("aria-disabled") === "true" &&
		button.classList.contains("disabled") &&
		!button.hasAttribute("disabled")
	);
}

function iconHref(testWindow: HappyDOMWindow): string | null {
	return (
		testWindow.document
			.querySelector(`${WRAPPER} button use`)
			?.getAttribute("href") ?? null
	);
}

function countOpenSections(testWindow: HappyDOMWindow): number {
	return testWindow.document.querySelectorAll(
		`${JOB_LOG_SECTION_HEADER_SELECTOR} ${JOB_LOG_SECTION_OPEN_ICON_SELECTOR}`,
	).length;
}

function countClosedSections(testWindow: HappyDOMWindow): number {
	return testWindow.document.querySelectorAll(
		`${JOB_LOG_SECTION_HEADER_SELECTOR} ${JOB_LOG_SECTION_CLOSED_ICON_SELECTOR}`,
	).length;
}

interface SectionSpec {
	label: string;
	open: boolean;
	children: SectionSpec[];
}

function section(
	label: string,
	open: boolean,
	children: SectionSpec[] = [],
): SectionSpec {
	return { label, open, children };
}

/**
 * Replaces the fixture's log with a live model of GitLab's own section
 * behaviour, built by cloning the fixture's header and line markup.
 *
 * Two properties of `log.vue` are what this feature depends on and what a
 * static fixture cannot show. The rendered log is flat, so a closed section
 * contributes only its own header and the headers nested inside it do not exist
 * in the document at all. And the re-render happens after GitLab's click
 * handler returns, never inside it, which is what lets one synchronous pass of
 * clicks land on elements that are all still mounted.
 *
 * The returned `stream` appends a root section the way a running job's runner
 * does, which is the case a single mounted snapshot cannot show.
 */
function installJobLog(
	testWindow: HappyDOMWindow,
	roots: readonly SectionSpec[],
): { stream(spec: SectionSpec): void } {
	const { document } = testWindow;
	const container = document.querySelector(LOG_CONTENT_SELECTOR);
	const headerTemplate = document.querySelector(
		JOB_LOG_SECTION_HEADER_SELECTOR,
	);
	const lineTemplate = document.querySelector(
		`.job-log-line:not(${JOB_LOG_SECTION_HEADER_SELECTOR})`,
	);

	if (!container || !headerTemplate || !lineTemplate) {
		throw new Error("Job log fixture does not carry the expected log lines");
	}

	const tree = [...roots];
	const headers = new Map<SectionSpec, HappyDOMElement>();
	const lines = new Map<SectionSpec, HappyDOMElement>();
	const specsByHeader = new Map<HappyDOMElement, SectionSpec>();
	let isRenderQueued = false;

	const headerFor = (spec: SectionSpec): HappyDOMElement => {
		let header = headers.get(spec);

		if (!header) {
			header = headerTemplate.cloneNode(true) as HappyDOMElement;
			const content = header.querySelector(".job-log-line-content");

			if (content) {
				content.textContent = spec.label;
			}

			headers.set(spec, header);
			specsByHeader.set(header, spec);
		}

		const chevron = header.querySelector("svg");
		chevron?.setAttribute(
			"data-testid",
			spec.open ? "chevron-lg-down-icon" : "chevron-lg-right-icon",
		);
		chevron
			?.querySelector("use")
			?.setAttribute(
				"href",
				`${SPRITE_PREFIX}#chevron-lg-${spec.open ? "down" : "right"}`,
			);

		return header;
	};

	const lineFor = (spec: SectionSpec): HappyDOMElement => {
		let line = lines.get(spec);

		if (!line) {
			line = lineTemplate.cloneNode(true) as HappyDOMElement;
			const content = line.querySelector(".job-log-line-content");

			if (content) {
				content.textContent = `${spec.label} output`;
			}

			lines.set(spec, line);
		}

		return line;
	};

	const render = () => {
		const visible: HappyDOMElement[] = [];
		const walk = (specs: readonly SectionSpec[]) => {
			for (const spec of specs) {
				visible.push(headerFor(spec));

				if (spec.open) {
					visible.push(lineFor(spec));
					walk(spec.children);
				}
			}
		};

		walk(tree);
		container.replaceChildren(...visible);
	};

	container.addEventListener("click", (event) => {
		const target = event.target as HappyDOMElement | null;
		const header = target?.closest(JOB_LOG_SECTION_HEADER_SELECTOR) ?? null;
		const spec = header ? specsByHeader.get(header) : undefined;

		if (!spec) {
			return;
		}

		spec.open = !spec.open;

		if (isRenderQueued) {
			return;
		}

		isRenderQueued = true;
		queueMicrotask(() => {
			isRenderQueued = false;
			render();
		});
	});

	render();

	return {
		stream(spec) {
			tree.push(spec);
			render();
		},
	};
}

function activateRuntime(testWindow: HappyDOMWindow): AbortController {
	const controller = new AbortController();
	activateFeatureRuntime(
		asBrowserWindow(testWindow),
		[toggleJobLogSections],
		controller.signal,
	);
	return controller;
}

function headerAt(
	testWindow: HappyDOMWindow,
	index: number,
): globalThis.HTMLElement {
	const header = testWindow.document.querySelectorAll(
		JOB_LOG_SECTION_HEADER_SELECTOR,
	)[index];

	if (!header) {
		throw new Error(`Job log has no section header at index ${index}`);
	}

	return header as unknown as globalThis.HTMLElement;
}

function searchInput(testWindow: HappyDOMWindow): globalThis.HTMLInputElement {
	const input = testWindow.document.querySelector(
		`${JOB_LOG_SEARCH_BOX_SELECTOR} input`,
	);

	if (!input) {
		throw new Error("Job log fixture does not carry the top bar search box");
	}

	return input as unknown as globalThis.HTMLInputElement;
}

function chainedSections(depth: number): SectionSpec {
	let deepest = section(`level ${depth}`, false);

	for (let level = depth - 1; level > 0; level -= 1) {
		deepest = section(`level ${level}`, false, [deepest]);
	}

	return deepest;
}

describe("toggle-job-log-sections", () => {
	test("matches only the job detail page", async () => {
		const testWindow = await openJobLog();

		for (const [url, expected] of [
			[JOB_URL, true],
			[`${JOB_URL}/`, true],
			["https://gitlab.example/gitlab/example/project/-/jobs/9", true],
			[`${JOB_URL}?x=1#L4`, true],
			// A separate full-log Vue application, not this top bar.
			[`${JOB_URL}/viewer`, false],
			[`${JOB_URL}/artifacts/browse`, false],
			[`${JOB_URL}/raw`, false],
			["https://gitlab.com/example/project/-/jobs", false],
			["https://gitlab.com/example/project/-/pipelines/7", false],
		] as const) {
			testWindow.happyDOM.setURL(url);
			expect(toggleJobLogSections.matches(context(testWindow))).toBe(expected);
		}
	});

	test("injects an accessible native-shaped button first in the icon group", async () => {
		const testWindow = await openJobLog();
		const controller = activate(testWindow);
		const button = requireButton(testWindow);
		const wrapper = button.parentElement;
		const group = testWindow.document.querySelector(
			JOB_LOG_TOP_BAR_ANCHOR_SELECTOR,
		)?.parentElement?.parentElement;

		expect((wrapper?.parentElement as unknown) === (group as unknown)).toBe(
			true,
		);
		expect((group?.firstElementChild as unknown) === (wrapper as unknown)).toBe(
			true,
		);
		expect(button.type).toBe("button");
		expect(button.classList.contains("gl-button")).toBe(true);
		expect(button.classList.contains("btn-icon")).toBe(true);
		expect(button.classList.contains("btn-md")).toBe(true);
		expect(button.classList.contains("disabled")).toBe(false);
		expect(button.hasAttribute("disabled")).toBe(false);
		expect(button.hasAttribute("aria-disabled")).toBe(false);
		// The fixture opens with one open section, so the button collapses.
		expect(button.getAttribute("aria-label")).toBe("Collapse all log sections");
		expect(button.getAttribute("title")).toBe("Collapse all log sections");
		expect(wrapper?.getAttribute("title")).toBe("Collapse all log sections");
		expect(iconHref(testWindow)).toBe(`${SPRITE_PREFIX}#collapse`);
		const icon = button.querySelector("svg");
		expect(icon?.getAttribute("class")).toBe(
			"gl-button-icon gl-icon s16 gl-fill-current",
		);
		expect(icon?.getAttribute("aria-hidden")).toBe("true");
		const status = testWindow.document.querySelector(STATUS);
		expect(status?.parentElement === wrapper).toBe(true);
		expect(status?.classList.contains("gl-sr-only")).toBe(true);
		expect(status?.getAttribute("role")).toBe("status");
		expect(status?.getAttribute("aria-live")).toBe("polite");
		expect(status?.getAttribute("aria-atomic")).toBe("true");
		expect(getToggleJobLogSectionsCompatibility(context(testWindow))).toBe(
			"supported",
		);
		controller.abort();
	});

	test("is idempotent and leaves the rest of the top bar untouched", async () => {
		const testWindow = await openJobLog();
		const group = testWindow.document.querySelector(
			JOB_LOG_TOP_BAR_ANCHOR_SELECTOR,
		)?.parentElement?.parentElement;
		const nativeChildren = [...(group?.children ?? [])];
		const controller = activate(testWindow);

		toggleJobLogSections.activate(context(testWindow), controller.signal);
		toggleJobLogSections.reconcile?.(context(testWindow), controller.signal);
		const button = requireButton(testWindow);

		expect(testWindow.document.querySelectorAll(WRAPPER)).toHaveLength(1);
		expect(testWindow.document.querySelectorAll(STATUS)).toHaveLength(1);
		expect([...(group?.children ?? [])].slice(1)).toEqual(nativeChildren);
		expect(
			testWindow.document.querySelectorAll(
				`${JOB_LOG_TOP_BAR_SELECTOR} button`,
			),
		).toHaveLength(nativeChildren.length);
		expect(button.isConnected).toBe(true);

		controller.abort();
		expect(testWindow.document.querySelector(WRAPPER)).toBeNull();
		expect(testWindow.document.querySelector(STATUS)).toBeNull();
		expect([...(group?.children ?? [])]).toEqual(nativeChildren);
	});

	test("disables the button when the log renders no sections", async () => {
		const testWindow = await openJobLog();
		for (const header of testWindow.document.querySelectorAll(
			JOB_LOG_SECTION_HEADER_SELECTOR,
		)) {
			header.remove();
		}
		const controller = activate(testWindow);
		const button = requireButton(testWindow);

		expect(isDisabled(button)).toBe(true);
		expect(button.getAttribute("aria-label")).toBe("Expand all log sections");
		expect(iconHref(testWindow)).toBe(`${SPRITE_PREFIX}#expand`);

		// The button stays clickable the way GitLab's own do, so the handler is
		// what has to refuse a run when there is nothing to toggle.
		button.click();
		expect(testWindow.document.querySelector(STATUS)?.textContent).toBe("");
		controller.abort();
	});

	test("collapses every open section in one pass, including nested ones", async () => {
		const testWindow = await openJobLog();
		installJobLog(testWindow, [
			section("build", true, [
				section("install", true, [section("deps", true)]),
				section("compile", true),
			]),
			section("test", true),
			section("upload", false),
		]);
		const controller = activate(testWindow);
		expect(countOpenSections(testWindow)).toBe(5);

		requireButton(testWindow).click();
		await settleGitLabDom(testWindow);

		expect(countOpenSections(testWindow)).toBe(0);
		// Only the two roots remain rendered once everything below them closed.
		expect(countClosedSections(testWindow)).toBe(3);
		expect(testWindow.document.querySelector(STATUS)?.textContent).toBe(
			"Collapsed 5 log sections",
		);
		expect(requireButton(testWindow).getAttribute("aria-label")).toBe(
			"Expand all log sections",
		);
		expect(iconHref(testWindow)).toBe(`${SPRITE_PREFIX}#expand`);
		controller.abort();
	});

	test("expands nested sections over as many passes as the depth needs", async () => {
		const testWindow = await openJobLog();
		installJobLog(testWindow, [
			section("build", false, [
				section("install", false, [section("deps", false)]),
				section("compile", false),
			]),
			section("test", false),
		]);
		const controller = activate(testWindow);
		const button = requireButton(testWindow);

		expect(button.getAttribute("aria-label")).toBe("Expand all log sections");
		// Only the two roots exist until they are opened.
		expect(countClosedSections(testWindow)).toBe(2);

		button.click();
		expect(isDisabled(button)).toBe(true);
		await settleGitLabDom(testWindow);

		expect(countClosedSections(testWindow)).toBe(0);
		expect(countOpenSections(testWindow)).toBe(5);
		expect(testWindow.document.querySelector(STATUS)?.textContent).toBe(
			"Expanded 5 log sections",
		);
		expect(isDisabled(requireButton(testWindow))).toBe(false);
		expect(requireButton(testWindow).getAttribute("aria-label")).toBe(
			"Collapse all log sections",
		);
		expect(iconHref(testWindow)).toBe(`${SPRITE_PREFIX}#collapse`);
		controller.abort();
	});

	test("stops expanding at the pass cap instead of running forever", async () => {
		const testWindow = await openJobLog();
		installJobLog(testWindow, [chainedSections(25)]);
		const controller = activate(testWindow);

		requireButton(testWindow).click();
		await settleGitLabDom(testWindow);

		expect(testWindow.document.querySelector(STATUS)?.textContent).toBe(
			"Expanded 20 log sections",
		);
		expect(countOpenSections(testWindow)).toBe(20);
		expect(countClosedSections(testWindow)).toBe(1);
		expect(isDisabled(requireButton(testWindow))).toBe(false);
		controller.abort();
	});

	test("abandons an expand run when the activation aborts", async () => {
		const testWindow = await openJobLog();
		installJobLog(testWindow, [chainedSections(10)]);
		const controller = activate(testWindow);

		requireButton(testWindow).click();
		controller.abort();
		await settleGitLabDom(testWindow);

		expect(testWindow.document.querySelector(WRAPPER)).toBeNull();
		// The first pass had already been clicked when the abort landed.
		expect(countOpenSections(testWindow)).toBe(1);
		expect(countClosedSections(testWindow)).toBe(1);
	});

	test("re-enables itself when an expand run fails", async () => {
		const testWindow = await openJobLog();
		installJobLog(testWindow, [
			section("build", false, [section("deps", false)]),
		]);
		const consoleError = spyOn(console, "error").mockImplementation(() => {});
		const controller = activate(testWindow);
		Object.defineProperty(testWindow, "requestAnimationFrame", {
			configurable: true,
			value() {
				throw new Error("frames are unavailable");
			},
		});

		requireButton(testWindow).click();
		await settleGitLabDom(testWindow);

		// A run that cannot finish must not leave the button disabled for good.
		expect(isDisabled(requireButton(testWindow))).toBe(false);
		expect(
			consoleError.mock.calls.some(
				([message]) =>
					message === "Tonic could not expand the job log sections",
			),
		).toBe(true);
		consoleError.mockRestore();
		controller.abort();
	});

	test("follows a section the user toggles by hand", async () => {
		const testWindow = await openJobLog();
		installJobLog(testWindow, [section("build", true), section("test", false)]);
		const controller = activate(testWindow);

		expect(requireButton(testWindow).getAttribute("aria-label")).toBe(
			"Collapse all log sections",
		);

		const [header] = testWindow.document.querySelectorAll(
			JOB_LOG_SECTION_HEADER_SELECTOR,
		);
		(header as unknown as globalThis.HTMLElement).click();
		await settleGitLabDom(testWindow);

		expect(countOpenSections(testWindow)).toBe(0);
		expect(requireButton(testWindow).getAttribute("aria-label")).toBe(
			"Expand all log sections",
		);
		expect(iconHref(testWindow)).toBe(`${SPRITE_PREFIX}#expand`);
		controller.abort();
	});

	test("follows sections that stream in while a job is running", async () => {
		const testWindow = await openJobLog();
		const template = testWindow.document.querySelector(
			JOB_LOG_SECTION_HEADER_SELECTOR,
		);
		const log = testWindow.document.querySelector(LOG_CONTENT_SELECTOR);

		if (!template || !log) {
			throw new Error("Job log fixture does not carry the expected log lines");
		}

		const header = template.cloneNode(true);
		log.replaceChildren();
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[toggleJobLogSections],
			controller.signal,
		);
		/*
		 * Settle before appending. Mounting the button is itself a mutation
		 * inside the top bar, so it schedules one more pass; riding on that pass
		 * would prove nothing about streamed headers.
		 */
		await settleGitLabDom(testWindow);
		expect(isDisabled(requireButton(testWindow))).toBe(true);

		// A queued job paints an empty log, then the runner streams into it.
		log.append(header as never);
		await settleGitLabDom(testWindow);

		expect(isDisabled(requireButton(testWindow))).toBe(false);
		expect(requireButton(testWindow).getAttribute("aria-label")).toBe(
			"Collapse all log sections",
		);
		expect(iconHref(testWindow)).toBe(`${SPRITE_PREFIX}#collapse`);
		controller.abort();
	});

	test("leaves the runtime asleep while ordinary log lines stream", async () => {
		const testWindow = await openJobLog();
		const log = testWindow.document.querySelector(LOG_CONTENT_SELECTOR);
		const line = testWindow.document
			.querySelector(`.job-log-line:not(${JOB_LOG_SECTION_HEADER_SELECTOR})`)
			?.cloneNode(true);

		if (!log || !line) {
			throw new Error("Job log fixture does not carry the expected log lines");
		}

		let reconciles = 0;
		const counted = {
			...toggleJobLogSections,
			reconcile(
				...args: Parameters<NonNullable<typeof toggleJobLogSections.reconcile>>
			) {
				reconciles += 1;
				toggleJobLogSections.reconcile?.(...args);
			},
		};
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[counted],
			controller.signal,
		);
		await settleGitLabDom(testWindow);
		const settled = reconciles;

		for (let index = 0; index < 20; index += 1) {
			log.append(line.cloneNode(true) as never);
		}
		await settleGitLabDom(testWindow);

		// This is what declaring the header selector instead of the log buys.
		expect(reconciles).toBe(settled);
		controller.abort();
	});

	test("abandons an expand run when the tab moves to another job", async () => {
		const testWindow = await openJobLog();
		installJobLog(testWindow, [chainedSections(10)]);
		const controller = activate(testWindow);

		requireButton(testWindow).click();
		// Both job paths match, so the activation signal stays open across this.
		testWindow.happyDOM.setURL(
			"https://gitlab.com/example/project/-/jobs/5678",
		);
		await settleGitLabDom(testWindow);

		// Only the pass that had already been clicked lands.
		expect(countOpenSections(testWindow)).toBe(1);
		expect(countClosedSections(testWindow)).toBe(1);
		// A run left behind must not announce, nor strand the button disabled.
		expect(testWindow.document.querySelector(STATUS)?.textContent).toBe("");
		expect(isDisabled(requireButton(testWindow))).toBe(false);
		controller.abort();
	});

	test("mounts after hydration and repairs a replaced top bar", async () => {
		const markup = await readJobLogFixture();
		const testWindow = createGitLabTestWindow("", JOB_URL, JOB_PAGE);
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[toggleJobLogSections],
			controller.signal,
		);
		expect(testWindow.document.querySelector(WRAPPER)).toBeNull();
		expect(getToggleJobLogSectionsCompatibility(context(testWindow))).toBe(
			"unsupported",
		);

		testWindow.document.body.insertAdjacentHTML("beforeend", markup);
		await settleGitLabDom(testWindow);
		const firstButton = requireButton(testWindow);

		const replacement = testWindow.document.createElement("div");
		replacement.innerHTML = markup;
		const replacementTopBar = replacement.querySelector(
			JOB_LOG_TOP_BAR_SELECTOR,
		);
		const currentTopBar = testWindow.document.querySelector(
			JOB_LOG_TOP_BAR_SELECTOR,
		);

		if (!currentTopBar || !replacementTopBar) {
			throw new Error("Job log fixture has no top bar to replace");
		}

		currentTopBar.replaceWith(replacementTopBar);
		await settleGitLabDom(testWindow);

		expect(testWindow.document.querySelectorAll(WRAPPER)).toHaveLength(1);
		expect(requireButton(testWindow)).toBe(firstButton);
		expect(
			(requireButton(testWindow).parentElement?.parentElement
				?.parentElement as unknown) === (replacementTopBar as unknown),
		).toBe(false);
		expect(replacementTopBar.contains(requireButton(testWindow) as never)).toBe(
			true,
		);
		controller.abort();
	});

	test("re-inserts the button when GitLab displaces it inside the group", async () => {
		const testWindow = await openJobLog();
		const controller = activate(testWindow);
		const wrapper = requireButton(testWindow).parentElement;
		const group = wrapper?.parentElement;

		group?.append(wrapper as never);
		expect((group?.firstElementChild as unknown) === (wrapper as unknown)).toBe(
			false,
		);

		toggleJobLogSections.reconcile?.(context(testWindow), controller.signal);
		expect((group?.firstElementChild as unknown) === (wrapper as unknown)).toBe(
			true,
		);
		controller.abort();
	});

	test("does not adopt or remove a foreign owned marker", async () => {
		const testWindow = await openJobLog();
		const foreign = testWindow.document.createElement("div");
		foreign.setAttribute(TOGGLE_JOB_LOG_SECTIONS_ATTRIBUTE, "");
		foreign.textContent = "Foreign";
		testWindow.document.body.append(foreign);
		const controller = activate(testWindow);

		expect(testWindow.document.querySelectorAll(WRAPPER)).toHaveLength(1);
		expect(foreign.textContent).toBe("Foreign");
		expect(getToggleJobLogSectionsCompatibility(context(testWindow))).toBe(
			"unsupported",
		);
		controller.abort();
		expect(foreign.isConnected).toBe(true);
	});

	test("missing, ambiguous, and unsafe contracts are safe no-ops", async () => {
		const cases: Array<(testWindow: HappyDOMWindow) => void> = [
			(testWindow) => {
				testWindow.document.querySelector(JOB_LOG_TOP_BAR_SELECTOR)?.remove();
			},
			(testWindow) => {
				const topBar = testWindow.document.querySelector(
					JOB_LOG_TOP_BAR_SELECTOR,
				);
				topBar?.parentElement?.append(topBar.cloneNode(true));
			},
			(testWindow) => {
				testWindow.document
					.querySelector(JOB_LOG_TOP_BAR_ANCHOR_SELECTOR)
					?.remove();
			},
			(testWindow) => {
				const anchor = testWindow.document.querySelector(
					JOB_LOG_TOP_BAR_ANCHOR_SELECTOR,
				);
				anchor?.parentElement?.append(anchor.cloneNode(true));
			},
			// Controls that stopped being wrapped would otherwise resolve the row
			// holding the search box as the icon group.
			(testWindow) => {
				const anchor = testWindow.document.querySelector(
					JOB_LOG_TOP_BAR_ANCHOR_SELECTOR,
				);
				anchor?.parentElement?.replaceWith(anchor);
			},
			// A flattened group would otherwise make the whole bar the target.
			(testWindow) => {
				const anchor = testWindow.document.querySelector(
					JOB_LOG_TOP_BAR_ANCHOR_SELECTOR,
				);
				testWindow.document
					.querySelector(JOB_LOG_TOP_BAR_SELECTOR)
					?.replaceChildren(anchor as never);
			},
			(testWindow) => {
				for (const use of testWindow.document.querySelectorAll(
					`${JOB_LOG_TOP_BAR_SELECTOR} use`,
				)) {
					use.removeAttribute("href");
				}
			},
			(testWindow) => {
				testWindow.document
					.querySelector(`${JOB_LOG_TOP_BAR_SELECTOR} use`)
					?.setAttribute("href", "https://evil.example/icons.svg#icon");
			},
			(testWindow) => {
				testWindow.document
					.querySelector(`${JOB_LOG_TOP_BAR_SELECTOR} use`)
					?.setAttribute("href", "/assets/icons.svg");
			},
			(testWindow) => {
				testWindow.document
					.querySelector(`${JOB_LOG_TOP_BAR_SELECTOR} use`)
					?.setAttribute("href", "/assets/icons.png#icon");
			},
		];

		for (const mutate of cases) {
			const testWindow = await openJobLog();
			mutate(testWindow);
			const controller = activate(testWindow);

			expect(testWindow.document.querySelector(WRAPPER)).toBeNull();
			expect(getToggleJobLogSectionsCompatibility(context(testWindow))).toBe(
				"unsupported",
			);
			controller.abort();
		}
	});

	test("removes the button when the top bar goes away and puts it back", async () => {
		const testWindow = await openJobLog();
		const controller = activate(testWindow);
		const topBar = testWindow.document.querySelector(JOB_LOG_TOP_BAR_SELECTOR);
		const parent = topBar?.parentElement;

		topBar?.remove();
		toggleJobLogSections.reconcile?.(context(testWindow), controller.signal);
		expect(testWindow.document.querySelector(WRAPPER)).toBeNull();

		parent?.append(topBar as never);
		toggleJobLogSections.reconcile?.(context(testWindow), controller.signal);
		expect(testWindow.document.querySelectorAll(WRAPPER)).toHaveLength(1);
		controller.abort();
	});

	test("reports other pages as not applicable", async () => {
		const testWindow = await openJobLog(
			"https://gitlab.com/example/project/-/jobs",
		);

		expect(getToggleJobLogSectionsCompatibility(context(testWindow))).toBe(
			"not-applicable",
		);
	});

	describe("collapsed by default", () => {
		test("opens the log with every section collapsed and announces nothing", async () => {
			const testWindow = await openJobLog();
			collapseByDefault = true;
			installJobLog(testWindow, [
				section("build", true, [section("deps", true)]),
				section("test", true),
			]);
			const controller = activate(testWindow);
			await settleGitLabDom(testWindow);

			expect(countOpenSections(testWindow)).toBe(0);
			expect(countClosedSections(testWindow)).toBe(2);
			/*
			 * This is the state the log opens in, not a result the user asked for,
			 * so the live region stays silent.
			 */
			expect(testWindow.document.querySelector(STATUS)?.textContent).toBe("");
			// The button reports the log it is actually looking at.
			expect(requireButton(testWindow).getAttribute("aria-label")).toBe(
				"Expand all log sections",
			);
			expect(iconHref(testWindow)).toBe(`${SPRITE_PREFIX}#expand`);
			expect(isDisabled(requireButton(testWindow))).toBe(false);
			controller.abort();
		});

		test("changes nothing while the setting is off", async () => {
			const testWindow = await openJobLog();
			installJobLog(testWindow, [
				section("build", true, [section("deps", true)]),
			]);
			const controller = activate(testWindow);
			await settleGitLabDom(testWindow);

			expect(countOpenSections(testWindow)).toBe(2);
			expect(requireButton(testWindow).getAttribute("aria-label")).toBe(
				"Collapse all log sections",
			);
			expect(testWindow.document.querySelector(STATUS)?.textContent).toBe("");
			controller.abort();
		});

		test("collapses the sections a running job streams in later", async () => {
			const testWindow = await openJobLog();
			collapseByDefault = true;
			const log = installJobLog(testWindow, [section("build", true)]);
			const controller = activateRuntime(testWindow);
			await settleGitLabDom(testWindow);
			expect(countOpenSections(testWindow)).toBe(0);

			/*
			 * The first pass clicked a header itself. If its own clicks counted as
			 * the user taking over, everything streamed after this would arrive
			 * expanded.
			 */
			log.stream(section("test", true, [section("deps", true)]));
			await settleGitLabDom(testWindow);

			expect(countOpenSections(testWindow)).toBe(0);
			expect(countClosedSections(testWindow)).toBe(2);
			controller.abort();
		});

		test("stops once the user opens a section by hand", async () => {
			const testWindow = await openJobLog();
			collapseByDefault = true;
			const log = installJobLog(testWindow, [section("build", true)]);
			const controller = activateRuntime(testWindow);
			await settleGitLabDom(testWindow);
			expect(countOpenSections(testWindow)).toBe(0);

			headerAt(testWindow, 0).click();
			await settleGitLabDom(testWindow);
			// Reopening must stick rather than be collapsed again by the next pass.
			expect(countOpenSections(testWindow)).toBe(1);

			log.stream(section("test", true));
			await settleGitLabDom(testWindow);

			expect(countOpenSections(testWindow)).toBe(2);
			controller.abort();
		});

		test("stops once the user presses the toggle button", async () => {
			const testWindow = await openJobLog();
			collapseByDefault = true;
			const log = installJobLog(testWindow, [section("build", true)]);
			const controller = activateRuntime(testWindow);
			await settleGitLabDom(testWindow);
			expect(countOpenSections(testWindow)).toBe(0);

			requireButton(testWindow).click();
			await settleGitLabDom(testWindow);
			expect(countOpenSections(testWindow)).toBe(1);
			// A button press does announce, unlike the collapsed default.
			expect(testWindow.document.querySelector(STATUS)?.textContent).toBe(
				"Expanded 1 log section",
			);

			log.stream(section("test", true));
			await settleGitLabDom(testWindow);

			expect(countOpenSections(testWindow)).toBe(2);
			controller.abort();
		});

		test("stops once the user searches the log", async () => {
			const searches: Array<(testWindow: HappyDOMWindow) => void> = [
				(testWindow) => {
					searchInput(testWindow).click();
				},
				(testWindow) => {
					// GitLab's search box submits on Enter with no click anywhere.
					searchInput(testWindow).dispatchEvent(
						new testWindow.KeyboardEvent("keydown", {
							key: "Enter",
							bubbles: true,
						}) as unknown as globalThis.KeyboardEvent,
					);
				},
			];

			for (const search of searches) {
				const testWindow = await openJobLog();
				collapseByDefault = true;
				const log = installJobLog(testWindow, [section("build", true)]);
				const controller = activateRuntime(testWindow);
				await settleGitLabDom(testWindow);
				expect(countOpenSections(testWindow)).toBe(0);

				search(testWindow);
				log.stream(section("test", true));
				await settleGitLabDom(testWindow);

				expect(countOpenSections(testWindow)).toBe(1);
				controller.abort();
			}
		});

		test("leaves a deep-linked log line reachable", async () => {
			const testWindow = await openJobLog(`${JOB_URL}#L12`);
			collapseByDefault = true;
			installJobLog(testWindow, [section("build", true)]);
			const controller = activate(testWindow);
			await settleGitLabDom(testWindow);

			// A line inside a closed section is not in the document at all, so a
			// collapsed log would land the shared link on nothing.
			expect(countOpenSections(testWindow)).toBe(1);
			controller.abort();

			const otherWindow = await openJobLog(`${JOB_URL}#top`);
			installJobLog(otherWindow, [section("build", true)]);
			const otherController = activate(otherWindow);
			await settleGitLabDom(otherWindow);

			// Only GitLab's own log line anchors are treated as deep links.
			expect(countOpenSections(otherWindow)).toBe(0);
			otherController.abort();
		});

		test("keeps the answer it read when the log opened", async () => {
			const testWindow = await openJobLog();
			const log = installJobLog(testWindow, [section("build", true)]);
			const controller = activateRuntime(testWindow);
			await settleGitLabDom(testWindow);
			expect(countOpenSections(testWindow)).toBe(1);

			// Turning it on applies from the next job log, not the one being read.
			collapseByDefault = true;
			log.stream(section("test", true));
			await settleGitLabDom(testWindow);

			expect(countOpenSections(testWindow)).toBe(2);
			controller.abort();
		});

		test("re-reads the setting when the tab moves to another job", async () => {
			const testWindow = await openJobLog();
			installJobLog(testWindow, [section("build", true)]);
			const controller = activate(testWindow);
			await settleGitLabDom(testWindow);
			expect(countOpenSections(testWindow)).toBe(1);

			/*
			 * Both job paths match, so the activation stays alive across this and
			 * only the path can say a different log is on screen now.
			 */
			collapseByDefault = true;
			testWindow.happyDOM.setURL(
				"https://gitlab.com/example/project/-/jobs/5678",
			);
			installJobLog(testWindow, [
				section("deploy", true, [section("push", true)]),
			]);
			toggleJobLogSections.reconcile?.(context(testWindow), controller.signal);
			await settleGitLabDom(testWindow);

			expect(countOpenSections(testWindow)).toBe(0);
			expect(countClosedSections(testWindow)).toBe(1);
			controller.abort();
		});

		test("survives two reconciliations inside one task", async () => {
			const testWindow = await openJobLog();
			collapseByDefault = true;
			installJobLog(testWindow, [
				section("build", true, [section("deps", true)]),
				section("test", true),
			]);
			const controller = activate(testWindow);

			/*
			 * GitLab writes a section toggle to its store synchronously and renders
			 * the chevron later, so a second pass before that render still sees the
			 * headers as open. Clicking them again would reopen everything the
			 * first pass closed, and reconciliation frequency is not this feature's
			 * to control.
			 */
			toggleJobLogSections.reconcile?.(context(testWindow), controller.signal);
			await settleGitLabDom(testWindow);

			expect(countOpenSections(testWindow)).toBe(0);
			expect(countClosedSections(testWindow)).toBe(2);
			expect(requireButton(testWindow).getAttribute("aria-label")).toBe(
				"Expand all log sections",
			);
			controller.abort();
		});

		test("keeps a takeover that happened before the setting resolved", async () => {
			const testWindow = await openJobLog();
			collapseByDefault = undefined;
			const log = installJobLog(testWindow, [section("build", true)]);
			const controller = activateRuntime(testWindow);
			await settleGitLabDom(testWindow);

			// The user is already working the log when the stored value lands.
			headerAt(testWindow, 0).click();
			await settleGitLabDom(testWindow);
			collapseByDefault = true;
			log.stream(section("test", true));
			await settleGitLabDom(testWindow);

			/*
			 * Deferring the answer must not outlive the takeover. Arming on the
			 * late value would collapse the log out from under someone who is
			 * reading it.
			 */
			expect(countOpenSections(testWindow)).toBe(1);
			controller.abort();
		});

		test("waits for a settings value instead of deciding from the defaults", async () => {
			const testWindow = await openJobLog();
			// The runtime starts every tab from the defaults and resolves the
			// stored value a storage round trip later.
			collapseByDefault = undefined;
			installJobLog(testWindow, [section("build", true)]);
			const controller = activate(testWindow);
			await settleGitLabDom(testWindow);
			expect(countOpenSections(testWindow)).toBe(1);

			collapseByDefault = true;
			toggleJobLogSections.reconcile?.(context(testWindow), controller.signal);
			await settleGitLabDom(testWindow);

			expect(countOpenSections(testWindow)).toBe(0);
			controller.abort();
		});
	});

	test("observes the top bar, section headers, and its own markers", () => {
		expect(toggleJobLogSections.mutationSelectors).toEqual([
			JOB_LOG_TOP_BAR_SELECTOR,
			JOB_LOG_SECTION_HEADER_SELECTOR,
			WRAPPER,
		]);
		expect(toggleJobLogSections.observedAttributes).toBeUndefined();
	});
});
