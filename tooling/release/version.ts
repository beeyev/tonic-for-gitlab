export interface ReleaseVersion {
	tag: string;
	version: string;
}

const STABLE_VERSION_PATTERN =
	/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
const MAX_VERSION_COMPONENT = 65_535;

export function parseReleaseVersion(value: string): ReleaseVersion {
	const match = STABLE_VERSION_PATTERN.exec(value);

	if (match === null) {
		throw new TypeError(
			"Release version must be canonical MAJOR.MINOR.PATCH decimal notation",
		);
	}

	const components = match.slice(1).map(Number);
	if (components.some((component) => component > MAX_VERSION_COMPONENT)) {
		throw new RangeError(
			`Release version components must not exceed ${MAX_VERSION_COMPONENT}`,
		);
	}

	if (components.every((component) => component === 0)) {
		throw new RangeError("Release version must not be 0.0.0");
	}

	return { tag: `v${value}`, version: value };
}

if (import.meta.main) {
	const value = process.env.RELEASE_VERSION;
	if (value === undefined) {
		throw new TypeError("RELEASE_VERSION is required");
	}

	const release = parseReleaseVersion(value);
	console.log(`version=${release.version}`);
	console.log(`tag=${release.tag}`);
}
