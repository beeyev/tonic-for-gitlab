import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { CurrentTabStatusCard, ProjectHomepageLink } from "./App";

afterEach(cleanup);

describe("current-tab recovery status", () => {
	test("renders an accessible unavailable message without raw page data", () => {
		render(
			<CurrentTabStatusCard
				status={{
					type: "tonic:control-surface:status",
					origin: "https://gitlab.com",
					status: "unavailable",
					reason: "ambiguous-anchor",
				}}
			/>,
		);

		const status = screen.getByRole("status");
		expect(status.textContent).toContain("Page controls unavailable");
		expect(status.textContent).toContain("ambiguous-anchor");
		expect(status.textContent).not.toContain("header.js-super-topbar");
	});

	test("replaces stale recovery output when the current page is mounted", () => {
		const view = render(
			<CurrentTabStatusCard
				status={{
					type: "tonic:control-surface:status",
					origin: "https://gitlab.com",
					status: "unavailable",
					reason: "missing-anchor",
				}}
			/>,
		);

		expect(screen.getByRole("status").textContent).toContain(
			"Page controls unavailable",
		);
		view.rerender(
			<CurrentTabStatusCard
				status={{
					type: "tonic:control-surface:status",
					origin: "https://gitlab.com",
					status: "mounted",
				}}
			/>,
		);

		/*
		 * The mounted state keeps the live region and reports the working case,
		 * so an opened popup is never blank. What must not survive is the
		 * recovery message itself.
		 */
		const status = screen.getByRole("status");
		expect(status.textContent).toContain("Page controls active");
		expect(status.textContent).not.toContain("unavailable");
		expect(status.textContent).not.toContain("missing-anchor");
	});

	test("keeps message failure and invalid-response states distinct", () => {
		const view = render(
			<CurrentTabStatusCard status={{ status: "message-failed" }} />,
		);
		expect(screen.getByRole("status").textContent).toBe(
			"Tonic could not contact this page. Reload it if Tonic should be active here.",
		);

		view.rerender(
			<CurrentTabStatusCard status={{ status: "invalid-response" }} />,
		);
		expect(screen.getByRole("status").textContent).toBe(
			"The page returned an invalid Tonic status response.",
		);
	});

	test("reports a foreign page on a granted origin without warning about it", () => {
		render(
			<CurrentTabStatusCard
				status={{
					type: "tonic:control-surface:status",
					origin: "https://intranet.example",
					status: "not-gitlab",
				}}
			/>,
		);

		const status = screen.getByRole("status");
		expect(status.textContent).toContain("not GitLab");
		// Not a diagnostic: nothing is broken on a page that was never GitLab.
		expect(status.textContent).not.toContain("unavailable");
	});
});

describe("project homepage link", () => {
	test("links the popup logo and title to the manifest homepage", () => {
		render(
			<ProjectHomepageLink
				homepageUrl="https://github.com/beeyev/tonic-for-gitlab"
				iconUrl="chrome-extension://test/icon64.png"
			/>,
		);

		const link = screen.getByRole("link", {
			name: "Open Tonic for GitLab project homepage",
		});
		expect(link.getAttribute("href")).toBe(
			"https://github.com/beeyev/tonic-for-gitlab",
		);
		expect(link.getAttribute("target")).toBe("_blank");
		expect(link.getAttribute("rel")).toBe("noreferrer");
		expect(link.textContent).toContain("Tonic for GitLab");
		expect(link.querySelector("img")).not.toBeNull();
	});
});
