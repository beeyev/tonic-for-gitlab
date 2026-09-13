import { afterEach, describe, expect, test } from "bun:test";
import type { Window as HappyDOMWindow } from "happy-dom";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readMergeRequestTabBarFixture,
	settleGitLabDom,
} from "../../../tests/helpers/gitlab-dom";
import { createFeatureContext } from "../../content/runtime/feature-context";
import { activateFeatureRuntime } from "../../content/runtime/feature-lifecycle";
import {
	approveMergeRequestFromTabs,
	getApproveMergeRequestFromTabsCompatibility,
} from "./approve-merge-request-from-tabs";
import {
	APPROVE_MERGE_REQUEST_FROM_TABS_ATTRIBUTE,
	MERGE_REQUEST_APPROVALS_SELECTOR,
	MERGE_REQUEST_APPROVE_BUTTON_SELECTOR,
	MERGE_REQUEST_TABS_ACTIONS_SELECTOR,
	MERGE_REQUEST_TABS_CONTAINER_SELECTOR,
} from "./selectors";

const MERGE_REQUEST_URL =
	"https://gitlab.com/example/project/-/merge_requests/7";
const MIRROR = `[${APPROVE_MERGE_REQUEST_FROM_TABS_ATTRIBUTE}]`;

afterEach(() => {
	closeGitLabTestWindows();
});

async function openTabBar(url = MERGE_REQUEST_URL): Promise<HappyDOMWindow> {
	return createGitLabTestWindow(
		await readMergeRequestTabBarFixture("19"),
		url,
		"projects:merge_requests:show",
	);
}

function context(testWindow: HappyDOMWindow) {
	return createFeatureContext(asBrowserWindow(testWindow));
}

function activate(testWindow: HappyDOMWindow): AbortController {
	const controller = new AbortController();
	approveMergeRequestFromTabs.activate(context(testWindow), controller.signal);
	return controller;
}

function requireMirror(testWindow: HappyDOMWindow): HTMLButtonElement {
	const mirror = testWindow.document.querySelector(MIRROR);

	if (!(mirror instanceof testWindow.HTMLButtonElement)) {
		throw new Error("Mirrored approve button was not mounted");
	}

	return mirror as unknown as HTMLButtonElement;
}

function requireRealButton(testWindow: HappyDOMWindow): HTMLButtonElement {
	const button = testWindow.document.querySelector(
		MERGE_REQUEST_APPROVE_BUTTON_SELECTOR,
	);

	if (!(button instanceof testWindow.HTMLButtonElement)) {
		throw new Error("GitLab approve button is missing from the fixture");
	}

	return button as unknown as HTMLButtonElement;
}

/** GitLab replaces the control when approval state changes, so the test does too. */
function replaceRealButton(
	testWindow: HappyDOMWindow,
	className: string,
	label: string,
): HTMLButtonElement {
	const current = testWindow.document.querySelector(
		MERGE_REQUEST_APPROVE_BUTTON_SELECTOR,
	);

	if (!current) {
		throw new Error("GitLab approve button is missing from the fixture");
	}

	const replacement = testWindow.document.createElement("button");
	replacement.setAttribute("data-testid", "approve-button");
	replacement.type = "button";
	replacement.className = className;
	const text = testWindow.document.createElement("span");
	text.className = "gl-button-text";
	text.textContent = label;
	replacement.append(text);
	current.replaceWith(replacement);

	return replacement as unknown as HTMLButtonElement;
}

describe("approve-merge-request-from-tabs", () => {
	test("matches every merge request detail tab", async () => {
		const testWindow = await openTabBar();

		for (const suffix of ["", "/diffs", "/commits", "/pipelines"]) {
			testWindow.happyDOM.setURL(`${MERGE_REQUEST_URL}${suffix}`);
			expect(approveMergeRequestFromTabs.matches(context(testWindow))).toBe(
				true,
			);
		}

		testWindow.happyDOM.setURL(
			"https://gitlab.com/example/project/-/merge_requests",
		);
		expect(approveMergeRequestFromTabs.matches(context(testWindow))).toBe(
			false,
		);
	});

	test("mirrors GitLab's approve control into the tab bar at the neighbouring size", async () => {
		const testWindow = await openTabBar(`${MERGE_REQUEST_URL}/diffs`);
		activate(testWindow);
		const mirror = requireMirror(testWindow);
		const container = testWindow.document.querySelector(
			MERGE_REQUEST_TABS_CONTAINER_SELECTOR,
		);
		const actions = testWindow.document.querySelector(
			MERGE_REQUEST_TABS_ACTIONS_SELECTOR,
		);
		const realButton = requireRealButton(testWindow);

		expect((mirror.parentElement as unknown) === (container as unknown)).toBe(
			true,
		);
		expect(
			(mirror.nextElementSibling as unknown) === (actions as unknown),
		).toBe(true);
		expect(mirror.type).toBe("button");
		expect(mirror.hasAttribute("data-testid")).toBe(false);
		expect(mirror.querySelector("[data-testid]")).toBeNull();
		expect(mirror.textContent?.trim()).toBe("Approve");
		expect(mirror.classList.contains("btn-confirm")).toBe(true);
		expect(mirror.classList.contains("gl-button")).toBe(true);
		expect(mirror.classList.contains("btn-md")).toBe(true);
		expect(mirror.classList.contains("btn-sm")).toBe(false);
		expect(realButton.classList.contains("btn-sm")).toBe(true);
		expect(
			getApproveMergeRequestFromTabsCompatibility(context(testWindow)),
		).toBe("supported");
	});

	test("forwards the click to GitLab's own control instead of approving itself", async () => {
		const testWindow = await openTabBar(`${MERGE_REQUEST_URL}/diffs`);
		const controller = activate(testWindow);
		const realButton = requireRealButton(testWindow);
		let realClicks = 0;
		realButton.addEventListener("click", () => {
			realClicks += 1;
		});

		requireMirror(testWindow).click();
		expect(realClicks).toBe(1);

		realButton.disabled = true;
		requireMirror(testWindow).click();
		expect(realClicks).toBe(1);

		realButton.disabled = false;
		realButton.remove();
		requireMirror(testWindow).click();
		expect(realClicks).toBe(1);
		controller.abort();
	});

	test("tracks the label, variant, and disabled state GitLab renders", async () => {
		const testWindow = await openTabBar();
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[approveMergeRequestFromTabs],
			controller.signal,
		);
		const mirror = requireMirror(testWindow);

		const revoke = replaceRealButton(
			testWindow,
			"btn gl-button btn-default btn-sm",
			"Revoke approval",
		);
		await settleGitLabDom(testWindow);

		expect(requireMirror(testWindow)).toBe(mirror);
		expect(mirror.textContent?.trim()).toBe("Revoke approval");
		expect(mirror.classList.contains("btn-default")).toBe(true);
		expect(mirror.classList.contains("btn-confirm")).toBe(false);
		expect(mirror.classList.contains("btn-md")).toBe(true);

		/* GitLab blocks its own control with `aria-disabled` and the `disabled`
		 * class, never the property, so the mirror reads the same signals. */
		revoke.setAttribute("aria-disabled", "true");
		revoke.className = "btn gl-button btn-default btn-sm disabled";
		revoke.append(
			testWindow.document.createElement("span") as unknown as never,
		);
		await settleGitLabDom(testWindow);
		expect(mirror.disabled).toBe(true);
		expect(mirror.classList.contains("disabled")).toBe(true);

		revoke.removeAttribute("aria-disabled");
		revoke.className = "btn gl-button btn-default btn-sm";
		revoke.lastElementChild?.remove();
		await settleGitLabDom(testWindow);
		expect(mirror.disabled).toBe(false);
		controller.abort();
	});

	test("does not forward a click while GitLab's control is mid-request", async () => {
		const testWindow = await openTabBar(`${MERGE_REQUEST_URL}/diffs`);
		const controller = activate(testWindow);
		const realButton = requireRealButton(testWindow);
		let realClicks = 0;
		realButton.addEventListener("click", () => {
			realClicks += 1;
		});

		realButton.setAttribute("aria-disabled", "true");
		requireMirror(testWindow).click();
		expect(realClicks).toBe(0);

		realButton.removeAttribute("aria-disabled");
		realButton.classList.add("disabled");
		requireMirror(testWindow).click();
		expect(realClicks).toBe(0);

		realButton.classList.remove("disabled");
		requireMirror(testWindow).click();
		expect(realClicks).toBe(1);
		controller.abort();
	});

	test("re-reads the live control before the pointer or keyboard can use it", async () => {
		const testWindow = await openTabBar(`${MERGE_REQUEST_URL}/diffs`);
		const controller = activate(testWindow);
		const mirror = requireMirror(testWindow);
		const realButton = requireRealButton(testWindow);

		/* GitLab patches this label and variant in place, which reaches the shared
		 * observer as `characterData` and `class`, neither of which it carries. */
		const label = realButton.querySelector(".gl-button-text");
		if (label) {
			label.textContent = "Revoke approval";
		}
		realButton.className = "btn gl-button btn-default btn-sm";
		expect(mirror.textContent?.trim()).toBe("Approve");

		mirror.dispatchEvent(
			new testWindow.Event("pointerenter") as unknown as Event,
		);
		expect(mirror.textContent?.trim()).toBe("Revoke approval");
		expect(mirror.classList.contains("btn-default")).toBe(true);
		expect(mirror.classList.contains("btn-confirm")).toBe(false);

		if (label) {
			label.textContent = "Approve additionally";
		}
		mirror.dispatchEvent(new testWindow.Event("focus") as unknown as Event);
		expect(mirror.textContent?.trim()).toBe("Approve additionally");

		realButton.remove();
		mirror.dispatchEvent(
			new testWindow.Event("pointerenter") as unknown as Event,
		);
		expect(mirror.isConnected).toBe(false);
		controller.abort();
	});

	test("stands down when the control carries no usable label", async () => {
		const testWindow = await openTabBar();
		const realButton = requireRealButton(testWindow);
		realButton.textContent = "x".repeat(61);
		const controller = activate(testWindow);

		expect(testWindow.document.querySelector(MIRROR)).toBeNull();
		expect(
			getApproveMergeRequestFromTabsCompatibility(context(testWindow)),
		).toBe("unsupported");
		controller.abort();
	});

	test("forwards to the SAML control, which submits GitLab's own form", async () => {
		const testWindow = await openTabBar();
		const realButton = requireRealButton(testWindow);
		const form = testWindow.document.createElement("form");
		form.setAttribute("data-testid", "approve-form");
		form.setAttribute("action", "/example/project/-/merge_requests/7/approve");
		form.setAttribute("method", "post");
		const submit = testWindow.document.createElement("button");
		submit.setAttribute("data-testid", "approve-button");
		submit.type = "submit";
		submit.className = "btn gl-button btn-confirm btn-sm";
		const text = testWindow.document.createElement("span");
		text.className = "gl-button-text";
		text.textContent = "Approve with SAML";
		submit.append(text);
		form.append(submit);
		realButton.replaceWith(form as unknown as never);
		const controller = activate(testWindow);
		const mirror = requireMirror(testWindow);
		let submitClicks = 0;
		submit.addEventListener("click", () => {
			submitClicks += 1;
		});

		expect(mirror.textContent?.trim()).toBe("Approve with SAML");
		// The mirror stays outside the form and stays type=button, so only the
		// forwarded click can submit it.
		expect(mirror.type).toBe("button");
		expect(mirror.closest("form")).toBeNull();

		mirror.click();
		expect(submitClicks).toBe(1);
		controller.abort();
	});

	test("never carries two size classes when GitLab renders another size", async () => {
		const testWindow = await openTabBar();
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[approveMergeRequestFromTabs],
			controller.signal,
		);
		const mirror = requireMirror(testWindow);

		replaceRealButton(
			testWindow,
			"btn gl-button btn-confirm btn-lg",
			"Approve",
		);
		await settleGitLabDom(testWindow);
		expect(
			[...mirror.classList].filter((name) => /^btn-(sm|md|lg)$/.test(name)),
		).toEqual(["btn-lg"]);

		replaceRealButton(testWindow, "btn gl-button btn-confirm", "Approve");
		await settleGitLabDom(testWindow);
		expect(
			[...mirror.classList].filter((name) => /^btn-(sm|md|lg)$/.test(name)),
		).toEqual(["btn-md"]);
		controller.abort();
	});

	test("repairs foreign edits to the mirrored children", async () => {
		const testWindow = await openTabBar();
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[approveMergeRequestFromTabs],
			controller.signal,
		);
		const mirror = requireMirror(testWindow);

		mirror.replaceChildren();
		await settleGitLabDom(testWindow);

		expect(mirror.textContent?.trim()).toBe("Approve");
		controller.abort();
	});

	test("is idempotent and cleans up every owned mark on abort", async () => {
		const testWindow = await openTabBar();
		const controller = activate(testWindow);

		approveMergeRequestFromTabs.activate(
			context(testWindow),
			controller.signal,
		);
		approveMergeRequestFromTabs.reconcile?.(
			context(testWindow),
			controller.signal,
		);
		expect(testWindow.document.querySelectorAll(MIRROR)).toHaveLength(1);

		const mirror = requireMirror(testWindow);
		controller.abort();

		expect(testWindow.document.querySelector(MIRROR)).toBeNull();
		expect(mirror.isConnected).toBe(false);
		expect(mirror.hasAttribute(APPROVE_MERGE_REQUEST_FROM_TABS_ATTRIBUTE)).toBe(
			false,
		);
	});

	test("mounts after hydration and reconciles a replaced tab bar root", async () => {
		const markup = await readMergeRequestTabBarFixture("19");
		const testWindow = createGitLabTestWindow(
			"<div></div>",
			MERGE_REQUEST_URL,
			"projects:merge_requests:show",
		);
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[approveMergeRequestFromTabs],
			controller.signal,
		);
		expect(testWindow.document.querySelector(MIRROR)).toBeNull();

		testWindow.document.body.insertAdjacentHTML("beforeend", markup);
		await settleGitLabDom(testWindow);
		const firstMirror = requireMirror(testWindow);

		const replacement = testWindow.document.createElement("div");
		replacement.innerHTML = markup;
		const currentWrapper = testWindow.document.querySelector(
			".merge-request-sticky-header-wrapper",
		);
		const replacementWrapper = replacement.firstElementChild;

		if (currentWrapper && replacementWrapper) {
			currentWrapper.replaceWith(replacementWrapper);
		}
		await settleGitLabDom(testWindow);

		expect(testWindow.document.querySelectorAll(MIRROR)).toHaveLength(1);
		expect(requireMirror(testWindow)).toBe(firstMirror);
		expect(
			firstMirror.parentElement?.matches(MERGE_REQUEST_TABS_CONTAINER_SELECTOR),
		).toBe(true);
		controller.abort();
	});

	test("repairs placement when GitLab moves the mirrored button", async () => {
		const testWindow = await openTabBar();
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[approveMergeRequestFromTabs],
			controller.signal,
		);
		const mirror = requireMirror(testWindow);
		const container = testWindow.document.querySelector(
			MERGE_REQUEST_TABS_CONTAINER_SELECTOR,
		);
		const actions = testWindow.document.querySelector(
			MERGE_REQUEST_TABS_ACTIONS_SELECTOR,
		);

		container?.prepend(mirror as unknown as never);
		await settleGitLabDom(testWindow);

		expect(
			(requireMirror(testWindow).nextElementSibling as unknown) ===
				(actions as unknown),
		).toBe(true);
		controller.abort();
	});

	test("removes the mirrored button when GitLab renders no approve control", async () => {
		const testWindow = await openTabBar();
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[approveMergeRequestFromTabs],
			controller.signal,
		);
		expect(testWindow.document.querySelector(MIRROR)).not.toBeNull();

		requireRealButton(testWindow).remove();
		await settleGitLabDom(testWindow);

		expect(testWindow.document.querySelector(MIRROR)).toBeNull();
		expect(
			getApproveMergeRequestFromTabsCompatibility(context(testWindow)),
		).toBe("not-applicable");
		controller.abort();
	});

	test("stays absent on a cold load that carries no approvals widget", async () => {
		const markup = await readMergeRequestTabBarFixture("19");
		const testWindow = createGitLabTestWindow(
			markup,
			`${MERGE_REQUEST_URL}/diffs`,
			"projects:merge_requests:show",
		);
		testWindow.document
			.querySelector(MERGE_REQUEST_APPROVALS_SELECTOR)
			?.remove();
		const controller = activate(testWindow);

		expect(testWindow.document.querySelector(MIRROR)).toBeNull();
		expect(
			getApproveMergeRequestFromTabsCompatibility(context(testWindow)),
		).toBe("not-applicable");
		controller.abort();
	});

	test("missing and ambiguous anchors are safe no-ops", async () => {
		const cases: Array<(testWindow: HappyDOMWindow) => void> = [
			(testWindow) => {
				testWindow.document
					.querySelector(MERGE_REQUEST_TABS_CONTAINER_SELECTOR)
					?.remove();
			},
			(testWindow) => {
				testWindow.document
					.querySelector(MERGE_REQUEST_TABS_ACTIONS_SELECTOR)
					?.remove();
			},
			(testWindow) => {
				const container = testWindow.document.querySelector(
					MERGE_REQUEST_TABS_CONTAINER_SELECTOR,
				);
				container?.parentElement?.append(container.cloneNode(true));
			},
			(testWindow) => {
				const actions = testWindow.document.querySelector(
					MERGE_REQUEST_TABS_ACTIONS_SELECTOR,
				);
				actions?.parentElement?.append(actions.cloneNode(true));
			},
			(testWindow) => {
				const approvals = testWindow.document.querySelector(
					MERGE_REQUEST_APPROVALS_SELECTOR,
				);
				approvals?.parentElement?.append(approvals.cloneNode(true));
			},
		];

		for (const breakContract of cases) {
			const testWindow = await openTabBar();
			breakContract(testWindow);
			const controller = activate(testWindow);

			expect(testWindow.document.querySelector(MIRROR)).toBeNull();
			expect(
				getApproveMergeRequestFromTabsCompatibility(context(testWindow)),
			).toBe("unsupported");
			controller.abort();
		}
	});

	test("does not adopt or remove a foreign owned marker", async () => {
		const testWindow = await openTabBar();
		const foreign = testWindow.document.createElement("button");
		foreign.setAttribute(APPROVE_MERGE_REQUEST_FROM_TABS_ATTRIBUTE, "");
		foreign.textContent = "Foreign";
		testWindow.document.body.append(foreign);
		const controller = activate(testWindow);

		expect(testWindow.document.querySelectorAll(MIRROR)).toHaveLength(1);
		expect(foreign.textContent).toBe("Foreign");
		expect(
			getApproveMergeRequestFromTabsCompatibility(context(testWindow)),
		).toBe("unsupported");
		controller.abort();
		expect(foreign.isConnected).toBe(true);
	});

	test("adds no attribute to the runtime's shared observer", () => {
		expect(approveMergeRequestFromTabs.observedAttributes).toBeUndefined();
	});
});
