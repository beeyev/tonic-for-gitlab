/**
 * Scope identity and query canonicalization for remembered merge request list
 * filters.
 *
 * Pure functions only: every decision here has to be provable without a DOM, and
 * the persisted data is page-supplied untrusted input that is later re-emitted
 * into an `href`, so parsing and rebuilding go through `URL` and
 * `URLSearchParams` and never through string concatenation.
 */

/** GitLab's issuable state values for merge requests. */
export const MERGE_REQUEST_LIST_STATES = [
	"opened",
	"merged",
	"closed",
	"all",
] as const;

export type MergeRequestListState = (typeof MERGE_REQUEST_LIST_STATES)[number];

/** GitLab's default tab when the URL carries no `state`. */
export const DEFAULT_MERGE_REQUEST_LIST_STATE: MergeRequestListState = "opened";

export interface ListFilterScope {
	/** Normalized pathname with no trailing slash. */
	path: string;
	state: MergeRequestListState;
}

/**
 * Keys GitLab uses for keyset paging and page size, observed live on 18.11.11
 * and 19.2.4-ee: switching a tab or paging rewrites the URL with
 * `first_page_size` and, once paged, `page_after`. Restoring any of them is how
 * upstream produced broken paging, so they are stripped from what is stored and
 * a link carrying one is never rewritten. `page` and `cursor` cover the offset
 * and cursor forms GitLab still emits on older list controllers.
 */
export const PAGING_PARAMS = new Set([
	"cursor",
	"first_page_size",
	"last_page_size",
	"page",
	"page_after",
	"page_before",
]);

/**
 * Parameters that are never part of a remembered filter set.
 *
 * `state` is scope identity, not a filter: Open, Merged, and Closed each
 * remember their own filters.
 *
 * `sort` is deliberately excluded. GitLab already persists the merge request
 * sort server-side per user, and it *saves* whatever sort arrives in the query,
 * so a Tonic-rewritten link carrying `sort=` would silently overwrite the user's
 * global sort preference on every click.
 */
const NON_FILTER_PARAMS = new Set([...PAGING_PARAMS, "sort", "state"]);

/**
 * Merge request list scopes this feature remembers, matched by suffix so a
 * GitLab mounted under a relative URL root still matches.
 *
 * Deliberately narrower than `isMergeRequestListPath`, which also matches
 * `/dashboard/merge_requests`. The dashboard is out of scope for v1 and the two
 * shipped list features still need both forms, so this predicate is separate
 * rather than a change to that one.
 *
 * Ending *at* `/-/merge_requests` is also what excludes a merge request detail
 * path such as `/-/merge_requests/123`.
 */
export function isMergeRequestScopePath(pathname: string): boolean {
	return normalizeScopePath(pathname).endsWith("/-/merge_requests");
}

/**
 * One trailing slash is dropped because GitLab produces both forms for the same
 * list: the server-rendered entry is `/-/merge_requests` and its own
 * same-document navigation rewrites it to `/-/merge_requests/`. Treating those
 * as two scopes would split one list's filters in half.
 */
export function normalizeScopePath(pathname: string): string {
	return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function isMergeRequestListState(
	value: string | null,
): value is MergeRequestListState {
	return (MERGE_REQUEST_LIST_STATES as readonly string[]).includes(value ?? "");
}

/**
 * Resolves the scope state, or `undefined` when the URL names a state this
 * build does not know.
 *
 * An unknown value is refused rather than folded into the default. Folding it
 * would merge an unrelated list into the default tab's filters, and using it
 * verbatim would let a page-supplied string open an unbounded number of stored
 * scopes.
 */
export function readScopeState(
	params: URLSearchParams,
): MergeRequestListState | undefined {
	const state = params.get("state");

	if (state === null) {
		return DEFAULT_MERGE_REQUEST_LIST_STATE;
	}

	return isMergeRequestListState(state) ? state : undefined;
}

export function hasPagingParam(params: URLSearchParams): boolean {
	for (const key of params.keys()) {
		if (PAGING_PARAMS.has(key)) {
			return true;
		}
	}

	return false;
}

/**
 * The filter part of a query, in a stable form that can be compared exactly.
 *
 * Repeated keys are preserved. `label_name[]=a&label_name[]=b` is one filter
 * with two values, and reading each key once collapses it to a single label,
 * which silently changes what the user asked for.
 *
 * Sorting makes "did this actually change" a string comparison, which is what
 * keeps the feature from writing to storage on every reconcile.
 */
export function canonicalizeFilterQuery(search: string): string {
	const entries: [string, string][] = [];

	for (const [key, value] of new URLSearchParams(search)) {
		if (NON_FILTER_PARAMS.has(key)) {
			continue;
		}

		entries.push([key, value]);
	}

	/*
	 * Code-unit ordering, not `localeCompare`: the canonical form is compared
	 * against a value another build may have stored, so it must not depend on
	 * the browser's locale.
	 */
	entries.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
		if (leftKey !== rightKey) {
			return leftKey < rightKey ? -1 : 1;
		}

		if (leftValue === rightValue) {
			return 0;
		}

		return leftValue < rightValue ? -1 : 1;
	});

	const canonical = new URLSearchParams();

	for (const [key, value] of entries) {
		canonical.append(key, value);
	}

	return canonical.toString();
}

/** True only for a string that is already the canonical form of itself. */
export function isCanonicalFilterQuery(value: string): boolean {
	return canonicalizeFilterQuery(value) === value;
}

/**
 * The scope a URL addresses, or `undefined` when it is not a remembered merge
 * request list at all.
 */
export function readListScope(
	pathname: string,
	search: string,
): ListFilterScope | undefined {
	if (!isMergeRequestScopePath(pathname)) {
		return undefined;
	}

	const state = readScopeState(new URLSearchParams(search));

	return state === undefined
		? undefined
		: { path: normalizeScopePath(pathname), state };
}

/**
 * In-memory lookup key. Newlines cannot appear in an origin, a pathname, or a
 * state value, so no component can impersonate a separator.
 */
export function toScopeKey(origin: string, scope: ListFilterScope): string {
	return `${origin}\n${scope.path}\n${scope.state}`;
}
