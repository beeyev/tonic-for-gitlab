import type { ControlSurfaceUnavailableReason } from "../../control-surface/status-protocol";

/** The subset of unavailable reasons that anchor resolution can produce. */
type TopBarAnchorUnavailableReason = Extract<
	ControlSurfaceUnavailableReason,
	"missing-anchor" | "ambiguous-anchor" | "unsupported-structure"
>;

export const TOP_BAR_SELECTOR = "header.js-super-topbar";
export const TOP_BAR_SEARCH_SELECTOR =
	'[data-testid="super-topbar-search-button-xs"]';

const USER_MENU_SELECTOR = '[data-testid="user-menu-toggle"]';
const SIGNED_OUT_CONTROL_SELECTOR = [
	'[data-testid="topbar-signup-button"]',
	'[data-testid="topbar-signin-button"]',
].join(",");
export const TOP_BAR_ACCOUNT_CONTROL_SELECTOR = [
	USER_MENU_SELECTOR,
	SIGNED_OUT_CONTROL_SELECTOR,
].join(",");

export type TopBarAnchorResolution =
	| {
			status: "available";
			parent: Element;
			before: Element | null;
	  }
	| {
			status: "unavailable";
			reason: TopBarAnchorUnavailableReason;
	  };

function containsSelector(element: Element, selector: string): boolean {
	return element.matches(selector) || element.querySelector(selector) !== null;
}

export function resolveTopBarAnchor(
	document: Document,
): TopBarAnchorResolution {
	const topBars = document.querySelectorAll(TOP_BAR_SELECTOR);
	const searchButtons = document.querySelectorAll(TOP_BAR_SEARCH_SELECTOR);

	if (topBars.length === 0 || searchButtons.length === 0) {
		return { status: "unavailable", reason: "missing-anchor" };
	}

	if (topBars.length !== 1 || searchButtons.length !== 1) {
		return { status: "unavailable", reason: "ambiguous-anchor" };
	}

	const topBar = topBars[0];
	const searchButton = searchButtons[0];

	if (!topBar.contains(searchButton)) {
		return { status: "unavailable", reason: "unsupported-structure" };
	}

	let actionCluster: Element = searchButton;

	while (
		actionCluster.parentElement &&
		actionCluster.parentElement !== topBar
	) {
		actionCluster = actionCluster.parentElement;
	}

	if (
		actionCluster === searchButton ||
		actionCluster.parentElement !== topBar
	) {
		return { status: "unavailable", reason: "unsupported-structure" };
	}

	const children = [...actionCluster.children];
	const userMenuChild = children.find((child) =>
		containsSelector(child, USER_MENU_SELECTOR),
	);
	const signedOutControlChild = children.find((child) =>
		containsSelector(child, SIGNED_OUT_CONTROL_SELECTOR),
	);

	return {
		status: "available",
		parent: actionCluster,
		before: userMenuChild ?? signedOutControlChild ?? null,
	};
}
