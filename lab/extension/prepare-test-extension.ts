import {
	cp,
	lstat,
	mkdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface ExtensionManifest {
	host_permissions?: unknown;
	name?: unknown;
	[key: string]: unknown;
}

export interface PreparedLabExtension {
	manifestPath: string;
	projectPath: string;
}

interface PrepareLabExtensionOptions {
	outputPath?: string;
	repositoryPath?: string;
}

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_PATH = resolve(SCRIPT_DIRECTORY, "../..");
export const LAB_EXTENSION_PROJECT_PATH = resolve(
	REPOSITORY_PATH,
	".ignore/lab-extension",
);
/**
 * The lab instances share one browser match pattern because ports are outside
 * Tonic's cross-browser permission boundary.
 *
 * The ports are the published ones in `../compose.yaml`; change both together.
 * `check-shipping-manifests.ts` reads this list to prove no shipping manifest
 * carries a lab origin.
 */
export const LAB_HOST_PERMISSIONS = ["http://localhost/*"] as const;

const ROOT_FILES = [
	".env.defaults",
	"components.json",
	"extension-env.d.ts",
	"package.json",
	"tsconfig.json",
] as const;

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

function readManifest(value: unknown): ExtensionManifest {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TypeError("The source extension manifest must be a JSON object");
	}

	return value as ExtensionManifest;
}

function isMissingPath(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

async function assertSafeOutputPath(
	repositoryPath: string,
	outputPath: string,
): Promise<void> {
	const resolvedRepositoryPath = resolve(repositoryPath);
	const resolvedOutputPath = resolve(outputPath);
	const ignoredRoot = resolve(resolvedRepositoryPath, ".ignore");
	const expectedOutputPath = resolve(ignoredRoot, "lab-extension");

	if (resolvedOutputPath !== expectedOutputPath) {
		throw new TypeError(
			"The generated extension output must be .ignore/lab-extension",
		);
	}

	await mkdir(ignoredRoot, { recursive: true });
	const ignoredRootStats = await lstat(ignoredRoot);

	if (ignoredRootStats.isSymbolicLink() || !ignoredRootStats.isDirectory()) {
		throw new TypeError("The repository .ignore path must be a real directory");
	}

	try {
		const outputStats = await lstat(resolvedOutputPath);

		if (outputStats.isSymbolicLink() || !outputStats.isDirectory()) {
			throw new TypeError(
				"The generated extension output must be a real directory when it exists",
			);
		}
	} catch (error) {
		if (!isMissingPath(error)) {
			throw error;
		}
	}
}

export async function prepareLabExtension({
	outputPath,
	repositoryPath = REPOSITORY_PATH,
}: PrepareLabExtensionOptions = {}): Promise<PreparedLabExtension> {
	const resolvedRepositoryPath = resolve(repositoryPath);
	const resolvedOutputPath = resolve(
		outputPath ?? resolve(resolvedRepositoryPath, ".ignore/lab-extension"),
	);
	await assertSafeOutputPath(resolvedRepositoryPath, resolvedOutputPath);

	const sourceManifestPath = resolve(
		resolvedRepositoryPath,
		"src/manifest.json",
	);
	const manifest = readManifest(await readJson(sourceManifestPath));

	if (manifest.host_permissions !== undefined) {
		throw new TypeError(
			"The source manifest must not declare host permissions; merge them here first",
		);
	}

	/*
	 * Required host permissions, not extra content-script matches.
	 *
	 * Chrome grants a required host permission when it loads an unpacked
	 * extension, with no prompt, so `permissions.request` for a lab origin
	 * resolves `true` immediately and does not need the user gesture and native
	 * bubble that no automated session can answer. Adding a lab origin through
	 * the toolbar then exercises the real path: stored target, granted
	 * permission, dynamic registration, injection.
	 *
	 * Extra content-script matches would inject without any of that, and a lab
	 * origin added through the toolbar as well would then run the script twice
	 * on the same page.
	 *
	 * Removal is the one flow this project cannot show, and it does not fail
	 * inertly: `releaseTargetAccess` unregisters the script before
	 * `permissions.remove` refuses a required permission, so the row stays in
	 * storage with nothing registered until the next reconciliation, which
	 * reopening the toolbar performs.
	 */
	manifest.host_permissions = [...LAB_HOST_PERMISSIONS];

	if (typeof manifest.name !== "string" || manifest.name.length === 0) {
		throw new TypeError("The source manifest must declare a name");
	}

	manifest.name = `${manifest.name} (local lab)`;

	await rm(resolvedOutputPath, { force: true, recursive: true });
	await mkdir(resolvedOutputPath, { recursive: true });
	await cp(
		resolve(resolvedRepositoryPath, "src"),
		resolve(resolvedOutputPath, "src"),
		{ recursive: true },
	);

	for (const file of ROOT_FILES) {
		await cp(
			resolve(resolvedRepositoryPath, file),
			resolve(resolvedOutputPath, file),
		);
	}

	await symlink(
		resolve(resolvedRepositoryPath, "node_modules"),
		resolve(resolvedOutputPath, "node_modules"),
		"junction",
	);

	const generatedManifestPath = resolve(
		resolvedOutputPath,
		"src/manifest.json",
	);
	await writeFile(
		generatedManifestPath,
		`${JSON.stringify(manifest, null, "\t")}\n`,
		"utf8",
	);

	return {
		manifestPath: generatedManifestPath,
		projectPath: resolvedOutputPath,
	};
}

if (import.meta.main) {
	const prepared = await prepareLabExtension();
	console.log(prepared.projectPath);
}
