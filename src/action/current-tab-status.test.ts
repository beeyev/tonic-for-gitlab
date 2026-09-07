import { describe, expect, test } from "bun:test";
import {
	CONTROL_SURFACE_STATUS_REQUEST_TYPE,
	CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
} from "../control-surface/status-protocol";
import { queryCurrentTabStatus } from "./current-tab-status";

describe("current tab control-surface status", () => {
	test("queries only the active tab id and sends one typed request", async () => {
		const queries: unknown[] = [];
		const messages: unknown[] = [];
		const status = await queryCurrentTabStatus({
			async query(queryInfo) {
				queries.push(queryInfo);
				return [{ id: 42 }];
			},
			async sendMessage(tabId, message) {
				messages.push({ tabId, message });
				return {
					type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
					origin: "https://gitlab.com",
					status: "mounted",
				};
			},
		});

		expect(queries).toEqual([{ active: true, currentWindow: true }]);
		expect(messages).toEqual([
			{
				tabId: 42,
				message: { type: CONTROL_SURFACE_STATUS_REQUEST_TYPE },
			},
		]);
		expect(status.status).toBe("mounted");
	});

	test("keeps unavailable, no tab, message failure, and invalid response distinct", async () => {
		const unavailable = await queryCurrentTabStatus({
			async query() {
				return [{ id: 1 }];
			},
			async sendMessage() {
				return {
					type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
					origin: "http://localhost:10018",
					status: "unavailable",
					reason: "missing-anchor",
				};
			},
		});
		const noTab = await queryCurrentTabStatus({
			async query() {
				return [];
			},
			async sendMessage() {
				throw new Error("must not run");
			},
		});
		const messageFailure = await queryCurrentTabStatus({
			async query() {
				return [{ id: 1 }];
			},
			async sendMessage() {
				throw new Error("untrusted browser detail");
			},
		});
		const invalidResponse = await queryCurrentTabStatus({
			async query() {
				return [{ id: 1 }];
			},
			async sendMessage() {
				return { status: "mounted", page: "private content" };
			},
		});

		expect(unavailable).toEqual({
			type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
			origin: "http://localhost:10018",
			status: "unavailable",
			reason: "missing-anchor",
		});
		expect(noTab.status).toBe("no-active-tab");
		expect(messageFailure.status).toBe("message-failed");
		expect(invalidResponse.status).toBe("invalid-response");
	});

	test("reports a rejected tab query as a browser failure, not a page one", async () => {
		const status = await queryCurrentTabStatus({
			async query() {
				throw new Error("tabs unavailable");
			},
			async sendMessage() {
				throw new Error("should not be reached");
			},
		});

		expect(status).toEqual({ status: "tab-query-failed" });
	});
});
