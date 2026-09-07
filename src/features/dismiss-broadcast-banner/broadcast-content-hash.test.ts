import { describe, expect, test } from "bun:test";
import {
	BROADCAST_CONTENT_HASH_REQUEST_TYPE,
	BROADCAST_CONTENT_HASH_RESPONSE_TYPE,
	hashBroadcastContent,
	MAX_BROADCAST_CONTENT_LENGTH,
	registerBroadcastContentHashResponder,
} from "./broadcast-content-hash";

type MessageListener = (
	message: unknown,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response?: unknown) => void,
) => boolean | undefined;

function createRuntimeHarness() {
	let listener: MessageListener | undefined;
	const runtime = {
		id: "tonic-extension-id",
		onMessage: {
			addListener(nextListener: MessageListener) {
				listener = nextListener;
			},
		},
	} as unknown as Pick<typeof chrome.runtime, "id" | "onMessage">;
	const sender = {
		id: runtime.id,
		tab: { id: 1 },
		url: "http://gitlab.example/group/project",
	} as chrome.runtime.MessageSender;

	return {
		get listener() {
			if (!listener) {
				throw new Error("Hash responder was not registered");
			}

			return listener;
		},
		runtime,
		sender,
	};
}

describe("broadcast content hashing", () => {
	test("keeps the existing SHA-256 fingerprint on secure pages", async () => {
		const sendMessage = () =>
			Promise.reject(new Error("Worker fallback should not run"));

		expect(
			await hashBroadcastContent("abc", {
				subtle: globalThis.crypto.subtle,
				sendMessage,
			}),
		).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
		expect(
			await hashBroadcastContent("Tonic ✓", {
				subtle: globalThis.crypto.subtle,
				sendMessage,
			}),
		).toBe("13e0b409f1331963ed78fbb2c224101b5071443d0c87431bc1eb13a9285a17bc");
	});

	test("requests the same fingerprint from the worker without page Web Crypto", async () => {
		let request: unknown;
		const fingerprint = "a".repeat(64);
		const result = await hashBroadcastContent("canonical content", {
			subtle: undefined,
			async sendMessage(message) {
				request = message;
				return {
					type: BROADCAST_CONTENT_HASH_RESPONSE_TYPE,
					ok: true,
					fingerprint,
				};
			},
		});

		expect(request).toEqual({
			type: BROADCAST_CONTENT_HASH_REQUEST_TYPE,
			content: "canonical content",
		});
		expect(result).toBe(fingerprint);
	});

	test("rejects an invalid worker response", async () => {
		for (const response of [
			{ ok: true, fingerprint: "not-a-digest" },
			{
				type: BROADCAST_CONTENT_HASH_RESPONSE_TYPE,
				ok: true,
				fingerprint: "a".repeat(64),
				pageData: "unexpected",
			},
		]) {
			expect(
				hashBroadcastContent("canonical content", {
					subtle: undefined,
					async sendMessage() {
						return response;
					},
				}),
			).rejects.toThrow("Broadcast content fingerprint response is invalid");
		}
	});

	test("responds asynchronously to a bounded request from a target content script", async () => {
		const harness = createRuntimeHarness();
		const fingerprint = "b".repeat(64);
		registerBroadcastContentHashResponder(harness.runtime, async (content) =>
			content === "canonical content" ? fingerprint : "",
		);
		let returned: boolean | undefined;
		const response = new Promise<unknown>((resolve) => {
			returned = harness.listener(
				{
					type: BROADCAST_CONTENT_HASH_REQUEST_TYPE,
					content: "canonical content",
				},
				harness.sender,
				resolve,
			);
		});

		expect(returned).toBe(true);
		expect(await response).toEqual({
			type: BROADCAST_CONTENT_HASH_RESPONSE_TYPE,
			ok: true,
			fingerprint,
		});
	});

	test("preserves UTF-8 fingerprints across the insecure-page worker round trip", async () => {
		const harness = createRuntimeHarness();
		registerBroadcastContentHashResponder(harness.runtime);
		const fingerprint = await hashBroadcastContent("Tonic ✓", {
			subtle: undefined,
			sendMessage(message) {
				return new Promise((resolve, reject) => {
					if (!harness.listener(message, harness.sender, resolve)) {
						reject(new Error("Hash responder did not keep the response open"));
					}
				});
			},
		});

		expect(fingerprint).toBe(
			"13e0b409f1331963ed78fbb2c224101b5071443d0c87431bc1eb13a9285a17bc",
		);
	});

	test("rejects invalid senders and oversized request payloads", () => {
		const harness = createRuntimeHarness();
		let hashCalls = 0;
		registerBroadcastContentHashResponder(harness.runtime, async () => {
			hashCalls += 1;
			return "c".repeat(64);
		});
		const invalidResponses: unknown[] = [];
		const request = {
			type: BROADCAST_CONTENT_HASH_REQUEST_TYPE,
			content: "canonical content",
		};

		expect(
			harness.listener(
				request,
				{ ...harness.sender, id: "other-extension" },
				(response) => invalidResponses.push(response),
			),
		).toBe(false);
		expect(
			harness.listener(
				{
					...request,
					content: "x".repeat(MAX_BROADCAST_CONTENT_LENGTH + 1),
				},
				harness.sender,
				(response) => invalidResponses.push(response),
			),
		).toBe(false);

		expect(hashCalls).toBe(0);
		expect(invalidResponses).toEqual([
			{
				type: BROADCAST_CONTENT_HASH_RESPONSE_TYPE,
				ok: false,
				error: "invalid-request",
			},
			{
				type: BROADCAST_CONTENT_HASH_RESPONSE_TYPE,
				ok: false,
				error: "invalid-request",
			},
		]);
	});

	test("ignores unrelated messages and reports worker hash failures", async () => {
		const harness = createRuntimeHarness();
		registerBroadcastContentHashResponder(harness.runtime, async () => {
			throw new Error("Web Crypto failed");
		});
		let unrelatedResponse: unknown;

		expect(
			harness.listener({ type: "unrelated" }, harness.sender, (response) => {
				unrelatedResponse = response;
			}),
		).toBe(false);
		expect(unrelatedResponse).toBeUndefined();

		const response = new Promise<unknown>((resolve) => {
			expect(
				harness.listener(
					{
						type: BROADCAST_CONTENT_HASH_REQUEST_TYPE,
						content: "canonical content",
					},
					harness.sender,
					resolve,
				),
			).toBe(true);
		});

		expect(await response).toEqual({
			type: BROADCAST_CONTENT_HASH_RESPONSE_TYPE,
			ok: false,
			error: "hash-failed",
		});
	});
});
