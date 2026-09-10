import { createHash } from "node:crypto";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkShippingManifests } from "../../lab/extension/check-shipping-manifests";
import { parseReleaseVersion } from "./version";
import {
	createDeterministicZip,
	readZipEntries,
	readZipEntry,
	type ZipEntry,
} from "./zip";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_PATH = resolve(SCRIPT_DIRECTORY, "../..");
const RELEASE_ASSETS_DIRECTORY = "release-assets";
const MANIFEST_ENTRY = "manifest.json";

const DISTRIBUTIONS = [
	{ browser: "chrome", label: "chromium" },
	{ browser: "firefox", label: "firefox" },
] as const;

export interface PackedArchive {
	fileName: string;
	sha256: string;
	size: number;
}

async function collectEntries(root: string): Promise<ZipEntry[]> {
	const paths = await readdir(root, { recursive: true, withFileTypes: true });
	const entries: ZipEntry[] = [];

	for (const path of paths) {
		const absolute = join(path.parentPath, path.name);

		// readdir reports the link target's type, so ask the link itself. A
		// symlink would otherwise be packaged as a copy of whatever it points at.
		const stats = await lstat(absolute);
		if (stats.isDirectory()) {
			continue;
		}
		if (!stats.isFile()) {
			throw new TypeError(
				`Refusing to package a non-regular file: ${relative(root, absolute)}`,
			);
		}

		entries.push({
			name: relative(root, absolute).split(sep).join("/"),
			data: await readFile(absolute),
		});
	}

	return entries;
}

function assertArchiveShape(archive: Buffer, expectedManifest: Buffer): void {
	const records = readZipEntries(archive);
	const manifests = records.filter((record) => record.name === MANIFEST_ENTRY);

	if (manifests.length !== 1) {
		throw new TypeError(
			`Archive must contain exactly one ${MANIFEST_ENTRY} at its root`,
		);
	}

	for (const record of records) {
		if (
			record.name.startsWith("/") ||
			record.name.includes("\\") ||
			record.name.split("/").some((segment) => segment === "..")
		) {
			throw new TypeError(`Unsafe archive entry: ${record.name}`);
		}
	}

	// readZipEntry verifies the CRC, so this also proves the container is intact.
	if (!readZipEntry(archive, MANIFEST_ENTRY).equals(expectedManifest)) {
		throw new TypeError(
			`Archive ${MANIFEST_ENTRY} does not match the built manifest`,
		);
	}
}

/**
 * Package an already-built `dist/` into reproducible release archives and their
 * checksum file. Reads no clock and no build metadata, so the same `dist/`
 * always produces the same bytes.
 */
export async function packDistributions(
	version: string,
	repositoryPath = REPOSITORY_PATH,
): Promise<PackedArchive[]> {
	const { version: releaseVersion } = parseReleaseVersion(version);
	const resolvedRepositoryPath = resolve(repositoryPath);
	const assetsPath = resolve(resolvedRepositoryPath, RELEASE_ASSETS_DIRECTORY);
	await rm(assetsPath, { force: true, recursive: true });
	await mkdir(assetsPath, { recursive: true });

	const packed: PackedArchive[] = [];

	for (const { browser, label } of DISTRIBUTIONS) {
		const distPath = resolve(resolvedRepositoryPath, "dist", browser);
		const manifest = await readFile(resolve(distPath, MANIFEST_ENTRY));
		const declaredVersion = JSON.parse(manifest.toString("utf8")).version;

		if (declaredVersion !== releaseVersion) {
			throw new TypeError(
				`Built ${browser} manifest declares ${declaredVersion}, expected ${releaseVersion}`,
			);
		}

		const fileName = `tonic-for-gitlab-${releaseVersion}-${label}.zip`;
		const archive = createDeterministicZip(await collectEntries(distPath));
		assertArchiveShape(archive, manifest);

		await writeFile(resolve(assetsPath, fileName), archive);
		packed.push({
			fileName,
			sha256: createHash("sha256").update(archive).digest("hex"),
			size: archive.length,
		});
	}

	await writeFile(
		resolve(assetsPath, "SHA256SUMS"),
		`${packed.map(({ fileName, sha256 }) => `${sha256}  ${fileName}`).join("\n")}\n`,
		"utf8",
	);

	return packed;
}

async function buildDistributions(
	releaseVersion: string,
	repositoryPath: string,
): Promise<void> {
	await rm(resolve(repositoryPath, "dist"), { force: true, recursive: true });

	for (const { browser } of DISTRIBUTIONS) {
		const build = Bun.spawnSync(
			["bunx", "--no-install", "extension", "build", `--browser=${browser}`],
			{
				cwd: repositoryPath,
				env: {
					...process.env,
					EXTENSION_PUBLIC_VERSION: releaseVersion,
					EXTENSION_TELEMETRY_DISABLED: "1",
				},
				stdout: "inherit",
				stderr: "inherit",
			},
		);

		if (build.exitCode !== 0) {
			throw new Error(`Building the ${browser} distribution failed`);
		}
	}
}

if (import.meta.main) {
	const value = process.env.RELEASE_VERSION;
	if (value === undefined) {
		throw new TypeError("RELEASE_VERSION is required");
	}

	const { version } = parseReleaseVersion(value);
	await buildDistributions(version, REPOSITORY_PATH);
	await checkShippingManifests(REPOSITORY_PATH);

	for (const archive of await packDistributions(version, REPOSITORY_PATH)) {
		console.log(
			`${archive.sha256}  ${archive.fileName}  (${archive.size} bytes)`,
		);
	}
}
