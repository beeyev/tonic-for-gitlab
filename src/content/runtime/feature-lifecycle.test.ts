import { afterEach, describe, expect, test } from "bun:test";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readMergeRequestListFixture,
	settleGitLabDom,
} from "../../../tests/helpers/gitlab-dom";
import { dimDraftMergeRequests } from "../../features/dim-draft-merge-requests/dim-draft-merge-requests";
import { DRAFT_ROW_ATTRIBUTE } from "../../features/dim-draft-merge-requests/selectors";
import type { Feature } from "./feature-context";
import { activateFeatureRuntime } from "./feature-lifecycle";

afterEach(() => {
	closeGitLabTestWindows();
});

describe("feature lifecycle", () => {
	/*
	 * The case the original filter missed. GitLab appends toasts, modals,
	 * tooltips, and Vue portals straight to `document.body`, so every one of
	 * those childList records has `target === document.body`. Asking whether the
	 * target's subtree *contains* anything owned is always true for a target that
	 * near the root, which admitted essentially every mutation on a real page.
	 */
	test("ignores a node appended to the body outside every declared selector", async () => {
		const testWindow = createGitLabTestWindow(
			'<main id="content-body"><span id="owned"></span></main>',
		);
		const controller = new AbortController();
		let reconciliations = 0;
		const feature: Feature = {
			id: "body-append-test",
			mutationSelectors: ["main#content-body"],
			matches: () => true,
			activate: () => {
				reconciliations += 1;
			},
			reconcile: () => {
				reconciliations += 1;
			},
		};

		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[feature],
			controller.signal,
		);
		expect(reconciliations).toBe(1);

		const toast = testWindow.document.createElement("aside");

		toast.className = "gl-toast";
		testWindow.document.body.append(toast);
		await settleGitLabDom(testWindow);

		expect(reconciliations).toBe(1);
		controller.abort();
	});

	/*
	 * A change inside an owned subtree still wakes the feature, which is the half
	 * the ancestor walk is responsible for.
	 */
	test("still reconciles for a change inside a declared selector", async () => {
		const testWindow = createGitLabTestWindow(
			'<main id="content-body"><span id="owned"></span></main>',
		);
		const controller = new AbortController();
		let reconciliations = 0;
		const feature: Feature = {
			id: "owned-subtree-test",
			mutationSelectors: ["main#content-body"],
			matches: () => true,
			activate: () => {
				reconciliations += 1;
			},
			reconcile: () => {
				reconciliations += 1;
			},
		};

		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[feature],
			controller.signal,
		);
		testWindow.document
			.getElementById("owned")
			?.append(testWindow.document.createElement("b"));
		await settleGitLabDom(testWindow);

		expect(reconciliations).toBe(2);
		controller.abort();
	});

	/*
	 * And a container that brings owned content with it still wakes the feature,
	 * which is the half the added-node subtree test is responsible for.
	 */
	test("reconciles when an added container holds a declared selector", async () => {
		const testWindow = createGitLabTestWindow('<div id="shell"></div>');
		const controller = new AbortController();
		let reconciliations = 0;
		const feature: Feature = {
			id: "added-container-test",
			mutationSelectors: ["main#content-body"],
			matches: () => true,
			activate: () => {
				reconciliations += 1;
			},
			reconcile: () => {
				reconciliations += 1;
			},
		};

		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[feature],
			controller.signal,
		);

		const wrapper = testWindow.document.createElement("div");

		wrapper.innerHTML = '<main id="content-body"></main>';
		testWindow.document.getElementById("shell")?.append(wrapper);
		await settleGitLabDom(testWindow);

		expect(reconciliations).toBe(2);
		controller.abort();
	});

	test("ignores mutations outside declared feature selectors", async () => {
		const testWindow = createGitLabTestWindow(
			'<main id="content-body"></main><aside id="unrelated"></aside>',
		);
		const controller = new AbortController();
		let reconciliations = 0;
		const feature: Feature = {
			id: "mutation-filter-test",
			mutationSelectors: ["main#content-body"],
			matches: () => true,
			activate: () => {
				reconciliations += 1;
			},
			reconcile: () => {
				reconciliations += 1;
			},
		};

		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[feature],
			controller.signal,
		);
		testWindow.document
			.getElementById("unrelated")
			?.append(testWindow.document.createElement("span"));
		await settleGitLabDom(testWindow);

		expect(reconciliations).toBe(1);

		testWindow.document
			.getElementById("content-body")
			?.append(testWindow.document.createElement("span"));
		await settleGitLabDom(testWindow);

		expect(reconciliations).toBe(2);
	});

	test("re-evaluates features after same-document navigation", async () => {
		const testWindow = createGitLabTestWindow(
			'<main id="content-body"></main>',
		);
		const controller = new AbortController();
		let activations = 0;
		let aborts = 0;
		const feature: Feature = {
			id: "navigation-test",
			mutationSelectors: ["main#content-body"],
			matches: ({ location }) =>
				location.pathname.endsWith("/-/merge_requests"),
			activate: (_context, signal) => {
				activations += 1;
				signal.addEventListener(
					"abort",
					() => {
						aborts += 1;
					},
					{ once: true },
				);
			},
		};

		activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[feature],
			controller.signal,
		);
		expect(activations).toBe(1);

		testWindow.history.pushState({}, "", "/example/project/-/issues");
		testWindow.dispatchEvent(new testWindow.PopStateEvent("popstate"));
		await settleGitLabDom(testWindow);

		expect(aborts).toBe(1);
	});

	test("immediately reconciles a changed feature setting", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const controller = new AbortController();
		let isEnabled = true;
		const configuredFeature: Feature = {
			...dimDraftMergeRequests,
			matches(context) {
				return isEnabled && dimDraftMergeRequests.matches(context);
			},
		};
		const runtime = activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[configuredFeature],
			controller.signal,
		);

		expect(
			testWindow.document.querySelector(`[${DRAFT_ROW_ATTRIBUTE}]`),
		).not.toBeNull();

		isEnabled = false;
		runtime.reconcile();
		expect(
			testWindow.document.querySelector(`[${DRAFT_ROW_ATTRIBUTE}]`),
		).toBeNull();

		isEnabled = true;
		runtime.reconcile();
		expect(
			testWindow.document.querySelector(`[${DRAFT_ROW_ATTRIBUTE}]`),
		).not.toBeNull();
	});

	test("cancels a scheduled reconciliation before reconciling immediately", () => {
		const testWindow = createGitLabTestWindow(
			'<main id="content-body"></main>',
		);
		const controller = new AbortController();
		const scheduledFrameId = 17 as unknown as ReturnType<
			typeof testWindow.requestAnimationFrame
		>;
		const cancelledFrames: Array<
			ReturnType<typeof testWindow.requestAnimationFrame>
		> = [];
		let scheduledCallback:
			| Parameters<typeof testWindow.requestAnimationFrame>[0]
			| undefined;
		testWindow.requestAnimationFrame = (callback) => {
			scheduledCallback = callback;
			return scheduledFrameId;
		};
		testWindow.cancelAnimationFrame = (frameId) => {
			cancelledFrames.push(frameId);
		};
		const feature: Feature = {
			id: "manual-reconciliation-test",
			mutationSelectors: ["main#content-body"],
			matches: () => true,
			activate: () => {},
			reconcile: () => {},
		};
		const runtime = activateFeatureRuntime(
			asBrowserWindow(testWindow),
			[feature],
			controller.signal,
		);

		testWindow.dispatchEvent(new testWindow.PopStateEvent("popstate"));
		expect(scheduledCallback).toBeDefined();

		runtime.reconcile();

		expect(cancelledFrames).toEqual([scheduledFrameId]);
		controller.abort();
		expect(cancelledFrames).toEqual([scheduledFrameId]);
	});
});

describe("feature isolation", () => {
	/*
	 * GitLab DOM is untrusted input, so a feature can throw. Before this guard
	 * the throw escaped the pass and every later feature was skipped, including
	 * the control panel the user would recover from.
	 */
	test("keeps running later features when one throws", () => {
		const activated: string[] = [];
		const controller = new AbortController();
		const failing: Feature = {
			id: "failing",
			matches: () => true,
			activate() {
				throw new Error("GitLab DOM changed under us");
			},
		};
		const healthy: Feature = {
			id: "healthy",
			matches: () => true,
			activate() {
				activated.push("healthy");
			},
		};

		activateFeatureRuntime(window, [failing, healthy], controller.signal);

		expect(activated).toEqual(["healthy"]);
		controller.abort();
	});

	test("retries a failed feature on the next pass instead of latching it off", () => {
		const controller = new AbortController();
		let attempts = 0;
		const flaky: Feature = {
			id: "flaky",
			matches: () => true,
			activate() {
				attempts++;

				if (attempts === 1) {
					throw new Error("transient");
				}
			},
		};

		const runtime = activateFeatureRuntime(window, [flaky], controller.signal);
		expect(attempts).toBe(1);

		runtime.reconcile();

		expect(attempts).toBe(2);
		controller.abort();
	});
});
