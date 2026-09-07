export const AI_PANELS_SELECTOR =
	'[data-testid="ai-panels"], .paneled-view.ai-panels';
export const DUO_DISABLED_TOGGLE_SELECTOR =
	'[data-testid="duo-disabled-toggle"]';

export const HIDDEN_ENTRYPOINT_ATTRIBUTE =
	"data-tonic-for-gitlab-hidden-duo-agent-platform-entrypoint";
export const HIDDEN_RAIL_ATTRIBUTE =
	"data-tonic-for-gitlab-hidden-duo-agent-platform-rail";

export const INTERACTIVE_CONTROL_SELECTOR = [
	"a[href]",
	"button",
	'input:not([type="hidden"])',
	"select",
	"textarea",
	"summary",
	'[contenteditable]:not([contenteditable="false"])',
	'[role="button"]',
	'[role="checkbox"]',
	'[role="combobox"]',
	'[role="link"]',
	'[role="menuitem"]',
	'[role="menuitemcheckbox"]',
	'[role="menuitemradio"]',
	'[role="option"]',
	'[role="radio"]',
	'[role="slider"]',
	'[role="spinbutton"]',
	'[role="switch"]',
	'[role="tab"]',
	'[role="textbox"]',
	'[role="treeitem"]',
	'[tabindex]:not([tabindex="-1"])',
].join(",");
