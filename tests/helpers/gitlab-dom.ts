import { Window } from "happy-dom";

const fixtureDirectory = new URL("../fixtures/gitlab/", import.meta.url);
const openWindows: Window[] = [];

export type MergeRequestContractSurface = "project" | "group" | "dashboard";
export type MergeRequestMergeWidgetScenario =
	| "auto-merge"
	| "immediate"
	| "merge-train";
export type BroadcastBannerScenario = "native-dismissible" | "non-dismissible";

export interface MergeRequestContractFixture {
	markup: string;
	page: string;
}

export async function readMergeRequestContractFixture(
	version: "18" | "19",
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
	version: "18" | "19",
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
	version: "18" | "19",
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
	version: "18" | "19",
): Promise<string> {
	return Bun.file(
		new URL(
			`${version}/merge-request-comment-form/form.html`,
			fixtureDirectory,
		),
	).text();
}

export async function readMergeRequestMergeWidgetFixture(
	version: "18" | "19",
	scenario: MergeRequestMergeWidgetScenario,
): Promise<string> {
	return Bun.file(
		new URL(
			`${version}/merge-request-merge-widget/${scenario}.html`,
			fixtureDirectory,
		),
	).text();
}

export async function readMergeRequestHeaderFixture(
	version: "18" | "19" | "gitlab-com-public",
): Promise<string> {
	const path =
		version === "gitlab-com-public"
			? "19/merge-request-header/gitlab-com-public.html"
			: `${version}/merge-request-header/header.html`;

	return Bun.file(new URL(path, fixtureDirectory)).text();
}

export async function readObservedGitLab18MergeRequestListFixture(): Promise<string> {
	return Bun.file(
		new URL("18/merge-request-list/observed-public.html", fixtureDirectory),
	).text();
}

/**
 * The CI job log top bar and two section-header log lines. There is one
 * baseline because the top bar template and the section header markup are the
 * same in 18.11 and current master; a version-specific fixture waits for an
 * observed difference.
 */
export async function readJobLogFixture(): Promise<string> {
	return Bun.file(
		new URL("19/job-log/top-bar-and-sections.html", fixtureDirectory),
	).text();
}

export async function readTopBarFixture(version: "18" | "19"): Promise<string> {
	const fileName = version === "18" ? "signed-in.html" : "signed-out.html";
	return Bun.file(
		new URL(`${version}/top-bar/${fileName}`, fixtureDirectory),
	).text();
}

export async function readDuoAgentPlatformFixture(
	version: "18" | "19",
): Promise<string> {
	return Bun.file(
		new URL(
			`${version}/duo-agent-platform/entrypoint-only.html`,
			fixtureDirectory,
		),
	).text();
}

/**
 * The repository file tree browser carrying GitLab's "Provide feedback" link.
 * The two versions differ in where the link sits: 18.7 through 19.0 render it
 * inside the panel, 19.1 renders it as a fixed-position sibling, and 19.2
 * removed it.
 */
export async function readFileTreeBrowserFeedbackFixture(
	version: "18" | "19",
): Promise<string> {
	return Bun.file(
		new URL(
			`${version}/file-tree-browser/feedback-link.html`,
			fixtureDirectory,
		),
	).text();
}

export async function readBroadcastBannerFixture(
	version: "18" | "19",
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
