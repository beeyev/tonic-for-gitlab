import { afterEach, describe, expect, test } from "bun:test";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readDuoAgentPlatformFixture,
	SUPPORTED_GITLAB_MAJORS,
	settleGitLabDom,
} from "../../../tests/helpers/gitlab-dom";
import { createFeatureContext } from "../../content/runtime/feature-context";
import { activateFeatureRuntime } from "../../content/runtime/feature-lifecycle";
import {
	getHideDuoAgentPlatformEntrypointCompatibility,
	hideDuoAgentPlatformEntrypoint,
} from "./hide-duo-agent-platform-entrypoint";
import {
	AI_PANELS_SELECTOR,
	DUO_DISABLED_TOGGLE_SELECTOR,
	HIDDEN_ENTRYPOINT_ATTRIBUTE,
	HIDDEN_RAIL_ATTRIBUTE,
} from "./selectors";

afterEach(() => {
	closeGitLabTestWindows();
});

function getContractElements(testWindow: Window): {
	entrypoint: HTMLElement;
	navigation: HTMLElement;
	rail: HTMLElement;
} {
	const entrypoint = testWindow.document.querySelector(
		DUO_DISABLED_TOGGLE_SELECTOR,
	) as HTMLElement;

	return {
		entrypoint,
		navigation: entrypoint.closest("nav") as HTMLElement,
		rail: entrypoint.closest(AI_PANELS_SELECTOR) as HTMLElement,
	};
}

describe("hide-duo-agent-platform-entrypoint", () => {
	test.each([...SUPPORTED_GITLAB_MAJORS])(
		"marks the whole GitLab %s rail when Duo is its only control",
		async (version) => {
			const testWindow = createGitLabTestWindow(
				await readDuoAgentPlatformFixture(version),
			);
			const controller = new AbortController();
			const context = createFeatureContext(asBrowserWindow(testWindow));

			expect(getHideDuoAgentPlatformEntrypointCompatibility(context)).toBe(
				"supported",
			);
			hideDuoAgentPlatformEntrypoint.activate(context, controller.signal);

			const { entrypoint, rail } = getContractElements(
				asBrowserWindow(testWindow),
			);
			expect(rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(true);
			expect(entrypoint.hasAttribute(HIDDEN_ENTRYPOINT_ATTRIBUTE)).toBe(false);
		},
	);

	test.each([
		[
			"known",
			'<button type="button" data-testid="ai-chat-toggle">Chat</button>',
		],
		["unknown", '<a href="/future-ai-surface">Future action</a>'],
	] as const)(
		"hides only the Duo entrypoint beside another %s interactive control",
		async (_kind, control) => {
			const testWindow = createGitLabTestWindow(
				await readDuoAgentPlatformFixture("19"),
			);
			const { navigation } = getContractElements(asBrowserWindow(testWindow));
			navigation.insertAdjacentHTML("beforeend", control);
			const controller = new AbortController();

			hideDuoAgentPlatformEntrypoint.activate(
				createFeatureContext(asBrowserWindow(testWindow)),
				controller.signal,
			);

			const { entrypoint, rail } = getContractElements(
				asBrowserWindow(testWindow),
			);
			expect(entrypoint.hasAttribute(HIDDEN_ENTRYPOINT_ATTRIBUTE)).toBe(true);
			expect(rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(false);
		},
	);

	test("is a safe no-op when the Duo target contains another interactive control", async () => {
		const testWindow = createGitLabTestWindow(
			await readDuoAgentPlatformFixture("19"),
		);
		const { entrypoint } = getContractElements(asBrowserWindow(testWindow));
		entrypoint.insertAdjacentHTML(
			"beforeend",
			'<a href="/future-ai-surface">Future action</a>',
		);
		const controller = new AbortController();
		const context = createFeatureContext(asBrowserWindow(testWindow));

		expect(getHideDuoAgentPlatformEntrypointCompatibility(context)).toBe(
			"unsupported",
		);
		hideDuoAgentPlatformEntrypoint.activate(context, controller.signal);

		const { rail } = getContractElements(asBrowserWindow(testWindow));
		expect(entrypoint.hasAttribute(HIDDEN_ENTRYPOINT_ATTRIBUTE)).toBe(false);
		expect(rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(false);
	});

	test("hides only the Duo entrypoint when the rail has another action outside navigation", async () => {
		const testWindow = createGitLabTestWindow(
			await readDuoAgentPlatformFixture("19"),
		);
		const { navigation } = getContractElements(asBrowserWindow(testWindow));
		navigation.insertAdjacentHTML(
			"beforebegin",
			'<div role="dialog"><button type="button">Close panel</button></div>',
		);
		const controller = new AbortController();

		hideDuoAgentPlatformEntrypoint.activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);

		const { entrypoint, rail } = getContractElements(
			asBrowserWindow(testWindow),
		);
		expect(rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(false);
		expect(entrypoint.hasAttribute(HIDDEN_ENTRYPOINT_ATTRIBUTE)).toBe(true);
	});

	test("does not treat focus wrappers, disabled editing, or hidden inputs as rail controls", async () => {
		const testWindow = createGitLabTestWindow(
			await readDuoAgentPlatformFixture("19"),
		);
		const { navigation } = getContractElements(asBrowserWindow(testWindow));
		navigation.insertAdjacentHTML(
			"beforeend",
			'<div tabindex="-1"></div><div contenteditable="false"></div><input type="hidden">',
		);
		const controller = new AbortController();

		hideDuoAgentPlatformEntrypoint.activate(
			createFeatureContext(asBrowserWindow(testWindow)),
			controller.signal,
		);

		const { entrypoint, rail } = getContractElements(
			asBrowserWindow(testWindow),
		);
		expect(rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(true);
		expect(entrypoint.hasAttribute(HIDDEN_ENTRYPOINT_ATTRIBUTE)).toBe(false);
	});

	test.each([
		[
			"duplicate target",
			(document: Document) => {
				const target = document.querySelector(DUO_DISABLED_TOGGLE_SELECTOR);
				target?.after(target.cloneNode(true));
			},
		],
		[
			"target outside the outer rail",
			(document: Document) => {
				const target = document.querySelector(DUO_DISABLED_TOGGLE_SELECTOR);
				document.body.append(target as Node);
			},
		],
		[
			"target outside semantic navigation",
			(document: Document) => {
				const target = document.querySelector(DUO_DISABLED_TOGGLE_SELECTOR);
				document.querySelector(AI_PANELS_SELECTOR)?.append(target as Node);
			},
		],
		[
			"non-interactive target",
			(document: Document) => {
				const target = document.querySelector(DUO_DISABLED_TOGGLE_SELECTOR);
				const replacement = document.createElement("span");
				replacement.setAttribute("data-testid", "duo-disabled-toggle");
				target?.replaceWith(replacement);
			},
		],
	] as const)("is a safe no-op for a %s contract", async (_name, change) => {
		const testWindow = createGitLabTestWindow(
			await readDuoAgentPlatformFixture("19"),
		);
		change(asBrowserWindow(testWindow).document);
		const controller = new AbortController();
		const context = createFeatureContext(asBrowserWindow(testWindow));

		expect(getHideDuoAgentPlatformEntrypointCompatibility(context)).toBe(
			"unsupported",
		);
		hideDuoAgentPlatformEntrypoint.activate(context, controller.signal);

		expect(
			testWindow.document.querySelector(`[${HIDDEN_ENTRYPOINT_ATTRIBUTE}]`),
		).toBeNull();
		expect(
			testWindow.document.querySelector(`[${HIDDEN_RAIL_ATTRIBUTE}]`),
		).toBeNull();
	});

	test.each([
		[
			"AI rail is absent",
			(document: Document) => {
				document.querySelector(AI_PANELS_SELECTOR)?.remove();
			},
		],
		[
			"AI rail is waiting for Vue to mount",
			(document: Document) => {
				document.querySelector(DUO_DISABLED_TOGGLE_SELECTOR)?.remove();
			},
		],
		[
			"available Duo renders its normal control",
			(document: Document) => {
				document
					.querySelector(DUO_DISABLED_TOGGLE_SELECTOR)
					?.setAttribute("data-testid", "ai-chat-toggle");
			},
		],
	] as const)("is not applicable when the %s", async (_name, change) => {
		const testWindow = createGitLabTestWindow(
			await readDuoAgentPlatformFixture("19"),
		);
		change(asBrowserWindow(testWindow).document);
		const context = createFeatureContext(asBrowserWindow(testWindow));

		expect(getHideDuoAgentPlatformEntrypointCompatibility(context)).toBe(
			"not-applicable",
		);
	});

	/*
	 * Not a claim that GitLab nests rails. The page is untrusted and its own
	 * script can render an element carrying the same test ID, so the contract
	 * resolves the rail the entrypoint actually sits in rather than the
	 * outermost match, and hides only that one.
	 */
	test("marks only the nearest rail when an outer element carries the same test ID", async () => {
		const testWindow = createGitLabTestWindow(
			await readDuoAgentPlatformFixture("19"),
		);
		const document = asBrowserWindow(testWindow).document;
		const { rail } = getContractElements(asBrowserWindow(testWindow));
		const outerRail = document.createElement("div");
		outerRail.setAttribute("data-testid", "ai-panels");
		rail.before(outerRail);
		outerRail.append(rail);
		const controller = new AbortController();
		const context = createFeatureContext(asBrowserWindow(testWindow));

		// The predecessor of this test built its outer element from a selector
		// that was later removed, which left it matching nothing and passing
		// without testing anything. Prove the decoy is a real candidate first.
		expect(outerRail.matches(AI_PANELS_SELECTOR)).toBe(true);
		expect(getHideDuoAgentPlatformEntrypointCompatibility(context)).toBe(
			"supported",
		);
		hideDuoAgentPlatformEntrypoint.activate(context, controller.signal);

		expect(rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(true);
		expect(outerRail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(false);
	});

	test("activation is idempotent and abort restores attached and detached state", async () => {
		const testWindow = createGitLabTestWindow(
			await readDuoAgentPlatformFixture("19"),
		);
		const controller = new AbortController();
		const context = createFeatureContext(asBrowserWindow(testWindow));

		hideDuoAgentPlatformEntrypoint.activate(context, controller.signal);
		hideDuoAgentPlatformEntrypoint.activate(context, controller.signal);

		const { rail } = getContractElements(asBrowserWindow(testWindow));
		expect(
			testWindow.document.querySelectorAll(`[${HIDDEN_RAIL_ATTRIBUTE}]`),
		).toHaveLength(1);

		rail.remove();
		controller.abort();

		expect(rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(false);
	});

	test("clears a prior marker when the contract becomes ambiguous", async () => {
		const testWindow = createGitLabTestWindow(
			await readDuoAgentPlatformFixture("19"),
		);
		const controller = new AbortController();
		const context = createFeatureContext(asBrowserWindow(testWindow));
		hideDuoAgentPlatformEntrypoint.activate(context, controller.signal);
		const { entrypoint, rail } = getContractElements(
			asBrowserWindow(testWindow),
		);

		entrypoint.after(entrypoint.cloneNode(true));
		hideDuoAgentPlatformEntrypoint.reconcile?.(context, controller.signal);

		expect(rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(false);
		expect(
			testWindow.document.querySelector(`[${HIDDEN_ENTRYPOINT_ATTRIBUTE}]`),
		).toBeNull();
	});

	test("runtime reconciles replacement and newly added controls", async () => {
		const testWindow = createGitLabTestWindow(
			await readDuoAgentPlatformFixture("19"),
		);
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[hideDuoAgentPlatformEntrypoint],
			controller.signal,
		);
		const original = getContractElements(asBrowserWindow(testWindow));

		const replacement = original.rail.cloneNode(true) as HTMLElement;
		replacement.removeAttribute(HIDDEN_RAIL_ATTRIBUTE);
		original.rail.replaceWith(replacement);
		await settleGitLabDom(testWindow);

		expect(original.rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(false);
		expect(replacement.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(true);

		replacement
			.querySelector("nav")
			?.insertAdjacentHTML(
				"beforeend",
				'<button type="button" data-testid="future-ai-action">Future</button>',
			);
		await settleGitLabDom(testWindow);

		expect(replacement.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(false);
		expect(
			replacement
				.querySelector(DUO_DISABLED_TOGGLE_SELECTOR)
				?.hasAttribute(HIDDEN_ENTRYPOINT_ATTRIBUTE),
		).toBe(true);
	});

	test("runtime activates when Vue mounts the unavailable entrypoint late", async () => {
		const testWindow = createGitLabTestWindow(
			await readDuoAgentPlatformFixture("19"),
		);
		const { entrypoint, navigation, rail } = getContractElements(
			asBrowserWindow(testWindow),
		);
		entrypoint.remove();
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[hideDuoAgentPlatformEntrypoint],
			controller.signal,
		);

		expect(rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(false);
		navigation.append(entrypoint);
		await settleGitLabDom(testWindow);

		expect(rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(true);
	});

	test("runtime preserves the rail when an existing link becomes actionable", async () => {
		const testWindow = createGitLabTestWindow(
			await readDuoAgentPlatformFixture("19"),
		);
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[hideDuoAgentPlatformEntrypoint],
			controller.signal,
		);
		const { navigation, entrypoint, rail } = getContractElements(
			asBrowserWindow(testWindow),
		);
		const futureAction =
			asBrowserWindow(testWindow).document.createElement("a");
		navigation.append(futureAction);
		await settleGitLabDom(testWindow);

		expect(rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(true);
		futureAction.setAttribute("href", "/future-ai-surface");
		await settleGitLabDom(testWindow);

		expect(rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(false);
		expect(entrypoint.hasAttribute(HIDDEN_ENTRYPOINT_ATTRIBUTE)).toBe(true);
	});

	test("runtime clears owned state when Vue removes the unavailable entrypoint", async () => {
		const testWindow = createGitLabTestWindow(
			await readDuoAgentPlatformFixture("19"),
		);
		const controller = new AbortController();
		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[hideDuoAgentPlatformEntrypoint],
			controller.signal,
		);
		const { entrypoint, rail } = getContractElements(
			asBrowserWindow(testWindow),
		);
		expect(rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(true);

		entrypoint.remove();
		await settleGitLabDom(testWindow);

		expect(rail.hasAttribute(HIDDEN_RAIL_ATTRIBUTE)).toBe(false);
		expect(entrypoint.hasAttribute(HIDDEN_ENTRYPOINT_ATTRIBUTE)).toBe(false);
		expect(
			getHideDuoAgentPlatformEntrypointCompatibility(
				createFeatureContext(asBrowserWindow(testWindow)),
			),
		).toBe("not-applicable");
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
			"features/hide-duo-agent-platform-entrypoint/styles.css",
		);
	});

	test("observes only contract-changing attributes", () => {
		expect(hideDuoAgentPlatformEntrypoint.observedAttributes).toEqual(["href"]);
	});
});
