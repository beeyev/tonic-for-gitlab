import type { ControlSurfaceStatus } from "../../control-surface/status-protocol";
import type { TonicSettings } from "../../settings/repository";
import type { Feature, FeatureContext } from "../runtime/feature-context";
import {
	DEFAULT_IN_PAGE_FEATURE_COMPATIBILITY,
	type InPageFeatureCompatibility,
	type SettingChangeHandlers,
} from "./in-page-control-panel";
import {
	IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE,
	mountInPageControlPanel,
} from "./mount-in-page-control-panel";
import {
	resolveTopBarAnchor,
	TOP_BAR_ACCOUNT_CONTROL_SELECTOR,
	TOP_BAR_SEARCH_SELECTOR,
	TOP_BAR_SELECTOR,
} from "./top-bar-anchor";

const IN_PAGE_CONTROL_PANEL_ROOT_SELECTOR = `[${IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE}]`;

/**
 * One layer above every GitLab page-chrome z-index observed on a merge request
 * list (highest is 600, the super sidebar), and far below the 9999 used by
 * GitLab's visually hidden skip link. The popover component mirrors this value
 * as a fallback for a top bar that stops being a flex container.
 */
export const CONTROL_SURFACE_Z_INDEX = "700";

interface MountedControlPanel {
	before: Element | null;
	destroy(): void;
	host: HTMLElement;
	parent: Element;
	updateCompatibility(compatibility: InPageFeatureCompatibility): void;
	updateSettings(settings: TonicSettings): void;
}

function compatibilityIsEqual(
	left: InPageFeatureCompatibility,
	right: InPageFeatureCompatibility,
): boolean {
	return (
		left.confirmMergeRequest === right.confirmMergeRequest &&
		left.copyMergeRequestLink === right.copyMergeRequestLink &&
		left.dimDraftMergeRequests === right.dimDraftMergeRequests &&
		left.filterMyAuthoredMergeRequests ===
			right.filterMyAuthoredMergeRequests &&
		left.hideDuoAgentPlatformEntrypoint ===
			right.hideDuoAgentPlatformEntrypoint &&
		left.hideFileTreeBrowserFeedbackButton ===
			right.hideFileTreeBrowserFeedbackButton &&
		left.highlightAuthoredMergeRequests ===
			right.highlightAuthoredMergeRequests &&
		left.startThreadsByDefault === right.startThreadsByDefault &&
		left.toggleJobLogSections === right.toggleJobLogSections
	);
}

export function createInPageControlPanelFeature(
	initialSettings: TonicSettings,
	handlers: SettingChangeHandlers,
	stylesheet: string,
	getCompatibility: (
		context: FeatureContext,
	) => InPageFeatureCompatibility = () => DEFAULT_IN_PAGE_FEATURE_COMPATIBILITY,
): {
	feature: Feature;
	getStatus(): ControlSurfaceStatus;
	updateSettings(settings: TonicSettings): void;
} {
	let settings = initialSettings;
	let compatibility = DEFAULT_IN_PAGE_FEATURE_COMPATIBILITY;
	let mountedPanel: MountedControlPanel | undefined;
	let status: ControlSurfaceStatus = {
		status: "unavailable",
		reason: "initializing",
	};

	const destroyMountedPanel = () => {
		mountedPanel?.destroy();
		mountedPanel = undefined;
	};

	const deactivate = () => {
		destroyMountedPanel();
		status = { status: "unavailable", reason: "initializing" };
	};

	const reconcile = (context: FeatureContext) => {
		const { document } = context;
		const nextCompatibility = getCompatibility(context);

		if (!compatibilityIsEqual(compatibility, nextCompatibility)) {
			compatibility = nextCompatibility;
			mountedPanel?.updateCompatibility(nextCompatibility);
		}

		const resolution = resolveTopBarAnchor(document);

		if (resolution.status === "unavailable") {
			destroyMountedPanel();
			status = resolution;
			return;
		}

		if (mountedPanel?.host.isConnected) {
			/*
			 * Moving the existing host keeps its shadow root, React root, popover
			 * open state, and focus. Only a host GitLab detached needs a rebuild,
			 * so a re-rendered account control no longer closes an open panel.
			 */
			if (
				mountedPanel.parent !== resolution.parent ||
				mountedPanel.before !== resolution.before
			) {
				resolution.parent.insertBefore(mountedPanel.host, resolution.before);
				mountedPanel.parent = resolution.parent;
				mountedPanel.before = resolution.before;
			}

			status = { status: "mounted" };
			return;
		}

		destroyMountedPanel();
		const host = document.createElement("div");
		host.setAttribute(IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE, "");
		host.setAttribute("data-extension-root", "true");
		host.style.setProperty("all", "initial", "important");
		host.style.setProperty("display", "inline-flex", "important");
		host.style.setProperty("align-items", "center", "important");
		/*
		 * GitLab's top bar creates no stacking context, so the popover otherwise
		 * competes at the root and loses to page chrome: `panel-header-inner` is
		 * z-index 99, and the page also uses 200, 251, 252, 599, and 600 for the
		 * right sidebar, flash container, panel portal, and super sidebar.
		 *
		 * A flex item with a z-index other than `auto` creates a stacking context
		 * even while `position` stays `static`, which lifts the whole shadow tree
		 * in one declaration. `position` must stay static: making the host
		 * positioned turns it into the containing block for the absolutely
		 * positioned popover and throws its coordinates off-screen.
		 */
		host.style.setProperty("z-index", CONTROL_SURFACE_Z_INDEX, "important");
		resolution.parent.insertBefore(host, resolution.before);

		const panel = mountInPageControlPanel(
			host,
			document,
			settings,
			compatibility,
			handlers,
			stylesheet,
		);
		mountedPanel = {
			...panel,
			before: resolution.before,
			host,
			parent: resolution.parent,
		};
		status = { status: "mounted" };
	};

	return {
		feature: {
			id: "in-page-control-panel",
			mutationSelectors: [
				TOP_BAR_SELECTOR,
				TOP_BAR_SEARCH_SELECTOR,
				TOP_BAR_ACCOUNT_CONTROL_SELECTOR,
				IN_PAGE_CONTROL_PANEL_ROOT_SELECTOR,
			],
			matches: () => true,
			activate(context, signal) {
				reconcile(context);
				signal.addEventListener("abort", deactivate, { once: true });
			},
			reconcile,
		},
		getStatus() {
			return status;
		},
		updateSettings(nextSettings) {
			settings = nextSettings;
			mountedPanel?.updateSettings(nextSettings);
		},
	};
}
