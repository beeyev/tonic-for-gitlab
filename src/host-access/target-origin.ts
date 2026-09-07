/**
 * A Tonic host target is a normalized `http` or `https` origin and nothing
 * else. Chrome host permissions are origin-scoped, so a path component would
 * never be a permission boundary; a relative-root GitLab such as
 * `https://intranet.example/gitlab` is reached by granting its whole origin and
 * letting the feature contract decide where Tonic actually activates.
 *
 * `http` is deliberately supported. Self-managed GitLab on a private network is
 * routinely served without TLS, and the local verification lab in `lab/` is
 * plain HTTP on `localhost`.
 */

/** Built in, always active, and not part of the user-managed list. */
export const BUILT_IN_ORIGIN = "https://gitlab.com";

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

/** Matches an explicit scheme so a bare host can default to `https`. */
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * An allowlist of shape, not just of characters.
 *
 * `URL` accepts a hostname of `*`, and Chrome reads `*` as a match-pattern
 * wildcard, so the exact-origin request built from it asked for permission on
 * every https site on the web. `*.example.com` did the same for a whole domain
 * tree. That is why this is an allowlist rather than a hunt for wildcard syntax.
 *
 * A plain character allowlist was not enough on its own: it also admitted
 * hostnames that are only punctuation, and ones with an empty label such as
 * `gitlab..com`. Those normalized to origins like `https://..`, were persisted,
 * and then failed forever, because Chrome's match-pattern parser rejects them,
 * so the permission request errored and the row kept a `Grant access` button
 * that could never succeed. Parsing here exists to name a bad input while the
 * user is still looking at the field, so every label must begin and end with an
 * alphanumeric, which is what a real host does and what punycode already
 * satisfies.
 */
const SUPPORTED_HOSTNAME =
	/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?)*$/i;

/** `URL.hostname` keeps the brackets on an IPv6 literal. */
const SUPPORTED_IPV6_HOSTNAME = /^\[[0-9a-f:.]+\]$/i;

export type TargetOriginRejection =
	| "empty"
	| "invalid-url"
	| "unsupported-protocol"
	| "credentials-not-allowed"
	| "built-in"
	| "duplicate";

export type TargetOriginResult =
	| { status: "accepted"; origin: string }
	| { status: "rejected"; reason: TargetOriginRejection };

/**
 * Normalizes typed or pasted input to an origin.
 *
 * Path, query, and fragment are dropped rather than rejected: pasting a deep
 * link such as `https://gitlab.example/-/merge_requests?scope=all` is the most
 * likely input, and the caller displays the resulting origin, so nothing is
 * silently different from what the user can see. Credentials are rejected
 * instead of stripped, because a URL carrying them is a mistake worth naming.
 */
export function parseTargetOrigin(input: string): TargetOriginResult {
	const trimmed = input.trim();

	if (trimmed === "") {
		return { status: "rejected", reason: "empty" };
	}

	const candidate = EXPLICIT_SCHEME.test(trimmed)
		? trimmed
		: `https://${trimmed}`;
	let url: URL;

	try {
		url = new URL(candidate);
	} catch {
		return { status: "rejected", reason: "invalid-url" };
	}

	if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
		return { status: "rejected", reason: "unsupported-protocol" };
	}

	if (url.username !== "" || url.password !== "") {
		return { status: "rejected", reason: "credentials-not-allowed" };
	}

	/*
	 * `https://` alone parses with an empty host, which no permission can match,
	 * and a wildcard host would turn an exact-origin request into a broad match
	 * pattern.
	 */
	if (
		!SUPPORTED_HOSTNAME.test(url.hostname) &&
		!SUPPORTED_IPV6_HOSTNAME.test(url.hostname)
	) {
		return { status: "rejected", reason: "invalid-url" };
	}

	return { status: "accepted", origin: url.origin };
}

/** Adds the two rejections that depend on what is already configured. */
export function resolveTargetOrigin(
	input: string,
	configuredOrigins: readonly string[],
): TargetOriginResult {
	const parsed = parseTargetOrigin(input);

	if (parsed.status === "rejected") {
		return parsed;
	}

	if (parsed.origin === BUILT_IN_ORIGIN) {
		return { status: "rejected", reason: "built-in" };
	}

	if (configuredOrigins.includes(parsed.origin)) {
		return { status: "rejected", reason: "duplicate" };
	}

	return parsed;
}

/**
 * True only for a string that is already the normalized form of itself. Used to
 * validate persisted entries and the origin echoed by a content script, so
 * neither can introduce a value the rest of the code would not have produced.
 */
export function isTargetOrigin(value: unknown): value is string {
	if (typeof value !== "string") {
		return false;
	}

	const parsed = parseTargetOrigin(value);

	return parsed.status === "accepted" && parsed.origin === value;
}

/**
 * The exact-origin pattern used for permission requests and script matches.
 *
 * `URL.origin` omits default ports, but Chrome treats an omitted match-pattern
 * port as `:*`. Put the default back so a normalized origin still matches only
 * its own port.
 */
export function toOriginPattern(origin: string): string {
	const url = new URL(origin);
	const port = url.port || (url.protocol === "http:" ? "80" : "443");

	return `${url.protocol}//${url.hostname}:${port}/*`;
}

export const CONTENT_SCRIPT_ID_PREFIX = "tonic-origin-";

/**
 * Deterministic registration ID for an origin.
 *
 * Base64url rather than something readable: the ID has to be injective, and
 * substituting non-alphanumeric characters is not. `https://a.b` and
 * `https://a-b` are different origins that a naive substitution collapses onto
 * one ID, which would silently drop a registration. `URL.origin` is ASCII (IDN
 * hosts come back punycoded), so `btoa` is safe here.
 */
export function toContentScriptId(origin: string): string {
	const encoded = btoa(origin)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	return `${CONTENT_SCRIPT_ID_PREFIX}${encoded}`;
}
