import { afterEach, describe, expect, test } from "bun:test";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
	assertNoFixedLabOrigins,
	findFixedLabOriginReferences,
} from "./check-shipping-manifests";
import {
	LAB_HOST_PERMISSIONS,
	prepareLabExtension,
	REPOSITORY_PATH,
} from "./prepare-test-extension";

interface ManifestContentScript {
	matches: string[];
}

interface Manifest {
	content_scripts: ManifestContentScript[];
	host_permissions?: string[];
	name: string;
	[key: string]: unknown;
}

const temporaryDirectories: string[] = [];

async function readManifest(path: string): Promise<Manifest> {
	return JSON.parse(await readFile(path, "utf8")) as Manifest;
}

async function createFixtureRepository(): Promise<string> {
	const repositoryPath = await mkdtemp(
		resolve(tmpdir(), "tonic-lab-extension-repository-"),
	);
	temporaryDirectories.push(repositoryPath);
	await mkdir(resolve(repositoryPath, "src"), { recursive: true });
	await mkdir(resolve(repositoryPath, "lab/extension"), { recursive: true });
	await cp(
		resolve(REPOSITORY_PATH, "src/manifest.json"),
		resolve(repositoryPath, "src/manifest.json"),
	);
	for (const file of [
		"components.json",
		"extension-env.d.ts",
		"package.json",
		"tsconfig.json",
	]) {
		await cp(resolve(REPOSITORY_PATH, file), resolve(repositoryPath, file));
	}

	await symlink(
		resolve(REPOSITORY_PATH, "node_modules"),
		resolve(repositoryPath, "node_modules"),
		"junction",
	);

	return repositoryPath;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { force: true, recursive: true })),
	);
});

describe("local-lab extension project", () => {
	test("keeps every shipping manifest field free of fixed lab origins", async () => {
		const manifest = await readManifest(
			resolve(REPOSITORY_PATH, "src/manifest.json"),
		);
		const origins = LAB_HOST_PERMISSIONS.map((pattern) => pattern.slice(0, -2));
		const matches = manifest.content_scripts.flatMap((entry) => entry.matches);

		/*
		 * `readInjectedFiles` in src/host-access/registration.ts finds the bundle
		 * to register for a self-managed origin by this exact pattern, so drift
		 * here would leave every added instance on `registration-failed`.
		 */
		expect(matches).toEqual(["https://gitlab.com/*"]);
		expect(findFixedLabOriginReferences(manifest, origins)).toEqual([]);
		expect(() =>
			assertNoFixedLabOrigins(
				{ optional_host_permissions: [LAB_HOST_PERMISSIONS[0]] },
				origins,
				"Test manifest",
			),
		).toThrow("$.optional_host_permissions[0]");
	});

	test("refuses every output except the owned ignored directory", async () => {
		const externalPath = await mkdtemp(
			resolve(tmpdir(), "tonic-lab-extension-external-"),
		);
		temporaryDirectories.push(externalPath);

		for (const outputPath of [
			REPOSITORY_PATH,
			resolve(REPOSITORY_PATH, "src/generated"),
			externalPath,
		]) {
			await expect(prepareLabExtension({ outputPath })).rejects.toThrow(
				"output must be .ignore/lab-extension",
			);
		}
	});

	test("refuses a symlink at the owned output path", async () => {
		const repositoryPath = await createFixtureRepository();
		await mkdir(resolve(repositoryPath, ".ignore"), { recursive: true });
		await symlink(
			repositoryPath,
			resolve(repositoryPath, ".ignore/lab-extension"),
			"junction",
		);

		await expect(prepareLabExtension({ repositoryPath })).rejects.toThrow(
			"output must be a real directory",
		);
	});

	test("refuses a source manifest that already declares host permissions", async () => {
		const repositoryPath = await createFixtureRepository();
		const sourceManifestPath = resolve(repositoryPath, "src/manifest.json");
		const sourceManifest = JSON.parse(
			await readFile(sourceManifestPath, "utf8"),
		) as Manifest;
		sourceManifest.host_permissions = ["https://gitlab.example/*"];
		await writeFile(sourceManifestPath, JSON.stringify(sourceManifest), "utf8");

		await expect(prepareLabExtension({ repositoryPath })).rejects.toThrow(
			"must not declare host permissions",
		);
	});

	test("generates only the intended lab changes without editing the source", async () => {
		const repositoryPath = await createFixtureRepository();
		const sourceManifestPath = resolve(repositoryPath, "src/manifest.json");
		const sourceBefore = await readFile(sourceManifestPath, "utf8");
		const sourceManifest = JSON.parse(sourceBefore) as Manifest;

		const prepared = await prepareLabExtension({ repositoryPath });
		const generatedManifest = await readManifest(prepared.manifestPath);
		const generatedMatches = generatedManifest.content_scripts.flatMap(
			(entry) => entry.matches,
		);

		// Injection stays dynamic, so the lab origins reach Chrome as granted
		// host permissions and never as extra static matches.
		expect(generatedMatches).toEqual(["https://gitlab.com/*"]);
		expect(generatedManifest.host_permissions).toEqual(["http://localhost/*"]);
		expect(generatedManifest.name).toBe("Tonic for GitLab (local lab)");

		generatedManifest.name = sourceManifest.name;
		delete generatedManifest.host_permissions;
		expect(generatedManifest).toEqual(sourceManifest);
		expect(await readFile(sourceManifestPath, "utf8")).toBe(sourceBefore);
		expect(
			await readFile(resolve(prepared.projectPath, "package.json"), "utf8"),
		).toBe(await readFile(resolve(repositoryPath, "package.json"), "utf8"));
		expect(await realpath(resolve(prepared.projectPath, "node_modules"))).toBe(
			resolve(REPOSITORY_PATH, "node_modules"),
		);
	});
});
