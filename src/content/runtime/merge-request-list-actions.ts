/**
 * GitLab's filtered-search bar on a merge request list.
 *
 * The union is ordered only for readability. The outermost unique match is the
 * stable sibling anchor; nested matches are GitLab's private control DOM.
 */
export const MERGE_REQUEST_FILTER_BAR_SELECTORS = [
	'[data-testid="filtered-search-input"]',
	'[data-testid="issuable-search-container"]',
] as const;

export const MERGE_REQUEST_LIST_ACTIONS_ROOT_ATTRIBUTE =
	"data-tonic-for-gitlab-merge-request-list-actions";

export const MERGE_REQUEST_LIST_ACTION_CONTROL_ATTRIBUTE =
	"data-tonic-for-gitlab-merge-request-list-action-control";

const MERGE_REQUEST_LIST_ACTION_SLOT_ATTRIBUTE =
	"data-tonic-for-gitlab-merge-request-list-action-slot";

export type MergeRequestListActionSlot =
	| "my-merge-requests"
	| "remembered-filters";

const ACTION_SLOTS: readonly MergeRequestListActionSlot[] = [
	"my-merge-requests",
	"remembered-filters",
];

const actionHosts = new WeakMap<Document, HTMLElement>();

function resolveFilterBar(document: Document): Element | undefined {
	const matches = new Set<Element>();

	for (const selector of MERGE_REQUEST_FILTER_BAR_SELECTORS) {
		for (const element of document.querySelectorAll(selector)) {
			matches.add(element);
		}
	}

	const outermost = [...matches].filter(
		(candidate) =>
			![...matches].some(
				(other) => other !== candidate && other.contains(candidate),
			),
	);

	return outermost.length === 1 ? outermost[0] : undefined;
}

export function hasMergeRequestFilterBar(document: Document): boolean {
	return resolveFilterBar(document) !== undefined;
}

function readSlot(element: Element): MergeRequestListActionSlot | undefined {
	const value = element.getAttribute(MERGE_REQUEST_LIST_ACTION_SLOT_ATTRIBUTE);
	return ACTION_SLOTS.includes(value as MergeRequestListActionSlot)
		? (value as MergeRequestListActionSlot)
		: undefined;
}

/**
 * Resolves one shared row under GitLab's filter bar and an ordered position in
 * it. Each consumer owns only its own child. The shared row exists because two
 * independent features now need the same real DOM anchor and must not reorder
 * each other according to reconciliation timing.
 */
export function resolveMergeRequestListActionAnchor(
	document: Document,
	slot: MergeRequestListActionSlot,
): { parent: HTMLElement; before: Element | null } | undefined {
	const bar = resolveFilterBar(document);
	const parent = bar?.parentElement;

	if (!bar || !parent) {
		return undefined;
	}

	let host = actionHosts.get(document);

	if (!host?.isConnected) {
		/*
		 * A project-owned attribute is a probe, not proof of ownership: page
		 * script can create one too. Refuse a foreign root rather than appending
		 * extension controls to it or later deleting it during cleanup.
		 */
		if (
			document.querySelector(
				`[${MERGE_REQUEST_LIST_ACTIONS_ROOT_ATTRIBUTE}]`,
			) !== null
		) {
			return undefined;
		}

		host = document.createElement("div");
		host.setAttribute(MERGE_REQUEST_LIST_ACTIONS_ROOT_ATTRIBUTE, "");
		host.setAttribute("data-extension-root", "true");
		actionHosts.set(document, host);
	}

	const children = [...host.children];
	const slots = children.map(readSlot);

	if (
		slots.some((childSlot) => childSlot === undefined) ||
		new Set(slots).size !== slots.length
	) {
		return undefined;
	}

	if (host.parentElement !== parent || bar.nextElementSibling !== host) {
		parent.insertBefore(host, bar.nextElementSibling);
	}

	const targetIndex = ACTION_SLOTS.indexOf(slot);
	const before = children.find((_child, index) => {
		const childSlot = slots[index];
		return (
			childSlot !== undefined && ACTION_SLOTS.indexOf(childSlot) > targetIndex
		);
	});

	return { parent: host, before: before ?? null };
}

export function markMergeRequestListActionSlot(
	element: Element,
	slot: MergeRequestListActionSlot,
): void {
	element.setAttribute(MERGE_REQUEST_LIST_ACTION_SLOT_ATTRIBUTE, slot);
}

export function markMergeRequestListActionControl(element: Element): void {
	element.setAttribute(MERGE_REQUEST_LIST_ACTION_CONTROL_ATTRIBUTE, "");
}

export function detachMergeRequestListAction(element: Element): void {
	const host = element.parentElement;
	element.remove();

	if (
		host?.hasAttribute(MERGE_REQUEST_LIST_ACTIONS_ROOT_ATTRIBUTE) &&
		host.children.length === 0
	) {
		host.remove();

		if (actionHosts.get(host.ownerDocument) === host) {
			actionHosts.delete(host.ownerDocument);
		}
	}
}
