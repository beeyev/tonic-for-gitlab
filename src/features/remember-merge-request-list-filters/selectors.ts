import {
	hasMergeRequestFilterBar,
	MERGE_REQUEST_FILTER_BAR_SELECTORS,
	resolveMergeRequestListActionAnchor,
} from "../../content/runtime/merge-request-list-actions";

export const FILTER_BAR_SELECTORS = MERGE_REQUEST_FILTER_BAR_SELECTORS;

/**
 * Candidate links to rewrite.
 *
 * A substring match on the attribute is only a cheap pre-filter; every match is
 * then resolved through `URL` and checked for origin, path, and query before
 * anything is rewritten.
 *
 * It matches roughly one element per row, because every row's title link is a
 * `/-/merge_requests/<iid>` detail path that contains the substring: 24 matches
 * on a 20-row list. Only the path tells those apart from a list, so
 * `resolveListLinkTarget` runs its path check before building any
 * `URLSearchParams` and every row link is rejected there. Narrowing the
 * selector itself was rejected: excluding the detail form needs a pattern the
 * attribute selector cannot express, and the shared runtime already uses this
 * string as the feature's `mutationSelectors` entry, where a broader match only
 * costs the same rejected path check.
 *
 * It intentionally does not match GitLab's state tabs. Those are
 * `<a role="tab" href="#">` on both 18.11.11 and 19.2.4-ee, so there is no URL
 * on them to carry a remembered filter.
 */
export const MERGE_REQUEST_LIST_LINK_SELECTOR = 'a[href*="/-/merge_requests"]';

export function hasFilterBar(document: Document): boolean {
	return hasMergeRequestFilterBar(document);
}

/** Project-owned hooks for the filter status chip. */
export const CHIP_ROOT_ATTRIBUTE = "data-tonic-for-gitlab-list-filter-status";
export const CHIP_STATE_ATTRIBUTE = "data-tonic-for-gitlab-list-filter-state";
export const CHIP_LABEL_ATTRIBUTE = "data-tonic-for-gitlab-list-filter-label";
export const CHIP_ACTION_ATTRIBUTE = "data-tonic-for-gitlab-list-filter-action";

/**
 * Where the chip is placed: immediately after GitLab's filter bar container, as
 * a sibling rather than inside it.
 *
 * Inside would mean joining someone else's flex row and competing with the
 * term input, clear button, search button, and suggestion list that share it.
 * The bar is also a Vue component that rebuilds its own internals - it was
 * observed rebuilding into token-edit state mid-session on GitLab.com - so a
 * position among those children is the least stable one available. A sibling
 * anchored on the outer container survives every internal re-render.
 */
export function resolveFilterStatusAnchor(
	document: Document,
): { parent: Element; before: Element | null } | undefined {
	return resolveMergeRequestListActionAnchor(document, "remembered-filters");
}
