import type {
	Feature,
	FeatureContext,
} from "../../content/runtime/feature-context";
import { isTargetOrigin } from "../../host-access/target-origin";
import {
	type FilterStatusView,
	reconcileFilterStatusChip,
} from "./filter-status-chip";
import type { ListFilterStore } from "./list-filters-store";
import { createOwnedLinkHrefRegistry } from "./owned-link-hrefs";
import {
	canonicalizeFilterQuery,
	DEFAULT_MERGE_REQUEST_LIST_STATE,
	hasPagingParam,
	type ListFilterScope,
	readListScope,
} from "./scope";
import {
	CHIP_ACTION_ATTRIBUTE,
	FILTER_BAR_SELECTORS,
	hasFilterBar,
	MERGE_REQUEST_LIST_LINK_SELECTOR,
} from "./selectors";

export const REMEMBER_MERGE_REQUEST_LIST_FILTERS_ID =
	"remember-merge-request-list-filters";

const ownedLinkHrefs = createOwnedLinkHrefRegistry();

interface ListLinkTarget {
	url: URL;
	scope: ListFilterScope;
}

/**
 * The attribute forms GitLab was observed to write for a merge request list:
 * an absolute URL or a root-relative path. Anything else is refused.
 *
 * This is not pedantry. GitLab's own state tabs are `<a role="tab" href="#">`
 * on 18.11.11 and 19.2.4-ee, and a bare fragment resolves to the *current* URL.
 * On a list page that resolves to the list itself, so without this check the
 * feature would rewrite `#` into a full list URL and break GitLab's tabs.
 */
const REWRITABLE_HREF = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/**
 * Decides whether one link may receive remembered filters.
 *
 * Every refusal below is a correctness rule, not a safety belt:
 *
 * - a cross-origin link must never receive filters from any instance, because
 *   usernames, labels, and milestones do not mean the same thing on another
 *   GitLab, and this instance's stored data has no authority over that one;
 * - a link already carrying filters is the user's or GitLab's own choice, and
 *   GitLab's breadcrumb on a filtered list is exactly such a link;
 * - a link carrying a paging or cursor parameter is a paging link, and
 *   restoring filters onto a keyset cursor is how upstream broke paging;
 * - an unknown `state` value is a scope this build cannot identify.
 */
function resolveListLinkTarget(
	href: string,
	location: Location,
): ListLinkTarget | undefined {
	if (!href.startsWith("/") && !REWRITABLE_HREF.test(href)) {
		return undefined;
	}

	let url: URL;

	try {
		url = new URL(href, location.href);
	} catch {
		return undefined;
	}

	if (
		url.origin !== location.origin ||
		url.username !== "" ||
		url.password !== ""
	) {
		return undefined;
	}

	/*
	 * Path first, because it is the discriminator that rejects the most for the
	 * least. The candidate selector matches every row's link to a merge request
	 * detail page, and `isMergeRequestScopePath` turns those away on one string
	 * comparison, before any `URLSearchParams` is built or any query is
	 * canonicalized and sorted.
	 */
	const scope = readListScope(url.pathname, url.search);

	if (scope === undefined) {
		return undefined;
	}

	if (
		hasPagingParam(new URLSearchParams(url.search)) ||
		canonicalizeFilterQuery(url.search) !== ""
	) {
		return undefined;
	}

	return { url, scope };
}

/**
 * Rebuilds an href, keeping the attribute in the form GitLab wrote it.
 *
 * Turning a root-relative href into an absolute one is a real bug class, not a
 * cosmetic difference; Refined GitHub hit it in their issue #5435. Only the two
 * forms GitLab was observed to emit are produced here: an attribute with a
 * scheme stays absolute, everything else is emitted root-relative, which is what
 * resolving it against the document already made it mean.
 */
function formatHref(originalHref: string, url: URL): string {
	const relative = `${url.pathname}${url.search}${url.hash}`;

	if (/^[a-z][a-z0-9+.-]*:/i.test(originalHref)) {
		return url.href;
	}

	return originalHref.startsWith("//") ? `//${url.host}${relative}` : relative;
}

function buildRestoredHref(
	originalHref: string,
	url: URL,
	query: string,
): string {
	const restored = new URL(url.href);

	/*
	 * Appended rather than assigned: the link's own `state` decides which tab it
	 * targets, and this feature only supplies the filters remembered for that
	 * state. Built through `URLSearchParams` because the stored query is
	 * page-supplied untrusted input being re-emitted into an href.
	 */
	for (const [key, value] of new URLSearchParams(query)) {
		restored.searchParams.append(key, value);
	}

	return formatHref(originalHref, restored);
}

function restoreListLinks(
	context: FeatureContext,
	origin: string,
	signal: AbortSignal,
	store: ListFilterStore,
): void {
	const links = ownedLinkHrefs.forSignal(signal);
	const ownedLinks: HTMLAnchorElement[] = [];

	for (const link of context.document.querySelectorAll<HTMLAnchorElement>(
		MERGE_REQUEST_LIST_LINK_SELECTOR,
	)) {
		/*
		 * The chip's own "Use saved" anchor matches the candidate selector. A
		 * single attribute check keeps it out rather than a `:not()` selector,
		 * which would push a level 4 complex selector through both this query and
		 * the shared runtime's mutation filter.
		 */
		if (link.hasAttribute(CHIP_ACTION_ATTRIBUTE)) {
			continue;
		}

		const originalHref =
			links.originalHref(link) ?? link.getAttribute("href") ?? "";
		const target = resolveListLinkTarget(originalHref, context.location);

		if (!target) {
			links.restore(link);
			continue;
		}

		const query = store.read(origin, target.scope);

		// No entry and a remembered empty filter set mean the same thing for a
		// link: GitLab's own href is already what the user should get.
		if (!query) {
			links.restore(link);
			continue;
		}

		links.rewrite(link, buildRestoredHref(originalHref, target.url, query));
		ownedLinks.push(link);
	}

	links.retain(ownedLinks);
}

/**
 * The href that takes the user to their saved filters for this scope.
 *
 * Built from the path and the scope's own state rather than from the current
 * URL, so paging parameters are dropped and the user lands on the first page.
 * `sort` is dropped for the reason it is never stored: GitLab persists the sort
 * preference server-side, so omitting it lets the user's own preference apply.
 */
function buildSavedFiltersHref(
	location: Location,
	scope: ListFilterScope,
	query: string,
): string {
	const url = new URL(location.pathname, location.href);

	if (scope.state !== DEFAULT_MERGE_REQUEST_LIST_STATE) {
		url.searchParams.set("state", scope.state);
	}

	for (const [key, value] of new URLSearchParams(query)) {
		url.searchParams.append(key, value);
	}

	return `${url.pathname}${url.search}`;
}

/**
 * What the chip should say for the list currently on screen.
 *
 * Visible when there is something to say: a set is saved for this scope, or the
 * list is showing filters that could be saved. Neither means an undecorated
 * list, which is the common case on an unfiltered one.
 *
 * A stored empty query counts as nothing saved here. It rewrites no links, so
 * presenting it as a remembered state would describe an effect that does not
 * exist; treating it as unsaved instead lets the user replace it from the same
 * control they would use on any other unremembered list.
 *
 * A saved set with an unfiltered list on screen is its own state. Calling it
 * diverged was wrong twice over: nothing different is being shown, and the
 * `Save these` it offered wrote an empty query, which reads back as nothing
 * saved, so a control labelled Save destroyed the saved set in one click. The
 * state offers `Use saved` and `Forget` instead, which is what the user can
 * actually do from there.
 *
 * `diverged` deliberately does not also offer `Forget`. It already carries two
 * controls beside GitLab's own Search and Clear, and a `Forget` there would act
 * on a set the user is not looking at, which is the same class of surprise the
 * destructive `Save these` was. Forgetting stays reachable from the two states
 * that do show the saved set's own list: `remembered`, and this one.
 *
 * Every offer that writes is dropped when the store cannot write, which is the
 * case while a newer build owns the stored value. Offering a control whose only
 * outcome is a refused write and a console error is worse than offering nothing.
 */
function resolveFilterStatusView(
	context: FeatureContext,
	origin: string,
	store: ListFilterStore,
): FilterStatusView {
	const { location } = context;
	const scope = readListScope(location.pathname, location.search);

	if (!scope || !hasFilterBar(context.document)) {
		return { state: "hidden" };
	}

	const saved = store.read(origin, scope);
	const current = canonicalizeFilterQuery(location.search);
	const isWritable = store.isWritable();

	if (!saved) {
		return current === "" || !isWritable
			? { state: "hidden" }
			: { state: "unsaved", actions: ["remember"] };
	}

	if (current === saved) {
		return { state: "remembered", actions: isWritable ? ["forget"] : [] };
	}

	const savedHref = buildSavedFiltersHref(location, scope, saved);

	if (current === "") {
		return {
			state: "saved-not-applied",
			savedHref,
			actions: isWritable ? ["use-saved", "forget"] : ["use-saved"],
		};
	}

	return {
		state: "diverged",
		savedHref,
		actions: isWritable ? ["use-saved", "save"] : ["use-saved"],
	};
}

/**
 * Remembers the filter query of a merge request list scope and puts it back by
 * rewriting GitLab's own navigation links.
 *
 * Tonic never assigns `location`, never calls `pushState` or `replaceState`, and
 * never starts a navigation. The saved query rides along on a link the user
 * chose to click, which makes the reload loop that upstream shipped
 * structurally impossible rather than merely guarded against.
 */
export function createRememberMergeRequestListFiltersFeature(
	store: ListFilterStore,
): Feature {
	const reconcile = (context: FeatureContext, signal: AbortSignal): void => {
		if (signal.aborted) {
			return;
		}

		/*
		 * Scopes are per instance. The same project path exists on gitlab.com and
		 * on a self-managed GitLab, and one instance's filters are wrong on the
		 * other. Normalizing through the same predicate the host-access targets
		 * use keeps the two representations from drifting apart.
		 */
		const origin = context.location.origin;

		if (!isTargetOrigin(origin)) {
			return;
		}

		restoreListLinks(context, origin, signal, store);

		/*
		 * Both actions write through the store, whose snapshot updates before the
		 * write settles, then reconcile immediately so the chip and the links
		 * answer the click in the same frame instead of waiting for the storage
		 * echo. The echo still arrives and is idempotent by then.
		 *
		 * The scope is read from `location` when the control is pressed, not from
		 * the pass that rendered it. Reconciliation is batched on an animation
		 * frame, so GitLab can change the URL and the user can click before the
		 * next pass runs; a scope captured at render time would then write the new
		 * query into the previous state tab's entry, or forget an entry the user
		 * is no longer looking at.
		 */
		const currentScope = (): ListFilterScope | undefined =>
			readListScope(context.location.pathname, context.location.search);
		reconcileFilterStatusChip(
			context,
			signal,
			resolveFilterStatusView(context, origin, store),
			{
				forget() {
					const scope = currentScope();

					if (scope) {
						store.remember(origin, scope, undefined);
						reconcile(context, signal);
					}
				},
				/*
				 * Never called with an empty query. `Remember filters` and
				 * `Save these` are offered only for a list that is showing filters,
				 * so a control labelled Save cannot write the empty value that reads
				 * back as nothing saved. Nothing else writes at all, which is what
				 * makes the stored set the one the user chose rather than the last
				 * one they happened to look at.
				 */
				save() {
					const scope = currentScope();
					const query = canonicalizeFilterQuery(context.location.search);

					/*
					 * An empty query would read back as nothing saved, so a control
					 * labelled Save would delete the set it was asked to replace. The
					 * chip never offers one for an unfiltered list, and this refuses
					 * the case where the URL changed between render and click.
					 */
					if (scope && query !== "") {
						store.remember(origin, scope, query);
						reconcile(context, signal);
					}
				},
			},
		);
	};

	return {
		id: REMEMBER_MERGE_REQUEST_LIST_FILTERS_ID,
		observedAttributes: ["href"],
		/*
		 * The filter bar is here because the chip anchors to it. GitLab rebuilds
		 * that container, and on a list with no rows there is no candidate link in
		 * the mutated subtree to wake the observer for an unrelated reason, so the
		 * chip was silently lost. This is no longer the cost it once was: the
		 * feature has no keystroke listeners any more, and a reconcile that finds
		 * an unchanged view writes nothing.
		 */
		mutationSelectors: [
			MERGE_REQUEST_LIST_LINK_SELECTOR,
			...FILTER_BAR_SELECTORS,
		],
		/*
		 * Deliberately not restricted to list pages. The chip needs a list, but
		 * restore has to reach the sidebar link on the pages a user navigates back
		 * from, which are project, group, and merge request detail pages. The work
		 * on a page with no such link is one `querySelectorAll` that returns
		 * nothing.
		 */
		matches() {
			return true;
		},
		activate: reconcile,
		reconcile,
	};
}
