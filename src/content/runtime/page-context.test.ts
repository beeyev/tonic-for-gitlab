import { describe, expect, test } from "bun:test";
import {
	isJobDetailPath,
	isMergeRequestDetailPath,
	isMergeRequestListPath,
	isRepositoryFilePath,
} from "./page-context";

describe("isMergeRequestListPath", () => {
	test.each([
		["/dashboard/merge_requests", true],
		["/dashboard/merge_requests/", true],
		["/group/project/-/merge_requests", true],
		["/groups/example/-/merge_requests", true],
		["/group/project/-/merge_requests/42", false],
		["/group/project/-/issues", false],
		["/", false],
	] as const)("classifies %s", (pathname, expected) => {
		expect(isMergeRequestListPath(pathname)).toBe(expected);
	});
});

describe("relative URL root installations", () => {
	/*
	 * Targets are origins with no path prefix, so a GitLab under
	 * `https://intranet.example/gitlab` reaches the content script for the whole
	 * origin and the page contract has to be what decides. An absolute dashboard
	 * path made that false for exactly one page type.
	 */
	test("matches the dashboard queue under a relative URL root", () => {
		expect(isMergeRequestListPath("/gitlab/dashboard/merge_requests")).toBe(
			true,
		);
		expect(isMergeRequestListPath("/gitlab/dashboard/merge_requests/")).toBe(
			true,
		);
		expect(isMergeRequestListPath("/deep/root/dashboard/merge_requests")).toBe(
			true,
		);
	});

	test("still matches root-mounted and project lists", () => {
		expect(isMergeRequestListPath("/dashboard/merge_requests")).toBe(true);
		expect(
			isMergeRequestListPath("/gitlab/group/project/-/merge_requests"),
		).toBe(true);
	});

	test("does not match a path that merely mentions merge requests", () => {
		expect(isMergeRequestListPath("/dashboard/merge_requests_archive")).toBe(
			false,
		);
		expect(isMergeRequestListPath("/help/dashboard/merge_requests/new")).toBe(
			false,
		);
	});
});

describe("isMergeRequestDetailPath", () => {
	test.each([
		["/group/project/-/merge_requests/42", true],
		["/group/project/-/merge_requests/42/", true],
		["/group/project/-/merge_requests/42/diffs", true],
		["/group/project/-/merge_requests/42/commits", true],
		["/gitlab/group/project/-/merge_requests/42", true],
		["/deep/root/group/project/-/merge_requests/1", true],
		// A new merge request has no IID, and no comment form either.
		["/group/project/-/merge_requests/new", false],
		["/group/project/-/merge_requests", false],
		["/group/project/-/merge_requests/", false],
		["/group/project/-/issues/42", false],
		["/dashboard/merge_requests", false],
		["/", false],
	] as const)("classifies %s", (pathname, expected) => {
		expect(isMergeRequestDetailPath(pathname)).toBe(expected);
	});
});

describe("isJobDetailPath", () => {
	test.each([
		["/group/project/-/jobs/42", true],
		["/group/project/-/jobs/42/", true],
		["/gitlab/group/project/-/jobs/42", true],
		["/deep/root/group/subgroup/project/-/jobs/1", true],
		// A separate full-log Vue application on the same job ID.
		["/group/project/-/jobs/42/viewer", false],
		["/group/project/-/jobs/42/raw", false],
		["/group/project/-/jobs/42/artifacts/browse", false],
		["/group/project/-/jobs", false],
		["/group/project/-/jobs/", false],
		["/group/project/-/jobs/new", false],
		["/group/project/-/pipelines/42", false],
		["/", false],
	] as const)("classifies %s", (pathname, expected) => {
		expect(isJobDetailPath(pathname)).toBe(expected);
	});
});

describe("isRepositoryFilePath", () => {
	test.each([
		["/group/project/-/tree/main", true],
		["/group/project/-/tree/main/modules/network", true],
		["/group/project/-/blob/main/versions.tf", true],
		["/gitlab/group/project/-/blob/main/README.md", true],
		["/group/subgroup/project/-/tree/release%2F1.0/src", true],
		// The project overview renders the same partial, but the browser's router
		// suppresses it there and the path carries no tree or blob segment.
		["/group/project", false],
		["/group/project/-/tree", false],
		["/group/project/-/merge_requests/42/diffs", false],
		["/group/project/-/blame/main/versions.tf", false],
		["/", false],
	] as const)("classifies %s", (pathname, expected) => {
		expect(isRepositoryFilePath(pathname)).toBe(expected);
	});
});
