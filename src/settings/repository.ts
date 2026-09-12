import {
	createWriteQueue,
	isNewerSchema,
	isRecord,
	type StorageArea,
	type StorageChangeEvent,
	subscribeToStorageKey,
} from "../storage/storage-key";

export const SETTINGS_STORAGE_KEY = "tonic.settings";
export const SETTINGS_SCHEMA_VERSION = 12;

export interface TonicSettings {
	schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
	approveMergeRequestFromTabsEnabled: boolean;
	collapseJobLogSectionsByDefaultEnabled: boolean;
	confirmMergeRequestEnabled: boolean;
	copyMergeRequestLinkEnabled: boolean;
	dimDraftMergeRequestsEnabled: boolean;
	filterMyAuthoredMergeRequestsEnabled: boolean;
	hideDuoAgentPlatformEntrypointEnabled: boolean;
	hideFileTreeBrowserFeedbackButtonEnabled: boolean;
	highlightAuthoredMergeRequestsEnabled: boolean;
	rememberMergeRequestListFiltersEnabled: boolean;
	startThreadsByDefaultEnabled: boolean;
	toggleJobLogSectionsEnabled: boolean;
}

export const DEFAULT_SETTINGS: TonicSettings = {
	schemaVersion: SETTINGS_SCHEMA_VERSION,
	approveMergeRequestFromTabsEnabled: true,
	collapseJobLogSectionsByDefaultEnabled: false,
	confirmMergeRequestEnabled: false,
	copyMergeRequestLinkEnabled: true,
	dimDraftMergeRequestsEnabled: true,
	filterMyAuthoredMergeRequestsEnabled: true,
	hideDuoAgentPlatformEntrypointEnabled: false,
	hideFileTreeBrowserFeedbackButtonEnabled: true,
	highlightAuthoredMergeRequestsEnabled: true,
	rememberMergeRequestListFiltersEnabled: true,
	startThreadsByDefaultEnabled: true,
	toggleJobLogSectionsEnabled: true,
};

export class InvalidSettingsError extends Error {
	constructor() {
		super("Stored Tonic settings do not match the supported schema");
		this.name = "InvalidSettingsError";
	}
}

/** Thrown when a write would overwrite settings a newer build owns. */
export class NewerSettingsSchemaError extends Error {
	constructor() {
		super("Stored Tonic settings use a newer schema than this build supports");
		this.name = "NewerSettingsSchemaError";
	}
}

/** Ignores unknown keys so an older running tab can still read newer settings. */
export function parseSettings(value: unknown): TonicSettings {
	if (
		!isRecord(value) ||
		value.schemaVersion !== SETTINGS_SCHEMA_VERSION ||
		typeof value.approveMergeRequestFromTabsEnabled !== "boolean" ||
		typeof value.collapseJobLogSectionsByDefaultEnabled !== "boolean" ||
		typeof value.confirmMergeRequestEnabled !== "boolean" ||
		typeof value.copyMergeRequestLinkEnabled !== "boolean" ||
		typeof value.dimDraftMergeRequestsEnabled !== "boolean" ||
		typeof value.filterMyAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.hideDuoAgentPlatformEntrypointEnabled !== "boolean" ||
		typeof value.hideFileTreeBrowserFeedbackButtonEnabled !== "boolean" ||
		typeof value.highlightAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.rememberMergeRequestListFiltersEnabled !== "boolean" ||
		typeof value.startThreadsByDefaultEnabled !== "boolean" ||
		typeof value.toggleJobLogSectionsEnabled !== "boolean"
	) {
		throw new InvalidSettingsError();
	}

	return {
		schemaVersion: SETTINGS_SCHEMA_VERSION,
		approveMergeRequestFromTabsEnabled:
			value.approveMergeRequestFromTabsEnabled,
		collapseJobLogSectionsByDefaultEnabled:
			value.collapseJobLogSectionsByDefaultEnabled,
		confirmMergeRequestEnabled: value.confirmMergeRequestEnabled,
		copyMergeRequestLinkEnabled: value.copyMergeRequestLinkEnabled,
		dimDraftMergeRequestsEnabled: value.dimDraftMergeRequestsEnabled,
		filterMyAuthoredMergeRequestsEnabled:
			value.filterMyAuthoredMergeRequestsEnabled,
		hideDuoAgentPlatformEntrypointEnabled:
			value.hideDuoAgentPlatformEntrypointEnabled,
		hideFileTreeBrowserFeedbackButtonEnabled:
			value.hideFileTreeBrowserFeedbackButtonEnabled,
		highlightAuthoredMergeRequestsEnabled:
			value.highlightAuthoredMergeRequestsEnabled,
		rememberMergeRequestListFiltersEnabled:
			value.rememberMergeRequestListFiltersEnabled,
		startThreadsByDefaultEnabled: value.startThreadsByDefaultEnabled,
		toggleJobLogSectionsEnabled: value.toggleJobLogSectionsEnabled,
	};
}

/*
 * Migrations preserve saved choices and apply only the new setting's historical
 * default. Keep defaults literal: `DEFAULT_SETTINGS` may change later.
 */
function migrateSettingsFromV1(
	value: Record<string, unknown>,
): TonicSettings | undefined {
	if (typeof value.dimDraftMergeRequestsEnabled !== "boolean") {
		return undefined;
	}

	return migrateSettingsFromV2({
		dimDraftMergeRequestsEnabled: value.dimDraftMergeRequestsEnabled,
		highlightAuthoredMergeRequestsEnabled: true,
	});
}

function migrateSettingsFromV2(
	value: Record<string, unknown>,
): TonicSettings | undefined {
	if (
		typeof value.dimDraftMergeRequestsEnabled !== "boolean" ||
		typeof value.highlightAuthoredMergeRequestsEnabled !== "boolean"
	) {
		return undefined;
	}

	return migrateSettingsFromV3({
		dimDraftMergeRequestsEnabled: value.dimDraftMergeRequestsEnabled,
		highlightAuthoredMergeRequestsEnabled:
			value.highlightAuthoredMergeRequestsEnabled,
		rememberMergeRequestListFiltersEnabled: true,
	});
}

function migrateSettingsFromV3(
	value: Record<string, unknown>,
): TonicSettings | undefined {
	if (
		typeof value.dimDraftMergeRequestsEnabled !== "boolean" ||
		typeof value.highlightAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.rememberMergeRequestListFiltersEnabled !== "boolean"
	) {
		return undefined;
	}

	return migrateSettingsFromV4({
		dimDraftMergeRequestsEnabled: value.dimDraftMergeRequestsEnabled,
		highlightAuthoredMergeRequestsEnabled:
			value.highlightAuthoredMergeRequestsEnabled,
		rememberMergeRequestListFiltersEnabled:
			value.rememberMergeRequestListFiltersEnabled,
		startThreadsByDefaultEnabled: true,
	});
}

function migrateSettingsFromV4(
	value: Record<string, unknown>,
): TonicSettings | undefined {
	if (
		typeof value.dimDraftMergeRequestsEnabled !== "boolean" ||
		typeof value.highlightAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.rememberMergeRequestListFiltersEnabled !== "boolean" ||
		typeof value.startThreadsByDefaultEnabled !== "boolean"
	) {
		return undefined;
	}

	return migrateSettingsFromV5({
		dimDraftMergeRequestsEnabled: value.dimDraftMergeRequestsEnabled,
		filterMyAuthoredMergeRequestsEnabled: true,
		highlightAuthoredMergeRequestsEnabled:
			value.highlightAuthoredMergeRequestsEnabled,
		rememberMergeRequestListFiltersEnabled:
			value.rememberMergeRequestListFiltersEnabled,
		startThreadsByDefaultEnabled: value.startThreadsByDefaultEnabled,
	});
}

// Merge confirmation stays off until the user opts into an extra merge step.
function migrateSettingsFromV5(
	value: Record<string, unknown>,
): TonicSettings | undefined {
	if (
		typeof value.dimDraftMergeRequestsEnabled !== "boolean" ||
		typeof value.filterMyAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.highlightAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.rememberMergeRequestListFiltersEnabled !== "boolean" ||
		typeof value.startThreadsByDefaultEnabled !== "boolean"
	) {
		return undefined;
	}

	return migrateSettingsFromV6({
		confirmMergeRequestEnabled: false,
		dimDraftMergeRequestsEnabled: value.dimDraftMergeRequestsEnabled,
		filterMyAuthoredMergeRequestsEnabled:
			value.filterMyAuthoredMergeRequestsEnabled,
		highlightAuthoredMergeRequestsEnabled:
			value.highlightAuthoredMergeRequestsEnabled,
		rememberMergeRequestListFiltersEnabled:
			value.rememberMergeRequestListFiltersEnabled,
		startThreadsByDefaultEnabled: value.startThreadsByDefaultEnabled,
	});
}

// Hiding the Duo entrypoint stays off because it removes a GitLab control.
function migrateSettingsFromV6(
	value: Record<string, unknown>,
): TonicSettings | undefined {
	if (
		typeof value.confirmMergeRequestEnabled !== "boolean" ||
		typeof value.dimDraftMergeRequestsEnabled !== "boolean" ||
		typeof value.filterMyAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.highlightAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.rememberMergeRequestListFiltersEnabled !== "boolean" ||
		typeof value.startThreadsByDefaultEnabled !== "boolean"
	) {
		return undefined;
	}

	return migrateSettingsFromV7({
		confirmMergeRequestEnabled: value.confirmMergeRequestEnabled,
		dimDraftMergeRequestsEnabled: value.dimDraftMergeRequestsEnabled,
		filterMyAuthoredMergeRequestsEnabled:
			value.filterMyAuthoredMergeRequestsEnabled,
		hideDuoAgentPlatformEntrypointEnabled: false,
		highlightAuthoredMergeRequestsEnabled:
			value.highlightAuthoredMergeRequestsEnabled,
		rememberMergeRequestListFiltersEnabled:
			value.rememberMergeRequestListFiltersEnabled,
		startThreadsByDefaultEnabled: value.startThreadsByDefaultEnabled,
	});
}

// The feedback link is safe to hide by default: GitLab removed it in 19.2.
function migrateSettingsFromV7(
	value: Record<string, unknown>,
): TonicSettings | undefined {
	if (
		typeof value.confirmMergeRequestEnabled !== "boolean" ||
		typeof value.dimDraftMergeRequestsEnabled !== "boolean" ||
		typeof value.filterMyAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.hideDuoAgentPlatformEntrypointEnabled !== "boolean" ||
		typeof value.highlightAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.rememberMergeRequestListFiltersEnabled !== "boolean" ||
		typeof value.startThreadsByDefaultEnabled !== "boolean"
	) {
		return undefined;
	}

	return migrateSettingsFromV8({
		confirmMergeRequestEnabled: value.confirmMergeRequestEnabled,
		dimDraftMergeRequestsEnabled: value.dimDraftMergeRequestsEnabled,
		filterMyAuthoredMergeRequestsEnabled:
			value.filterMyAuthoredMergeRequestsEnabled,
		hideDuoAgentPlatformEntrypointEnabled:
			value.hideDuoAgentPlatformEntrypointEnabled,
		hideFileTreeBrowserFeedbackButtonEnabled: true,
		highlightAuthoredMergeRequestsEnabled:
			value.highlightAuthoredMergeRequestsEnabled,
		rememberMergeRequestListFiltersEnabled:
			value.rememberMergeRequestListFiltersEnabled,
		startThreadsByDefaultEnabled: value.startThreadsByDefaultEnabled,
	});
}

function migrateSettingsFromV8(
	value: Record<string, unknown>,
): TonicSettings | undefined {
	if (
		typeof value.confirmMergeRequestEnabled !== "boolean" ||
		typeof value.dimDraftMergeRequestsEnabled !== "boolean" ||
		typeof value.filterMyAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.hideDuoAgentPlatformEntrypointEnabled !== "boolean" ||
		typeof value.hideFileTreeBrowserFeedbackButtonEnabled !== "boolean" ||
		typeof value.highlightAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.rememberMergeRequestListFiltersEnabled !== "boolean" ||
		typeof value.startThreadsByDefaultEnabled !== "boolean"
	) {
		return undefined;
	}

	return migrateSettingsFromV9({
		confirmMergeRequestEnabled: value.confirmMergeRequestEnabled,
		copyMergeRequestLinkEnabled: true,
		dimDraftMergeRequestsEnabled: value.dimDraftMergeRequestsEnabled,
		filterMyAuthoredMergeRequestsEnabled:
			value.filterMyAuthoredMergeRequestsEnabled,
		hideDuoAgentPlatformEntrypointEnabled:
			value.hideDuoAgentPlatformEntrypointEnabled,
		hideFileTreeBrowserFeedbackButtonEnabled:
			value.hideFileTreeBrowserFeedbackButtonEnabled,
		highlightAuthoredMergeRequestsEnabled:
			value.highlightAuthoredMergeRequestsEnabled,
		rememberMergeRequestListFiltersEnabled:
			value.rememberMergeRequestListFiltersEnabled,
		startThreadsByDefaultEnabled: value.startThreadsByDefaultEnabled,
	});
}

// The log toggle is safe by default because it changes nothing until pressed.
function migrateSettingsFromV9(
	value: Record<string, unknown>,
): TonicSettings | undefined {
	if (
		typeof value.confirmMergeRequestEnabled !== "boolean" ||
		typeof value.copyMergeRequestLinkEnabled !== "boolean" ||
		typeof value.dimDraftMergeRequestsEnabled !== "boolean" ||
		typeof value.filterMyAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.hideDuoAgentPlatformEntrypointEnabled !== "boolean" ||
		typeof value.hideFileTreeBrowserFeedbackButtonEnabled !== "boolean" ||
		typeof value.highlightAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.rememberMergeRequestListFiltersEnabled !== "boolean" ||
		typeof value.startThreadsByDefaultEnabled !== "boolean"
	) {
		return undefined;
	}

	return migrateSettingsFromV10({
		confirmMergeRequestEnabled: value.confirmMergeRequestEnabled,
		copyMergeRequestLinkEnabled: value.copyMergeRequestLinkEnabled,
		dimDraftMergeRequestsEnabled: value.dimDraftMergeRequestsEnabled,
		filterMyAuthoredMergeRequestsEnabled:
			value.filterMyAuthoredMergeRequestsEnabled,
		hideDuoAgentPlatformEntrypointEnabled:
			value.hideDuoAgentPlatformEntrypointEnabled,
		hideFileTreeBrowserFeedbackButtonEnabled:
			value.hideFileTreeBrowserFeedbackButtonEnabled,
		highlightAuthoredMergeRequestsEnabled:
			value.highlightAuthoredMergeRequestsEnabled,
		rememberMergeRequestListFiltersEnabled:
			value.rememberMergeRequestListFiltersEnabled,
		startThreadsByDefaultEnabled: value.startThreadsByDefaultEnabled,
		toggleJobLogSectionsEnabled: true,
	});
}

// Collapsing sections stays off by default because it hides log output on load.
function migrateSettingsFromV10(
	value: Record<string, unknown>,
): TonicSettings | undefined {
	if (
		typeof value.confirmMergeRequestEnabled !== "boolean" ||
		typeof value.copyMergeRequestLinkEnabled !== "boolean" ||
		typeof value.dimDraftMergeRequestsEnabled !== "boolean" ||
		typeof value.filterMyAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.hideDuoAgentPlatformEntrypointEnabled !== "boolean" ||
		typeof value.hideFileTreeBrowserFeedbackButtonEnabled !== "boolean" ||
		typeof value.highlightAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.rememberMergeRequestListFiltersEnabled !== "boolean" ||
		typeof value.startThreadsByDefaultEnabled !== "boolean" ||
		typeof value.toggleJobLogSectionsEnabled !== "boolean"
	) {
		return undefined;
	}

	return migrateSettingsFromV11({
		collapseJobLogSectionsByDefaultEnabled: false,
		confirmMergeRequestEnabled: value.confirmMergeRequestEnabled,
		copyMergeRequestLinkEnabled: value.copyMergeRequestLinkEnabled,
		dimDraftMergeRequestsEnabled: value.dimDraftMergeRequestsEnabled,
		filterMyAuthoredMergeRequestsEnabled:
			value.filterMyAuthoredMergeRequestsEnabled,
		hideDuoAgentPlatformEntrypointEnabled:
			value.hideDuoAgentPlatformEntrypointEnabled,
		hideFileTreeBrowserFeedbackButtonEnabled:
			value.hideFileTreeBrowserFeedbackButtonEnabled,
		highlightAuthoredMergeRequestsEnabled:
			value.highlightAuthoredMergeRequestsEnabled,
		rememberMergeRequestListFiltersEnabled:
			value.rememberMergeRequestListFiltersEnabled,
		startThreadsByDefaultEnabled: value.startThreadsByDefaultEnabled,
		toggleJobLogSectionsEnabled: value.toggleJobLogSectionsEnabled,
	});
}

// Mirroring GitLab's own Approve control adds a control without changing one.
function migrateSettingsFromV11(
	value: Record<string, unknown>,
): TonicSettings | undefined {
	if (
		typeof value.collapseJobLogSectionsByDefaultEnabled !== "boolean" ||
		typeof value.confirmMergeRequestEnabled !== "boolean" ||
		typeof value.copyMergeRequestLinkEnabled !== "boolean" ||
		typeof value.dimDraftMergeRequestsEnabled !== "boolean" ||
		typeof value.filterMyAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.hideDuoAgentPlatformEntrypointEnabled !== "boolean" ||
		typeof value.hideFileTreeBrowserFeedbackButtonEnabled !== "boolean" ||
		typeof value.highlightAuthoredMergeRequestsEnabled !== "boolean" ||
		typeof value.rememberMergeRequestListFiltersEnabled !== "boolean" ||
		typeof value.startThreadsByDefaultEnabled !== "boolean" ||
		typeof value.toggleJobLogSectionsEnabled !== "boolean"
	) {
		return undefined;
	}

	return {
		schemaVersion: SETTINGS_SCHEMA_VERSION,
		approveMergeRequestFromTabsEnabled: true,
		collapseJobLogSectionsByDefaultEnabled:
			value.collapseJobLogSectionsByDefaultEnabled,
		confirmMergeRequestEnabled: value.confirmMergeRequestEnabled,
		copyMergeRequestLinkEnabled: value.copyMergeRequestLinkEnabled,
		dimDraftMergeRequestsEnabled: value.dimDraftMergeRequestsEnabled,
		filterMyAuthoredMergeRequestsEnabled:
			value.filterMyAuthoredMergeRequestsEnabled,
		hideDuoAgentPlatformEntrypointEnabled:
			value.hideDuoAgentPlatformEntrypointEnabled,
		hideFileTreeBrowserFeedbackButtonEnabled:
			value.hideFileTreeBrowserFeedbackButtonEnabled,
		highlightAuthoredMergeRequestsEnabled:
			value.highlightAuthoredMergeRequestsEnabled,
		rememberMergeRequestListFiltersEnabled:
			value.rememberMergeRequestListFiltersEnabled,
		startThreadsByDefaultEnabled: value.startThreadsByDefaultEnabled,
		toggleJobLogSectionsEnabled: value.toggleJobLogSectionsEnabled,
	};
}

export type SettingsOutcome =
	/** Storage held a value this build understands. */
	| "stored"
	/** Storage held the previous schema; this build upgraded it in memory. */
	| "migrated"
	/** Nothing stored yet. */
	| "default"
	/** A newer build owns the stored value; it is read-only to this one. */
	| "newer-schema"
	/** Unusable state that this build replaces with the defaults. */
	| "reset";

export interface SettingsResolution {
	outcome: SettingsOutcome;
	settings: TonicSettings;
}

/** Resolves raw storage. Invalid values reset; newer schemas remain read-only. */
export function resolveSettings(value: unknown): SettingsResolution {
	if (value === undefined) {
		return { outcome: "default", settings: { ...DEFAULT_SETTINGS } };
	}

	if (isNewerSchema(value, SETTINGS_SCHEMA_VERSION)) {
		return { outcome: "newer-schema", settings: { ...DEFAULT_SETTINGS } };
	}

	// Persist only on the next user change, so older tabs remain usable during an update.
	if (isRecord(value)) {
		const migrated =
			value.schemaVersion === 1
				? migrateSettingsFromV1(value)
				: value.schemaVersion === 2
					? migrateSettingsFromV2(value)
					: value.schemaVersion === 3
						? migrateSettingsFromV3(value)
						: value.schemaVersion === 4
							? migrateSettingsFromV4(value)
							: value.schemaVersion === 5
								? migrateSettingsFromV5(value)
								: value.schemaVersion === 6
									? migrateSettingsFromV6(value)
									: value.schemaVersion === 7
										? migrateSettingsFromV7(value)
										: value.schemaVersion === 8
											? migrateSettingsFromV8(value)
											: value.schemaVersion === 9
												? migrateSettingsFromV9(value)
												: value.schemaVersion === 10
													? migrateSettingsFromV10(value)
													: value.schemaVersion === 11
														? migrateSettingsFromV11(value)
														: undefined;

		if (migrated) {
			return { outcome: "migrated", settings: migrated };
		}
	}

	try {
		return { outcome: "stored", settings: parseSettings(value) };
	} catch (error) {
		if (!(error instanceof InvalidSettingsError)) {
			throw error;
		}

		return { outcome: "reset", settings: { ...DEFAULT_SETTINGS } };
	}
}

/** The settings a caller may change. `schemaVersion` is owned by this module. */
export type TonicSettingsChange = Partial<Omit<TonicSettings, "schemaVersion">>;

export interface SettingsRepository {
	read(): Promise<TonicSettings>;
	/** Merges one caller-owned change into the latest stored settings. */
	update(change: TonicSettingsChange): Promise<TonicSettings>;
	subscribe(
		listener: (settings: TonicSettings) => void,
		signal: AbortSignal,
	): void;
}

export function createSettingsRepository(
	storageArea: StorageArea = chrome.storage.local,
	storageChanges: StorageChangeEvent = chrome.storage.onChanged,
	reportReset: () => void = () => {
		console.error("Tonic settings were unusable and were reset to defaults");
	},
): SettingsRepository {
	const applyResolution = async (
		resolution: SettingsResolution,
	): Promise<TonicSettings> => {
		if (resolution.outcome === "reset") {
			reportReset();
			await storageArea.set({ [SETTINGS_STORAGE_KEY]: resolution.settings });
		}

		return resolution.settings;
	};

	const applyUpdate = async (
		change: TonicSettingsChange,
	): Promise<TonicSettings> => {
		const stored = await storageArea.get(SETTINGS_STORAGE_KEY);
		const value = stored[SETTINGS_STORAGE_KEY];

		// Merging would drop settings this build cannot read.
		if (isNewerSchema(value, SETTINGS_SCHEMA_VERSION)) {
			throw new NewerSettingsSchemaError();
		}

		const resolution = resolveSettings(value);

		if (resolution.outcome === "reset") {
			reportReset();
		}

		const next: TonicSettings = {
			...resolution.settings,
			...change,
			schemaVersion: SETTINGS_SCHEMA_VERSION,
		};

		await storageArea.set({ [SETTINGS_STORAGE_KEY]: next });

		return next;
	};

	// One tab serializes updates; Chrome storage stays last-writer-wins across tabs.
	const serialize = createWriteQueue();

	return {
		async read() {
			const stored = await storageArea.get(SETTINGS_STORAGE_KEY);

			return applyResolution(resolveSettings(stored[SETTINGS_STORAGE_KEY]));
		},
		update(change) {
			return serialize(() => applyUpdate(change));
		},
		subscribe(listener, signal) {
			subscribeToStorageKey(
				storageChanges,
				SETTINGS_STORAGE_KEY,
				(newValue) => {
					const resolution = resolveSettings(newValue);

					if (resolution.outcome === "reset") {
						reportReset();
					}

					listener(resolution.settings);
				},
				signal,
			);
		},
	};
}
