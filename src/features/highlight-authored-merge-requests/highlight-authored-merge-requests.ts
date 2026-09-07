import type {
	Feature,
	FeatureContext,
	FeaturePageCompatibility,
} from "../../content/runtime/feature-context";
import {
	CURRENT_USER_TOGGLE_SELECTOR,
	MERGE_REQUEST_AUTHOR_USERNAME_ATTRIBUTE,
	MERGE_REQUEST_LIST_ROOT_SELECTOR,
	resolveCurrentUsername,
	resolveMergeRequestListContract,
} from "../../content/runtime/merge-request-list";
import { createOwnedAttributeRegistry } from "../../content/runtime/owned-attributes";
import { isMergeRequestListPath } from "../../content/runtime/page-context";
import { AUTHORED_ROW_ATTRIBUTE, FEATURE_ROOT_ATTRIBUTE } from "./selectors";

export const HIGHLIGHT_AUTHORED_MERGE_REQUESTS_ID =
	"highlight-authored-merge-requests";

const ownedAttributes = createOwnedAttributeRegistry();

export function getHighlightAuthoredMergeRequestsCompatibility(
	context: FeatureContext,
): FeaturePageCompatibility {
	const contract = resolveMergeRequestListContract(context);

	if (contract.status !== "supported") {
		return contract.status;
	}

	return contract.surface !== "dashboard" &&
		contract.rows.every(({ authorUsername }) => authorUsername !== undefined)
		? "supported"
		: "unsupported";
}

function reconcileAuthoredRows(
	context: FeatureContext,
	signal: AbortSignal,
): void {
	if (signal.aborted) {
		return;
	}

	const ownedState = ownedAttributes.forSignal(signal);
	const currentUsername = resolveCurrentUsername(context);
	const contract = resolveMergeRequestListContract(context);

	if (
		!currentUsername ||
		contract.status !== "supported" ||
		contract.surface === "dashboard" ||
		contract.rows.some(({ authorUsername }) => authorUsername === undefined)
	) {
		ownedState.clear();
		return;
	}

	const { root, rows } = contract;
	ownedState.retain([root, ...rows.map(({ element }) => element)]);
	ownedState.set(root, FEATURE_ROOT_ATTRIBUTE, true);

	for (const row of rows) {
		ownedState.set(
			row.element,
			AUTHORED_ROW_ATTRIBUTE,
			row.authorUsername === currentUsername,
		);
	}
}

export const highlightAuthoredMergeRequests: Feature = {
	id: HIGHLIGHT_AUTHORED_MERGE_REQUESTS_ID,
	observedAttributes: [MERGE_REQUEST_AUTHOR_USERNAME_ATTRIBUTE, "href"],
	mutationSelectors: [
		MERGE_REQUEST_LIST_ROOT_SELECTOR,
		CURRENT_USER_TOGGLE_SELECTOR,
	],
	/*
	 * The page, not the DOM. Reconciliation already handles a missing list root
	 * by clearing everything it owns, so checking for the root here only queried
	 * it a second time per pass and made activation flap: when GitLab swapped
	 * `main#content-body` out and back in, `matches` went false then true, which
	 * aborted the activation and discarded the owned-attribute registry the
	 * feature then had to rebuild.
	 */
	matches({ location }) {
		return isMergeRequestListPath(location.pathname);
	},
	activate(context, signal) {
		reconcileAuthoredRows(context, signal);
	},
	reconcile(context, signal) {
		reconcileAuthoredRows(context, signal);
	},
};
