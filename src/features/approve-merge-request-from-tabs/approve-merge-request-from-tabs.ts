import type {
	Feature,
	FeatureContext,
	FeaturePageCompatibility,
} from "../../content/runtime/feature-context";
import { createOwnedAttributeRegistry } from "../../content/runtime/owned-attributes";
import { isMergeRequestDetailPath } from "../../content/runtime/page-context";
import {
	APPROVE_MERGE_REQUEST_FROM_TABS_ATTRIBUTE,
	MERGE_REQUEST_APPROVALS_SELECTOR,
	MERGE_REQUEST_APPROVE_BUTTON_SELECTOR,
	MERGE_REQUEST_TABS_ACTIONS_SELECTOR,
	MERGE_REQUEST_TABS_CONTAINER_SELECTOR,
} from "./selectors";

export const APPROVE_MERGE_REQUEST_FROM_TABS_ID =
	"approve-merge-request-from-tabs";

/**
 * The widget button is `btn-sm` (24px) while every neighbour in the tab bar is
 * `btn-md` (32px). Only the size class is exchanged, so variant, category and
 * the in-flight `disabled` class stay whatever GitLab rendered.
 */
const SOURCE_SIZE_CLASS = "btn-sm";
const MIRRORED_SIZE_CLASS = "btn-md";
const SIZE_CLASSES = new Set(["btn-sm", "btn-md", "btn-lg"]);

interface TabBarContract {
	actions: HTMLElement;
	container: HTMLElement;
	label: string;
	realButton: HTMLButtonElement;
}

interface MirroredButton {
	button: HTMLButtonElement;
	/** Label written into the mirror, so a stale or edited mirror is detectable. */
	renderedLabel: string | undefined;
}

/**
 * Longest label the mirror will render.
 *
 * GitLab's own labels are short. A longer string means the control is no longer
 * the one this feature understands, and a mirror whose label does not match the
 * action it forwards to is worse than no mirror, so the feature stands down.
 */
const MAX_LABEL_LENGTH = 60;

const BUTTON_TEXT_CLASS = "gl-button-text";

type TabBarResolution =
	| { status: "supported"; contract: TabBarContract }
	/** The tab bar holds, but GitLab offers no approve control to mirror. */
	| { status: "not-applicable" }
	| { status: "unsupported" };

const ownedAttributes = createOwnedAttributeRegistry();
const mirrorsBySignal = new WeakMap<AbortSignal, MirroredButton>();
const ownedButtons = new WeakSet<HTMLButtonElement>();

function queryUnique<T extends Element>(
	scope: ParentNode,
	selector: string,
	elementConstructor: abstract new (...args: never[]) => T,
): T | undefined {
	const matches = scope.querySelectorAll(selector);
	const [match] = matches;

	return matches.length === 1 && match instanceof elementConstructor
		? match
		: undefined;
}

function mirroredClassName(sourceClassName: string): string {
	const sourceClasses = sourceClassName.split(/\s+/).filter(Boolean);
	const classes = new Set(
		sourceClasses.map((className) =>
			className === SOURCE_SIZE_CLASS ? MIRRORED_SIZE_CLASS : className,
		),
	);

	// Only size an unsized source. Adding to a sized one would carry two sizes.
	if (!sourceClasses.some((className) => SIZE_CLASSES.has(className))) {
		classes.add(MIRRORED_SIZE_CLASS);
	}

	return [...classes].join(" ");
}

function resolveRealApproveButton(
	document: Document,
): HTMLButtonElement | undefined {
	const HTMLButtonElementConstructor = document.defaultView?.HTMLButtonElement;

	if (!HTMLButtonElementConstructor) {
		return undefined;
	}

	return queryUnique(
		document,
		MERGE_REQUEST_APPROVE_BUTTON_SELECTOR,
		HTMLButtonElementConstructor,
	);
}

/**
 * Whether GitLab's control is mid-request.
 *
 * Observed on 19.2.2-ce: while an approval is in flight the
 * control keeps `disabled` false and is blocked through `aria-disabled` and the
 * `disabled` class instead. Reading the property alone reports an idle control
 * and lets a forwarded click submit a second approval, which the CSS stops a
 * real pointer from doing.
 */
function controlIsBusy(realButton: HTMLButtonElement): boolean {
	return (
		realButton.disabled ||
		realButton.getAttribute("aria-disabled") === "true" ||
		realButton.classList.contains("disabled")
	);
}

/** GitLab's own label, or nothing when it is missing or not a label any more. */
function resolveLabel(realButton: HTMLButtonElement): string | undefined {
	const label = realButton.textContent?.replace(/\s+/g, " ").trim();

	return label && label.length <= MAX_LABEL_LENGTH ? label : undefined;
}

function resolveTabBar(
	context: FeatureContext,
	ownedButton?: HTMLButtonElement,
): TabBarResolution {
	const { document } = context;
	const HTMLElementConstructor = document.defaultView?.HTMLElement;
	const HTMLButtonElementConstructor = document.defaultView?.HTMLButtonElement;

	if (!HTMLElementConstructor || !HTMLButtonElementConstructor) {
		return { status: "unsupported" };
	}

	const container = queryUnique(
		document,
		MERGE_REQUEST_TABS_CONTAINER_SELECTOR,
		HTMLElementConstructor,
	);

	if (!container) {
		return { status: "unsupported" };
	}

	/*
	 * The container itself is server-rendered HAML and is not Vue-managed, so a
	 * child inserted here survives. The action cluster is not an insertion point:
	 * its children are Vue roots with `v-if` siblings.
	 */
	const actions = queryUnique(
		container,
		MERGE_REQUEST_TABS_ACTIONS_SELECTOR,
		HTMLElementConstructor,
	);

	if (!actions || actions.parentElement !== container) {
		return { status: "unsupported" };
	}

	const markedElements = document.querySelectorAll(
		`[${APPROVE_MERGE_REQUEST_FROM_TABS_ATTRIBUTE}]`,
	);
	let markedButton: HTMLButtonElement | undefined;

	for (const markedElement of markedElements) {
		if (markedElement === ownedButton) {
			continue;
		}

		if (
			ownedButton ||
			markedButton ||
			!(markedElement instanceof HTMLButtonElementConstructor) ||
			!ownedButtons.has(markedElement)
		) {
			return { status: "unsupported" };
		}

		markedButton = markedElement;
	}

	if (
		markedButton &&
		(markedButton.parentElement !== container ||
			markedButton.nextElementSibling !== actions)
	) {
		return { status: "unsupported" };
	}

	const approveButtons = document.querySelectorAll(
		MERGE_REQUEST_APPROVE_BUTTON_SELECTOR,
	);
	const [approveButton] = approveButtons;

	/*
	 * No approve control is the normal state for a user who cannot approve, and
	 * for a cold load of a non-Overview tab, where GitLab loads the widget bundle
	 * only for the `show` action. Both degrade to no mirrored button.
	 */
	if (approveButtons.length === 0) {
		return { status: "not-applicable" };
	}

	if (
		approveButtons.length > 1 ||
		!(approveButton instanceof HTMLButtonElementConstructor)
	) {
		return { status: "unsupported" };
	}

	const label = resolveLabel(approveButton);

	if (!label) {
		return { status: "unsupported" };
	}

	return {
		status: "supported",
		contract: { actions, container, label, realButton: approveButton },
	};
}

function createMirror(
	context: FeatureContext,
	signal: AbortSignal,
): MirroredButton {
	const existing = mirrorsBySignal.get(signal);

	if (existing) {
		return existing;
	}

	const button = context.document.createElement("button");
	const mirror: MirroredButton = { button, renderedLabel: undefined };

	button.type = "button";
	ownedAttributes
		.forSignal(signal)
		.set(button, APPROVE_MERGE_REQUEST_FROM_TABS_ATTRIBUTE, true);

	button.addEventListener(
		"click",
		(event) => {
			event.preventDefault();
			const realButton = resolveRealApproveButton(button.ownerDocument);

			// GitLab owns approval. Forward the gesture; never call its API.
			if (!realButton?.isConnected || controlIsBusy(realButton)) {
				return;
			}

			realButton.click();
		},
		{ signal },
	);

	/*
	 * GitLab patches this label and variant in place, as a `characterData` and a
	 * `class` record, and the runtime observes neither. Today every approval
	 * change also restructures the approvals summary in the same batch, which
	 * does schedule a reconcile, but that is GitLab's rendering detail rather
	 * than a contract. Re-reading before the pointer or keyboard can act closes
	 * the gap without widening what the shared observer listens for.
	 */
	for (const eventName of ["pointerenter", "focus"] as const) {
		button.addEventListener(
			eventName,
			() => {
				refreshFromLiveControl(mirror);
			},
			{ signal },
		);
	}

	mirrorsBySignal.set(signal, mirror);
	ownedButtons.add(button);
	signal.addEventListener(
		"abort",
		() => {
			button.remove();
			mirrorsBySignal.delete(signal);
			ownedButtons.delete(button);
		},
		{ once: true },
	);

	return mirror;
}

function repairMirror(
	mirror: MirroredButton,
	realButton: HTMLButtonElement,
	label: string,
): void {
	const { button } = mirror;
	const className = mirroredClassName(realButton.className);
	const busy = controlIsBusy(realButton);

	if (button.type !== "button") {
		button.type = "button";
	}

	if (button.className !== className) {
		button.className = className;
	}

	/* The mirror carries the property GitLab's control does not, so a forwarded
	 * click cannot reach an in-flight approval the way a pointer cannot. */
	if (button.disabled !== busy) {
		button.disabled = busy;
	}

	/*
	 * Only the label crosses over, written as text. GitLab DOM is untrusted, and
	 * the loading spinner is already carried by the mirrored `disabled` class.
	 */
	const [firstChild] = button.children;

	if (
		mirror.renderedLabel !== label ||
		button.childNodes.length !== 1 ||
		firstChild?.className !== BUTTON_TEXT_CLASS ||
		firstChild.textContent !== label
	) {
		const text = button.ownerDocument.createElement("span");
		text.className = BUTTON_TEXT_CLASS;
		text.textContent = label;
		button.replaceChildren(text);
		mirror.renderedLabel = label;
	}
}

/**
 * Repair the mirror against the live control, outside the reconcile pass.
 *
 * Placement is left alone: this runs from the mirror's own listeners, so it is
 * already mounted, and a broken contract is the reconcile pass's business.
 */
function refreshFromLiveControl(mirror: MirroredButton): void {
	const { button } = mirror;
	const realButton = resolveRealApproveButton(button.ownerDocument);
	const label = realButton ? resolveLabel(realButton) : undefined;

	if (!realButton?.isConnected || !label) {
		button.remove();
		return;
	}

	repairMirror(mirror, realButton, label);
}

function reconcile(context: FeatureContext, signal: AbortSignal): void {
	if (signal.aborted) {
		return;
	}

	const mirror = createMirror(context, signal);
	const resolution = resolveTabBar(context, mirror.button);

	if (resolution.status !== "supported") {
		mirror.button.remove();
		return;
	}

	repairMirror(
		mirror,
		resolution.contract.realButton,
		resolution.contract.label,
	);

	if (
		mirror.button.parentElement !== resolution.contract.container ||
		mirror.button.nextElementSibling !== resolution.contract.actions
	) {
		resolution.contract.container.insertBefore(
			mirror.button,
			resolution.contract.actions,
		);
	}
}

export function getApproveMergeRequestFromTabsCompatibility(
	context: FeatureContext,
): FeaturePageCompatibility {
	if (!isMergeRequestDetailPath(context.location.pathname)) {
		return "not-applicable";
	}

	return resolveTabBar(context).status;
}

export const approveMergeRequestFromTabs: Feature = {
	id: APPROVE_MERGE_REQUEST_FROM_TABS_ID,
	/*
	 * No attribute is observed. Measured on 19.2.2-ce: GitLab
	 * never sets `disabled` here, the in-flight state arrives as spinner children
	 * inside `.js-mr-approvals`, and the label and variant are patched in place,
	 * as `characterData` and `class`, which the shared observer does not carry.
	 * Adding `class` to the union would make every class change on a GitLab page
	 * a record the runtime inspects for every feature, and would still miss the
	 * label, so the mirror re-reads the live control before it can be used.
	 */
	mutationSelectors: [
		MERGE_REQUEST_TABS_CONTAINER_SELECTOR,
		MERGE_REQUEST_APPROVALS_SELECTOR,
		`[${APPROVE_MERGE_REQUEST_FROM_TABS_ATTRIBUTE}]`,
	],
	matches: ({ location }) => isMergeRequestDetailPath(location.pathname),
	activate: reconcile,
	reconcile,
};
