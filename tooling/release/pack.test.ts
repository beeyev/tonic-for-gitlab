import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { packDistributions } from "./pack";
import { readZipEntries, readZipEntry } from "./zip";

const VERSION = "1.2.3";
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { force: true, recursive: true })),
	);
});

async function createFixtureRepository(
	versions: { chrome?: string; firefox?: string } = {},
): Promise<string> {
	const repositoryPath = await mkdtemp(resolve(tmpdir(), "tonic-pack-"));
	temporaryDirectories.push(repositoryPath);

	for (const browser of ["chrome", "firefox"] as const) {
		const distPath = resolve(repositoryPath, "dist", browser);
		await mkdir(resolve(distPath, "background"), { recursive: true });
		await writeFile(
			resolve(distPath, "manifest.json"),
			JSON.stringify({ version: versions[browser] ?? VERSION, browser }),
			"utf8",
		);
		await writeFile(
			resolve(distPath, "background", "worker.js"),
			`console.log("${browser}");`,
			"utf8",
		);
	}

	return repositoryPath;
}

function assetPath(repositoryPath: string, fileName: string): string {
	return resolve(repositoryPath, "release-assets", fileName);
}

describe("release packaging", () => {
	test("writes both archives and a matching checksum file", async () => {
		const repositoryPath = await createFixtureRepository();

		const packed = await packDistributions(VERSION, repositoryPath);

		expect(packed.map(({ fileName }) => fileName)).toEqual([
			`tonic-for-gitlab-${VERSION}-chromium.zip`,
			`tonic-for-gitlab-${VERSION}-firefox.zip`,
		]);

		const checksums = await readFile(
			assetPath(repositoryPath, "SHA256SUMS"),
			"utf8",
		);
		for (const { fileName, sha256 } of packed) {
			const archive = await readFile(assetPath(repositoryPath, fileName));
			expect(createHash("sha256").update(archive).digest("hex")).toBe(sha256);
			expect(checksums).toContain(`${sha256}  ${fileName}`);
		}
		expect(checksums.endsWith("\n")).toBe(true);
	});

	test("packs the same dist into byte-identical archives", async () => {
		const repositoryPath = await createFixtureRepository();

		const first = await packDistributions(VERSION, repositoryPath);
		const firstBytes = await readFile(
			assetPath(repositoryPath, first[0].fileName),
		);
		const second = await packDistributions(VERSION, repositoryPath);
		const secondBytes = await readFile(
			assetPath(repositoryPath, second[0].fileName),
		);

		expect(first[0].sha256).toBe(second[0].sha256);
		expect(firstBytes.equals(secondBytes)).toBe(true);
	});

	test("carries the built manifest into the archive root", async () => {
		const repositoryPath = await createFixtureRepository();

		const [chromium] = await packDistributions(VERSION, repositoryPath);
		const archive = await readFile(
			assetPath(repositoryPath, chromium.fileName),
		);

		expect(readZipEntries(archive).map(({ name }) => name)).toEqual([
			"background/worker.js",
			"manifest.json",
		]);
		expect(readZipEntry(archive, "manifest.json").toString("utf8")).toBe(
			await readFile(
				resolve(repositoryPath, "dist/chrome/manifest.json"),
				"utf8",
			),
		);
	});

	test("refuses a built manifest that disagrees with the release version", async () => {
		const repositoryPath = await createFixtureRepository({ firefox: "1.2.4" });

		await expect(packDistributions(VERSION, repositoryPath)).rejects.toThrow(
			"Built firefox manifest declares 1.2.4, expected 1.2.3",
		);
	});

	test("refuses a release version that is not a stable triple", async () => {
		const repositoryPath = await createFixtureRepository();

		await expect(packDistributions("1.2", repositoryPath)).rejects.toThrow(
			"canonical MAJOR.MINOR.PATCH",
		);
	});

	test("refuses to package a symlink found in dist", async () => {
		const repositoryPath = await createFixtureRepository();
		await symlink(
			"/etc/passwd",
			resolve(repositoryPath, "dist/chrome/leak.txt"),
		);

		await expect(packDistributions(VERSION, repositoryPath)).rejects.toThrow(
			"Refusing to package a non-regular file",
		);
	});

	test("replaces stale assets from an earlier run", async () => {
		const repositoryPath = await createFixtureRepository();
		await mkdir(resolve(repositoryPath, "release-assets"), { recursive: true });
		await writeFile(
			assetPath(repositoryPath, "tonic-for-gitlab-9.9.9-chromium.zip"),
			"stale",
			"utf8",
		);

		await packDistributions(VERSION, repositoryPath);

		expect(
			await Bun.file(
				assetPath(repositoryPath, "tonic-for-gitlab-9.9.9-chromium.zip"),
			).exists(),
		).toBe(false);
	});
});
