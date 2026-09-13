import { Window } from "happy-dom";

const fixtureDirectory = new URL("../fixtures/gitlab/", import.meta.url);
/**
 * GitLab.com is a deployment, not a major: it ships from master and has no
 * release number to file under. Keeping it outside the major tree is what stops
 * it from being cloned into the next major's directory, and from disappearing
 * with the oldest one.
 */
const gitLabComFixtureDirectory = new URL(
	"../fixtures/gitlab-com/",
	import.meta.url,
);
const openWindows: Window[] = [];

/**
 * The GitLab majors this build is tested against, and the single list every
 * version matrix reads. Each entry owns one `../fixtures/gitlab/<major>/`
 * directory and one lab service in `../../lab/compose.yaml`; supporting a new
 * major means adding those two things and appending here, not editing readers
 * or tests.
 *
 * Only the major is an axis. A contract that differs inside one major is a
 * named scenario instead, because the directory cannot express a minor.
 */
export const SUPPORTED_GITLAB_MAJORS = ["19"] as const;
export type GitLabMajor = (typeof SUPPORTED_GITLAB_MAJORS)[number];

export type MergeRequestContractSurface = "project" | "group" | "dashboard";
export type MergeRequestMergeWidgetScenario =
	| "auto-merge"
	| "immediate"
	| "merge-train";
export type BroadcastBannerScenario = "native-dismissible" | "non-dismissible";
export type TopBarScenario = "signed-in" | "signed-out";

export interface MergeRequestContractFixture {
	markup: string;
	page: string;
}

export async function readMergeRequestContractFixture(
	version: GitLabMajor,
	surface: MergeRequestContractSurface,
): Promise<MergeRequestContractFixture> {
	const markup = await Bun.file(
		new URL(
			`${version}/merge-request-contract/${surface}.html`,
			fixtureDirectory,
		),
	).text();
	const page = /^Page identifier: ([^\r\n]+)$/m.exec(markup)?.[1]?.trim();

	if (!page) {
		throw new Error(
			`GitLab ${version} ${surface} contract fixture has no page identifier`,
		);
	}

	return { markup, page };
}

export async function readMergeRequestListFixture(
	version: GitLabMajor,
): Promise<string> {
	return Bun.file(
		new URL(`${version}/merge-request-list/list.html`, fixtureDirectory),
	).text();
}

/**
 * The navigation, state tab, and filtered search bar contract, which the plain
 * list fixtures do not carry.
 */
export async function readMergeRequestListFiltersFixture(
	version: GitLabMajor,
): Promise<string> {
	return Bun.file(
		new URL(`${version}/merge-request-list/filters.html`, fixtureDirectory),
	).text();
}

/**
 * The main comment form on a merge request detail page, with GitLab's
 * comment-type dropdown collapsed, which is how it is rendered before a user
 * opens it.
 */
export async function readMergeRequestCommentFormFixture(
	version: GitLabMajor,
): Promise<string> {
	return Bun.file(
		new URL(
			`${version}/merge-request-comment-form/form.html`,
			fixtureDirectory,
		),
	).text();
}

export async function readMergeRequestMergeWidgetFixture(
	version: GitLabMajor,
	scenario: MergeRequestMergeWidgetScenario,
): Promise<string> {
	return Bun.file(
		new URL(
			`${version}/merge-request-merge-widget/${scenario}.html`,
			fixtureDirectory,
		),
	).text();
}

/** The merge request detail tab bar with the approvals widget section. */
export async function readMergeRequestTabBarFixture(
	version: GitLabMajor,
): Promise<string> {
	return Bun.file(
		new URL(
			`${version}/merge-request-tab-bar/tabs-and-approvals.html`,
			fixtureDirectory,
		),
	).text();
}

export async function readMergeRequestHeaderFixture(
	version: GitLabMajor,
): Promise<string> {
	return Bun.file(
		new URL(`${version}/merge-request-header/header.html`, fixtureDirectory),
	).text();
}

/**
 * The same header as rendered by GitLab.com, which deploys from master rather
 * than a numbered release and wraps the action cluster differently. Deployment
 * is its own axis, so this is a separate reader over a separate tree instead of
 * a version value.
 */
export async function readGitLabComMergeRequestHeaderFixture(): Promise<string> {
	return Bun.file(
		new URL("merge-request-header/header.html", gitLabComFixtureDirectory),
	).text();
}

/** The CI job log top bar and two section-header log lines. */
export async function readJobLogFixture(version: GitLabMajor): Promise<string> {
	return Bun.file(
		new URL(`${version}/job-log/top-bar-and-sections.html`, fixtureDirectory),
	).text();
}

/**
 * The top bar, whose action cluster differs by session rather than by version:
 * signed in it ends in the user menu, signed out in the register and sign-in
 * controls. The control panel anchors before whichever is present.
 */
export async function readTopBarFixture(
	version: GitLabMajor,
	scenario: TopBarScenario,
): Promise<string> {
	return Bun.file(
		new URL(`${version}/top-bar/${scenario}.html`, fixtureDirectory),
	).text();
}

export async function readDuoAgentPlatformFixture(
	version: GitLabMajor,
): Promise<string> {
	return Bun.file(
		new URL(
			`${version}/duo-agent-platform/entrypoint-only.html`,
			fixtureDirectory,
		),
	).text();
}

export async function readBroadcastBannerFixture(
	version: GitLabMajor,
	scenario: BroadcastBannerScenario,
): Promise<string> {
	return Bun.file(
		new URL(`${version}/broadcast-banner/${scenario}.html`, fixtureDirectory),
	).text();
}

/**
 * The `data-page` attribute is not decoration. GitLab renders it on `body` for
 * every page, and the content runtime uses it to decide the document is GitLab
 * at all before starting, because a target is a whole origin and the script also
 * loads on whatever else that host serves. The fixtures are page fragments, so
 * without it every one of them would look like a foreign document.
 */
export function createGitLabTestWindow(
	markup: string,
	url = "https://gitlab.com/example/project/-/merge_requests",
	page = "projects:merge_requests:index",
): Window {
	const testWindow = new Window({ url });
	testWindow.document.write(
		`<!doctype html><html><body data-page="${page}">${markup}</body></html>`,
	);
	openWindows.push(testWindow);
	return testWindow;
}

export function asBrowserWindow(testWindow: Window): globalThis.Window {
	return testWindow as unknown as globalThis.Window;
}

export async function settleGitLabDom(testWindow: Window): Promise<void> {
	await testWindow.happyDOM.waitUntilComplete();
}

export function closeGitLabTestWindows(): void {
	for (const testWindow of openWindows.splice(0)) {
		testWindow.close();
	}
}
