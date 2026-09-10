import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
	createDeterministicZip,
	DOS_EPOCH_SECONDS,
	readZipEntries,
	readZipEntry,
	type ZipEntry,
} from "./zip";

const COMPRESSIBLE = Buffer.from("tonic".repeat(500));

// Chained digests stand in for the high-entropy PNG icons the real archives
// carry, which deflate cannot shrink. A simple arithmetic pattern would.
const INCOMPRESSIBLE = Buffer.concat(
	Array.from({ length: 16 }).reduce<Buffer[]>((blocks, _, index) => {
		const previous = blocks.at(-1) ?? Buffer.from("tonic-for-gitlab");
		blocks.push(
			createHash("sha256").update(previous).update(`${index}`).digest(),
		);
		return blocks;
	}, []),
);

const temporaryDirectories: string[] = [];

afterAll(async () => {
	await Promise.all(
		temporaryDirectories.map((path) =>
			rm(path, { force: true, recursive: true }),
		),
	);
});

function entries(): ZipEntry[] {
	return [
		{ name: "manifest.json", data: Buffer.from('{"version":"1.2.3"}') },
		{ name: "icons/icon16.png", data: INCOMPRESSIBLE },
		{ name: "action/index.js", data: COMPRESSIBLE },
	];
}

describe("deterministic zip", () => {
	test("produces identical bytes regardless of input order", () => {
		const forward = createDeterministicZip(entries());
		const reversed = createDeterministicZip(entries().reverse());

		expect(forward.equals(reversed)).toBe(true);
	});

	test("produces identical bytes across repeated calls", () => {
		expect(
			createDeterministicZip(entries()).equals(
				createDeterministicZip(entries()),
			),
		).toBe(true);
	});

	test("stores entries in sorted order", () => {
		expect(createDeterministicZip(entries()).length).toBeGreaterThan(0);
		expect(
			readZipEntries(createDeterministicZip(entries())).map((r) => r.name),
		).toEqual(["action/index.js", "icons/icon16.png", "manifest.json"]);
	});

	test("round-trips compressible and incompressible payloads", () => {
		const archive = createDeterministicZip(entries());

		expect(readZipEntry(archive, "action/index.js").equals(COMPRESSIBLE)).toBe(
			true,
		);
		expect(
			readZipEntry(archive, "icons/icon16.png").equals(INCOMPRESSIBLE),
		).toBe(true);
	});

	test("falls back to stored entries when deflate would grow the payload", () => {
		const records = readZipEntries(createDeterministicZip(entries()));
		const icon = records.find((record) => record.name === "icons/icon16.png");
		const script = records.find((record) => record.name === "action/index.js");

		expect(icon?.method).toBe(0);
		expect(script?.method).toBe(8);
	});

	test("a later timestamp changes the bytes but not the contents", () => {
		const pinned = createDeterministicZip(entries());
		const later = createDeterministicZip(entries(), {
			modifiedAt: DOS_EPOCH_SECONDS + 86_400,
		});

		expect(pinned.equals(later)).toBe(false);
		expect(readZipEntry(later, "action/index.js").equals(COMPRESSIBLE)).toBe(
			true,
		);
	});

	test.each([
		["../escape.js", "must not traverse"],
		["nested/../../escape.js", "must not traverse"],
		["/absolute.js", "must be relative"],
		["windows\\path.js", "must use forward slashes"],
		["", "must not be empty"],
	])("rejects the entry name %p", (name, message) => {
		expect(() =>
			createDeterministicZip([{ name, data: Buffer.from("x") }]),
		).toThrow(message);
	});

	test("rejects duplicate entry names", () => {
		expect(() =>
			createDeterministicZip([
				{ name: "manifest.json", data: Buffer.from("a") },
				{ name: "manifest.json", data: Buffer.from("b") },
			]),
		).toThrow("Duplicate ZIP entry name");
	});

	test("detects a tampered payload through the stored checksum", () => {
		const archive = createDeterministicZip(entries());
		const target = archive.indexOf(INCOMPRESSIBLE);
		expect(target).toBeGreaterThan(0);
		archive[target] = archive[target] === 0 ? 1 : 0;

		expect(() => readZipEntry(archive, "icons/icon16.png")).toThrow(
			"Checksum mismatch",
		);
	});

	test("rejects reads of a missing entry", () => {
		expect(() =>
			readZipEntry(createDeterministicZip(entries()), "nope"),
		).toThrow("Missing ZIP entry");
	});

	// The browsers and both web stores read these archives with their own ZIP
	// implementations, so prove the container is valid outside this code.
	test("writes an archive that the system unzip accepts", async () => {
		const directory = await mkdtemp(resolve(tmpdir(), "tonic-zip-"));
		temporaryDirectories.push(directory);
		const path = resolve(directory, "archive.zip");
		await writeFile(path, createDeterministicZip(entries()));

		const integrity = Bun.spawnSync(["unzip", "-t", path], { stderr: "pipe" });
		expect(integrity.exitCode).toBe(0);
		expect(integrity.stdout.toString()).toContain("No errors detected");

		const listed = Bun.spawnSync(["unzip", "-Z1", path], { stderr: "pipe" });
		expect(listed.stdout.toString().trim().split("\n")).toEqual([
			"action/index.js",
			"icons/icon16.png",
			"manifest.json",
		]);
	});

	/*
	 * readZipEntries always decodes UTF-8, so it cannot catch a missing language
	 * encoding flag; this reads the header field itself. Without bit 11 a
	 * conforming reader decodes names as CP437, so a non-ASCII name extracts
	 * under different bytes than the manifest references. Info-ZIP 6.00 is not
	 * the oracle here because it mangles such names either way.
	 */
	test("marks entry names as UTF-8 in both headers", () => {
		const name = "_locales/français/messages.json";
		const archive = createDeterministicZip([{ name, data: Buffer.from("{}") }]);
		const centralOffset = archive.readUInt32LE(archive.length - 6);

		expect(archive.readUInt16LE(6)).toBe(0x0800);
		expect(archive.readUInt16LE(centralOffset + 8)).toBe(0x0800);
		expect(readZipEntries(archive)[0].name).toBe(name);
		expect(
			archive
				.subarray(30, 30 + Buffer.byteLength(name, "utf8"))
				.toString("utf8"),
		).toBe(name);
	});
});
