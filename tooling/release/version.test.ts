import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { parseReleaseVersion } from "./version";

describe("release version", () => {
	test.each([
		["0.0.1", "v0.0.1"],
		["1.2.3", "v1.2.3"],
		["65535.65535.65535", "v65535.65535.65535"],
	])("accepts %s", (version, tag) => {
		expect(parseReleaseVersion(version)).toEqual({ version, tag });
	});

	test.each([
		"",
		"0.0.0",
		"01.2.3",
		"1.02.3",
		"1.2.03",
		"1.2",
		"1.2.3.4",
		"65536.0.0",
		"1.65536.0",
		"1.0.65536",
		"1.2.3-alpha.1",
		"1.2.3+build.1",
		"v1.2.3",
		" 1.2.3",
		"1.2.3 ",
		"\n1.2.3",
		"1.2.3\n",
		"1.2.3\r",
		"1.2.3\r\n",
		"1.2.3\ntag=v9.9.9",
	])("rejects %s", (version) => {
		expect(() => parseReleaseVersion(version)).toThrow();
	});
});

describe("release version CLI", () => {
	const cwd = fileURLToPath(new URL("../../", import.meta.url));

	function runValidator(version?: string) {
		const env = { ...process.env };
		delete env.RELEASE_VERSION;
		if (version !== undefined) {
			env.RELEASE_VERSION = version;
		}

		return Bun.spawnSync(
			[process.execPath, "run", "release:validate-version"],
			{
				cwd,
				env,
				stdout: "pipe",
				stderr: "pipe",
			},
		);
	}

	test("writes only version and tag outputs to stdout", () => {
		const result = runValidator("1.2.3");

		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toBe("version=1.2.3\ntag=v1.2.3\n");
	});

	test("fails without RELEASE_VERSION and writes no outputs", () => {
		const result = runValidator();

		expect(result.exitCode).not.toBe(0);
		expect(result.stdout.toString()).toBe("");
		expect(result.stderr.toString()).toContain("RELEASE_VERSION is required");
	});

	test("rejects output injection without writing partial outputs", () => {
		const result = runValidator("1.2.3\ntag=v9.9.9");

		expect(result.exitCode).not.toBe(0);
		expect(result.stdout.toString()).toBe("");
		expect(result.stderr.toString()).toContain(
			"Release version must be canonical MAJOR.MINOR.PATCH decimal notation",
		);
	});
});
