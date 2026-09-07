import { isTargetOrigin } from "../host-access/target-origin";

export const CONTROL_SURFACE_STATUS_REQUEST_TYPE =
	"tonic:control-surface:get-status";
export const CONTROL_SURFACE_STATUS_RESPONSE_TYPE =
	"tonic:control-surface:status";

const CONTROL_SURFACE_UNAVAILABLE_REASONS = [
	"initializing",
	"missing-anchor",
	"ambiguous-anchor",
	"unsupported-structure",
	"stylesheet-unavailable",
] as const;

export type ControlSurfaceUnavailableReason =
	(typeof CONTROL_SURFACE_UNAVAILABLE_REASONS)[number];

export type ControlSurfaceStatus =
	| { status: "mounted" }
	/*
	 * The document is not GitLab. A target is a whole origin, so the content
	 * script also runs on whatever else that host serves. This is a normal
	 * outcome, not a failed control surface, and must not be reported as one.
	 */
	| { status: "not-gitlab" }
	| {
			status: "unavailable";
			reason: ControlSurfaceUnavailableReason;
	  };

/**
 * The response carries the document's own origin so the toolbar action can mark
 * which configured instance the current tab belongs to.
 *
 * This is not page data. It is the browser's origin for a document the
 * extension itself chose to inject into, it is validated as a normalized
 * origin, and the action only ever compares it against origins the user
 * configured. It is never rendered, so a value that matches nothing simply
 * marks no row. Nothing else about the page crosses this boundary.
 */
export type ControlSurfaceStatusResponse = ControlSurfaceStatus & {
	type: typeof CONTROL_SURFACE_STATUS_RESPONSE_TYPE;
	origin: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isControlSurfaceStatusRequest(
	value: unknown,
): value is { type: typeof CONTROL_SURFACE_STATUS_REQUEST_TYPE } {
	return (
		isRecord(value) &&
		Object.keys(value).length === 1 &&
		value.type === CONTROL_SURFACE_STATUS_REQUEST_TYPE
	);
}

export function parseControlSurfaceStatusResponse(
	value: unknown,
): ControlSurfaceStatusResponse | undefined {
	if (!isRecord(value) || value.type !== CONTROL_SURFACE_STATUS_RESPONSE_TYPE) {
		return undefined;
	}

	if (!isTargetOrigin(value.origin)) {
		return undefined;
	}

	if (
		(value.status === "mounted" || value.status === "not-gitlab") &&
		Object.keys(value).length === 3
	) {
		return {
			type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
			origin: value.origin,
			status: value.status,
		};
	}

	if (
		value.status === "unavailable" &&
		typeof value.reason === "string" &&
		CONTROL_SURFACE_UNAVAILABLE_REASONS.includes(
			value.reason as ControlSurfaceUnavailableReason,
		) &&
		Object.keys(value).length === 4
	) {
		return {
			type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
			origin: value.origin,
			status: "unavailable",
			reason: value.reason as ControlSurfaceUnavailableReason,
		};
	}

	return undefined;
}

export function createControlSurfaceStatusResponse(
	status: ControlSurfaceStatus,
	origin: string,
): ControlSurfaceStatusResponse {
	return {
		type: CONTROL_SURFACE_STATUS_RESPONSE_TYPE,
		origin,
		...status,
	};
}
