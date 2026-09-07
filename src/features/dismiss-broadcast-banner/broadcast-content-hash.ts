import { isTargetOrigin } from "../../host-access/target-origin";

export const MAX_BROADCAST_CONTENT_LENGTH = 262_144;
export const BROADCAST_CONTENT_HASH_REQUEST_TYPE =
	"tonic:dismiss-broadcast-banner:hash-content";
export const BROADCAST_CONTENT_HASH_RESPONSE_TYPE =
	"tonic:dismiss-broadcast-banner:hash-content-response";

const SHA_256_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

interface BroadcastContentHashDependencies {
	subtle: Pick<SubtleCrypto, "digest"> | undefined;
	sendMessage(message: unknown): Promise<unknown>;
}

interface BroadcastContentHashRequest {
	type: typeof BROADCAST_CONTENT_HASH_REQUEST_TYPE;
	content: string;
}

type BroadcastContentHashResponse =
	| {
			type: typeof BROADCAST_CONTENT_HASH_RESPONSE_TYPE;
			ok: true;
			fingerprint: string;
	  }
	| {
			type: typeof BROADCAST_CONTENT_HASH_RESPONSE_TYPE;
			ok: false;
			error: "invalid-request" | "hash-failed";
	  };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSha256Fingerprint(value: unknown): value is string {
	return typeof value === "string" && SHA_256_FINGERPRINT_PATTERN.test(value);
}

function isHashRequest(value: unknown): value is BroadcastContentHashRequest {
	return (
		isRecord(value) &&
		value.type === BROADCAST_CONTENT_HASH_REQUEST_TYPE &&
		typeof value.content === "string" &&
		value.content.length <= MAX_BROADCAST_CONTENT_LENGTH &&
		Object.keys(value).length === 2
	);
}

function isHashResponse(value: unknown): value is BroadcastContentHashResponse {
	if (
		!isRecord(value) ||
		value.type !== BROADCAST_CONTENT_HASH_RESPONSE_TYPE ||
		typeof value.ok !== "boolean" ||
		Object.keys(value).length !== 3
	) {
		return false;
	}

	return value.ok
		? isSha256Fingerprint(value.fingerprint)
		: value.error === "invalid-request" || value.error === "hash-failed";
}

function isContentScriptSender(
	sender: chrome.runtime.MessageSender,
	runtimeId: string,
): boolean {
	if (
		sender.id !== runtimeId ||
		!sender.tab ||
		typeof sender.url !== "string"
	) {
		return false;
	}

	try {
		return isTargetOrigin(new URL(sender.url).origin);
	} catch {
		return false;
	}
}

async function hashWithSubtle(
	content: string,
	subtle: Pick<SubtleCrypto, "digest">,
): Promise<string> {
	const encoded = new TextEncoder().encode(content);
	const digest = await subtle.digest("SHA-256", encoded);

	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

/** Uses the extension worker only when an insecure page has no Web Crypto. */
export async function hashBroadcastContent(
	content: string,
	dependencies: BroadcastContentHashDependencies = {
		subtle: globalThis.crypto?.subtle,
		sendMessage: (message) => chrome.runtime.sendMessage(message),
	},
): Promise<string> {
	if (dependencies.subtle) {
		return hashWithSubtle(content, dependencies.subtle);
	}

	const request: BroadcastContentHashRequest = {
		type: BROADCAST_CONTENT_HASH_REQUEST_TYPE,
		content,
	};
	const response: unknown = await dependencies.sendMessage(request);

	if (!isHashResponse(response) || !response.ok) {
		throw new TypeError("Broadcast content fingerprint response is invalid");
	}

	return response.fingerprint;
}

/** Registers the HTTP-page hash fallback synchronously in the extension worker. */
export function registerBroadcastContentHashResponder(
	runtime: Pick<typeof chrome.runtime, "id" | "onMessage"> = chrome.runtime,
	hashContent: (content: string) => Promise<string> = (content) => {
		const subtle = globalThis.crypto?.subtle;

		if (!subtle) {
			return Promise.reject(new TypeError("Web Crypto is unavailable"));
		}

		return hashWithSubtle(content, subtle);
	},
): void {
	runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (
			!isRecord(message) ||
			message.type !== BROADCAST_CONTENT_HASH_REQUEST_TYPE
		) {
			return false;
		}

		if (!isContentScriptSender(sender, runtime.id) || !isHashRequest(message)) {
			const response: BroadcastContentHashResponse = {
				type: BROADCAST_CONTENT_HASH_RESPONSE_TYPE,
				ok: false,
				error: "invalid-request",
			};
			sendResponse(response);
			return false;
		}

		void hashContent(message.content).then(
			(fingerprint) => {
				const response: BroadcastContentHashResponse = isSha256Fingerprint(
					fingerprint,
				)
					? {
							type: BROADCAST_CONTENT_HASH_RESPONSE_TYPE,
							ok: true,
							fingerprint,
						}
					: {
							type: BROADCAST_CONTENT_HASH_RESPONSE_TYPE,
							ok: false,
							error: "hash-failed",
						};
				sendResponse(response);
			},
			() => {
				const response: BroadcastContentHashResponse = {
					type: BROADCAST_CONTENT_HASH_RESPONSE_TYPE,
					ok: false,
					error: "hash-failed",
				};
				sendResponse(response);
			},
		);

		return true;
	});
}
