import { afterEach, describe, expect, test } from "bun:test";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	type MergeRequestContractFixture,
	type MergeRequestContractSurface,
	readMergeRequestContractFixture,
} from "../../../tests/helpers/gitlab-dom";
import { getDimDraftMergeRequestsCompatibility } from "../../features/dim-draft-merge-requests/dim-draft-merge-requests";
import { getHighlightAuthoredMergeRequestsCompatibility } from "../../features/highlight-authored-merge-requests/highlight-authored-merge-requests";
import { createFeatureContext } from "./feature-context";
import { resolveMergeRequestListContract } from "./merge-request-list";

const SURFACE_CONTEXT: Record<
	MergeRequestContractSurface,
	{ page: string; url: string }
> = {
	project: {
		page: "projects:merge_requests:index",
		url: "https://gitlab.com/example/project/-/merge_requests",
	},
	group: {
		page: "groups:merge_requests",
		url: "https://gitlab.com/groups/example/-/merge_requests",
	},
	dashboard: {
		page: "dashboard:merge_requests",
		url: "https://gitlab.com/dashboard/merge_requests",
	},
};

afterEach(() => {
	closeGitLabTestWindows();
});

function createContractWindow(
	fixture: string | MergeRequestContractFixture,
	surface: MergeRequestContractSurface,
) {
	const context = SURFACE_CONTEXT[surface];
	return createGitLabTestWindow(
		typeof fixture === "string" ? fixture : fixture.markup,
		context.url,
		typeof fixture === "string" ? context.page : fixture.page,
	);
}

describe("merge request list compatibility contract", () => {
	test.each([
		["18", "project", "Draft: Improve project presentation", "current.user"],
		["18", "group", "Improve group presentation", "other.user"],
		[
			"18",
			"dashboard",
			"Draft: Improve dashboard presentation",
			"current.user",
		],
		["19", "project", "Draft: Improve project presentation", "current.user"],
		["19", "group", "Improve group presentation", "other.user"],
		[
			"19",
			"dashboard",
			"Draft: Improve dashboard presentation",
			"current.user",
		],
	] as const)(
		"resolves required rows and fields for GitLab %s %s markup",
		async (version, surface, expectedTitle, expectedAuthorUsername) => {
			const testWindow = createContractWindow(
				await readMergeRequestContractFixture(version, surface),
				surface,
			);
			const contract = resolveMergeRequestListContract(
				createFeatureContext(asBrowserWindow(testWindow)),
			);

			expect(contract.status).toBe("supported");

			if (contract.status !== "supported") {
				throw new Error("Expected a supported fixture contract");
			}

			expect(contract.surface).toBe(surface);
			expect(contract.rows).toHaveLength(1);
			expect(contract.rows[0]?.title).toBe(expectedTitle);
			expect(contract.rows[0]?.authorUsername).toBe(expectedAuthorUsername);
		},
	);

	test.each([
		[
			"project",
			'<main id="content-body"><div class="issuable-list-container"><section data-testid="issuable-empty-state"></section></div></main>',
		],
		[
			"dashboard",
			'<main id="content-body"><div data-testid="merge-request-dashboard-tab" role="tabpanel" aria-hidden="false"><section data-testid="merge-request-dashboard-list"><div data-testid="crud-body"><div data-testid="crud-empty"></div></div></section></div><div data-testid="merge-request-dashboard-tab" role="tabpanel" aria-hidden="true"></div></main>',
		],
	] as const)("accepts the explicit %s empty state", (surface, markup) => {
		const testWindow = createContractWindow(markup, surface);

		expect(
			resolveMergeRequestListContract(
				createFeatureContext(asBrowserWindow(testWindow)),
			),
		).toMatchObject({ status: "supported", rows: [], surface });
	});

	test("rejects an ambiguous or incomplete structural contract", async () => {
		const { markup } = await readMergeRequestContractFixture("19", "project");
		const ambiguousWindow = createContractWindow(
			`${markup}${markup}`,
			"project",
		);
		const incompleteWindow = createContractWindow(
			'<main id="content-body"><div class="issuable-list-container"></div></main>',
			"project",
		);

		expect(
			resolveMergeRequestListContract(
				createFeatureContext(asBrowserWindow(ambiguousWindow)),
			),
		).toEqual({ status: "unsupported" });
		expect(
			resolveMergeRequestListContract(
				createFeatureContext(asBrowserWindow(incompleteWindow)),
			),
		).toEqual({ status: "unsupported" });
	});

	test.each([
		[
			"duplicate",
			'<a data-testid="issuable-title-link" href="/example/project/-/merge_requests/1">Draft: Improve project presentation</a>',
		],
		[
			"conflicting",
			'<a data-testid="issuable-title-link" href="/example/project/-/merge_requests/2">Ready: Conflicting title</a>',
		],
	] as const)("rejects %s classic title links", async (_case, extraLink) => {
		const fixture = await readMergeRequestContractFixture("19", "project");
		const testWindow = createContractWindow(fixture, "project");
		testWindow.document
			.querySelector('[data-testid="issuable-container"]')
			?.insertAdjacentHTML("beforeend", extraLink);

		expect(
			getDimDraftMergeRequestsCompatibility(
				createFeatureContext(asBrowserWindow(testWindow)),
			),
		).toBe("unsupported");
	});

	test("rejects a classic title link with an invalid merge request href", async () => {
		const fixture = await readMergeRequestContractFixture("19", "project");
		const testWindow = createContractWindow(fixture, "project");
		testWindow.document
			.querySelector('[data-testid="issuable-title-link"]')
			?.setAttribute("href", "/example/project/-/merge_requests/not-an-id");

		expect(
			getDimDraftMergeRequestsCompatibility(
				createFeatureContext(asBrowserWindow(testWindow)),
			),
		).toBe("unsupported");
	});

	test("shares one immutable contract snapshot within a reconciliation pass", async () => {
		const fixture = await readMergeRequestContractFixture("19", "project");
		const testWindow = createContractWindow(fixture, "project");
		const context = createFeatureContext(asBrowserWindow(testWindow));
		const contract = resolveMergeRequestListContract(context);

		testWindow.document
			.querySelector('[data-testid="issuable-title-link"]')
			?.remove();

		expect(resolveMergeRequestListContract(context)).toBe(contract);
		expect(Object.isFrozen(contract)).toBe(true);
		if (contract.status === "supported") {
			expect(Object.isFrozen(contract.rows)).toBe(true);
			expect(Object.isFrozen(contract.rows[0])).toBe(true);
		}
		expect(
			getDimDraftMergeRequestsCompatibility(
				createFeatureContext(asBrowserWindow(testWindow)),
			),
		).toBe("unsupported");
	});

	test("reports the affected feature when a required row field disappears", async () => {
		const testWindow = createContractWindow(
			await readMergeRequestContractFixture("19", "project"),
			"project",
		);
		const titleLink = testWindow.document.querySelector(
			'[data-testid="issuable-title-link"]',
		);
		titleLink?.remove();
		const titlePass = createFeatureContext(asBrowserWindow(testWindow));

		expect(getDimDraftMergeRequestsCompatibility(titlePass)).toBe(
			"unsupported",
		);
		expect(getHighlightAuthoredMergeRequestsCompatibility(titlePass)).toBe(
			"supported",
		);

		const author = testWindow.document.querySelector(
			'[data-testid="issuable-author"]',
		);
		author?.remove();

		expect(
			getHighlightAuthoredMergeRequestsCompatibility(
				createFeatureContext(asBrowserWindow(testWindow)),
			),
		).toBe("unsupported");
	});

	test("keeps the distinct dashboard rows visible as an unsupported feature contract", async () => {
		const testWindow = createContractWindow(
			await readMergeRequestContractFixture("19", "dashboard"),
			"dashboard",
		);
		const context = createFeatureContext(asBrowserWindow(testWindow));

		expect(resolveMergeRequestListContract(context).status).toBe("supported");
		expect(getDimDraftMergeRequestsCompatibility(context)).toBe("unsupported");
		expect(getHighlightAuthoredMergeRequestsCompatibility(context)).toBe(
			"unsupported",
		);
	});
});
