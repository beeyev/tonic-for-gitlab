export const MERGE_REQUEST_TABS_CONTAINER_SELECTOR =
	".merge-request-tabs-container";

export const MERGE_REQUEST_TABS_ACTIONS_SELECTOR =
	".merge-request-tabs-actions";

export const MERGE_REQUEST_APPROVALS_SELECTOR = ".js-mr-approvals";

/**
 * GitLab renders one approve control or none. The label is GitLab's own and
 * covers `Approve`, `Approve additionally`, `Revoke approval`, and the SAML
 * variant, which is a submit button inside `[data-testid="approve-form"]` and
 * carries the same test ID.
 */
export const MERGE_REQUEST_APPROVE_BUTTON_SELECTOR = `${MERGE_REQUEST_APPROVALS_SELECTOR} [data-testid="approve-button"]`;

export const APPROVE_MERGE_REQUEST_FROM_TABS_ATTRIBUTE =
	"data-tonic-for-gitlab-approve-merge-request-from-tabs";
