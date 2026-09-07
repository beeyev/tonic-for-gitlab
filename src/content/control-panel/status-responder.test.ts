import { describe, expect, test } from "bun:test";
import {
	CONTROL_SURFACE_STATUS_REQUEST_TYPE,
	CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
} from "../../control-surface/status-protocol";
import { registerControlSurfaceStatusResponder } from "./status-responder";

describe("control-surface status responder", () => {
	test("responds only to the typed request and removes its listener on abort", () => {
		let listener:
			| ((
					message: unknown,
					sender: chrome.runtime.MessageSender,
					sendResponse: (response?: unknown) => void,
			  ) => boolean)
			| undefined;
		let removedListener: typeof listener;
		const runtime = {
			onMessage: {
				addListener(nextListener: typeof listener) {
					listener = nextListener;
				},
				removeListener(nextListener: typeof listener) {
					removedListener = nextListener;
				},
			},
		} as unknown as Pick<typeof chrome.runtime, "onMessage">;
		const controller = new AbortController();
		registerControlSurfaceStatusResponder(
			() => ({ status: "unavailable", reason: "missing-anchor" }),
			"http://localhost:10019",
			controller.signal,
			runtime,
		);
		let response: unknown;

		expect(
			listener?.(
				{ type: "other-message" },
				{} as chrome.runtime.MessageSender,
				(value) => {
					response = value;
				},
			),
		).toBe(false);
		expect(response).toBeUndefined();

		listener?.(
			{ type: CONTROL_SURFACE_STATUS_REQUEST_TYPE },
			{} as chrome.runtime.MessageSender,
			(value) => {
				response = value;
			},
		);
		expect(response).toEqual({
			type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
			origin: "http://localhost:10019",
			status: "unavailable",
			reason: "missing-anchor",
		});

		controller.abort();
		expect(removedListener).toBe(listener);
	});
});
