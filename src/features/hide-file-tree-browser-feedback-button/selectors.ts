/**
 * The file tree browser panel. GitLab renders this class only on the root of
 * `repository/file_tree_browser/file_tree_browser.vue`, so it scopes the search
 * without depending on the layout utilities that share that element. The
 * neighbouring `file-tree-browser-overlay`, `-peek`, `-expanded`, and
 * `-responsive` classes are separate tokens and do not match.
 */
export const FILE_TREE_BROWSER_SELECTOR = ".file-tree-browser";

/**
 * The feedback control is a `GlButton` rendered with `href`, which produces an
 * anchor, and `target="_blank"`, which the file tree browser's own repository
 * links never carry.
 */
export const EXTERNAL_LINK_SELECTOR = 'a[href][target="_blank"]';

/**
 * `GlIcon` renders `data-testid="<name>-icon"`. `comment-dots` is what tells the
 * feedback link apart from any other external link the panel may grow, and it
 * survives the feedback issue URL changing.
 */
export const FEEDBACK_ICON_SELECTOR = '[data-testid="comment-dots-icon"]';

/**
 * The 19.1 placement, where the link is a following sibling of the panel rather
 * than a child of it.
 *
 * This exists to be observable, not to resolve anything. Such a link enters the
 * DOM through a child-list record naming the shared parent, which is an ancestor
 * of the panel, so a panel-anchored selector cannot see it; the runtime tests the
 * added node itself with `closest`, and this selector matches the anchor there.
 *
 * The sibling combinator is what keeps that free. Anchoring on the shared parent
 * instead would mean watching the Rails wrapper, which also holds the rendered
 * file content, and the runtime unions selectors across every registered feature
 * before consulting `matches`, so that cost would land on every repository page
 * for every feature even when this one is switched off.
 *
 * Happy DOM handles combinators in `matches` and `closest`, but scopes the whole
 * selector to the subtree in `element.querySelector` rather than matching against
 * the document. A selector that only resolved through an ancestor combinator in
 * `querySelector` would therefore silently never match under test, which is
 * exactly where it has to be provable. This one resolves through `closest`.
 */
export const PANEL_SIBLING_FEEDBACK_LINK_SELECTOR = `${FILE_TREE_BROWSER_SELECTOR} ~ ${EXTERNAL_LINK_SELECTOR}`;

export const HIDDEN_FEEDBACK_LINK_ATTRIBUTE =
	"data-tonic-for-gitlab-hidden-file-tree-browser-feedback-link";
