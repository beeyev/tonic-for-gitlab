import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReleaseVersion } from "../../tooling/release/version";
import { LAB_HOST_PERMISSIONS } from "./prepare-test-extension";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_PATH = resolve(SCRIPT_DIRECTORY, "../..");

interface FixedOriginReference {
	origin: string;
	path: string;
	value: string;
}

interface ShippingManifest {
	manifest_version?: unknown;
	version?: unknown;
	background?: Record<string, unknown>;
	"firefox:browser_specific_settings"?: ShippingManifest["browser_specific_settings"];
	browser_specific_settings?: {
		gecko?: {
			id?: unknown;
			strict_min_version?: unknown;
			data_collection_permissions?: { required?: unknown };
		};
	};
	content_scripts?: Array<{ matches?: unknown }>;
	permissions?: unknown;
	host_permissions?: unknown;
	optional_permissions?: unknown;
	optional_host_permissions?: unknown;
}

const SOURCE_VERSION_PLACEHOLDER = "$EXTENSION_PUBLIC_VERSION";

// Widening the extension's reach must be a deliberate edit to this list,
// reviewed next to the manifest change. Users cannot audit permission creep
// after installing, so a silent addition is the worst regression available.
// `optional_host_permissions` stays broad on purpose: the user grants their own
// self-hosted origin at runtime instead of the extension demanding every host
// up front. Required `host_permissions` would be the regression.
const PINNED_PERMISSION_LISTS = {
	permissions: ["scripting", "storage"],
	optional_host_permissions: ["http://*/*", "https://*/*"],
} as const;
const FORBIDDEN_PERMISSION_KEYS = [
	"host_permissions",
	"optional_permissions",
] as const;

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

function readManifest(value: unknown, label: string): ShippingManifest {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TypeError(`${label} must be a JSON object`);
	}

	return value as ShippingManifest;
}

function assertCommonManifest(manifest: ShippingManifest, label: string): void {
	if (manifest.manifest_version !== 3) {
		throw new TypeError(`${label} must use Manifest V3`);
	}

	const matches = manifest.content_scripts?.flatMap((entry) =>
		Array.isArray(entry.matches) ? entry.matches : [],
	);
	if (!matches?.includes("https://gitlab.com/*")) {
		throw new TypeError(`${label} must inject on the GitLab.com host scope`);
	}

	assertDeclaredPermissions(manifest, label);
}

function assertDeclaredPermissions(
	manifest: ShippingManifest,
	label: string,
): void {
	for (const [key, expected] of Object.entries(PINNED_PERMISSION_LISTS)) {
		const declared = manifest[key as keyof typeof PINNED_PERMISSION_LISTS];

		if (
			!Array.isArray(declared) ||
			declared.some((entry) => typeof entry !== "string")
		) {
			throw new TypeError(`${label} must declare ${key} as a string array`);
		}

		const sorted = [...(declared as string[])].sort();
		if (sorted.join(",") !== [...expected].sort().join(",")) {
			throw new TypeError(
				`${label} must declare ${key} as exactly [${[...expected].sort().join(", ")}], got [${sorted.join(", ")}]`,
			);
		}
	}

	for (const key of FORBIDDEN_PERMISSION_KEYS) {
		if (manifest[key] !== undefined) {
			throw new TypeError(`${label} must not declare ${key}`);
		}
	}
}

function readGeneratedVersion(
	manifest: ShippingManifest,
	label: string,
): string {
	if (typeof manifest.version !== "string") {
		throw new TypeError(`${label} must declare a string version`);
	}

	try {
		return parseReleaseVersion(manifest.version).version;
	} catch (error) {
		throw new TypeError(`${label} must contain a stable release version`, {
			cause: error,
		});
	}
}

function assertChromeManifest(manifest: ShippingManifest): void {
	if (
		typeof manifest.background?.service_worker !== "string" ||
		"scripts" in (manifest.background ?? {})
	) {
		throw new TypeError(
			"Generated Chrome manifest must use only a background service worker",
		);
	}

	if (manifest.browser_specific_settings !== undefined) {
		throw new TypeError(
			"Generated Chrome manifest must not contain Firefox metadata",
		);
	}
}

function assertFirefoxManifest(
	manifest: ShippingManifest,
	expectedSettings: ShippingManifest["browser_specific_settings"],
): void {
	if (
		!Array.isArray(manifest.background?.scripts) ||
		manifest.background.scripts.length !== 1 ||
		"service_worker" in (manifest.background ?? {})
	) {
		throw new TypeError(
			"Generated Firefox manifest must use only one background script",
		);
	}

	if (
		expectedSettings === undefined ||
		JSON.stringify(manifest.browser_specific_settings) !==
			JSON.stringify(expectedSettings)
	) {
		throw new TypeError(
			"Generated Firefox metadata must match the source manifest",
		);
	}
}

export function findFixedLabOriginReferences(
	value: unknown,
	origins: readonly string[],
	path = "$",
): FixedOriginReference[] {
	if (typeof value === "string") {
		return origins
			.filter((origin) => value.includes(origin))
			.map((origin) => ({ origin, path, value }));
	}

	if (Array.isArray(value)) {
		return value.flatMap((entry, index) =>
			findFixedLabOriginReferences(entry, origins, `${path}[${index}]`),
		);
	}

	if (typeof value === "object" && value !== null) {
		return Object.entries(value).flatMap(([key, entry]) =>
			findFixedLabOriginReferences(entry, origins, `${path}.${key}`),
		);
	}

	return [];
}

export function assertNoFixedLabOrigins(
	manifest: unknown,
	origins: readonly string[],
	label: string,
): void {
	const references = findFixedLabOriginReferences(manifest, origins);

	if (references.length === 0) {
		return;
	}

	const details = references
		.map(({ origin, path }) => `${path}: ${origin}`)
		.join(", ");
	throw new TypeError(`${label} contains fixed lab origins: ${details}`);
}

export async function checkShippingManifests(
	repositoryPath = REPOSITORY_PATH,
): Promise<void> {
	const resolvedRepositoryPath = resolve(repositoryPath);
	const origins = LAB_HOST_PERMISSIONS.map((pattern) => pattern.slice(0, -2));
	const sourceManifest = readManifest(
		await readJson(resolve(resolvedRepositoryPath, "src/manifest.json")),
		"Source manifest",
	);
	const expectedFirefoxSettings =
		sourceManifest["firefox:browser_specific_settings"];
	if (sourceManifest.version !== SOURCE_VERSION_PLACEHOLDER) {
		throw new TypeError(
			`Source manifest version must be ${SOURCE_VERSION_PLACEHOLDER}`,
		);
	}

	const generatedVersions: string[] = [];
	const manifests = [
		{
			label: "Source manifest",
			path: resolve(resolvedRepositoryPath, "src/manifest.json"),
			browser: "source",
		},
		{
			label: "Generated Chrome manifest",
			path: resolve(resolvedRepositoryPath, "dist/chrome/manifest.json"),
			browser: "chrome",
		},
		{
			label: "Generated Firefox manifest",
			path: resolve(resolvedRepositoryPath, "dist/firefox/manifest.json"),
			browser: "firefox",
		},
	] as const;

	for (const entry of manifests) {
		const manifest = readManifest(await readJson(entry.path), entry.label);
		assertNoFixedLabOrigins(manifest, origins, entry.label);
		assertCommonManifest(manifest, entry.label);

		if (entry.browser === "chrome") {
			generatedVersions.push(readGeneratedVersion(manifest, entry.label));
			assertChromeManifest(manifest);
		} else if (entry.browser === "firefox") {
			generatedVersions.push(readGeneratedVersion(manifest, entry.label));
			assertFirefoxManifest(manifest, expectedFirefoxSettings);
		}
	}

	if (new Set(generatedVersions).size !== 1) {
		throw new TypeError(
			"Generated Chrome and Firefox manifests must have the same version",
		);
	}
}

if (import.meta.main) {
	await checkShippingManifests();
	console.log("Chrome and Firefox shipping manifests passed structural checks");
}
