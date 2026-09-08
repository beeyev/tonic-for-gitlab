import { describe, expect, test } from "bun:test";
import {
	BUILT_IN_ORIGIN,
	isTargetOrigin,
	parseTargetOrigin,
	resolveTargetOrigin,
	toContentScriptId,
	toOriginPattern,
} from "./target-origin";

describe("target origin normalization", () => {
	test("assumes https for a bare host but never downgrades an explicit scheme", () => {
		expect(parseTargetOrigin("gitlab.example.com")).toEqual({
			status: "accepted",
			origin: "https://gitlab.example.com",
		});
		expect(parseTargetOrigin("http://gitlab.example.com")).toEqual({
			status: "accepted",
			origin: "http://gitlab.example.com",
		});
	});

	/*
	 * Self-managed GitLab on a private network is routinely plain HTTP, and the
	 * verification lab in `lab/` is HTTP on localhost with a non-default port.
	 */
	test("accepts plain HTTP, ports, dotless hosts, and IP hosts", () => {
		expect(parseTargetOrigin("http://localhost:10019")).toEqual({
			status: "accepted",
			origin: "http://localhost:10019",
		});
		expect(parseTargetOrigin("http://gitlab:8080")).toEqual({
			status: "accepted",
			origin: "http://gitlab:8080",
		});
		expect(parseTargetOrigin("http://10.1.2.3")).toEqual({
			status: "accepted",
			origin: "http://10.1.2.3",
		});
	});

	test("drops path, query, and fragment instead of refusing a pasted link", () => {
		expect(
			parseTargetOrigin(
				"https://gitlab.example.com/group/-/merge_requests?scope=all#note_1",
			),
		).toEqual({ status: "accepted", origin: "https://gitlab.example.com" });
	});

	test("normalizes a default port and surrounding whitespace away", () => {
		expect(parseTargetOrigin("  https://gitlab.example.com:443/  ")).toEqual({
			status: "accepted",
			origin: "https://gitlab.example.com",
		});
	});

	test("names each refusal instead of collapsing them", () => {
		expect(parseTargetOrigin("   ")).toEqual({
			status: "rejected",
			reason: "empty",
		});
		expect(parseTargetOrigin("ftp://gitlab.example.com")).toEqual({
			status: "rejected",
			reason: "unsupported-protocol",
		});
		expect(parseTargetOrigin("chrome://extensions")).toEqual({
			status: "rejected",
			reason: "unsupported-protocol",
		});
		expect(parseTargetOrigin("https://user:secret@gitlab.example.com")).toEqual(
			{
				status: "rejected",
				reason: "credentials-not-allowed",
			},
		);
		expect(parseTargetOrigin("https://")).toEqual({
			status: "rejected",
			reason: "invalid-url",
		});
		expect(parseTargetOrigin("javascript:alert(1)")).toEqual({
			status: "rejected",
			reason: "invalid-url",
		});
	});

	/*
	 * `URL` accepts a wildcard hostname and Chrome reads it as a match-pattern
	 * wildcard, so this turned an exact-origin request into permission for every
	 * host. Typing a bare wildcard asked for access to every https site.
	 */
	test("refuses wildcard hosts that would become broad match patterns", () => {
		for (const input of [
			"*",
			"http://*",
			"https://*.example.com",
			"https://*.*",
		]) {
			expect(parseTargetOrigin(input)).toEqual({
				status: "rejected",
				reason: "invalid-url",
			});
		}
	});

	/*
	 * These parsed, normalized to origins like `https://..`, and were persisted,
	 * and then failed forever: Chrome's match-pattern parser rejects them, so the
	 * permission request errored and the row kept a `Grant access` button that
	 * could never succeed. Parsing exists to name a bad input at the field.
	 */
	test("refuses hostnames with an empty or punctuation-only label", () => {
		for (const input of [
			"..",
			"-",
			"_",
			"gitlab..com",
			".gitlab.com",
			"gitlab.com.",
			"-gitlab.com",
			"gitlab-.com",
		]) {
			expect(parseTargetOrigin(input)).toEqual({
				status: "rejected",
				reason: "invalid-url",
			});
		}
	});

	test("still accepts the hosts a self-managed GitLab really uses", () => {
		for (const input of [
			"https://gitlab.example.com",
			"http://localhost:10019",
			"http://gitlab",
			"http://10.1.2.3",
			"http://[::1]:8080",
			"https://git_lab.example.com",
		]) {
			expect(parseTargetOrigin(input).status).toBe("accepted");
		}
	});

	test("refuses the built-in origin and anything already configured", () => {
		expect(resolveTargetOrigin("gitlab.com", [])).toEqual({
			status: "rejected",
			reason: "built-in",
		});
		expect(resolveTargetOrigin("https://gitlab.com:8443", [])).toEqual({
			status: "rejected",
			reason: "built-in",
		});
		expect(resolveTargetOrigin("http://gitlab.com", []).status).toBe(
			"accepted",
		);
		expect(
			resolveTargetOrigin("https://gitlab.example.com/group", [
				"https://gitlab.example.com",
			]),
		).toEqual({ status: "rejected", reason: "duplicate" });
	});

	test("recognizes only values that are already their own normalized form", () => {
		expect(isTargetOrigin(BUILT_IN_ORIGIN)).toBe(true);
		expect(isTargetOrigin("http://localhost:10019")).toBe(true);
		expect(isTargetOrigin("gitlab.com")).toBe(false);
		expect(isTargetOrigin("https://gitlab.com/")).toBe(false);
		expect(isTargetOrigin("https://gitlab.com/group")).toBe(false);
		expect(isTargetOrigin(undefined)).toBe(false);
		expect(isTargetOrigin(42)).toBe(false);
	});
});

describe("derived identifiers", () => {
	test("uses one browser permission scope for every port on a hostname", () => {
		expect(toOriginPattern("http://localhost:10019")).toBe(
			"http://localhost/*",
		);
		expect(toOriginPattern("http://gitlab.example.com")).toBe(
			"http://gitlab.example.com/*",
		);
		expect(toOriginPattern("https://gitlab.example.com")).toBe(
			"https://gitlab.example.com/*",
		);
		expect(toOriginPattern("http://[::1]:8080")).toBe("http://[::1]/*");
	});

	test("is stable for one origin and distinct for origins a substitution would merge", () => {
		expect(toContentScriptId("https://a.b")).toBe(
			toContentScriptId("https://a.b"),
		);
		expect(toContentScriptId("https://a.b")).not.toBe(
			toContentScriptId("https://a-b"),
		);
		expect(toContentScriptId("https://a.b:8443")).toBe(
			toContentScriptId("https://a.b"),
		);
		expect(toContentScriptId("http://a.b")).not.toBe(
			toContentScriptId("https://a.b"),
		);
	});

	test("never produces the reserved leading underscore", () => {
		expect(
			toContentScriptId("https://gitlab.example.com").startsWith("_"),
		).toBe(false);
	});
});
