import type {
	Feature,
	FeatureContext,
	FeaturePageCompatibility,
} from "../../content/runtime/feature-context";
import {
	MERGE_REQUEST_LIST_ROOT_SELECTOR,
	MERGE_REQUEST_TITLE_ATTRIBUTE,
	resolveMergeRequestListContract,
} from "../../content/runtime/merge-request-list";
import { createOwnedAttributeRegistry } from "../../content/runtime/owned-attributes";
import { isMergeRequestListPath } from "../../content/runtime/page-context";
import { DRAFT_ROW_ATTRIBUTE, FEATURE_ROOT_ATTRIBUTE } from "./selectors";

export const DIM_DRAFT_MERGE_REQUESTS_ID = "dim-draft-merge-requests";

const DRAFT_TITLE_PREFIX = /^(?:draft:|\[draft\]|\(draft\))/i;
const ownedAttributes = createOwnedAttributeRegistry();

export function getDimDraftMergeRequestsCompatibility(
	context: FeatureContext,
): FeaturePageCompatibility {
	const contract = resolveMergeRequestListContract(context);

	if (contract.status !== "supported") {
		return contract.status;
	}

	return contract.surface !== "dashboard" &&
		contract.rows.every(({ title }) => title !== undefined)
		? "supported"
		: "unsupported";
}

function reconcileDraftRows(
	context: FeatureContext,
	signal: AbortSignal,
): void {
	if (signal.aborted) {
		return;
	}

	const ownedState = ownedAttributes.forSignal(signal);
	const contract = resolveMergeRequestListContract(context);

	if (
		contract.status !== "supported" ||
		contract.surface === "dashboard" ||
		contract.rows.some(({ title }) => title === undefined)
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
			DRAFT_ROW_ATTRIBUTE,
			DRAFT_TITLE_PREFIX.test(row.title as string),
		);
	}
}

export const dimDraftMergeRequests: Feature = {
	id: DIM_DRAFT_MERGE_REQUESTS_ID,
	observedAttributes: [MERGE_REQUEST_TITLE_ATTRIBUTE],
	mutationSelectors: [MERGE_REQUEST_LIST_ROOT_SELECTOR],
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
		reconcileDraftRows(context, signal);
	},
	reconcile(context, signal) {
		reconcileDraftRows(context, signal);
	},
};
