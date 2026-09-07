import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LAB_HOST_PERMISSIONS } from "./prepare-test-extension";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_PATH = resolve(SCRIPT_DIRECTORY, "../..");

interface FixedOriginReference {
	origin: string;
	path: string;
	value: string;
}

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
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
	const manifests = [
		{
			label: "Source manifest",
			path: resolve(resolvedRepositoryPath, "src/manifest.json"),
		},
		{
			label: "Generated Chrome manifest",
			path: resolve(resolvedRepositoryPath, "dist/chrome/manifest.json"),
		},
	] as const;

	for (const manifest of manifests) {
		assertNoFixedLabOrigins(
			await readJson(manifest.path),
			origins,
			manifest.label,
		);
	}
}

if (import.meta.main) {
	await checkShippingManifests();
	console.log("Shipping manifests contain no fixed lab origins");
}
