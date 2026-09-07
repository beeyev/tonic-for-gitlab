import type {
	Feature,
	FeatureContext,
	FeaturePageCompatibility,
} from "../../content/runtime/feature-context";
import { createOwnedAttributeRegistry } from "../../content/runtime/owned-attributes";
import { isMergeRequestDetailPath } from "../../content/runtime/page-context";
import {
	COMMENT_BUTTON_GROUP_SELECTOR,
	COMMENT_FORM_SELECTORS,
	COMMENT_TYPE_ITEM_SELECTOR,
	THREAD_DEFAULT_FORM_ATTRIBUTE,
	THREAD_TYPE_ITEM_SELECTOR,
} from "./selectors";

export const START_THREADS_BY_DEFAULT_ID = "start-threads-by-default";

const ownedAttributes = createOwnedAttributeRegistry();

/**
 * Forms this feature has already selected a thread on, for as long as GitLab
 * keeps the element.
 *
 * The marker attribute cannot answer this on its own, because it belongs to the
 * activation signal and abort clears it. Disabling the setting and enabling it
 * again on the same page would then look like an unhandled form and select
 * again, overruling a user who had switched back to "Comment" in between. That
 * is the only case the second selection would be visible in at all: cleanup
 * does not revert the selection, so a form nobody touched afterwards is still
 * on "Start thread" when the feature comes back.
 */
const handledForms = new WeakSet<HTMLElement>();

function resolveCommentForm(document: Document): HTMLElement | undefined {
	for (const selector of COMMENT_FORM_SELECTORS) {
		const forms = document.querySelectorAll<HTMLElement>(selector);

		if (forms.length === 1) {
			return forms[0];
		}
	}

	return undefined;
}

/**
 * The comment-type control inside a resolved form, resolved all at once. Both
 * options must be present before anything is touched: an element labelled
 * "Start thread" with no "Comment" beside it is not GitLab's two-choice control,
 * and selecting it would take away a choice this feature promises to leave
 * intact.
 */
function resolveThreadItem(form: HTMLElement): HTMLElement | undefined {
	const group = form.querySelector(COMMENT_BUTTON_GROUP_SELECTOR);
	const commentItem = group?.querySelector(COMMENT_TYPE_ITEM_SELECTOR);
	const threadItem = group?.querySelector<HTMLElement>(
		THREAD_TYPE_ITEM_SELECTOR,
	);

	return commentItem && threadItem ? threadItem : undefined;
}

export function getStartThreadsByDefaultCompatibility(
	context: FeatureContext,
): FeaturePageCompatibility {
	/*
	 * No merge request, or no comment form yet, is not a compatibility failure:
	 * a signed-out reader gets no comment form at all, and on a signed-in page
	 * the form is rendered by Vue after load, so every runtime pass before that
	 * lands here too.
	 */
	if (!isMergeRequestDetailPath(context.location.pathname)) {
		return "not-applicable";
	}

	const form = resolveCommentForm(context.document);

	if (!form) {
		return "not-applicable";
	}

	return resolveThreadItem(form) ? "supported" : "unsupported";
}

function reconcileCommentType(
	context: FeatureContext,
	signal: AbortSignal,
): void {
	if (signal.aborted) {
		return;
	}

	const ownedState = ownedAttributes.forSignal(signal);
	const form = resolveCommentForm(context.document);
	const threadItem = form ? resolveThreadItem(form) : undefined;

	// Never a partial mutation: a missing form or a changed comment-type control
	// clears what the feature owns instead of acting on half a contract.
	if (!form || !threadItem) {
		ownedState.clear();
		return;
	}

	// A form GitLab replaced drops its marker, so the new one is preselected.
	ownedState.retain([form]);

	/*
	 * Once per form element, and never again for that element. The user may
	 * switch back to "Comment" at any time, and reconciliation runs on every
	 * observed mutation, so a second selection would overrule that choice.
	 */
	if (!handledForms.has(form)) {
		if (threadItem.getAttribute("aria-selected") !== "true") {
			threadItem.click();
		}

		handledForms.add(form);
	}

	// Re-marking a form already handled is what keeps the marker an accurate
	// record of the feature's state after an abort removed it.
	ownedState.set(form, THREAD_DEFAULT_FORM_ATTRIBUTE, true);
}

export const startThreadsByDefault: Feature = {
	id: START_THREADS_BY_DEFAULT_ID,
	mutationSelectors: [COMMENT_BUTTON_GROUP_SELECTOR],
	// The page, not the DOM. The comment form mounts after load, so a DOM check
	// here would make activation flap between runtime passes; reconciliation
	// already treats a missing form as a safe no-op.
	matches({ location }) {
		return isMergeRequestDetailPath(location.pathname);
	},
	activate(context, signal) {
		reconcileCommentType(context, signal);
	},
	reconcile(context, signal) {
		reconcileCommentType(context, signal);
	},
};

/*
 * Cleanup removes the marker attribute through the registry and deliberately
 * leaves the selection alone. The feature performs exactly the one-time action
 * a user would perform through GitLab's own control, and by the time the
 * feature is aborted or disabled the selected type may be the user's own later
 * choice; reverting it would discard that. Turning the setting off therefore
 * takes effect on the next comment form rather than on the open one.
 */
