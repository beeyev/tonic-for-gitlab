import { type ReactNode, useId, useRef, useState } from "react";
import type { TonicSettings } from "../../settings/repository";
import { Button } from "../../ui/components/button";
import { AlertTriangleIcon, ChevronDownIcon } from "../../ui/components/icons";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "../../ui/components/popover";
import { Switch } from "../../ui/components/switch";
import type { FeaturePageCompatibility } from "../runtime/feature-context";

export interface SettingChangeHandlers {
	onApproveMergeRequestFromTabsEnabledChange(enabled: boolean): Promise<void>;
	onCollapseJobLogSectionsByDefaultEnabledChange(
		enabled: boolean,
	): Promise<void>;
	onConfirmMergeRequestEnabledChange(enabled: boolean): Promise<void>;
	onCopyMergeRequestLinkEnabledChange(enabled: boolean): Promise<void>;
	onDimDraftMergeRequestsEnabledChange(enabled: boolean): Promise<void>;
	onFilterMyAuthoredMergeRequestsEnabledChange(enabled: boolean): Promise<void>;
	onHideDuoAgentPlatformEntrypointEnabledChange(
		enabled: boolean,
	): Promise<void>;
	onHideFileTreeBrowserFeedbackButtonEnabledChange(
		enabled: boolean,
	): Promise<void>;
	onHighlightAuthoredMergeRequestsEnabledChange(
		enabled: boolean,
	): Promise<void>;
	onRememberMergeRequestListFiltersEnabledChange(
		enabled: boolean,
	): Promise<void>;
	onStartThreadsByDefaultEnabledChange(enabled: boolean): Promise<void>;
	onToggleJobLogSectionsEnabledChange(enabled: boolean): Promise<void>;
}

export interface InPageFeatureCompatibility {
	approveMergeRequestFromTabs: FeaturePageCompatibility;
	confirmMergeRequest: FeaturePageCompatibility;
	copyMergeRequestLink: FeaturePageCompatibility;
	dimDraftMergeRequests: FeaturePageCompatibility;
	filterMyAuthoredMergeRequests: FeaturePageCompatibility;
	hideDuoAgentPlatformEntrypoint: FeaturePageCompatibility;
	hideFileTreeBrowserFeedbackButton: FeaturePageCompatibility;
	highlightAuthoredMergeRequests: FeaturePageCompatibility;
	startThreadsByDefault: FeaturePageCompatibility;
	toggleJobLogSections: FeaturePageCompatibility;
}

export const DEFAULT_IN_PAGE_FEATURE_COMPATIBILITY: InPageFeatureCompatibility =
	{
		approveMergeRequestFromTabs: "not-applicable",
		confirmMergeRequest: "not-applicable",
		copyMergeRequestLink: "not-applicable",
		dimDraftMergeRequests: "not-applicable",
		filterMyAuthoredMergeRequests: "not-applicable",
		hideDuoAgentPlatformEntrypoint: "not-applicable",
		hideFileTreeBrowserFeedbackButton: "not-applicable",
		highlightAuthoredMergeRequests: "not-applicable",
		startThreadsByDefault: "not-applicable",
		toggleJobLogSections: "not-applicable",
	};

interface InPageControlPanelProps {
	compatibility?: InPageFeatureCompatibility;
	portalContainer: ShadowRoot;
	settings: TonicSettings;
	handlers: SettingChangeHandlers;
}

/**
 * Persisted settings are the source of truth, but a write is not instant. Hold
 * an optimistic value for as long as a write is in flight so the switch does
 * not snap back mid-write, then drop it and follow the stored value again.
 *
 * The override is released on write settlement, never on a storage echo. The
 * runtime applies the settings the repository persisted as part of resolving
 * the change, so by the time the last write settles the stored value already
 * reflects it and there is nothing to wait for. State that waits for an echo
 * can wait forever: chrome.storage dispatches no change event when a write does
 * not alter the stored value, and such a write is reachable whenever another
 * tab already stored the value this one is about to write.
 *
 * Each setting owns one instance of this state, so one switch never releases or
 * overrides the other.
 */
function useOptimisticSetting(
	storedValue: boolean,
	onEnabledChange: (enabled: boolean) => Promise<void>,
): {
	isEnabled: boolean;
	saveFailed: boolean;
	handleCheckedChange(enabled: boolean): Promise<void>;
} {
	const [pending, setPending] = useState<boolean | undefined>(undefined);
	const [saveFailed, setSaveFailed] = useState(false);
	// Read synchronously when a write settles, where a state value would be a
	// render behind and cannot say whether another write is still in flight.
	const writesInFlight = useRef(0);

	return {
		isEnabled: pending ?? storedValue,
		saveFailed,
		async handleCheckedChange(enabled) {
			setPending(enabled);
			setSaveFailed(false);
			writesInFlight.current += 1;

			try {
				await onEnabledChange(enabled);
			} catch {
				/*
				 * Only the last write out may report a failure. An earlier rejection
				 * would otherwise report an error the user's final choice did not
				 * suffer.
				 */
				if (writesInFlight.current === 1) {
					setSaveFailed(true);
				}
			} finally {
				writesInFlight.current -= 1;

				// Likewise, only the last write out may drop the override, or an
				// earlier one settling would discard a later write's value.
				if (writesInFlight.current === 0) {
					setPending(undefined);
				}
			}
		},
	};
}

interface SettingSwitchRowProps {
	label: string;
	description: string;
	inactiveReason?: string;
	storedValue: boolean;
	onEnabledChange(enabled: boolean): Promise<void>;
}

function SettingSwitchRow({
	label,
	description,
	inactiveReason,
	storedValue,
	onEnabledChange,
}: SettingSwitchRowProps) {
	const labelId = useId();
	const descriptionId = useId();
	const inactiveReasonId = useId();
	const controlId = useId();
	const { isEnabled, saveFailed, handleCheckedChange } = useOptimisticSetting(
		storedValue,
		onEnabledChange,
	);

	return (
		<div className="border-b border-border/60 last:border-b-0">
			<label
				htmlFor={controlId}
				className="flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/70"
			>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span id={labelId} className="text-sm leading-5 font-medium">
						{label}
					</span>
					<span
						id={descriptionId}
						className="text-xs leading-relaxed text-muted-foreground"
					>
						{description}
					</span>
					{inactiveReason ? (
						<span
							id={inactiveReasonId}
							role="status"
							className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed font-medium text-foreground"
						>
							<AlertTriangleIcon className="mt-px size-3.5 text-warning" />
							<span className="sr-only">{label}: </span>
							{inactiveReason}
						</span>
					) : null}
				</span>
				<Switch
					id={controlId}
					checked={isEnabled}
					onCheckedChange={handleCheckedChange}
					aria-labelledby={labelId}
					aria-describedby={
						inactiveReason
							? `${descriptionId} ${inactiveReasonId}`
							: descriptionId
					}
					className="mt-0.5"
				/>
			</label>
			{saveFailed ? (
				<p
					role="alert"
					className="flex items-start gap-1.5 border-t border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive"
				>
					<AlertTriangleIcon className="mt-px size-3.5" />
					Could not save this setting. Try again.
				</p>
			) : null}
		</div>
	);
}

function SettingGroup({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	const headingId = useId();

	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-1.5">
			<h3
				id={headingId}
				className="px-1 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase"
			>
				{title}
			</h3>
			<div className="overflow-hidden rounded-md border border-border/70 bg-muted/40">
				{children}
			</div>
		</section>
	);
}

export function InPageControlPanelView({
	compatibility = DEFAULT_IN_PAGE_FEATURE_COMPATIBILITY,
	portalContainer,
	settings,
	handlers,
}: InPageControlPanelProps) {
	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button aria-label="Tonic settings" variant="outline" size="sm" />
				}
			>
				Tonic
				<ChevronDownIcon className="size-3.5 opacity-70 transition-transform duration-150 group-aria-expanded/button:rotate-180" />
			</PopoverTrigger>
			<PopoverContent
				container={portalContainer}
				align="end"
				side="bottom"
				sideOffset={8}
				collisionPadding={8}
				className="flex max-h-[min(28rem,calc(100dvh-1rem))] w-80 max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0"
			>
				<PopoverHeader className="shrink-0 border-b border-border px-3.5 py-2.5">
					<PopoverTitle>Tonic for GitLab</PopoverTitle>
					<PopoverDescription>Changes apply immediately.</PopoverDescription>
				</PopoverHeader>
				{/*
				 * Only the settings list scrolls. The heading stays in place as the
				 * panel grows past its height clamp, and `overscroll-contain` keeps a
				 * finished scroll gesture from continuing into the GitLab page.
				 */}
				<div className="tonic-scroll-region min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-2.5">
					<SettingGroup title="Interface">
						<SettingSwitchRow
							label="Hide unavailable GitLab Duo entry point"
							description="Hide the entire Duo panel too when its rail has no other action."
							inactiveReason={
								compatibility.hideDuoAgentPlatformEntrypoint === "unsupported"
									? "Inactive on this page. The GitLab Duo entry point uses an unsupported page structure."
									: undefined
							}
							storedValue={settings.hideDuoAgentPlatformEntrypointEnabled}
							onEnabledChange={
								handlers.onHideDuoAgentPlatformEntrypointEnabledChange
							}
						/>
						<SettingSwitchRow
							label="Hide file tree feedback link"
							description="Hide the Provide feedback link GitLab adds to the repository file tree browser."
							inactiveReason={
								compatibility.hideFileTreeBrowserFeedbackButton ===
								"unsupported"
									? "Inactive on this page. The file tree browser uses an unsupported page structure."
									: undefined
							}
							storedValue={settings.hideFileTreeBrowserFeedbackButtonEnabled}
							onEnabledChange={
								handlers.onHideFileTreeBrowserFeedbackButtonEnabledChange
							}
						/>
					</SettingGroup>
					<SettingGroup title="Merge requests">
						<SettingSwitchRow
							label="Approve from the tab bar"
							description="Mirror GitLab's Approve button into the merge request tab bar so it stays reachable from Commits, Pipelines and Changes."
							inactiveReason={
								compatibility.approveMergeRequestFromTabs === "unsupported"
									? "Inactive on this page. This feature does not support the current GitLab merge request tab bar."
									: undefined
							}
							storedValue={settings.approveMergeRequestFromTabsEnabled}
							onEnabledChange={
								handlers.onApproveMergeRequestFromTabsEnabledChange
							}
						/>
						<SettingSwitchRow
							label="Copy merge request link"
							description="Add a header button that copies the base merge request link from any detail tab."
							inactiveReason={
								compatibility.copyMergeRequestLink === "unsupported"
									? "Inactive on this page. This feature does not support the current GitLab merge request header."
									: undefined
							}
							storedValue={settings.copyMergeRequestLinkEnabled}
							onEnabledChange={handlers.onCopyMergeRequestLinkEnabledChange}
						/>
						<SettingSwitchRow
							label="Confirm main merge action"
							description="Ask before using GitLab's main Merge or Set to auto-merge button. Dropdown actions keep GitLab's native behavior."
							inactiveReason={
								compatibility.confirmMergeRequest === "unsupported"
									? "Inactive on this page. This feature does not support the current GitLab merge widget."
									: undefined
							}
							storedValue={settings.confirmMergeRequestEnabled}
							onEnabledChange={handlers.onConfirmMergeRequestEnabledChange}
						/>
						<SettingSwitchRow
							label="Dim draft merge requests"
							description="Reduce the emphasis of Draft rows while keeping their details readable."
							inactiveReason={
								compatibility.dimDraftMergeRequests === "unsupported"
									? "Inactive on this page. This feature does not support the current GitLab merge request list."
									: undefined
							}
							storedValue={settings.dimDraftMergeRequestsEnabled}
							onEnabledChange={handlers.onDimDraftMergeRequestsEnabledChange}
						/>
						<SettingSwitchRow
							label="Filter to my merge requests"
							description="Show a shortcut that filters the current list to merge requests you authored."
							inactiveReason={
								compatibility.filterMyAuthoredMergeRequests === "unsupported"
									? "Inactive on this page. This feature does not support the current GitLab merge request list."
									: undefined
							}
							storedValue={settings.filterMyAuthoredMergeRequestsEnabled}
							onEnabledChange={
								handlers.onFilterMyAuthoredMergeRequestsEnabledChange
							}
						/>
						<SettingSwitchRow
							label="Highlight my merge requests"
							description="Outline rows you authored so they stand out in the list."
							inactiveReason={
								compatibility.highlightAuthoredMergeRequests === "unsupported"
									? "Inactive on this page. This feature does not support the current GitLab merge request list."
									: undefined
							}
							storedValue={settings.highlightAuthoredMergeRequestsEnabled}
							onEnabledChange={
								handlers.onHighlightAuthoredMergeRequestsEnabledChange
							}
						/>
						<SettingSwitchRow
							label="Remember list filters"
							description="Show a control on merge request lists for saving their filters and putting them back."
							storedValue={settings.rememberMergeRequestListFiltersEnabled}
							onEnabledChange={
								handlers.onRememberMergeRequestListFiltersEnabledChange
							}
						/>
						<SettingSwitchRow
							label="Start threads by default"
							description="Preselect Start thread in the merge request comment box. Comment stays available."
							inactiveReason={
								compatibility.startThreadsByDefault === "unsupported"
									? "Inactive on this page. This feature does not support the current GitLab comment box."
									: undefined
							}
							storedValue={settings.startThreadsByDefaultEnabled}
							onEnabledChange={handlers.onStartThreadsByDefaultEnabledChange}
						/>
					</SettingGroup>
					<SettingGroup title="CI/CD">
						<SettingSwitchRow
							label="Toggle job log sections"
							description="Add a job log button that collapses or expands every section at once."
							inactiveReason={
								compatibility.toggleJobLogSections === "unsupported"
									? "Inactive on this page. This feature does not support the current GitLab job log."
									: undefined
							}
							storedValue={settings.toggleJobLogSectionsEnabled}
							onEnabledChange={handlers.onToggleJobLogSectionsEnabledChange}
						/>
						<SettingSwitchRow
							label="Collapse job log sections by default"
							description="Open job logs with every section collapsed."
							inactiveReason={
								/*
								 * The dependency outranks the page contract. Without the
								 * toggle button there is no way to expand a log this opens
								 * collapsed, and that is true on every page, not only where
								 * the job log contract fails.
								 */
								settings.toggleJobLogSectionsEnabled
									? compatibility.toggleJobLogSections === "unsupported"
										? "Inactive on this page. This feature does not support the current GitLab job log."
										: undefined
									: "Needs Toggle job log sections. Turn that on to use this."
							}
							storedValue={settings.collapseJobLogSectionsByDefaultEnabled}
							onEnabledChange={
								handlers.onCollapseJobLogSectionsByDefaultEnabledChange
							}
						/>
					</SettingGroup>
				</div>
			</PopoverContent>
		</Popover>
	);
}
