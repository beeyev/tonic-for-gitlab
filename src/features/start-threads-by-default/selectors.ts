/**
 * The main comment form, as an ordered contract rather than one hook.
 *
 * Both forms identify the same element on the supported versions. The test ID
 * is the documented hook and comes first; the class pair is the older hook and
 * is the one that stays unique to the *main* form if GitLab ever gives a thread
 * reply form the same test ID. A selector is used only when it resolves exactly
 * one element, so an ambiguous first entry falls through instead of guessing.
 */
export const COMMENT_FORM_SELECTORS = [
	'form[data-testid="comment-form"]',
	"form.js-main-target-form.common-note-form",
] as const;

/**
 * GitLab's own submit-type control: a button group holding the submit button
 * and the comment-type dropdown. This is also the feature's mutation selector,
 * deliberately narrower than the form: the runtime unions selectors across
 * features, so a form-level selector would wake every feature on each keystroke
 * in the rich text editor.
 */
export const COMMENT_BUTTON_GROUP_SELECTOR = '[data-testid="comment-button"]';

/**
 * The dropdown's listbox items. GitLab renders the listbox while the dropdown
 * is collapsed, so both options are resolvable without opening anything.
 */
export const COMMENT_TYPE_ITEM_SELECTOR =
	'[role="option"][data-testid="listbox-item-comment"]';

export const THREAD_TYPE_ITEM_SELECTOR =
	'[role="option"][data-testid="listbox-item-discussion"]';

/** Marks a comment form this feature has already preselected a thread on. */
export const THREAD_DEFAULT_FORM_ATTRIBUTE =
	"data-tonic-for-gitlab-start-threads-by-default";
