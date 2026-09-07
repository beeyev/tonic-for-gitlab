import type { FeatureContext } from "../../content/runtime/feature-context";
import {
	detachMergeRequestListAction,
	markMergeRequestListActionControl,
	markMergeRequestListActionSlot,
} from "../../content/runtime/merge-request-list-actions";
import {
	CHIP_ACTION_ATTRIBUTE,
	CHIP_LABEL_ATTRIBUTE,
	CHIP_ROOT_ATTRIBUTE,
	CHIP_STATE_ATTRIBUTE,
	resolveFilterStatusAnchor,
} from "./selectors";

/**
 * What the chip is saying right now.
 *
 * The chip is visible when there is something to say about this list's filters:
 * a set is saved for it, or the list is showing filters that could be saved. A
 * list with no filters and nothing saved has neither, so it stays undecorated.
 *
 * `unsaved` is the entry point, and without it the feature would do nothing at
 * all. Nothing is ever saved on its own, so how the filters on screen got there
 * does not matter: typed into GitLab's filter bar, followed from a colleague's
 * link, restored with a tab, or added by clicking a label chip in a row are all
 * the same to Tonic. This state is also the only thing that makes the feature
 * discoverable, since every other state requires a saved set to already exist.
 *
 * `saved-not-applied` is a separate state from `diverged` rather than a wording
 * detail. On an unfiltered list nothing different is being shown, so the
 * diverged label was factually wrong, and offering "Save these" there meant a
 * control labelled Save wrote an empty query, which reads back as nothing saved
 * and destroyed the set in one click with no undo. Splitting the state removes
 * that path structurally: "Save these" can never see an empty query.
 */
export type FilterStatusState =
	| "hidden"
	| "unsaved"
	| "remembered"
	| "diverged"
	| "saved-not-applied";

/** Every state that actually renders something. */
type VisibleStatusState = Exclude<FilterStatusState, "hidden">;

/** One rendered control. The order of the array is the rendered order. */
export type FilterStatusAction = "remember" | "forget" | "use-saved" | "save";

export interface FilterStatusView {
	state: FilterStatusState;
	/** Root-relative href to the saved filters. Set whenever `use-saved` is offered. */
	savedHref?: string;
	/** Controls to offer, in order. Empty renders the label on its own. */
	actions?: readonly FilterStatusAction[];
}

export interface FilterStatusActions {
	forget(): void;
	save(): void;
}

interface MountedChip {
	host: HTMLElement | undefined;
	parent: Element | undefined;
	before: Element | null;
	/** Rendered content identity, so an unchanged chip is never rewritten. */
	signature: string | undefined;
	/**
	 * The current pass's actions, refreshed on every reconcile.
	 *
	 * Handlers read this reference instead of closing over the actions of the
	 * pass that created them. Scope identity is origin plus path plus **state**,
	 * while the rendered view is not: switching Open to Merged leaves the chip
	 * looking identical, so a captured handler survived the tab change and wrote
	 * the new tab's filters into the previous tab's scope. Refreshing one
	 * reference removes that whole class of staleness rather than making the
	 * signature carry the scope.
	 */
	actions: FilterStatusActions;
	/**
	 * Controls this chip has built, whether or not they are attached right now.
	 *
	 * Looking them up with `host.querySelector` instead found only what was
	 * currently attached, so every state change rebuilt the controls it had just
	 * removed and bound a fresh click listener to the activation signal. That
	 * signal outlives every transition, because this feature matches every page
	 * and only aborts when the setting is switched off, so the listeners and the
	 * detached buttons behind them accumulated for the life of the tab: measured
	 * at one new button per transition. Keyed by action, so a control is built
	 * once and reattached however many times the state moves.
	 */
	controls: Map<FilterStatusAction, Element>;
	/** The status label, reused for the same reason the controls are. */
	label: Element | undefined;
}

const chipsBySignal = new WeakMap<AbortSignal, MountedChip>();

/*
 * No label for `unsaved`. Its button already says "Remember filters", so a
 * status beside it only restates the button in the state that shows up most
 * often. The other labels carry something their buttons do not: that Tonic has
 * a set saved for this list, and why two choices are on offer.
 */
const LABELS: Record<VisibleStatusState, string | undefined> = {
	unsaved: undefined,
	remembered: "Filters remembered",
	diverged: "Showing different filters",
	"saved-not-applied": "Saved filters not applied",
};

const ACTION_TEXT: Record<FilterStatusAction, string> = {
	remember: "Remember filters",
	forget: "Forget",
	"use-saved": "Use saved",
	save: "Save these",
};

/*
 * "Forget, button" says nothing about what is being forgotten, and GitLab's own
 * Clear and Search controls sit a few pixels above these. Each accessible name
 * therefore names the object the control acts on, while the visible text stays
 * short enough for a chip.
 */
const ACTION_LABELS: Record<FilterStatusAction, string> = {
	remember: "Remember the filters shown on this merge request list",
	forget: "Forget the filters saved for this merge request list",
	"use-saved": "Open this merge request list with its saved filters",
	save: "Save the filters shown on this merge request list",
};

function viewSignature(view: FilterStatusView): string {
	return [
		view.state,
		view.savedHref ?? "",
		(view.actions ?? []).join(" "),
	].join("\n");
}

/**
 * Finds or builds one control.
 *
 * Reuse is what keeps focus alive across a render: `replaceChildren` moved
 * `document.activeElement` to `<body>` on every single click, because the
 * control the user had just activated left the DOM.
 */
function resolveAction(
	document: Document,
	chip: MountedChip,
	action: FilterStatusAction,
	signal: AbortSignal,
): Element {
	const existing = chip.controls.get(action);

	if (existing) {
		return existing;
	}

	if (action === "use-saved") {
		/*
		 * An anchor, not a button. The feature never assigns `location` and never
		 * calls `pushState`; a remembered query only ever travels on a link the
		 * user chose to click, and this control is no exception to that rule.
		 */
		const link = document.createElement("a");

		link.setAttribute(CHIP_ACTION_ATTRIBUTE, action);
		markMergeRequestListActionControl(link);
		link.setAttribute("aria-label", ACTION_LABELS[action]);
		link.textContent = ACTION_TEXT[action];
		chip.controls.set(action, link);
		return link;
	}

	const button = document.createElement("button");

	button.type = "button";
	button.setAttribute(CHIP_ACTION_ATTRIBUTE, action);
	markMergeRequestListActionControl(button);
	button.setAttribute("aria-label", ACTION_LABELS[action]);
	button.textContent = ACTION_TEXT[action];
	button.addEventListener(
		"click",
		(event) => {
			/*
			 * The chip lives in GitLab's light DOM, so page script can reach these
			 * controls and call `.click()` on them. Only the browser sets
			 * `isTrusted`, and these buttons are the one bridge from the page to
			 * extension storage, so a synthetic click is refused rather than allowed
			 * to overwrite or erase a set the user saved. This is the whole
			 * "explicit user action" guarantee: without the check it means "any
			 * click event", including one the page dispatched.
			 */
			if (!event.isTrusted) {
				return;
			}

			event.preventDefault();

			if (action === "forget") {
				chip.actions.forget();
				return;
			}

			chip.actions.save();
		},
		{ signal },
	);

	chip.controls.set(action, button);
	return button;
}

function resolveLabel(chip: MountedChip, document: Document): Element {
	const existing = chip.label;

	if (existing) {
		return existing;
	}

	const label = document.createElement("span");

	label.setAttribute(CHIP_LABEL_ATTRIBUTE, "");
	/*
	 * On the label span alone, so the state text is announced when it changes
	 * without the whole button set re-announcing with it. Because nodes are
	 * reused and text is written only when it differs, an ordinary navigation
	 * that leaves the state alone - a state tab change on a list whose scopes are
	 * both remembered, a reconcile from a DOM mutation - produces no mutation
	 * inside the live region and so no announcement.
	 */
	label.setAttribute("role", "status");
	chip.label = label;
	return label;
}

/**
 * Rewrites the chip's children for one view, reusing every node it can.
 *
 * Built through `createElement` and `textContent` rather than an HTML string.
 * All rendered text is a literal owned by this file; the one page-derived value
 * is the saved href, which is assembled through `URL` and `URLSearchParams` and
 * set as an attribute, never concatenated into markup.
 */
function renderChip(
	chip: MountedChip,
	document: Document,
	view: FilterStatusView,
	signal: AbortSignal,
): void {
	const { host } = chip;

	if (!host || view.state === "hidden") {
		return;
	}

	const hadFocus = host.contains(document.activeElement);

	if (host.getAttribute(CHIP_STATE_ATTRIBUTE) !== view.state) {
		host.setAttribute(CHIP_STATE_ATTRIBUTE, view.state);
	}

	const rendered: Element[] = [];
	const labelText = LABELS[view.state];

	if (labelText !== undefined) {
		const label = resolveLabel(chip, document);

		if (label.textContent !== labelText) {
			label.textContent = labelText;
		}

		rendered.push(label);
	}

	for (const action of view.actions ?? []) {
		const control = resolveAction(document, chip, action, signal);

		if (action === "use-saved") {
			const savedHref = view.savedHref ?? "";

			if (control.getAttribute("href") !== savedHref) {
				control.setAttribute("href", savedHref);
			}
		}

		rendered.push(control);
	}

	rendered.forEach((node, index) => {
		if (host.children[index] !== node) {
			host.insertBefore(node, host.children[index] ?? null);
		}
	});

	while (host.children.length > rendered.length) {
		host.lastElementChild?.remove();
	}

	/*
	 * Every action replaces the control that triggered it, so reuse alone cannot
	 * keep focus: the clicked node is gone by design. Focus is moved deliberately
	 * to the successor control instead, and only when it was inside the chip to
	 * begin with, so a reconcile driven by another tab never steals it.
	 */
	if (hadFocus && !host.contains(document.activeElement)) {
		host.querySelector<HTMLElement>(`[${CHIP_ACTION_ATTRIBUTE}]`)?.focus();
	}
}

function detachChip(chip: MountedChip): void {
	if (chip.host) {
		detachMergeRequestListAction(chip.host);
	}
	chip.host = undefined;
	chip.parent = undefined;
	chip.before = null;
	chip.signature = undefined;
}

/**
 * The per-activation chip record, created once.
 *
 * The abort listener is registered here rather than on the path that builds a
 * host. GitLab's filter bar is a Vue component that rebuilds, so the chip can be
 * built more than once against one long-lived activation signal, and a listener
 * added per build accumulated on it.
 */
function chipState(
	signal: AbortSignal,
	actions: FilterStatusActions,
): MountedChip {
	const existing = chipsBySignal.get(signal);

	if (existing) {
		existing.actions = actions;
		return existing;
	}

	const chip: MountedChip = {
		host: undefined,
		parent: undefined,
		before: null,
		signature: undefined,
		actions,
		controls: new Map(),
		label: undefined,
	};

	chipsBySignal.set(signal, chip);
	signal.addEventListener(
		"abort",
		() => {
			detachChip(chip);
			chipsBySignal.delete(signal);
		},
		{ once: true },
	);

	return chip;
}

/**
 * Places, updates, moves, or removes the chip for the current view.
 *
 * Follows the control panel's mount contract: an existing host that GitLab only
 * moved is relocated rather than rebuilt, and only a host GitLab detached is
 * built again. Children are rewritten solely when the view changes, because the
 * shared observer watches this subtree and an unconditional rewrite would
 * schedule a reconcile that rewrites again on the next frame.
 */
export function reconcileFilterStatusChip(
	context: FeatureContext,
	signal: AbortSignal,
	view: FilterStatusView,
	actions: FilterStatusActions,
): void {
	const chip = chipState(signal, actions);

	if (view.state === "hidden") {
		detachChip(chip);
		return;
	}

	const anchor = resolveFilterStatusAnchor(context.document);

	if (!anchor) {
		detachChip(chip);
		return;
	}

	const signature = viewSignature(view);

	if (chip.host?.isConnected) {
		if (chip.parent !== anchor.parent || chip.before !== anchor.before) {
			anchor.parent.insertBefore(chip.host, anchor.before);
			chip.parent = anchor.parent;
			chip.before = anchor.before;
		}

		if (chip.signature !== signature) {
			renderChip(chip, context.document, view, signal);
			chip.signature = signature;
		}

		return;
	}

	const host = context.document.createElement("div");

	host.setAttribute(CHIP_ROOT_ATTRIBUTE, "");
	markMergeRequestListActionSlot(host, "remembered-filters");
	chip.host = host;
	renderChip(chip, context.document, view, signal);
	chip.signature = signature;
	anchor.parent.insertBefore(host, anchor.before);
	chip.parent = anchor.parent;
	chip.before = anchor.before;
}
