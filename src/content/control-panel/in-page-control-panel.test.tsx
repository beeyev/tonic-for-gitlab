import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	readMergeRequestContractFixture,
	readTopBarFixture,
} from "../../../tests/helpers/gitlab-dom";
import { getDimDraftMergeRequestsCompatibility } from "../../features/dim-draft-merge-requests/dim-draft-merge-requests";
import { getFilterMyAuthoredMergeRequestsCompatibility } from "../../features/filter-my-authored-merge-requests/filter-my-authored-merge-requests";
import { getHighlightAuthoredMergeRequestsCompatibility } from "../../features/highlight-authored-merge-requests/highlight-authored-merge-requests";
import { getStartThreadsByDefaultCompatibility } from "../../features/start-threads-by-default/start-threads-by-default";
import { DEFAULT_SETTINGS } from "../../settings/repository";
import { createFeatureContext } from "../runtime/feature-context";
import { activateFeatureRuntime } from "../runtime/feature-lifecycle";
import {
	DEFAULT_IN_PAGE_FEATURE_COMPATIBILITY,
	InPageControlPanelView,
	type InPageFeatureCompatibility,
	type SettingChangeHandlers,
} from "./in-page-control-panel";
import {
	CONTROL_SURFACE_Z_INDEX,
	createInPageControlPanelFeature,
} from "./in-page-control-panel-feature";
import {
	IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE,
	IN_PAGE_CONTROL_PANEL_STYLES_ATTRIBUTE,
} from "./mount-in-page-control-panel";
import { resolveTopBarAnchor } from "./top-bar-anchor";

const TEST_STYLESHEET = ":host { color: CanvasText; }";

const NOOP_HANDLERS: SettingChangeHandlers = {
	onApproveMergeRequestFromTabsEnabledChange: async () => {},
	onCollapseJobLogSectionsByDefaultEnabledChange: async () => {},
	onConfirmMergeRequestEnabledChange: async () => {},
	onCopyMergeRequestLinkEnabledChange: async () => {},
	onDimDraftMergeRequestsEnabledChange: async () => {},
	onFilterMyAuthoredMergeRequestsEnabledChange: async () => {},
	onHideDuoAgentPlatformEntrypointEnabledChange: async () => {},
	onHideFileTreeBrowserFeedbackButtonEnabledChange: async () => {},
	onHighlightAuthoredMergeRequestsEnabledChange: async () => {},
	onRememberMergeRequestListFiltersEnabledChange: async () => {},
	onStartThreadsByDefaultEnabledChange: async () => {},
	onToggleJobLogSectionsEnabledChange: async () => {},
};

beforeEach(() => {
	document.documentElement.className = "";
	document.body.replaceChildren();
});

afterEach(() => {
	cleanup();
	document.body.replaceChildren();
	(
		window as unknown as { happyDOM: { setURL(url: string): void } }
	).happyDOM.setURL("http://localhost/");
});

function createShadowMount(): {
	mountingPoint: HTMLDivElement;
	shadowRoot: ShadowRoot;
} {
	const host = document.createElement("div");
	const shadowRoot = host.attachShadow({ mode: "open" });
	const mountingPoint = document.createElement("div");
	shadowRoot.append(mountingPoint);
	document.body.append(host);
	return { mountingPoint, shadowRoot };
}

describe("in-page control panel", () => {
	test("explains which settings are inactive on an unsupported page contract", async () => {
		const { mountingPoint, shadowRoot } = createShadowMount();
		const user = userEvent.setup({ document });
		render(
			<InPageControlPanelView
				compatibility={{
					approveMergeRequestFromTabs: "unsupported",
					confirmMergeRequest: "unsupported",
					copyMergeRequestLink: "unsupported",
					dimDraftMergeRequests: "unsupported",
					filterMyAuthoredMergeRequests: "unsupported",
					hideDuoAgentPlatformEntrypoint: "unsupported",
					hideFileTreeBrowserFeedbackButton: "unsupported",
					highlightAuthoredMergeRequests: "unsupported",
					startThreadsByDefault: "unsupported",
					toggleJobLogSections: "unsupported",
				}}
				portalContainer={shadowRoot}
				settings={DEFAULT_SETTINGS}
				handlers={NOOP_HANDLERS}
			/>,
			{ container: mountingPoint },
		);

		await user.click(
			within(mountingPoint).getByRole("button", { name: "Tonic settings" }),
		);
		const dialog = shadowRoot.querySelector<HTMLElement>(
			'[data-slot="popover-content"]',
		) as HTMLElement;
		const statuses = within(dialog).getAllByRole("status");

		expect(statuses).toHaveLength(11);
		expect(statuses.map(({ textContent }) => textContent)).toEqual([
			"Hide unavailable GitLab Duo entry point: Inactive on this page. The GitLab Duo entry point uses an unsupported page structure.",
			"Hide file tree feedback link: Inactive on this page. The file tree browser uses an unsupported page structure.",
			"Approve from the tab bar: Inactive on this page. This feature does not support the current GitLab merge request tab bar.",
			"Copy merge request link: Inactive on this page. This feature does not support the current GitLab merge request header.",
			"Confirm main merge action: Inactive on this page. This feature does not support the current GitLab merge widget.",
			"Dim draft merge requests: Inactive on this page. This feature does not support the current GitLab merge request list.",
			"Filter to my merge requests: Inactive on this page. This feature does not support the current GitLab merge request list.",
			"Highlight my merge requests: Inactive on this page. This feature does not support the current GitLab merge request list.",
			"Start threads by default: Inactive on this page. This feature does not support the current GitLab comment box.",
			"Toggle job log sections: Inactive on this page. This feature does not support the current GitLab job log.",
			"Collapse job log sections by default: Inactive on this page. This feature does not support the current GitLab job log.",
		]);

		const dimSwitch = within(dialog).getByRole("switch", {
			name: "Dim draft merge requests",
		});
		const describedBy = dimSwitch.getAttribute("aria-describedby")?.split(" ");
		expect(describedBy).toContain(statuses[5]?.id);
		expect(
			within(dialog)
				.getByRole("switch", { name: "Filter to my merge requests" })
				.getAttribute("aria-describedby")
				?.split(" "),
		).toContain(statuses[6]?.id);
		expect(
			within(dialog)
				.getByRole("switch", { name: "Remember list filters" })
				.getAttribute("aria-describedby"),
		).not.toContain(statuses[5]?.id);
	});

	test("says which setting the collapsed job log default depends on", async () => {
		const { mountingPoint, shadowRoot } = createShadowMount();
		const user = userEvent.setup({ document });
		render(
			<InPageControlPanelView
				compatibility={{
					...DEFAULT_IN_PAGE_FEATURE_COMPATIBILITY,
					toggleJobLogSections: "supported",
				}}
				portalContainer={shadowRoot}
				settings={{
					...DEFAULT_SETTINGS,
					collapseJobLogSectionsByDefaultEnabled: true,
					toggleJobLogSectionsEnabled: false,
				}}
				handlers={NOOP_HANDLERS}
			/>,
			{ container: mountingPoint },
		);

		await user.click(
			within(mountingPoint).getByRole("button", { name: "Tonic settings" }),
		);
		const dialog = shadowRoot.querySelector<HTMLElement>(
			'[data-slot="popover-content"]',
		) as HTMLElement;
		const statuses = within(dialog).getAllByRole("status");

		// The dependency is the only unmet condition on this supported page.
		expect(statuses.map(({ textContent }) => textContent)).toEqual([
			"Collapse job log sections by default: Needs Toggle job log sections. Turn that on to use this.",
		]);
		expect(
			within(dialog)
				.getByRole("switch", { name: "Collapse job log sections by default" })
				.getAttribute("aria-describedby")
				?.split(" "),
		).toContain(statuses[0]?.id);
		// The switch still shows the stored choice; the dependency does not
		// silently rewrite it.
		expect(
			within(dialog)
				.getByRole("switch", { name: "Collapse job log sections by default" })
				.getAttribute("aria-checked"),
		).toBe("true");
	});

	test("prefers the dependency over the page contract on the collapsed default", async () => {
		const { mountingPoint, shadowRoot } = createShadowMount();
		const user = userEvent.setup({ document });
		render(
			<InPageControlPanelView
				compatibility={{
					...DEFAULT_IN_PAGE_FEATURE_COMPATIBILITY,
					toggleJobLogSections: "unsupported",
				}}
				portalContainer={shadowRoot}
				settings={{ ...DEFAULT_SETTINGS, toggleJobLogSectionsEnabled: false }}
				handlers={NOOP_HANDLERS}
			/>,
			{ container: mountingPoint },
		);

		await user.click(
			within(mountingPoint).getByRole("button", { name: "Tonic settings" }),
		);
		const dialog = shadowRoot.querySelector<HTMLElement>(
			'[data-slot="popover-content"]',
		) as HTMLElement;

		expect(
			within(dialog)
				.getAllByRole("status")
				.map(({ textContent }) => textContent),
		).toEqual([
			"Toggle job log sections: Inactive on this page. This feature does not support the current GitLab job log.",
			"Collapse job log sections by default: Needs Toggle job log sections. Turn that on to use this.",
		]);
	});

	test("keeps its portaled dialog in the shadow root while changing the setting", async () => {
		const { mountingPoint, shadowRoot } = createShadowMount();
		const settingsChanges: boolean[] = [];
		const user = userEvent.setup({ document });
		/*
		 * The runtime applies the settings the repository persisted before the
		 * handler resolves, so a settled write always arrives with new props.
		 */
		let view: ReturnType<typeof render>;
		const panel = (enabled: boolean) => (
			<InPageControlPanelView
				portalContainer={shadowRoot}
				settings={{
					...DEFAULT_SETTINGS,
					dimDraftMergeRequestsEnabled: enabled,
				}}
				handlers={{
					...NOOP_HANDLERS,
					onDimDraftMergeRequestsEnabledChange: async (next) => {
						settingsChanges.push(next);
						view.rerender(panel(next));
					},
				}}
			/>
		);
		view = render(panel(true), { container: mountingPoint });
		const trigger = within(mountingPoint).getByRole("button", {
			name: "Tonic settings",
		});

		await user.click(trigger);

		const dialog = await waitFor(() => {
			const element = shadowRoot.querySelector<HTMLElement>(
				'[data-slot="popover-content"]',
			);
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		expect(dialog.getAttribute("role")).toBe("dialog");
		const dialogLabelId = dialog.getAttribute("aria-labelledby");
		expect(dialogLabelId).not.toBeNull();
		expect(
			shadowRoot.getElementById(dialogLabelId as string)?.textContent,
		).toBe("Tonic for GitLab");
		expect(within(dialog).getByText("Tonic for GitLab")).toBeTruthy();
		const setting = within(dialog).getByRole("switch", {
			name: "Dim draft merge requests",
		});
		expect(dialog.getRootNode()).toBe(shadowRoot);
		expect(setting.getAttribute("aria-checked")).toBe("true");

		await user.click(setting);

		expect(settingsChanges).toEqual([false]);
		expect(setting.getAttribute("aria-checked")).toBe("false");
		expect(shadowRoot.querySelector('[data-slot="popover-content"]')).toBe(
			dialog,
		);

		await user.click(document.body);
		await waitFor(() => {
			expect(
				shadowRoot.querySelector('[data-slot="popover-content"]'),
			).toBeNull();
		});
	});

	test("follows a stored value that changes while the panel is open", async () => {
		const { mountingPoint, shadowRoot } = createShadowMount();
		const user = userEvent.setup({ document });
		const view = render(
			<InPageControlPanelView
				portalContainer={shadowRoot}
				settings={DEFAULT_SETTINGS}
				handlers={NOOP_HANDLERS}
			/>,
			{ container: mountingPoint },
		);

		await user.click(
			within(mountingPoint).getByRole("button", { name: "Tonic settings" }),
		);
		const setting = await waitFor(() => {
			const dialog = shadowRoot.querySelector<HTMLElement>(
				'[data-slot="popover-content"]',
			);
			expect(dialog).not.toBeNull();
			return within(dialog as HTMLElement).getByRole("switch", {
				name: "Dim draft merge requests",
			});
		});
		expect(setting.getAttribute("aria-checked")).toBe("true");

		// A change from another tab arrives as new props, with nothing pending.
		view.rerender(
			<InPageControlPanelView
				portalContainer={shadowRoot}
				settings={{ ...DEFAULT_SETTINGS, dimDraftMergeRequestsEnabled: false }}
				handlers={NOOP_HANDLERS}
			/>,
		);

		await waitFor(() => {
			expect(setting.getAttribute("aria-checked")).toBe("false");
		});
		expect(shadowRoot.querySelector('[data-slot="popover-content"]')).not.toBe(
			null,
		);
	});

	test("shows the last toggle in flight, then settles on the stored value", async () => {
		const { mountingPoint, shadowRoot } = createShadowMount();
		const user = userEvent.setup({ document });
		const panel = (enabled: boolean) => (
			<InPageControlPanelView
				portalContainer={shadowRoot}
				settings={{
					...DEFAULT_SETTINGS,
					dimDraftMergeRequestsEnabled: enabled,
				}}
				handlers={NOOP_HANDLERS}
			/>
		);
		const view = render(panel(true), { container: mountingPoint });

		await user.click(
			within(mountingPoint).getByRole("button", { name: "Tonic settings" }),
		);
		const setting = await waitFor(() => {
			const dialog = shadowRoot.querySelector<HTMLElement>(
				'[data-slot="popover-content"]',
			);
			expect(dialog).not.toBeNull();
			return within(dialog as HTMLElement).getByRole("switch", {
				name: "Dim draft merge requests",
			});
		});

		await user.click(setting); // -> false
		await user.click(setting); // -> true, net zero

		// While writes are in flight the last toggle is what the user sees.
		expect(setting.getAttribute("aria-checked")).toBe("true");

		// Both echoes arrive in write order, ending back on the original value.
		view.rerender(panel(false));
		view.rerender(panel(true));

		// A later change from another tab must not be masked by a stuck override.
		view.rerender(panel(false));

		await waitFor(() => {
			expect(setting.getAttribute("aria-checked")).toBe("false");
		});
	});

	test("changes each setting independently and keeps the popover open", async () => {
		const { mountingPoint, shadowRoot } = createShadowMount();
		const dimChanges: boolean[] = [];
		const filterMyChanges: boolean[] = [];
		const authoredChanges: boolean[] = [];
		const user = userEvent.setup({ document });
		let view: ReturnType<typeof render>;
		let stored = {
			dimDraftMergeRequestsEnabled: true,
			filterMyAuthoredMergeRequestsEnabled: true,
			highlightAuthoredMergeRequestsEnabled: true,
		};
		// Each handler persists only its own key and hands back the merged state,
		// which is what the repository and runtime do together.
		const handlers: SettingChangeHandlers = {
			...NOOP_HANDLERS,
			onDimDraftMergeRequestsEnabledChange: async (enabled) => {
				dimChanges.push(enabled);
				stored = { ...stored, dimDraftMergeRequestsEnabled: enabled };
				view.rerender(panel(stored));
			},
			onFilterMyAuthoredMergeRequestsEnabledChange: async (enabled) => {
				filterMyChanges.push(enabled);
				stored = { ...stored, filterMyAuthoredMergeRequestsEnabled: enabled };
				view.rerender(panel(stored));
			},
			onHighlightAuthoredMergeRequestsEnabledChange: async (enabled) => {
				authoredChanges.push(enabled);
				stored = { ...stored, highlightAuthoredMergeRequestsEnabled: enabled };
				view.rerender(panel(stored));
			},
		};
		const panel = (settings: {
			dimDraftMergeRequestsEnabled: boolean;
			filterMyAuthoredMergeRequestsEnabled: boolean;
			highlightAuthoredMergeRequestsEnabled: boolean;
		}) => (
			<InPageControlPanelView
				portalContainer={shadowRoot}
				settings={{ ...DEFAULT_SETTINGS, ...settings }}
				handlers={handlers}
			/>
		);
		view = render(panel(stored), { container: mountingPoint });

		await user.click(
			within(mountingPoint).getByRole("button", { name: "Tonic settings" }),
		);
		const dialog = await waitFor(() => {
			const element = shadowRoot.querySelector<HTMLElement>(
				'[data-slot="popover-content"]',
			);
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		const dimSwitch = within(dialog).getByRole("switch", {
			name: "Dim draft merge requests",
		});
		const filterMySwitch = within(dialog).getByRole("switch", {
			name: "Filter to my merge requests",
		});
		const authoredSwitch = within(dialog).getByRole("switch", {
			name: "Highlight my merge requests",
		});
		expect(authoredSwitch.getAttribute("aria-checked")).toBe("true");

		await user.click(authoredSwitch);

		expect(authoredChanges).toEqual([false]);
		expect(filterMyChanges).toEqual([]);
		expect(dimChanges).toEqual([]);
		expect(authoredSwitch.getAttribute("aria-checked")).toBe("false");
		// Persisting one setting must not disturb the other.
		expect(dimSwitch.getAttribute("aria-checked")).toBe("true");
		expect(filterMySwitch.getAttribute("aria-checked")).toBe("true");

		await user.click(filterMySwitch);

		expect(filterMyChanges).toEqual([false]);
		expect(filterMySwitch.getAttribute("aria-checked")).toBe("false");
		expect(dimSwitch.getAttribute("aria-checked")).toBe("true");
		expect(authoredSwitch.getAttribute("aria-checked")).toBe("false");

		await user.click(dimSwitch);

		expect(dimChanges).toEqual([false]);
		expect(filterMyChanges).toEqual([false]);
		expect(authoredChanges).toEqual([false]);
		expect(dimSwitch.getAttribute("aria-checked")).toBe("false");
		expect(authoredSwitch.getAttribute("aria-checked")).toBe("false");
		expect(shadowRoot.querySelector('[data-slot="popover-content"]')).toBe(
			dialog,
		);

		// Another tab turns Draft dimming back on.
		view.rerender(
			panel({
				dimDraftMergeRequestsEnabled: true,
				filterMyAuthoredMergeRequestsEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
			}),
		);

		await waitFor(() => {
			expect(dimSwitch.getAttribute("aria-checked")).toBe("true");
		});
		expect(authoredSwitch.getAttribute("aria-checked")).toBe("false");
	});

	test("reports a failed save, reverts the switch, and clears on a retry", async () => {
		const { mountingPoint, shadowRoot } = createShadowMount();
		const user = userEvent.setup({ document });
		let failWrite = true;
		const panel = (enabled: boolean) => (
			<InPageControlPanelView
				portalContainer={shadowRoot}
				settings={{
					...DEFAULT_SETTINGS,
					dimDraftMergeRequestsEnabled: enabled,
				}}
				handlers={{
					...NOOP_HANDLERS,
					onDimDraftMergeRequestsEnabledChange: async (next) => {
						if (failWrite) {
							throw new Error("storage unavailable");
						}

						view.rerender(panel(next));
					},
				}}
			/>
		);
		let view: ReturnType<typeof render>;
		view = render(panel(true), { container: mountingPoint });

		await user.click(
			within(mountingPoint).getByRole("button", { name: "Tonic settings" }),
		);
		const dialog = shadowRoot.querySelector<HTMLElement>(
			'[data-slot="popover-content"]',
		) as HTMLElement;
		const dim = within(dialog).getByRole("switch", {
			name: "Dim draft merge requests",
		});
		const authored = within(dialog).getByRole("switch", {
			name: "Highlight my merge requests",
		});

		await user.click(dim);

		const alert = await waitFor(() => {
			const element = within(dialog).getByRole("alert");
			expect(element).not.toBeNull();
			return element;
		});
		expect(alert.textContent).toContain("Could not save");
		// The optimistic value is dropped, so the switch shows what is stored.
		expect(dim.getAttribute("aria-checked")).toBe("true");
		// The other row is untouched by its neighbour's failure.
		expect(authored.getAttribute("aria-checked")).toBe("true");
		expect(within(dialog).queryAllByRole("alert")).toHaveLength(1);

		// Retrying clears the notice, which is exactly what it asks the user to do.
		failWrite = false;
		await user.click(dim);

		await waitFor(() => {
			expect(within(dialog).queryByRole("alert")).toBeNull();
		});
		expect(dim.getAttribute("aria-checked")).toBe("false");
	});

	test("changes the remembered list filters setting without touching its neighbours", async () => {
		const { mountingPoint, shadowRoot } = createShadowMount();
		const changes: boolean[] = [];
		const user = userEvent.setup({ document });
		let view: ReturnType<typeof render>;
		const panel = (enabled: boolean) => (
			<InPageControlPanelView
				portalContainer={shadowRoot}
				settings={{
					...DEFAULT_SETTINGS,
					rememberMergeRequestListFiltersEnabled: enabled,
				}}
				handlers={{
					...NOOP_HANDLERS,
					onRememberMergeRequestListFiltersEnabledChange: async (next) => {
						changes.push(next);
						view.rerender(panel(next));
					},
				}}
			/>
		);
		view = render(panel(true), { container: mountingPoint });

		await user.click(
			within(mountingPoint).getByRole("button", { name: "Tonic settings" }),
		);
		const dialog = await waitFor(() => {
			const element = shadowRoot.querySelector<HTMLElement>(
				'[data-slot="popover-content"]',
			);
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		const remember = within(dialog).getByRole("switch", {
			name: "Remember list filters",
		});
		expect(remember.getAttribute("aria-checked")).toBe("true");

		await user.click(remember);

		expect(changes).toEqual([false]);
		expect(remember.getAttribute("aria-checked")).toBe("false");
		expect(
			within(dialog)
				.getByRole("switch", { name: "Dim draft merge requests" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			within(dialog)
				.getByRole("switch", { name: "Highlight my merge requests" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(shadowRoot.querySelector('[data-slot="popover-content"]')).toBe(
			dialog,
		);
	});

	test("changes the start threads setting without touching its neighbours", async () => {
		const { mountingPoint, shadowRoot } = createShadowMount();
		const changes: boolean[] = [];
		const user = userEvent.setup({ document });
		let view: ReturnType<typeof render>;
		const panel = (enabled: boolean) => (
			<InPageControlPanelView
				portalContainer={shadowRoot}
				settings={{
					...DEFAULT_SETTINGS,
					startThreadsByDefaultEnabled: enabled,
				}}
				handlers={{
					...NOOP_HANDLERS,
					onStartThreadsByDefaultEnabledChange: async (next) => {
						changes.push(next);
						view.rerender(panel(next));
					},
				}}
			/>
		);
		view = render(panel(true), { container: mountingPoint });

		await user.click(
			within(mountingPoint).getByRole("button", { name: "Tonic settings" }),
		);
		const dialog = await waitFor(() => {
			const element = shadowRoot.querySelector<HTMLElement>(
				'[data-slot="popover-content"]',
			);
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		const startThreads = within(dialog).getByRole("switch", {
			name: "Start threads by default",
		});
		expect(startThreads.getAttribute("aria-checked")).toBe("true");
		// The default-on state is what a first-time reader sees in the panel.
		expect(DEFAULT_SETTINGS.startThreadsByDefaultEnabled).toBe(true);

		await user.click(startThreads);

		expect(changes).toEqual([false]);
		expect(startThreads.getAttribute("aria-checked")).toBe("false");
		expect(
			within(dialog)
				.getByRole("switch", { name: "Remember list filters" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			within(dialog)
				.getByRole("switch", { name: "Dim draft merge requests" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(shadowRoot.querySelector('[data-slot="popover-content"]')).toBe(
			dialog,
		);
	});

	test("changes the copy merge request link setting through its own handler", async () => {
		const { mountingPoint, shadowRoot } = createShadowMount();
		const changes: boolean[] = [];
		const user = userEvent.setup({ document });
		let view: ReturnType<typeof render>;
		const panel = (enabled: boolean) => (
			<InPageControlPanelView
				portalContainer={shadowRoot}
				settings={{
					...DEFAULT_SETTINGS,
					copyMergeRequestLinkEnabled: enabled,
				}}
				handlers={{
					...NOOP_HANDLERS,
					onCopyMergeRequestLinkEnabledChange: async (next) => {
						changes.push(next);
						view.rerender(panel(next));
					},
				}}
			/>
		);
		view = render(panel(true), { container: mountingPoint });

		await user.click(
			within(mountingPoint).getByRole("button", { name: "Tonic settings" }),
		);
		const dialog = await waitFor(() => {
			const element = shadowRoot.querySelector<HTMLElement>(
				'[data-slot="popover-content"]',
			);
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		const copyLink = within(dialog).getByRole("switch", {
			name: "Copy merge request link",
		});

		expect(DEFAULT_SETTINGS.copyMergeRequestLinkEnabled).toBe(true);
		expect(copyLink.getAttribute("aria-checked")).toBe("true");
		await user.click(copyLink);
		expect(changes).toEqual([false]);
		expect(copyLink.getAttribute("aria-checked")).toBe("false");
		expect(
			within(dialog)
				.getByRole("switch", { name: "Confirm main merge action" })
				.getAttribute("aria-checked"),
		).toBe("false");
	});

	test("enables merge confirmation from its default-off state", async () => {
		const { mountingPoint, shadowRoot } = createShadowMount();
		const changes: boolean[] = [];
		const user = userEvent.setup({ document });
		let view: ReturnType<typeof render>;
		const panel = (enabled: boolean) => (
			<InPageControlPanelView
				portalContainer={shadowRoot}
				settings={{
					...DEFAULT_SETTINGS,
					confirmMergeRequestEnabled: enabled,
				}}
				handlers={{
					...NOOP_HANDLERS,
					onConfirmMergeRequestEnabledChange: async (next) => {
						changes.push(next);
						view.rerender(panel(next));
					},
				}}
			/>
		);
		view = render(panel(false), { container: mountingPoint });

		await user.click(
			within(mountingPoint).getByRole("button", { name: "Tonic settings" }),
		);
		const dialog = await waitFor(() => {
			const element = shadowRoot.querySelector<HTMLElement>(
				'[data-slot="popover-content"]',
			);
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		const confirmation = within(dialog).getByRole("switch", {
			name: "Confirm main merge action",
		});

		expect(DEFAULT_SETTINGS.confirmMergeRequestEnabled).toBe(false);
		expect(confirmation.getAttribute("aria-checked")).toBe("false");

		await user.click(confirmation);

		expect(changes).toEqual([true]);
		expect(confirmation.getAttribute("aria-checked")).toBe("true");
		expect(
			within(dialog)
				.getByRole("switch", { name: "Start threads by default" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(shadowRoot.querySelector('[data-slot="popover-content"]')).toBe(
			dialog,
		);
	});

	test("opens from the keyboard, dismisses on Escape, and restores trigger focus", async () => {
		const { mountingPoint, shadowRoot } = createShadowMount();
		const user = userEvent.setup({ document });
		render(
			<InPageControlPanelView
				portalContainer={shadowRoot}
				settings={DEFAULT_SETTINGS}
				handlers={NOOP_HANDLERS}
			/>,
			{ container: mountingPoint },
		);
		const trigger = within(mountingPoint).getByRole("button", {
			name: "Tonic settings",
		});
		trigger.focus();

		await user.keyboard("{Enter}");

		const setting = await waitFor(() => {
			const dialog = shadowRoot.querySelector<HTMLElement>(
				'[data-slot="popover-content"]',
			);
			expect(dialog).not.toBeNull();
			return within(dialog as HTMLElement).getByRole("switch", {
				name: "Hide unavailable GitLab Duo entry point",
			});
		});
		expect(setting.getAttribute("aria-labelledby")).not.toBeNull();
		expect(shadowRoot.activeElement).toBe(setting);

		await user.keyboard("{Escape}");

		await waitFor(() => {
			expect(
				shadowRoot.querySelector('[data-slot="popover-content"]'),
			).toBeNull();
			expect(shadowRoot.activeElement).toBe(trigger);
		});
	});
});

describe("top-bar control-surface lifecycle", () => {
	test("updates an open panel after same-document navigation replaces the list surface", async () => {
		const [topBar, project, dashboard] = await Promise.all([
			readTopBarFixture("19", "signed-out"),
			readMergeRequestContractFixture("19", "project"),
			readMergeRequestContractFixture("19", "dashboard"),
		]);
		const testWindow = window as unknown as {
			happyDOM: { setURL(url: string): void };
		};
		document.body.innerHTML = `${topBar}${project.markup}`;
		document.body.dataset.page = project.page;
		const filterBar = document.createElement("div");
		filterBar.dataset.testid = "issuable-search-container";
		document
			.querySelector(".issuable-list-container")
			?.insertAdjacentElement("beforebegin", filterBar);
		testWindow.happyDOM.setURL(
			"https://gitlab.com/example/project/-/merge_requests",
		);
		const user = userEvent.setup({ document });
		const controller = new AbortController();
		const controlPanel = createInPageControlPanelFeature(
			DEFAULT_SETTINGS,
			NOOP_HANDLERS,
			TEST_STYLESHEET,
			(context) => ({
				approveMergeRequestFromTabs: "not-applicable",
				confirmMergeRequest: "not-applicable",
				copyMergeRequestLink: "not-applicable",
				dimDraftMergeRequests: getDimDraftMergeRequestsCompatibility(context),
				filterMyAuthoredMergeRequests:
					getFilterMyAuthoredMergeRequestsCompatibility(context),
				hideDuoAgentPlatformEntrypoint: "not-applicable",
				hideFileTreeBrowserFeedbackButton: "not-applicable",
				highlightAuthoredMergeRequests:
					getHighlightAuthoredMergeRequestsCompatibility(context),
				// Not applicable on a list page, so this row carries no reason.
				startThreadsByDefault: getStartThreadsByDefaultCompatibility(context),
				toggleJobLogSections: "not-applicable",
			}),
		);

		await act(async () => {
			activateFeatureRuntime(window, [controlPanel.feature], controller.signal);
		});
		const shadowRoot = document.querySelector(
			`[${IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE}]`,
		)?.shadowRoot as ShadowRoot;
		await user.click(
			within(shadowRoot.querySelector("div") as HTMLElement).getByRole(
				"button",
				{ name: "Tonic settings" },
			),
		);
		const dialog = shadowRoot.querySelector<HTMLElement>(
			'[data-slot="popover-content"]',
		) as HTMLElement;
		expect(within(dialog).queryByRole("status")).toBeNull();

		const template = document.createElement("template");
		template.innerHTML = dashboard.markup;
		const replacementRoot = template.content.querySelector("main");
		if (!replacementRoot) {
			throw new Error("Dashboard contract fixture has no content root");
		}
		await act(async () => {
			document.querySelector("main#content-body")?.replaceWith(replacementRoot);
			document.body.dataset.page = dashboard.page;
			testWindow.happyDOM.setURL("https://gitlab.com/dashboard/merge_requests");
			window.dispatchEvent(new PopStateEvent("popstate"));
			const navigationContext = createFeatureContext(window);
			expect(getDimDraftMergeRequestsCompatibility(navigationContext)).toBe(
				"unsupported",
			);
			controlPanel.feature.reconcile?.(navigationContext, controller.signal);
		});

		await waitFor(() => {
			expect(
				within(dialog)
					.getAllByRole("status")
					.map(({ textContent }) => textContent),
			).toEqual([
				"Dim draft merge requests: Inactive on this page. This feature does not support the current GitLab merge request list.",
				"Highlight my merge requests: Inactive on this page. This feature does not support the current GitLab merge request list.",
			]);
		});
		expect(shadowRoot.querySelector('[data-slot="popover-content"]')).toBe(
			dialog,
		);

		await act(async () => {
			controller.abort();
		});
	});

	test("updates an open panel when page compatibility changes", async () => {
		document.body.innerHTML = await readTopBarFixture("19", "signed-out");
		const user = userEvent.setup({ document });
		const controller = new AbortController();
		let compatibility: InPageFeatureCompatibility = {
			approveMergeRequestFromTabs: "supported",
			confirmMergeRequest: "supported",
			copyMergeRequestLink: "supported",
			dimDraftMergeRequests: "supported",
			filterMyAuthoredMergeRequests: "supported",
			hideDuoAgentPlatformEntrypoint: "supported",
			hideFileTreeBrowserFeedbackButton: "supported",
			highlightAuthoredMergeRequests: "supported",
			startThreadsByDefault: "supported",
			toggleJobLogSections: "supported",
		};
		const controlPanel = createInPageControlPanelFeature(
			DEFAULT_SETTINGS,
			NOOP_HANDLERS,
			TEST_STYLESHEET,
			() => compatibility,
		);
		const context = createFeatureContext(window);

		await act(async () => {
			controlPanel.feature.activate(context, controller.signal);
		});
		const shadowRoot = document.querySelector(
			`[${IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE}]`,
		)?.shadowRoot as ShadowRoot;
		const trigger = await waitFor(() =>
			within(shadowRoot.querySelector("div") as HTMLElement).getByRole(
				"button",
				{ name: "Tonic settings" },
			),
		);
		await user.click(trigger);
		const dialog = shadowRoot.querySelector<HTMLElement>(
			'[data-slot="popover-content"]',
		) as HTMLElement;
		expect(within(dialog).queryByRole("status")).toBeNull();

		compatibility = {
			approveMergeRequestFromTabs: "unsupported",
			confirmMergeRequest: "unsupported",
			copyMergeRequestLink: "unsupported",
			dimDraftMergeRequests: "unsupported",
			filterMyAuthoredMergeRequests: "unsupported",
			hideDuoAgentPlatformEntrypoint: "unsupported",
			hideFileTreeBrowserFeedbackButton: "unsupported",
			highlightAuthoredMergeRequests: "unsupported",
			startThreadsByDefault: "unsupported",
			toggleJobLogSections: "unsupported",
		};
		await act(async () => {
			controlPanel.feature.reconcile?.(context, controller.signal);
		});

		await waitFor(() => {
			expect(within(dialog).getAllByRole("status")).toHaveLength(11);
		});
		expect(shadowRoot.querySelector('[data-slot="popover-content"]')).toBe(
			dialog,
		);

		await act(async () => {
			controller.abort();
		});
	});

	test("resolves the signed-in and signed-out top bar anchors", async () => {
		document.body.innerHTML = await readTopBarFixture("19", "signed-in");
		const signedIn = resolveTopBarAnchor(document);
		expect(signedIn.status).toBe("available");
		if (signedIn.status === "available") {
			expect(signedIn.before?.classList.contains("user-menu")).toBe(true);
		}

		document.body.innerHTML = await readTopBarFixture("19", "signed-out");
		const signedOut = resolveTopBarAnchor(document);
		expect(signedOut.status).toBe("available");
		if (signedOut.status === "available") {
			expect(signedOut.before?.classList.contains("sign-up")).toBe(true);
		}
	});

	test("distinguishes missing, ambiguous, and unsupported top bars", () => {
		expect(resolveTopBarAnchor(document)).toEqual({
			status: "unavailable",
			reason: "missing-anchor",
		});

		document.body.innerHTML = `
			<header class="js-super-topbar">
				<div>
					<button data-testid="super-topbar-search-button-xs"></button>
					<button data-testid="super-topbar-search-button-xs"></button>
				</div>
			</header>`;
		expect(resolveTopBarAnchor(document)).toEqual({
			status: "unavailable",
			reason: "ambiguous-anchor",
		});

		document.body.innerHTML = `
			<header class="js-super-topbar">
				<button data-testid="super-topbar-search-button-xs"></button>
			</header>`;
		expect(resolveTopBarAnchor(document)).toEqual({
			status: "unavailable",
			reason: "unsupported-structure",
		});
	});

	test("replaces one host, follows theme changes, clears stale errors, and cleans up", async () => {
		document.body.innerHTML = await readTopBarFixture("19", "signed-in");
		const controller = new AbortController();
		const controlPanel = createInPageControlPanelFeature(
			DEFAULT_SETTINGS,
			NOOP_HANDLERS,
			TEST_STYLESHEET,
		);
		const context = createFeatureContext(window);

		await act(async () => {
			controlPanel.feature.activate(context, controller.signal);
		});
		expect(controlPanel.getStatus()).toEqual({ status: "mounted" });
		expect(
			document.querySelectorAll(`[${IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE}]`),
		).toHaveLength(1);
		const initialHost = document.querySelector(
			`[${IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE}]`,
		);
		/*
		 * GitLab's top bar creates no stacking context, so the host must lift the
		 * whole surface above page chrome itself. `position` must stay static or
		 * the host becomes the containing block and the popover is thrown
		 * off-screen.
		 */
		expect((initialHost as HTMLElement).style.getPropertyValue("z-index")).toBe(
			CONTROL_SURFACE_Z_INDEX,
		);
		expect((initialHost as HTMLElement).style.position).toBe("");
		expect(
			initialHost?.shadowRoot?.querySelector(
				`style[${IN_PAGE_CONTROL_PANEL_STYLES_ATTRIBUTE}]`,
			)?.textContent,
		).toBe(TEST_STYLESHEET);

		document.documentElement.classList.add("gl-dark");
		await waitFor(() => {
			expect(
				document
					.querySelector(`[${IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE}]`)
					?.getAttribute("data-tonic-theme"),
			).toBe("dark");
		});

		const duplicateSearch = document.createElement("button");
		duplicateSearch.dataset.testid = "super-topbar-search-button-xs";
		document.querySelector(".gl-justify-end")?.append(duplicateSearch);
		await act(async () => {
			controlPanel.feature.reconcile?.(context, controller.signal);
		});
		expect(controlPanel.getStatus()).toEqual({
			status: "unavailable",
			reason: "ambiguous-anchor",
		});
		expect(
			document.querySelectorAll(`[${IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE}]`),
		).toHaveLength(0);

		duplicateSearch.remove();
		await act(async () => {
			controlPanel.feature.reconcile?.(context, controller.signal);
		});
		expect(controlPanel.getStatus()).toEqual({ status: "mounted" });
		expect(
			document.querySelectorAll(`[${IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE}]`),
		).toHaveLength(1);

		await act(async () => {
			controller.abort();
		});
		expect(
			document.querySelectorAll(`[${IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE}]`),
		).toHaveLength(0);
	});

	test("moves before account controls that GitLab renders after activation", async () => {
		document.body.innerHTML = `
			<header class="js-super-topbar">
				<div class="gl-flex gl-justify-end gl-gap-3">
					<button data-testid="super-topbar-search-button-xs"></button>
				</div>
			</header>`;
		const controller = new AbortController();
		const controlPanel = createInPageControlPanelFeature(
			DEFAULT_SETTINGS,
			NOOP_HANDLERS,
			TEST_STYLESHEET,
		);
		await act(async () => {
			activateFeatureRuntime(window, [controlPanel.feature], controller.signal);
		});
		const actionCluster = document.querySelector(".gl-justify-end");
		const host = document.querySelector(
			`[${IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE}]`,
		);
		expect(actionCluster?.lastElementChild).toBe(host);

		const accountControl = document.createElement("div");
		accountControl.innerHTML =
			'<a data-testid="topbar-signin-button" href="/users/sign_in">Sign in</a>';
		await act(async () => {
			actionCluster?.append(accountControl);
		});

		await waitFor(() => {
			const repositionedHost = document.querySelector(
				`[${IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE}]`,
			);
			expect(accountControl.previousElementSibling).toBe(repositionedHost);
			// The same host moves, so the shadow root, React root, and any open
			// popover survive a GitLab re-render of the account controls.
			expect(repositionedHost).toBe(host);
			expect(host?.isConnected).toBe(true);
			expect(
				document.querySelectorAll(`[${IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE}]`),
			).toHaveLength(1);
		});

		await act(async () => {
			controller.abort();
		});
	});
});
