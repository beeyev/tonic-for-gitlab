/**
 * Merge request list paths, matched by suffix rather than absolute path.
 *
 * A self-managed GitLab can be mounted under a relative URL root, so the
 * personal queue is `/dashboard/merge_requests` on one instance and
 * `/gitlab/dashboard/merge_requests` on another. Targets carry no path prefix,
 * on the grounds that the page contract decides where features activate; an
 * absolute dashboard path quietly broke that promise, because it matched only
 * root-mounted instances while project lists worked everywhere.
 *
 * Suffix matching can in principle collide with an unrelated path on a granted
 * origin. It does not activate anything on its own: both features also require
 * the merge request list root and row contract to be present.
 */
export function isMergeRequestListPath(pathname: string): boolean {
	const normalizedPath = pathname.replace(/\/$/, "");

	return (
		normalizedPath.endsWith("/dashboard/merge_requests") ||
		normalizedPath.endsWith("/-/merge_requests")
	);
}

/**
 * Merge request detail paths, matched by the same suffix rule and for the same
 * relative-root reason as the list matcher above.
 *
 * The merge request IID is required, so `/-/merge_requests/new` and the list
 * itself do not match. A trailing segment is allowed, because the tab paths
 * such as `/diffs` and `/commits` are the same merge request.
 */
export function isMergeRequestDetailPath(pathname: string): boolean {
	return /\/-\/merge_requests\/\d+(?:\/|$)/.test(pathname);
}

/**
 * CI job detail paths, matched by the same relative-root reason as the merge
 * request matchers above.
 *
 * The job ID is required and nothing may follow it, so the job list
 * `/-/jobs` does not match. Neither do the surfaces that hang off the same ID:
 * `/-/jobs/:id/viewer` is a separate full-log Vue application mounted from
 * `viewer_project_job_path`, and `/-/jobs/:id/artifacts/...` browses artifacts.
 * Neither renders the job log top bar this matcher exists for.
 */
export function isJobDetailPath(pathname: string): boolean {
	return /\/-\/jobs\/\d+\/?$/.test(pathname);
}
