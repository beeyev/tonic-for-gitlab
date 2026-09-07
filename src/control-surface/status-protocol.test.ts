import { describe, expect, test } from "bun:test";
import {
	CONTROL_SURFACE_STATUS_REQUEST_TYPE,
	CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
	createControlSurfaceStatusResponse,
	isControlSurfaceStatusRequest,
	parseControlSurfaceStatusResponse,
} from "./status-protocol";

describe("control-surface status protocol", () => {
	test("accepts only the closed request shape", () => {
		expect(
			isControlSurfaceStatusRequest({
				type: CONTROL_SURFACE_STATUS_REQUEST_TYPE,
			}),
		).toBe(true);
		expect(
			isControlSurfaceStatusRequest({
				type: CONTROL_SURFACE_STATUS_REQUEST_TYPE,
				selector: "header",
			}),
		).toBe(false);
	});

	test("accepts mounted and known unavailable responses", () => {
		expect(
			parseControlSurfaceStatusResponse({
				type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
				origin: "https://gitlab.com",
				status: "mounted",
			}),
		).toEqual({
			type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
			origin: "https://gitlab.com",
			status: "mounted",
		});
		expect(
			parseControlSurfaceStatusResponse({
				type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
				origin: "http://localhost:10019",
				status: "unavailable",
				reason: "ambiguous-anchor",
			}),
		).toEqual({
			type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
			origin: "http://localhost:10019",
			status: "unavailable",
			reason: "ambiguous-anchor",
		});
	});

	/*
	 * A foreign page on a granted origin is a normal outcome. If the parser drops
	 * this status the action reports `invalid-response`, which reads as a bug in
	 * the page rather than as "this is not GitLab".
	 */
	test("round-trips the not-gitlab status", () => {
		expect(
			parseControlSurfaceStatusResponse(
				createControlSurfaceStatusResponse(
					{ status: "not-gitlab" },
					"https://intranet.example",
				),
			),
		).toEqual({
			type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
			origin: "https://intranet.example",
			status: "not-gitlab",
		});
	});

	test("rejects unknown reasons and extra page data", () => {
		expect(
			parseControlSurfaceStatusResponse({
				type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
				origin: "https://gitlab.com",
				status: "unavailable",
				reason: "page-said-so",
			}),
		).toBeUndefined();
		expect(
			parseControlSurfaceStatusResponse({
				type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
				origin: "https://gitlab.com",
				status: "mounted",
				url: "https://gitlab.example/private",
			}),
		).toBeUndefined();
	});

	test("rejects a response whose origin is missing or not normalized", () => {
		expect(
			parseControlSurfaceStatusResponse({
				type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
				status: "mounted",
			}),
		).toBeUndefined();
		expect(
			parseControlSurfaceStatusResponse({
				type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
				origin: "https://gitlab.example/group/project",
				status: "mounted",
			}),
		).toBeUndefined();
	});
});
