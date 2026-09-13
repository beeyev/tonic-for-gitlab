import type {
	Feature,
	FeatureContext,
	FeaturePageCompatibility,
} from "../../content/runtime/feature-context";
import { createOwnedAttributeRegistry } from "../../content/runtime/owned-attributes";
import { isRepositoryFilePath } from "../../content/runtime/page-context";
import {
	EXTERNAL_LINK_SELECTOR,
	FEEDBACK_ICON_SELECTOR,
	FILE_TREE_BROWSER_SELECTOR,
	HIDDEN_FEEDBACK_LINK_ATTRIBUTE,
	PANEL_SIBLING_FEEDBACK_LINK_SELECTOR,
} from "./selectors";

export const HIDE_FILE_TREE_BROWSER_FEEDBACK_BUTTON_ID =
	"hide-file-tree-browser-feedback-button";

type FeedbackLinkResolution =
	| { status: "not-applicable" | "unsupported" }
	| { status: "supported"; link: HTMLAnchorElement };

const ownedAttributes = createOwnedAttributeRegistry();

/**
 * GitLab moved this link and then removed it inside the supported range: 19.0
 * renders it as the panel's last child, 19.1 as a fixed-position sibling of the
 * panel, and 19.2 dropped it. Searching from the panel's parent covers both
 * placements with one query, and an absent link is the ordinary state from 19.2
 * on rather than a broken contract.
 */
function resolveFeedbackLink(document: Document): FeedbackLinkResolution {
	const HTMLAnchorElementConstructor = document.defaultView?.HTMLAnchorElement;
	const panels = document.querySelectorAll(FILE_TREE_BROWSER_SELECTOR);
	const [panel] = panels;

	if (panels.length === 0) {
		return { status: "not-applicable" };
	}

	if (panels.length !== 1 || !panel || !HTMLAnchorElementConstructor) {
		return { status: "unsupported" };
	}

	const scope = panel.parentElement ?? panel;
	const links = [...scope.querySelectorAll(EXTERNAL_LINK_SELECTOR)].filter(
		(link) => link.querySelector(FEEDBACK_ICON_SELECTOR) !== null,
	);
	const [link] = links;

	if (links.length === 0) {
		return { status: "not-applicable" };
	}

	if (links.length !== 1 || !(link instanceof HTMLAnchorElementConstructor)) {
		return { status: "unsupported" };
	}

	return { status: "supported", link };
}

export function getHideFileTreeBrowserFeedbackButtonCompatibility(
	context: FeatureContext,
): FeaturePageCompatibility {
	/*
	 * The path gate belongs here as much as in `matches`, or the panel would
	 * describe a page this feature never runs on: reporting `unsupported` for an
	 * ambiguous contract the feature is path-excluded from blames the file tree
	 * browser for an inactivity the user cannot act on.
	 */
	if (!isRepositoryFilePath(context.location.pathname)) {
		return "not-applicable";
	}

	return resolveFeedbackLink(context.document).status;
}

function reconcileFeedbackLink(
	context: FeatureContext,
	signal: AbortSignal,
): void {
	if (signal.aborted) {
		return;
	}

	const ownedState = ownedAttributes.forSignal(signal);
	const resolution = resolveFeedbackLink(context.document);

	if (resolution.status !== "supported") {
		ownedState.clear();
		return;
	}

	ownedState.retain([resolution.link]);
	ownedState.set(resolution.link, HIDDEN_FEEDBACK_LINK_ATTRIBUTE, true);
}

export const hideFileTreeBrowserFeedbackButton: Feature = {
	id: HIDE_FILE_TREE_BROWSER_FEEDBACK_BUTTON_ID,
	/*
	 * The panel covers the mount, where Vue replaces the server-rendered
	 * `#js-file-browser` element with the whole browser in one child-list
	 * mutation, and the owned attribute covers every later change to a link this
	 * feature already hid. Neither can see the 19.1 placement appear on its own:
	 * a link added beside the panel reports its mutation against the shared
	 * parent, which is an ancestor of the panel rather than a descendant, so the
	 * runtime's ancestor walk from the panel cannot reach it. The sibling
	 * selector is the third anchor, and it matches that added anchor directly.
	 */
	mutationSelectors: [
		FILE_TREE_BROWSER_SELECTOR,
		PANEL_SIBLING_FEEDBACK_LINK_SELECTOR,
		`[${HIDDEN_FEEDBACK_LINK_ATTRIBUTE}]`,
	],
	matches: ({ location }) => isRepositoryFilePath(location.pathname),
	activate(context, signal) {
		reconcileFeedbackLink(context, signal);
	},
	reconcile(context, signal) {
		reconcileFeedbackLink(context, signal);
	},
};
