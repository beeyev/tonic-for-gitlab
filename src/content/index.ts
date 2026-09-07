import type { ControlSurfaceStatus } from "../control-surface/status-protocol";
import {
	confirmMergeRequest,
	getConfirmMergeRequestCompatibility,
} from "../features/confirm-merge-request/confirm-merge-request";
import {
	copyMergeRequestLink,
	getCopyMergeRequestLinkCompatibility,
} from "../features/copy-merge-request-link/copy-merge-request-link";
import {
	dimDraftMergeRequests,
	getDimDraftMergeRequestsCompatibility,
} from "../features/dim-draft-merge-requests/dim-draft-merge-requests";
import { createBroadcastDismissalsRepository } from "../features/dismiss-broadcast-banner/broadcast-dismissals-repository";
import { createDismissBroadcastBannerFeature } from "../features/dismiss-broadcast-banner/dismiss-broadcast-banner";
import {
	filterMyAuthoredMergeRequests,
	getFilterMyAuthoredMergeRequestsCompatibility,
} from "../features/filter-my-authored-merge-requests/filter-my-authored-merge-requests";
import {
	getHideDuoAgentPlatformEntrypointCompatibility,
	hideDuoAgentPlatformEntrypoint,
} from "../features/hide-duo-agent-platform-entrypoint/hide-duo-agent-platform-entrypoint";
import {
	getHideFileTreeBrowserFeedbackButtonCompatibility,
	hideFileTreeBrowserFeedbackButton,
} from "../features/hide-file-tree-browser-feedback-button/hide-file-tree-browser-feedback-button";
import {
	getHighlightAuthoredMergeRequestsCompatibility,
	highlightAuthoredMergeRequests,
} from "../features/highlight-authored-merge-requests/highlight-authored-merge-requests";
import { createListFiltersRepository } from "../features/remember-merge-request-list-filters/list-filters-repository";
import {
	createListFilterStore,
	type ListFilterStoreController,
} from "../features/remember-merge-request-list-filters/list-filters-store";
import { createRememberMergeRequestListFiltersFeature } from "../features/remember-merge-request-list-filters/remember-merge-request-list-filters";
import {
	getStartThreadsByDefaultCompatibility,
	startThreadsByDefault,
} from "../features/start-threads-by-default/start-threads-by-default";
import {
	createToggleJobLogSectionsFeature,
	getToggleJobLogSectionsCompatibility,
} from "../features/toggle-job-log-sections/toggle-job-log-sections";
import {
	createSettingsRepository,
	DEFAULT_SETTINGS,
	type SettingsRepository,
	type TonicSettings,
	type TonicSettingsChange,
} from "../settings/repository";
import controlPanelStylesheetUrl from "../ui/styles.css";
import { decodeBundledStylesheet } from "./control-panel/bundled-stylesheet";
import { createInPageControlPanelFeature } from "./control-panel/in-page-control-panel-feature";
import { registerControlSurfaceStatusResponder } from "./control-panel/status-responder";
import type { Feature } from "./runtime/feature-context";
import { activateFeatureRuntime } from "./runtime/feature-lifecycle";
import { isGitLabDocument } from "./runtime/gitlab-document";

/** A missing panel stylesheet disables only the panel, never the content script. */
function readControlPanelStylesheet(): string | undefined {
	try {
		return decodeBundledStylesheet(controlPanelStylesheetUrl);
	} catch (error) {
		console.error("Tonic control-panel stylesheet is unavailable", error);
		return undefined;
	}
}

export interface ContentRuntimeDependencies {
	runtimeWindow: Window;
	repository: SettingsRepository;
	listFilters: ListFilterStoreController;
	broadcastDismissal: Feature;
	stylesheet: string | undefined;
	registerStatusResponder(
		getStatus: () => ControlSurfaceStatus,
		origin: string,
		signal: AbortSignal,
	): void;
}

export function startContentRuntime({
	runtimeWindow,
	repository,
	listFilters,
	broadcastDismissal,
	stylesheet,
	registerStatusResponder,
}: ContentRuntimeDependencies): () => void {
	const controller = new AbortController();

	// A configured origin can serve non-GitLab pages. Answer the popup without observers or subscriptions.
	if (!isGitLabDocument(runtimeWindow.document)) {
		registerStatusResponder(
			() => ({ status: "not-gitlab" }),
			runtimeWindow.location.origin,
			controller.signal,
		);

		return () => {
			controller.abort();
		};
	}

	// Reversible features use defaults for first paint. Merge confirmation waits for storage.
	let settings: TonicSettings = { ...DEFAULT_SETTINGS };
	let isSettingsResolutionPending = true;

	// Starting threads changes a GitLab control, so it waits for persisted settings.
	let hasResolvedSettings = false;

	// Apply the write result: Chrome does not order the echo with `set`, and emits none for a no-op.
	const writeSetting = async (change: TonicSettingsChange): Promise<void> => {
		applySettings(await repository.update(change));
	};

	const configuredDimDraftMergeRequests: Feature = {
		...dimDraftMergeRequests,
		matches(context) {
			return (
				settings.dimDraftMergeRequestsEnabled &&
				dimDraftMergeRequests.matches(context)
			);
		},
	};

	const configuredConfirmMergeRequest: Feature = {
		...confirmMergeRequest,
		matches(context) {
			return (
				(isSettingsResolutionPending || settings.confirmMergeRequestEnabled) &&
				confirmMergeRequest.matches(context)
			);
		},
	};

	const configuredCopyMergeRequestLink: Feature = {
		...copyMergeRequestLink,
		matches(context) {
			return (
				settings.copyMergeRequestLinkEnabled &&
				copyMergeRequestLink.matches(context)
			);
		},
	};

	const configuredHighlightAuthoredMergeRequests: Feature = {
		...highlightAuthoredMergeRequests,
		matches(context) {
			return (
				settings.highlightAuthoredMergeRequestsEnabled &&
				highlightAuthoredMergeRequests.matches(context)
			);
		},
	};

	const configuredFilterMyAuthoredMergeRequests: Feature = {
		...filterMyAuthoredMergeRequests,
		matches(context) {
			return (
				settings.filterMyAuthoredMergeRequestsEnabled &&
				filterMyAuthoredMergeRequests.matches(context)
			);
		},
	};

	const configuredHideDuoAgentPlatformEntrypoint: Feature = {
		...hideDuoAgentPlatformEntrypoint,
		matches(context) {
			return (
				settings.hideDuoAgentPlatformEntrypointEnabled &&
				hideDuoAgentPlatformEntrypoint.matches(context)
			);
		},
	};

	const configuredHideFileTreeBrowserFeedbackButton: Feature = {
		...hideFileTreeBrowserFeedbackButton,
		matches(context) {
			return (
				settings.hideFileTreeBrowserFeedbackButtonEnabled &&
				hideFileTreeBrowserFeedbackButton.matches(context)
			);
		},
	};

	const rememberMergeRequestListFilters =
		createRememberMergeRequestListFiltersFeature(listFilters);

	const configuredRememberMergeRequestListFilters: Feature = {
		...rememberMergeRequestListFilters,
		matches(context) {
			return (
				settings.rememberMergeRequestListFiltersEnabled &&
				rememberMergeRequestListFilters.matches(context)
			);
		},
	};

	const configuredStartThreadsByDefault: Feature = {
		...startThreadsByDefault,
		matches(context) {
			return (
				hasResolvedSettings &&
				settings.startThreadsByDefaultEnabled &&
				startThreadsByDefault.matches(context)
			);
		},
	};

	// Each log gets one default decision, so wait for storage rather than use startup defaults.
	const toggleJobLogSections = createToggleJobLogSectionsFeature(() =>
		hasResolvedSettings
			? settings.collapseJobLogSectionsByDefaultEnabled
			: undefined,
	);

	const configuredToggleJobLogSections: Feature = {
		...toggleJobLogSections,
		matches(context) {
			// The default needs the button, otherwise collapsed sections have no bulk restore.
			return (
				settings.toggleJobLogSectionsEnabled &&
				toggleJobLogSections.matches(context)
			);
		},
	};

	const controlPanel =
		stylesheet === undefined
			? undefined
			: createInPageControlPanelFeature(
					settings,
					{
						onCollapseJobLogSectionsByDefaultEnabledChange: (enabled) =>
							writeSetting({
								collapseJobLogSectionsByDefaultEnabled: enabled,
							}),
						onConfirmMergeRequestEnabledChange: (enabled) =>
							writeSetting({ confirmMergeRequestEnabled: enabled }),
						onCopyMergeRequestLinkEnabledChange: (enabled) =>
							writeSetting({ copyMergeRequestLinkEnabled: enabled }),
						onDimDraftMergeRequestsEnabledChange: (enabled) =>
							writeSetting({ dimDraftMergeRequestsEnabled: enabled }),
						onFilterMyAuthoredMergeRequestsEnabledChange: (enabled) =>
							writeSetting({ filterMyAuthoredMergeRequestsEnabled: enabled }),
						onHideDuoAgentPlatformEntrypointEnabledChange: (enabled) =>
							writeSetting({
								hideDuoAgentPlatformEntrypointEnabled: enabled,
							}),
						onHideFileTreeBrowserFeedbackButtonEnabledChange: (enabled) =>
							writeSetting({
								hideFileTreeBrowserFeedbackButtonEnabled: enabled,
							}),
						onHighlightAuthoredMergeRequestsEnabledChange: (enabled) =>
							writeSetting({ highlightAuthoredMergeRequestsEnabled: enabled }),
						onRememberMergeRequestListFiltersEnabledChange: (enabled) =>
							writeSetting({
								rememberMergeRequestListFiltersEnabled: enabled,
							}),
						onStartThreadsByDefaultEnabledChange: (enabled) =>
							writeSetting({ startThreadsByDefaultEnabled: enabled }),
						onToggleJobLogSectionsEnabledChange: (enabled) =>
							writeSetting({ toggleJobLogSectionsEnabled: enabled }),
					},
					stylesheet,
					(context) => ({
						confirmMergeRequest: getConfirmMergeRequestCompatibility(context),
						copyMergeRequestLink: getCopyMergeRequestLinkCompatibility(context),
						dimDraftMergeRequests:
							getDimDraftMergeRequestsCompatibility(context),
						filterMyAuthoredMergeRequests:
							getFilterMyAuthoredMergeRequestsCompatibility(context),
						hideDuoAgentPlatformEntrypoint:
							getHideDuoAgentPlatformEntrypointCompatibility(context),
						hideFileTreeBrowserFeedbackButton:
							getHideFileTreeBrowserFeedbackButtonCompatibility(context),
						highlightAuthoredMergeRequests:
							getHighlightAuthoredMergeRequestsCompatibility(context),
						startThreadsByDefault:
							getStartThreadsByDefaultCompatibility(context),
						toggleJobLogSections: getToggleJobLogSectionsCompatibility(context),
					}),
				);

	registerStatusResponder(
		() =>
			controlPanel?.getStatus() ?? {
				status: "unavailable",
				reason: "stylesheet-unavailable",
			},
		runtimeWindow.location.origin,
		controller.signal,
	);

	const runtime = activateFeatureRuntime(
		runtimeWindow,
		[
			...(controlPanel ? [controlPanel.feature] : []),
			broadcastDismissal,
			configuredDimDraftMergeRequests,
			configuredFilterMyAuthoredMergeRequests,
			configuredHideDuoAgentPlatformEntrypoint,
			configuredHideFileTreeBrowserFeedbackButton,
			configuredHighlightAuthoredMergeRequests,
			configuredRememberMergeRequestListFilters,
			configuredConfirmMergeRequest,
			configuredCopyMergeRequestLink,
			configuredStartThreadsByDefault,
			configuredToggleJobLogSections,
		],
		controller.signal,
	);

	// Reconcile when remembered filters arrive so existing links pick them up.
	listFilters.start(controller.signal, () => {
		runtime.reconcile();
	});

	const applySettings = (nextSettings: TonicSettings) => {
		if (controller.signal.aborted) {
			return;
		}

		settings = nextSettings;
		isSettingsResolutionPending = false;
		hasResolvedSettings = true;
		controlPanel?.updateSettings(nextSettings);
		runtime.reconcile();
	};

	// The store ignores an initial read older than an already-received change event.
	let hasAppliedSettings = false;

	repository.subscribe((nextSettings) => {
		hasAppliedSettings = true;
		applySettings(nextSettings);
	}, controller.signal);

	void repository
		.read()
		.then((storedSettings) => {
			if (!hasAppliedSettings) {
				applySettings(storedSettings);
			}
		})
		.catch((error: unknown) => {
			// A failed read disables settings that could change a GitLab control.
			isSettingsResolutionPending = false;
			runtime.reconcile();
			console.error("Tonic settings could not be read", error);
		});

	return () => {
		controller.abort();
	};
}

export default function main() {
	return startContentRuntime({
		runtimeWindow: window,
		repository: createSettingsRepository(),
		listFilters: createListFilterStore(createListFiltersRepository()),
		broadcastDismissal: createDismissBroadcastBannerFeature(
			createBroadcastDismissalsRepository(),
		),
		stylesheet: readControlPanelStylesheet(),
		registerStatusResponder: registerControlSurfaceStatusResponder,
	});
}
