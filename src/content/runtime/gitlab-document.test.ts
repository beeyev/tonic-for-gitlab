import { describe, expect, test } from "bun:test";
import { isGitLabDocument } from "./gitlab-document";

function documentWith(html: string): Document {
	const parsed = new DOMParser().parseFromString(
		`<html><head></head><body>${html}</body></html>`,
		"text/html",
	);

	return parsed;
}

describe("GitLab document detection", () => {
	/*
	 * Any one marker is enough on purpose. A false negative disables Tonic
	 * silently across a whole instance; a false positive only reaches the safe
	 * no-op the feature contract already guarantees.
	 */
	test("recognizes GitLab from its top bar alone", () => {
		expect(
			isGitLabDocument(
				documentWith('<header class="js-super-topbar"></header>'),
			),
		).toBe(true);
	});

	/*
	 * `#content-body` used to be enough. It is a generic identifier that a wiki
	 * or CI dashboard on the same host can also use, and a false positive is not
	 * harmless: the control panel matches every page, so the co-hosted app got
	 * reported to the toolbar action as GitLab with a broken top bar.
	 */
	test("does not accept a generic content identifier on its own", () => {
		expect(
			isGitLabDocument(documentWith('<div id="content-body"></div>')),
		).toBe(false);
	});

	test("recognizes GitLab from the server-rendered body page attribute", () => {
		const document = documentWith("");
		document.body.setAttribute("data-page", "explore:projects:index");

		expect(isGitLabDocument(document)).toBe(true);
	});

	test("recognizes GitLab from its own web app manifest", () => {
		const document = documentWith("");
		const link = document.createElement("link");
		link.setAttribute("rel", "manifest");
		link.setAttribute("href", "/-/manifest.json");
		document.head.append(link);

		expect(isGitLabDocument(document)).toBe(true);
	});

	test("rejects a foreign document sharing a granted origin", () => {
		expect(
			isGitLabDocument(documentWith('<div id="app"><h1>Build #42</h1></div>')),
		).toBe(false);
	});
});
