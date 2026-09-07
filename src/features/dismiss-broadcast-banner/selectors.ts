export const BROADCAST_BANNER_SELECTOR = "[data-broadcast-banner]";

export const BROADCAST_MESSAGE_TEXT_SELECTOR = ".gl-broadcast-message-text";

export const BROADCAST_BULLHORN_USE_SELECTOR =
	'.gl-broadcast-message-icon svg[data-testid="bullhorn-icon"] > use[href]';

export const NATIVE_BROADCAST_DISMISS_SELECTOR = [
	"button.js-dismiss-current-broadcast-notification",
	"button.gl-broadcast-message-dismiss",
].join(",");

export const BROADCAST_DISMISS_CONTROL_ATTRIBUTE =
	"data-tonic-for-gitlab-broadcast-dismiss";

export const BROADCAST_HIDDEN_ATTRIBUTE =
	"data-tonic-for-gitlab-broadcast-hidden";
