import type {
	Feature,
	FeatureContext,
	FeaturePageCompatibility,
} from "../../content/runtime/feature-context";
import {
	CURRENT_USER_TOGGLE_SELECTOR,
	MERGE_REQUEST_LIST_ROOT_SELECTOR,
	resolveCurrentUsername,
	resolveMergeRequestListContract,
} from "../../content/runtime/merge-request-list";
import {
	detachMergeRequestListAction,
	hasMergeRequestFilterBar,
	MERGE_REQUEST_FILTER_BAR_SELECTORS,
	MERGE_REQUEST_LIST_ACTIONS_ROOT_ATTRIBUTE,
	markMergeRequestListActionControl,
	markMergeRequestListActionSlot,
	resolveMergeRequestListActionAnchor,
} from "../../content/runtime/merge-request-list-actions";
import {
	FILTER_MY_AUTHORED_MERGE_REQUESTS_ACTION_ATTRIBUTE,
	FILTER_MY_AUTHORED_MERGE_REQUESTS_ROOT_ATTRIBUTE,
} from "./selectors";

export const FILTER_MY_AUTHORED_MERGE_REQUESTS_ID =
	"filter-my-authored-merge-requests";

const AUTHOR_USERNAME_PARAM = "author_username";

/*
 * GitLab treats these as variants of the author dimension, not independent
 * filters. In particular, `author_id` takes precedence over `author_username`,
 * while a negated current author would make the positive shortcut empty.
 */
const CONFLICTING_AUTHOR_PARAMS = [
	"author_id",
	"not[author_id]",
	"not[author_username]",
	"or[author_username]",
] as const;

/*
 * GitLab's supported list paging forms. A filter changes the result set, so a
 * cursor from the prior set cannot be carried into the filtered list.
 */
const PAGING_PARAMS = [
	"cursor",
	"first_page_size",
	"last_page_size",
	"page",
	"page_after",
	"page_before",
] as const;

interface MountedAction {
	href: string | undefined;
	link: HTMLAnchorElement;
	root: HTMLElement;
}

const actionsBySignal = new WeakMap<AbortSignal, MountedAction>();

function isSupportedListPath(pathname: string): boolean {
	return pathname.replace(/\/$/, "").endsWith("/-/merge_requests");
}

function isCurrentAuthorFilter(
	searchParams: URLSearchParams,
	username: string,
): boolean {
	const authors = searchParams.getAll(AUTHOR_USERNAME_PARAM);
	return (
		authors.length === 1 &&
		authors[0] === username &&
		CONFLICTING_AUTHOR_PARAMS.every((parameter) => !searchParams.has(parameter))
	);
}

export function buildMyAuthoredMergeRequestsHref(
	location: Location,
	username: string,
): string {
	const target = new URL(location.href);

	for (const parameter of CONFLICTING_AUTHOR_PARAMS) {
		target.searchParams.delete(parameter);
	}

	target.searchParams.set(AUTHOR_USERNAME_PARAM, username);

	for (const parameter of PAGING_PARAMS) {
		target.searchParams.delete(parameter);
	}

	return `${target.pathname}${target.search}${target.hash}`;
}

export function getFilterMyAuthoredMergeRequestsCompatibility(
	context: FeatureContext,
): FeaturePageCompatibility {
	if (!isSupportedListPath(context.location.pathname)) {
		return "not-applicable";
	}

	const contract = resolveMergeRequestListContract(context);

	if (contract.status !== "supported") {
		return contract.status;
	}

	return contract.surface !== "dashboard" &&
		hasMergeRequestFilterBar(context.document)
		? "supported"
		: "unsupported";
}

function mountedAction(
	context: FeatureContext,
	signal: AbortSignal,
): MountedAction {
	const existing = actionsBySignal.get(signal);

	if (existing) {
		return existing;
	}

	const root = context.document.createElement("div");
	root.setAttribute(FILTER_MY_AUTHORED_MERGE_REQUESTS_ROOT_ATTRIBUTE, "");
	markMergeRequestListActionSlot(root, "my-merge-requests");

	const link = context.document.createElement("a");
	link.setAttribute(FILTER_MY_AUTHORED_MERGE_REQUESTS_ACTION_ATTRIBUTE, "");
	markMergeRequestListActionControl(link);
	link.textContent = "My merge requests";
	root.append(link);

	const action = { href: undefined, link, root };
	actionsBySignal.set(signal, action);
	signal.addEventListener(
		"abort",
		() => {
			detachMergeRequestListAction(root);
			actionsBySignal.delete(signal);
		},
		{ once: true },
	);

	return action;
}

function detach(action: MountedAction): void {
	detachMergeRequestListAction(action.root);
	action.href = undefined;
}

function reconcile(context: FeatureContext, signal: AbortSignal): void {
	if (signal.aborted) {
		return;
	}

	const action = mountedAction(context, signal);
	const contract = resolveMergeRequestListContract(context);
	const username = resolveCurrentUsername(context);
	const currentParams = new URLSearchParams(context.location.search);

	if (
		!username ||
		contract.status !== "supported" ||
		contract.surface === "dashboard" ||
		isCurrentAuthorFilter(currentParams, username)
	) {
		detach(action);
		return;
	}

	const anchor = resolveMergeRequestListActionAnchor(
		context.document,
		"my-merge-requests",
	);

	if (!anchor) {
		detach(action);
		return;
	}

	const href = buildMyAuthoredMergeRequestsHref(context.location, username);

	if (action.href !== href) {
		action.link.setAttribute("href", href);
		action.href = href;
	}

	if (
		action.root.parentElement !== anchor.parent ||
		action.root.nextElementSibling !== anchor.before
	) {
		anchor.parent.insertBefore(action.root, anchor.before);
	}
}

export const filterMyAuthoredMergeRequests: Feature = {
	id: FILTER_MY_AUTHORED_MERGE_REQUESTS_ID,
	observedAttributes: ["href"],
	mutationSelectors: [
		MERGE_REQUEST_LIST_ROOT_SELECTOR,
		CURRENT_USER_TOGGLE_SELECTOR,
		...MERGE_REQUEST_FILTER_BAR_SELECTORS,
		`[${MERGE_REQUEST_LIST_ACTIONS_ROOT_ATTRIBUTE}]`,
	],
	matches({ location }) {
		return isSupportedListPath(location.pathname);
	},
	activate: reconcile,
	reconcile,
};
