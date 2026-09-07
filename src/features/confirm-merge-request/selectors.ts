export const READY_TO_MERGE_STATE_SELECTOR =
	'[data-testid="ready_to_merge_state"]';

export const CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE =
	"data-tonic-for-gitlab-confirm-merge-request-dialog";

export const CONFIRM_MERGE_REQUEST_DIALOG_PANEL_ATTRIBUTE =
	"data-tonic-for-gitlab-confirm-merge-request-dialog-panel";

export const CONFIRM_MERGE_REQUEST_DIALOG_DESCRIPTION_ATTRIBUTE =
	"data-tonic-for-gitlab-confirm-merge-request-dialog-description";

export const CONFIRM_MERGE_REQUEST_DIALOG_ACTIONS_ATTRIBUTE =
	"data-tonic-for-gitlab-confirm-merge-request-dialog-actions";

export const CONFIRM_MERGE_REQUEST_CANCEL_ATTRIBUTE =
	"data-tonic-for-gitlab-confirm-merge-request-cancel";

export const CONFIRM_MERGE_REQUEST_CONTINUE_ATTRIBUTE =
	"data-tonic-for-gitlab-confirm-merge-request-continue";

export interface MergeActionContract {
	fallbackLabel: string;
	selector: string;
}

/**
 * GitLab's primary action covers both immediate merge and auto-merge. Dropdown
 * actions stay under GitLab's control because merge-train variants already
 * open GitLab confirmation dialogs, while other variants do not expose enough
 * DOM state to distinguish that behavior before their click is dispatched.
 */
export const MERGE_ACTION_CONTRACTS: readonly MergeActionContract[] = [
	{
		fallbackLabel: "Merge",
		selector: '[data-testid="merge-button"]',
	},
];

export const MERGE_ACTION_SELECTOR = MERGE_ACTION_CONTRACTS.map(
	({ selector }) => selector,
).join(",");
