/**
 * Decides whether the current document is GitLab at all.
 *
 * Needed because a target is a whole origin. A GitLab mounted at
 * `https://intranet.example/gitlab` shares its origin with everything else on
 * that host, and the content script is injected into all of it. Without this
 * gate a wiki or CI server on the same host started the full feature runtime and
 * reported itself to the toolbar action as a GitLab page with a broken top bar.
 *
 * The check is permissive, but only across markers that are GitLab-specific.
 * The two failures are not symmetric: judging a real GitLab page as foreign
 * disables Tonic silently across an instance, while judging a foreign page as
 * GitLab starts the runtime there and, because the control panel matches every
 * page, reports that co-hosted app to the toolbar action as a GitLab page with a
 * broken top bar. The second is not the harmless no-op it was once documented
 * to be, which is why `#content-body` was dropped: it is a generic identifier
 * that a wiki or CI dashboard on the same host can easily also use.
 */
const GITLAB_DOCUMENT_SELECTORS = [
	"body[data-page]",
	"header.js-super-topbar",
	'link[rel="manifest"][href$="/-/manifest.json"]',
] as const;

export function isGitLabDocument(document: Document): boolean {
	return GITLAB_DOCUMENT_SELECTORS.some(
		(selector) => document.querySelector(selector) !== null,
	);
}
