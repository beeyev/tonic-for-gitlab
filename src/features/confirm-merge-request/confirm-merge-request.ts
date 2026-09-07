import type {
	Feature,
	FeatureContext,
	FeaturePageCompatibility,
} from "../../content/runtime/feature-context";
import { createOwnedAttributeRegistry } from "../../content/runtime/owned-attributes";
import { isMergeRequestDetailPath } from "../../content/runtime/page-context";
import {
	CONFIRM_MERGE_REQUEST_CANCEL_ATTRIBUTE,
	CONFIRM_MERGE_REQUEST_CONTINUE_ATTRIBUTE,
	CONFIRM_MERGE_REQUEST_DIALOG_ACTIONS_ATTRIBUTE,
	CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE,
	CONFIRM_MERGE_REQUEST_DIALOG_DESCRIPTION_ATTRIBUTE,
	CONFIRM_MERGE_REQUEST_DIALOG_PANEL_ATTRIBUTE,
	MERGE_ACTION_CONTRACTS,
	MERGE_ACTION_SELECTOR,
	type MergeActionContract,
	READY_TO_MERGE_STATE_SELECTOR,
} from "./selectors";

export const CONFIRM_MERGE_REQUEST_ID = "confirm-merge-request";

const ownedAttributes = createOwnedAttributeRegistry();
const actionElementSelector = 'button,[role="button"]';
const activeStates = new WeakMap<AbortSignal, ConfirmationState>();
let dialogInstance = 0;

interface PendingMergeAction {
	actionElement: HTMLElement;
	contract: MergeActionContract;
	marker: HTMLElement;
	root: HTMLElement;
}

interface ConfirmationState {
	bypassedMarkers: WeakSet<HTMLElement>;
	confirmation?: ConfirmationDialog;
	pending?: PendingMergeAction;
}

interface ConfirmationDialog {
	cancelButton: HTMLButtonElement;
	confirmButton: HTMLButtonElement;
	dialog: HTMLDialogElement;
	dismiss(returnValue: string): void;
}

function queryUniqueElement(
	root: ParentNode,
	selector: string,
): HTMLElement | undefined {
	const elements = root.querySelectorAll<HTMLElement>(selector);

	return elements.length === 1 ? elements[0] : undefined;
}

function resolveActionElement(marker: HTMLElement): HTMLElement | undefined {
	if (marker.matches(actionElementSelector)) {
		return marker;
	}

	return queryUniqueElement(marker, actionElementSelector);
}

function actionCanDispatchClick(actionElement: HTMLElement): boolean {
	return !(
		actionElement.tagName === "BUTTON" &&
		(actionElement as HTMLButtonElement).disabled
	);
}

function resolveReadyStateRoot(document: Document): HTMLElement | undefined {
	return queryUniqueElement(document, READY_TO_MERGE_STATE_SELECTOR);
}

function resolveClickedMergeAction(
	document: Document,
	target: EventTarget | null,
): PendingMergeAction | undefined {
	if (!target || !("nodeType" in target) || target.nodeType !== 1) {
		return undefined;
	}
	const targetElement = target as HTMLElement;

	const root = resolveReadyStateRoot(document);

	if (!root) {
		return undefined;
	}

	for (const contract of MERGE_ACTION_CONTRACTS) {
		const marker = targetElement.closest<HTMLElement>(contract.selector);

		if (
			!marker ||
			!root.contains(marker) ||
			queryUniqueElement(root, contract.selector) !== marker
		) {
			continue;
		}

		const actionElement = resolveActionElement(marker);

		if (!actionElement || !actionCanDispatchClick(actionElement)) {
			return undefined;
		}

		return { actionElement, contract, marker, root };
	}

	return undefined;
}

function pendingActionIsCurrent(
	document: Document,
	pending: PendingMergeAction,
): boolean {
	if (
		!pending.root.isConnected ||
		!pending.marker.isConnected ||
		!pending.actionElement.isConnected ||
		!actionCanDispatchClick(pending.actionElement)
	) {
		return false;
	}

	const root = resolveReadyStateRoot(document);

	return (
		root === pending.root &&
		queryUniqueElement(root, pending.contract.selector) === pending.marker &&
		resolveActionElement(pending.marker) === pending.actionElement
	);
}

function resolveCompatibility(
	context: FeatureContext,
): FeaturePageCompatibility {
	if (!isMergeRequestDetailPath(context.location.pathname)) {
		return "not-applicable";
	}

	const roots = context.document.querySelectorAll(
		READY_TO_MERGE_STATE_SELECTOR,
	);

	if (roots.length === 0) {
		return "not-applicable";
	}

	if (roots.length !== 1) {
		return "unsupported";
	}

	const root = roots[0];
	let foundAction = false;

	for (const { selector } of MERGE_ACTION_CONTRACTS) {
		const markers = root.querySelectorAll<HTMLElement>(selector);

		if (markers.length > 1) {
			return "unsupported";
		}

		const marker = markers[0];

		if (!marker) {
			continue;
		}

		foundAction = true;

		if (!resolveActionElement(marker)) {
			return "unsupported";
		}
	}

	return foundAction ? "supported" : "not-applicable";
}

function normalizedActionLabel(
	actionElement: HTMLElement,
	contract: MergeActionContract,
): string {
	const label = actionElement.textContent?.replace(/\s+/g, " ").trim();

	return label && label.length <= 80 ? label : contract.fallbackLabel;
}

function focusMergeWidgetRoot(root: HTMLElement, signal: AbortSignal): void {
	if (!root.isConnected) {
		return;
	}

	const hadTabIndex = root.hasAttribute("tabindex");

	if (!hadTabIndex) {
		root.setAttribute("tabindex", "-1");
		const clearTemporaryTabIndex = () => {
			if (root.getAttribute("tabindex") === "-1") {
				root.removeAttribute("tabindex");
			}
		};
		root.addEventListener("blur", clearTemporaryTabIndex, {
			once: true,
			signal,
		});
		signal.addEventListener("abort", clearTemporaryTabIndex, { once: true });
	}

	root.focus({ preventScroll: true });
}

function createConfirmationDialog(
	context: FeatureContext,
	signal: AbortSignal,
	state: ConfirmationState,
): ConfirmationDialog {
	const { document } = context;
	const instanceId = ++dialogInstance;
	const dialog = document.createElement("dialog");
	const panel = document.createElement("div");
	const title = document.createElement("h2");
	const description = document.createElement("p");
	const actions = document.createElement("div");
	const cancelButton = document.createElement("button");
	const confirmButton = document.createElement("button");
	const titleId = `tonic-confirm-merge-request-title-${instanceId}`;
	const descriptionId = `tonic-confirm-merge-request-description-${instanceId}`;

	dialog.setAttribute("data-extension-root", "true");
	dialog.setAttribute("aria-labelledby", titleId);
	dialog.setAttribute("aria-describedby", descriptionId);
	panel.setAttribute(CONFIRM_MERGE_REQUEST_DIALOG_PANEL_ATTRIBUTE, "");
	title.id = titleId;
	title.textContent = "Merge this merge request?";
	description.id = descriptionId;
	description.setAttribute(
		CONFIRM_MERGE_REQUEST_DIALOG_DESCRIPTION_ATTRIBUTE,
		"",
	);
	description.textContent =
		"GitLab will use the merge options currently shown on this merge request.";
	actions.setAttribute(CONFIRM_MERGE_REQUEST_DIALOG_ACTIONS_ATTRIBUTE, "");
	cancelButton.type = "button";
	cancelButton.setAttribute(CONFIRM_MERGE_REQUEST_CANCEL_ATTRIBUTE, "");
	cancelButton.textContent = "Cancel";
	confirmButton.type = "button";
	confirmButton.setAttribute(CONFIRM_MERGE_REQUEST_CONTINUE_ATTRIBUTE, "");
	confirmButton.textContent = "Merge";
	actions.append(cancelButton, confirmButton);
	panel.append(title, description, actions);
	dialog.append(panel);
	document.body.append(dialog);

	const ownedState = ownedAttributes.forSignal(signal);
	ownedState.set(dialog, CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE, true);

	const takePending = () => {
		const pending = state.pending;
		state.pending = undefined;
		return pending;
	};

	const restorePendingFocus = (pending: PendingMergeAction | undefined) => {
		if (
			pending?.actionElement.isConnected &&
			actionCanDispatchClick(pending.actionElement)
		) {
			pending.actionElement.focus({ preventScroll: true });
			return;
		}

		const currentRoot = resolveReadyStateRoot(document);

		if (currentRoot) {
			focusMergeWidgetRoot(currentRoot, signal);
		}
	};

	const dismiss = (returnValue = "cancel") => {
		const pending = takePending();

		if (dialog.open) {
			dialog.close(returnValue);
		}

		restorePendingFocus(pending);
	};

	const continueMergeAction = () => {
		const pending = takePending();

		if (dialog.open) {
			dialog.close("confirm");
		}

		if (!pending || !pendingActionIsCurrent(document, pending)) {
			restorePendingFocus(pending);
			return;
		}

		focusMergeWidgetRoot(pending.root, signal);
		state.bypassedMarkers.add(pending.marker);

		try {
			pending.actionElement.click();
		} finally {
			state.bypassedMarkers.delete(pending.marker);
		}
	};
	const confirmation: ConfirmationDialog = {
		cancelButton,
		confirmButton,
		dialog,
		dismiss,
	};

	cancelButton.addEventListener("click", () => dismiss("cancel"), { signal });
	confirmButton.addEventListener("click", continueMergeAction, { signal });
	dialog.addEventListener(
		"cancel",
		(event) => {
			event.preventDefault();
			dismiss("cancel");
		},
		{ signal },
	);
	dialog.addEventListener(
		"click",
		(event) => {
			if (event.target === dialog) {
				dismiss("cancel");
			}
		},
		{ signal },
	);
	return confirmation;
}

function activateConfirmation(
	context: FeatureContext,
	signal: AbortSignal,
): void {
	if (signal.aborted || activeStates.has(signal)) {
		return;
	}

	const state: ConfirmationState = {
		bypassedMarkers: new WeakSet(),
	};
	activeStates.set(signal, state);
	signal.addEventListener(
		"abort",
		() => {
			const dialog = state.confirmation?.dialog;

			state.confirmation?.dismiss("abort");
			dialog?.remove();
			activeStates.delete(signal);
		},
		{ once: true },
	);

	context.document.addEventListener(
		"click",
		(event) => {
			const pending = resolveClickedMergeAction(context.document, event.target);

			if (!pending) {
				return;
			}

			if (state.bypassedMarkers.has(pending.marker)) {
				state.bypassedMarkers.delete(pending.marker);
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			if (state.pending) {
				return;
			}

			const confirmation =
				state.confirmation ?? createConfirmationDialog(context, signal, state);
			state.confirmation = confirmation;
			state.pending = pending;
			confirmation.confirmButton.textContent = normalizedActionLabel(
				pending.actionElement,
				pending.contract,
			);
			confirmation.dialog.showModal();
			confirmation.cancelButton.focus({ preventScroll: true });
		},
		{ capture: true, signal },
	);
}

function reconcileConfirmation(
	context: FeatureContext,
	signal: AbortSignal,
): void {
	const state = activeStates.get(signal);

	if (
		state?.pending &&
		!pendingActionIsCurrent(context.document, state.pending)
	) {
		state.confirmation?.dismiss("stale-action");
	}
}

export function getConfirmMergeRequestCompatibility(
	context: FeatureContext,
): FeaturePageCompatibility {
	return resolveCompatibility(context);
}

export const confirmMergeRequest: Feature = {
	id: CONFIRM_MERGE_REQUEST_ID,
	mutationSelectors: [READY_TO_MERGE_STATE_SELECTOR, MERGE_ACTION_SELECTOR],
	matches({ location }) {
		return isMergeRequestDetailPath(location.pathname);
	},
	activate(context, signal) {
		activateConfirmation(context, signal);
	},
	reconcile(context, signal) {
		reconcileConfirmation(context, signal);
	},
};
