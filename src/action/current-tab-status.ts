import {
	CONTROL_SURFACE_STATUS_REQUEST_TYPE,
	type ControlSurfaceStatusResponse,
	parseControlSurfaceStatusResponse,
} from "../control-surface/status-protocol";

export type CurrentTabStatus =
	| { status: "loading" }
	| { status: "no-active-tab" }
	| { status: "tab-query-failed" }
	| { status: "message-failed" }
	| { status: "invalid-response" }
	| ControlSurfaceStatusResponse;

interface CurrentTabMessaging {
	query(queryInfo: { active: true; currentWindow: true }): Promise<
		Array<{
			id?: number;
		}>
	>;
	sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

export async function queryCurrentTabStatus(
	tabs: CurrentTabMessaging,
): Promise<Exclude<CurrentTabStatus, { status: "loading" }>> {
	let activeTab: { id?: number } | undefined;

	try {
		/*
		 * A rejected query is a browser-side failure, not a statement about the
		 * page. Reporting it as `invalid-response` would blame the content script
		 * for something it was never asked.
		 */
		[activeTab] = await tabs.query({ active: true, currentWindow: true });
	} catch {
		return { status: "tab-query-failed" };
	}

	if (activeTab?.id === undefined) {
		return { status: "no-active-tab" };
	}

	let response: unknown;

	try {
		response = await tabs.sendMessage(activeTab.id, {
			type: CONTROL_SURFACE_STATUS_REQUEST_TYPE,
		});
	} catch {
		/*
		 * Chrome exposes an untyped rejection here. It can mean no content-script
		 * receiver, a tab that disappeared after the query, or another browser-side
		 * connection failure. Do not turn any of those into a statement about the
		 * page, and do not parse or expose the browser's error text.
		 */
		return { status: "message-failed" };
	}

	return (
		parseControlSurfaceStatusResponse(response) ?? {
			status: "invalid-response",
		}
	);
}
