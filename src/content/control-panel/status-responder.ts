import {
	type ControlSurfaceStatus,
	createControlSurfaceStatusResponse,
	isControlSurfaceStatusRequest,
} from "../../control-surface/status-protocol";

export function registerControlSurfaceStatusResponder(
	getStatus: () => ControlSurfaceStatus,
	origin: string,
	signal: AbortSignal,
	runtime: Pick<typeof chrome.runtime, "onMessage"> = chrome.runtime,
): void {
	const handleMessage = (
		message: unknown,
		_sender: chrome.runtime.MessageSender,
		sendResponse: (response?: unknown) => void,
	) => {
		if (!isControlSurfaceStatusRequest(message)) {
			return false;
		}

		sendResponse(createControlSurfaceStatusResponse(getStatus(), origin));
		return false;
	};

	runtime.onMessage.addListener(handleMessage);
	signal.addEventListener(
		"abort",
		() => {
			runtime.onMessage.removeListener(handleMessage);
		},
		{ once: true },
	);
}
