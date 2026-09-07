import type { FeatureContext } from "./feature-context";
import { isMergeRequestListPath } from "./page-context";

export const MERGE_REQUEST_LIST_ROOT_SELECTOR = "main#content-body";

const MERGE_REQUEST_ROW_SELECTORS = [
	'[data-testid="issuable-container"]',
	"li.merge-request",
] as const;

const MERGE_REQUEST_ROW_SELECTOR = MERGE_REQUEST_ROW_SELECTORS.join(", ");
const ISSUABLE_LIST_CONTAINER_SELECTOR = ".issuable-list-container";
const ISSUABLE_EMPTY_STATE_SELECTOR = '[data-testid="issuable-empty-state"]';
const DASHBOARD_TAB_SELECTOR =
	'[data-testid="merge-request-dashboard-tab"][role="tabpanel"][aria-hidden="false"]';
const DASHBOARD_LIST_SELECTOR = '[data-testid="merge-request-dashboard-list"]';
const DASHBOARD_LIST_BODY_SELECTOR = '[data-testid="crud-body"]';
const DASHBOARD_EMPTY_STATE_SELECTOR = '[data-testid="crud-empty"]';
const DASHBOARD_ROW_SELECTOR = '[data-testid="merge-request"][role="row"]';

const CLASSIC_TITLE_LINK_SELECTOR = [
	'[data-testid="issuable-title-link"][href*="/-/merge_requests/"]',
	'a.issue-title-text[href*="/-/merge_requests/"]',
].join(", ");
const CLASSIC_AUTHOR_LINK_SELECTOR = [
	'a[data-testid="issuable-author"][data-username][href]',
	"a.author-link[data-user-id][data-username][href]",
].join(", ");
const DASHBOARD_AUTHOR_LINK_SELECTOR =
	"a.js-user-link[data-user-id][data-username][href]";
export const MERGE_REQUEST_TITLE_ATTRIBUTE = "data-qa-issuable-title";
export const MERGE_REQUEST_AUTHOR_USERNAME_ATTRIBUTE = "data-username";
export const CURRENT_USER_LINK_SELECTOR =
	'a[data-testid="user-menu-toggle"][href]';
export const CURRENT_USER_TOGGLE_SELECTOR = '[data-testid="user-menu-toggle"]';

const GITLAB_USERNAME = /^[A-Za-z0-9_.-]+$/;

export type MergeRequestListSurface = "project" | "group" | "dashboard";

export interface MergeRequestListRowContract {
	readonly authorUsername: string | undefined;
	readonly element: HTMLElement;
	readonly title: string | undefined;
}

export type MergeRequestListContract =
	| { readonly status: "not-applicable" }
	| { readonly status: "unsupported" }
	| {
			readonly status: "supported";
			readonly root: HTMLElement;
			readonly rows: readonly MergeRequestListRowContract[];
			readonly surface: MergeRequestListSurface;
	  };

const contractSnapshots = new WeakMap<
	FeatureContext,
	MergeRequestListContract
>();

function getSingleElement<T extends Element>(
	root: ParentNode,
	selector: string,
): T | undefined {
	const elements = root.querySelectorAll<T>(selector);
	return elements.length === 1 ? elements[0] : undefined;
}

function getSurface(
	context: FeatureContext,
): MergeRequestListSurface | undefined {
	const normalizedPath = context.location.pathname.replace(/\/$/, "");
	const page = context.document.body?.dataset.page;

	if (normalizedPath.endsWith("/dashboard/merge_requests")) {
		return page === "dashboard:merge_requests" ? "dashboard" : undefined;
	}

	if (!normalizedPath.endsWith("/-/merge_requests")) {
		return undefined;
	}

	if (page === "projects:merge_requests:index") {
		return "project";
	}

	return page === "groups:merge_requests" ? "group" : undefined;
}

function isMergeRequestLink(
	link: HTMLAnchorElement,
	location: Location,
): boolean {
	const href = link.getAttribute("href");

	if (!href) {
		return false;
	}

	try {
		const url = new URL(href, location.href);
		return (
			url.origin === location.origin &&
			url.username === "" &&
			url.password === "" &&
			url.search === "" &&
			url.hash === "" &&
			/\/-\/merge_requests\/\d+$/.test(url.pathname)
		);
	} catch {
		return false;
	}
}

export function getProfileUsername(
	link: HTMLAnchorElement,
	location: Location,
): string | undefined {
	const href = link.getAttribute("href");

	if (!href) {
		return undefined;
	}

	let profileUrl: URL;

	try {
		profileUrl = new URL(href, location.href);
	} catch {
		return undefined;
	}

	if (
		profileUrl.origin !== location.origin ||
		profileUrl.username !== "" ||
		profileUrl.password !== "" ||
		profileUrl.search !== "" ||
		profileUrl.hash !== ""
	) {
		return undefined;
	}

	const username = profileUrl.pathname.split("/").filter(Boolean).at(-1);
	return username && GITLAB_USERNAME.test(username) ? username : undefined;
}

/**
 * Resolves the signed-in username from GitLab's profile link. Duplicate links
 * for the same responsive control are accepted; missing, malformed, or
 * conflicting evidence is not identity.
 */
export function resolveCurrentUsername(
	context: FeatureContext,
): string | undefined {
	const links = [
		...context.document.querySelectorAll<HTMLAnchorElement>(
			CURRENT_USER_LINK_SELECTOR,
		),
	];

	if (links.length === 0) {
		return undefined;
	}

	const usernames = new Set<string>();

	for (const link of links) {
		const username = getProfileUsername(link, context.location);

		if (!username) {
			return undefined;
		}

		usernames.add(username);
	}

	return usernames.size === 1 ? [...usernames][0] : undefined;
}

function getAuthorUsername(
	links: NodeListOf<HTMLAnchorElement>,
	location: Location,
): string | undefined {
	if (links.length === 0) {
		return undefined;
	}

	const usernames = new Set<string>();

	for (const link of links) {
		const attributeUsername = link.getAttribute("data-username")?.trim();
		const profileUsername = getProfileUsername(link, location);

		if (!attributeUsername || attributeUsername !== profileUsername) {
			return undefined;
		}

		usernames.add(attributeUsername);
	}

	return usernames.size === 1 ? [...usernames][0] : undefined;
}

function getClassicRowContract(
	element: HTMLElement,
	location: Location,
): MergeRequestListRowContract {
	const titleLinks = element.querySelectorAll<HTMLAnchorElement>(
		CLASSIC_TITLE_LINK_SELECTOR,
	);
	const titleLink = titleLinks.length === 1 ? titleLinks[0] : undefined;
	const attributeTitle = element
		.getAttribute(MERGE_REQUEST_TITLE_ATTRIBUTE)
		?.trim();
	const linkTitle = titleLink?.textContent?.trim();

	return {
		authorUsername: getAuthorUsername(
			element.querySelectorAll<HTMLAnchorElement>(CLASSIC_AUTHOR_LINK_SELECTOR),
			location,
		),
		element,
		title:
			titleLink && isMergeRequestLink(titleLink, location)
				? attributeTitle || linkTitle || undefined
				: undefined,
	};
}

function getDashboardRowContract(
	element: HTMLElement,
	location: Location,
): MergeRequestListRowContract {
	const cells = element.querySelectorAll<HTMLElement>(':scope > [role="cell"]');
	const detailsCell = cells[1];
	const titleLinks = detailsCell
		? [
				...detailsCell.querySelectorAll<HTMLAnchorElement>(
					'a[href*="/-/merge_requests/"]',
				),
			].filter((link) => isMergeRequestLink(link, location))
		: [];
	const title =
		titleLinks.length === 1 ? titleLinks[0]?.textContent?.trim() : undefined;

	return {
		authorUsername: detailsCell
			? getAuthorUsername(
					detailsCell.querySelectorAll<HTMLAnchorElement>(
						DASHBOARD_AUTHOR_LINK_SELECTOR,
					),
					location,
				)
			: undefined,
		element,
		title: title || undefined,
	};
}

function resolveClassicContract(
	root: HTMLElement,
	surface: Extract<MergeRequestListSurface, "project" | "group">,
	location: Location,
): MergeRequestListContract {
	const container = getSingleElement<HTMLElement>(
		root,
		ISSUABLE_LIST_CONTAINER_SELECTOR,
	);

	if (!container) {
		return { status: "unsupported" };
	}

	const rows = [
		...container.querySelectorAll<HTMLElement>(MERGE_REQUEST_ROW_SELECTOR),
	];

	if (
		rows.length === 0 &&
		container.querySelector(ISSUABLE_EMPTY_STATE_SELECTOR) === null
	) {
		return { status: "unsupported" };
	}

	return {
		status: "supported",
		root,
		rows: rows.map((row) => getClassicRowContract(row, location)),
		surface,
	};
}

function resolveDashboardContract(
	root: HTMLElement,
	location: Location,
): MergeRequestListContract {
	const tab = getSingleElement<HTMLElement>(root, DASHBOARD_TAB_SELECTOR);
	const lists = tab?.querySelectorAll<HTMLElement>(DASHBOARD_LIST_SELECTOR);

	if (!tab || !lists || lists.length === 0) {
		return { status: "unsupported" };
	}

	const rows: HTMLElement[] = [];

	for (const list of lists) {
		const body = getSingleElement<HTMLElement>(
			list,
			DASHBOARD_LIST_BODY_SELECTOR,
		);

		if (!body) {
			return { status: "unsupported" };
		}

		const listRows = [
			...body.querySelectorAll<HTMLElement>(DASHBOARD_ROW_SELECTOR),
		];

		if (
			listRows.length === 0 &&
			body.querySelector(DASHBOARD_EMPTY_STATE_SELECTOR) === null
		) {
			return { status: "unsupported" };
		}

		rows.push(...listRows);
	}

	return {
		status: "supported",
		root,
		rows: rows.map((row) => getDashboardRowContract(row, location)),
		surface: "dashboard",
	};
}

/**
 * Resolves the complete page structure before a feature mutates any row.
 * Recognized empty states are supported; a missing row container or a
 * half-matching structure is not.
 */
function resolveMergeRequestListContractSnapshot(
	context: FeatureContext,
): MergeRequestListContract {
	if (!isMergeRequestListPath(context.location.pathname)) {
		return { status: "not-applicable" };
	}

	const surface = getSurface(context);
	const root = getSingleElement<HTMLElement>(
		context.document,
		MERGE_REQUEST_LIST_ROOT_SELECTOR,
	);

	if (!surface || !root) {
		return { status: "unsupported" };
	}

	return surface === "dashboard"
		? resolveDashboardContract(root, context.location)
		: resolveClassicContract(root, surface, context.location);
}

/**
 * Shares one immutable view of the untrusted GitLab DOM across every feature in
 * a runtime reconciliation pass. The lifecycle creates a fresh context for the
 * next pass, so later DOM changes cannot reuse this snapshot.
 */
export function resolveMergeRequestListContract(
	context: FeatureContext,
): MergeRequestListContract {
	const cached = contractSnapshots.get(context);

	if (cached) {
		return cached;
	}

	const contract = resolveMergeRequestListContractSnapshot(context);
	const snapshot =
		contract.status === "supported"
			? Object.freeze({
					...contract,
					rows: Object.freeze(contract.rows.map((row) => Object.freeze(row))),
				})
			: Object.freeze(contract);
	contractSnapshots.set(context, snapshot);
	return snapshot;
}
