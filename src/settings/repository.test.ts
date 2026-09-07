import { beforeEach, describe, expect, test } from "bun:test";
import { fakeBrowser } from "@webext-core/fake-browser";
import {
	createSettingsRepository,
	DEFAULT_SETTINGS,
	InvalidSettingsError,
	NewerSettingsSchemaError,
	parseSettings,
	resolveSettings,
	SETTINGS_STORAGE_KEY,
} from "./repository";

beforeEach(() => {
	fakeBrowser.reset();
});

function createRepository(
	onReset: () => void = () => {},
): ReturnType<typeof createSettingsRepository> {
	return createSettingsRepository(
		fakeBrowser.storage.local,
		fakeBrowser.storage.onChanged,
		onReset,
	);
}

describe("settings resolution", () => {
	test("uses explicit defaults when settings are absent", () => {
		expect(resolveSettings(undefined)).toEqual({
			outcome: "default",
			settings: DEFAULT_SETTINGS,
		});
		expect(DEFAULT_SETTINGS.confirmMergeRequestEnabled).toBe(false);
		expect(DEFAULT_SETTINGS.copyMergeRequestLinkEnabled).toBe(true);
		expect(DEFAULT_SETTINGS.hideDuoAgentPlatformEntrypointEnabled).toBe(false);
	});

	test("ignores unknown keys so a newer build's extra settings do not invalidate", () => {
		expect(
			parseSettings({
				schemaVersion: 11,
				collapseJobLogSectionsByDefaultEnabled: false,
				confirmMergeRequestEnabled: true,
				copyMergeRequestLinkEnabled: true,
				dimDraftMergeRequestsEnabled: false,
				filterMyAuthoredMergeRequestsEnabled: true,
				hideDuoAgentPlatformEntrypointEnabled: true,
				hideFileTreeBrowserFeedbackButtonEnabled: true,
				highlightAuthoredMergeRequestsEnabled: true,
				rememberMergeRequestListFiltersEnabled: true,
				startThreadsByDefaultEnabled: true,
				toggleJobLogSectionsEnabled: true,
				unknownFutureSetting: true,
			}),
		).toEqual({
			...DEFAULT_SETTINGS,
			confirmMergeRequestEnabled: true,
			dimDraftMergeRequestsEnabled: false,
			hideDuoAgentPlatformEntrypointEnabled: true,
		});
	});

	test("upgrades schema 10, preserves every choice, and leaves job logs expanded", () => {
		expect(
			resolveSettings({
				schemaVersion: 10,
				confirmMergeRequestEnabled: true,
				copyMergeRequestLinkEnabled: false,
				dimDraftMergeRequestsEnabled: false,
				filterMyAuthoredMergeRequestsEnabled: false,
				hideDuoAgentPlatformEntrypointEnabled: true,
				hideFileTreeBrowserFeedbackButtonEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
				startThreadsByDefaultEnabled: false,
				toggleJobLogSectionsEnabled: false,
			}),
		).toEqual({
			outcome: "migrated",
			settings: {
				...DEFAULT_SETTINGS,
				collapseJobLogSectionsByDefaultEnabled: false,
				confirmMergeRequestEnabled: true,
				copyMergeRequestLinkEnabled: false,
				dimDraftMergeRequestsEnabled: false,
				filterMyAuthoredMergeRequestsEnabled: false,
				hideDuoAgentPlatformEntrypointEnabled: true,
				hideFileTreeBrowserFeedbackButtonEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
				startThreadsByDefaultEnabled: false,
				toggleJobLogSectionsEnabled: false,
			},
		});
	});

	test("upgrades schema 9, preserves every choice, and enables the job log section toggle", () => {
		expect(
			resolveSettings({
				schemaVersion: 9,
				confirmMergeRequestEnabled: true,
				copyMergeRequestLinkEnabled: false,
				dimDraftMergeRequestsEnabled: false,
				filterMyAuthoredMergeRequestsEnabled: false,
				hideDuoAgentPlatformEntrypointEnabled: true,
				hideFileTreeBrowserFeedbackButtonEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
				startThreadsByDefaultEnabled: false,
			}),
		).toEqual({
			outcome: "migrated",
			settings: {
				...DEFAULT_SETTINGS,
				confirmMergeRequestEnabled: true,
				copyMergeRequestLinkEnabled: false,
				dimDraftMergeRequestsEnabled: false,
				filterMyAuthoredMergeRequestsEnabled: false,
				hideDuoAgentPlatformEntrypointEnabled: true,
				hideFileTreeBrowserFeedbackButtonEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
				startThreadsByDefaultEnabled: false,
				toggleJobLogSectionsEnabled: true,
			},
		});
	});

	test("upgrades schema 8, preserves every choice, and enables the merge request link action", () => {
		expect(
			resolveSettings({
				schemaVersion: 8,
				confirmMergeRequestEnabled: true,
				dimDraftMergeRequestsEnabled: false,
				filterMyAuthoredMergeRequestsEnabled: false,
				hideDuoAgentPlatformEntrypointEnabled: true,
				hideFileTreeBrowserFeedbackButtonEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
				startThreadsByDefaultEnabled: false,
			}),
		).toEqual({
			outcome: "migrated",
			settings: {
				...DEFAULT_SETTINGS,
				confirmMergeRequestEnabled: true,
				copyMergeRequestLinkEnabled: true,
				dimDraftMergeRequestsEnabled: false,
				filterMyAuthoredMergeRequestsEnabled: false,
				hideDuoAgentPlatformEntrypointEnabled: true,
				hideFileTreeBrowserFeedbackButtonEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
				startThreadsByDefaultEnabled: false,
			},
		});
	});

	test("upgrades schema 1 through every later step and keeps the saved Draft choice", () => {
		expect(
			resolveSettings({
				schemaVersion: 1,
				dimDraftMergeRequestsEnabled: false,
			}),
		).toEqual({
			outcome: "migrated",
			settings: { ...DEFAULT_SETTINGS, dimDraftMergeRequestsEnabled: false },
		});
	});

	test("upgrades schema 2 and keeps both saved choices", () => {
		expect(
			resolveSettings({
				schemaVersion: 2,
				dimDraftMergeRequestsEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
			}),
		).toEqual({
			outcome: "migrated",
			settings: {
				...DEFAULT_SETTINGS,
				dimDraftMergeRequestsEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
			},
		});
	});

	test("upgrades schema 3 and keeps all three saved choices", () => {
		expect(
			resolveSettings({
				schemaVersion: 3,
				dimDraftMergeRequestsEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
			}),
		).toEqual({
			outcome: "migrated",
			settings: {
				...DEFAULT_SETTINGS,
				dimDraftMergeRequestsEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
			},
		});
	});

	test("upgrades schema 4 and keeps all four saved choices", () => {
		expect(
			resolveSettings({
				schemaVersion: 4,
				dimDraftMergeRequestsEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
				startThreadsByDefaultEnabled: false,
			}),
		).toEqual({
			outcome: "migrated",
			settings: {
				...DEFAULT_SETTINGS,
				dimDraftMergeRequestsEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
				startThreadsByDefaultEnabled: false,
			},
		});
	});

	test("upgrades schema 5 through later defaults while preserving saved choices", () => {
		expect(
			resolveSettings({
				schemaVersion: 5,
				dimDraftMergeRequestsEnabled: false,
				filterMyAuthoredMergeRequestsEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
				startThreadsByDefaultEnabled: false,
			}),
		).toEqual({
			outcome: "migrated",
			settings: {
				...DEFAULT_SETTINGS,
				dimDraftMergeRequestsEnabled: false,
				filterMyAuthoredMergeRequestsEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
				startThreadsByDefaultEnabled: false,
			},
		});
	});

	test("upgrades schema 6, preserves saved choices, and leaves Duo entrypoint hiding off", () => {
		expect(
			resolveSettings({
				schemaVersion: 6,
				confirmMergeRequestEnabled: true,
				dimDraftMergeRequestsEnabled: false,
				filterMyAuthoredMergeRequestsEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
				startThreadsByDefaultEnabled: false,
			}),
		).toEqual({
			outcome: "migrated",
			settings: {
				...DEFAULT_SETTINGS,
				confirmMergeRequestEnabled: true,
				dimDraftMergeRequestsEnabled: false,
				filterMyAuthoredMergeRequestsEnabled: false,
				hideDuoAgentPlatformEntrypointEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
				startThreadsByDefaultEnabled: false,
			},
		});
	});

	test("upgrades schema 7, preserves saved choices, and starts hiding the file tree feedback link", () => {
		expect(
			resolveSettings({
				schemaVersion: 7,
				confirmMergeRequestEnabled: true,
				dimDraftMergeRequestsEnabled: false,
				filterMyAuthoredMergeRequestsEnabled: false,
				hideDuoAgentPlatformEntrypointEnabled: true,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
				startThreadsByDefaultEnabled: false,
			}),
		).toEqual({
			outcome: "migrated",
			settings: {
				...DEFAULT_SETTINGS,
				confirmMergeRequestEnabled: true,
				dimDraftMergeRequestsEnabled: false,
				filterMyAuthoredMergeRequestsEnabled: false,
				hideDuoAgentPlatformEntrypointEnabled: true,
				hideFileTreeBrowserFeedbackButtonEnabled: true,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: false,
				startThreadsByDefaultEnabled: false,
			},
		});
	});

	test("resets an unusable schema 3 value instead of migrating it", () => {
		expect(
			resolveSettings({
				schemaVersion: 3,
				dimDraftMergeRequestsEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
				rememberMergeRequestListFiltersEnabled: "false",
			}),
		).toEqual({ outcome: "reset", settings: DEFAULT_SETTINGS });
	});

	// A schema 2 value that was never valid is reset, not migrated.
	test("resets an unusable schema 2 value instead of migrating it", () => {
		expect(
			resolveSettings({
				schemaVersion: 2,
				dimDraftMergeRequestsEnabled: false,
				highlightAuthoredMergeRequestsEnabled: "true",
			}),
		).toEqual({ outcome: "reset", settings: DEFAULT_SETTINGS });
	});

	test("treats a higher schema version as newer, not invalid", () => {
		expect(
			resolveSettings({
				schemaVersion: 12,
				dimDraftMergeRequestsEnabled: false,
			}),
		).toEqual({ outcome: "newer-schema", settings: DEFAULT_SETTINGS });
	});

	test("resets structurally invalid state instead of failing", () => {
		expect(
			resolveSettings({
				schemaVersion: 7,
				confirmMergeRequestEnabled: false,
				dimDraftMergeRequestsEnabled: "false",
				filterMyAuthoredMergeRequestsEnabled: true,
				hideDuoAgentPlatformEntrypointEnabled: true,
				highlightAuthoredMergeRequestsEnabled: true,
				rememberMergeRequestListFiltersEnabled: true,
				startThreadsByDefaultEnabled: true,
			}),
		).toEqual({ outcome: "reset", settings: DEFAULT_SETTINGS });
		// A schema 1 value that was never valid is reset, not migrated.
		expect(
			resolveSettings({
				schemaVersion: 1,
				dimDraftMergeRequestsEnabled: "false",
			}),
		).toEqual({ outcome: "reset", settings: DEFAULT_SETTINGS });
		expect(resolveSettings("not-an-object")).toEqual({
			outcome: "reset",
			settings: DEFAULT_SETTINGS,
		});
	});

	test("parseSettings still rejects invalid input for writes", () => {
		expect(() => parseSettings({ schemaVersion: 7 })).toThrow(
			InvalidSettingsError,
		);
		expect(() =>
			parseSettings({ schemaVersion: 2, dimDraftMergeRequestsEnabled: true }),
		).toThrow(InvalidSettingsError);
		// A complete schema 9 value is still the previous schema, not this one.
		expect(() =>
			parseSettings({
				schemaVersion: 9,
				confirmMergeRequestEnabled: false,
				copyMergeRequestLinkEnabled: true,
				dimDraftMergeRequestsEnabled: true,
				filterMyAuthoredMergeRequestsEnabled: true,
				hideDuoAgentPlatformEntrypointEnabled: false,
				hideFileTreeBrowserFeedbackButtonEnabled: true,
				highlightAuthoredMergeRequestsEnabled: true,
				rememberMergeRequestListFiltersEnabled: true,
				startThreadsByDefaultEnabled: true,
			}),
		).toThrow(InvalidSettingsError);
		expect(() =>
			parseSettings({
				schemaVersion: 8,
				confirmMergeRequestEnabled: false,
				dimDraftMergeRequestsEnabled: true,
				filterMyAuthoredMergeRequestsEnabled: true,
				hideDuoAgentPlatformEntrypointEnabled: false,
				hideFileTreeBrowserFeedbackButtonEnabled: true,
				highlightAuthoredMergeRequestsEnabled: true,
				rememberMergeRequestListFiltersEnabled: true,
				startThreadsByDefaultEnabled: true,
			}),
		).toThrow(InvalidSettingsError);
	});
});

describe("settings repository", () => {
	test("uses explicit defaults only when settings are absent", async () => {
		expect(await createRepository().read()).toEqual(DEFAULT_SETTINGS);
		expect((await createRepository().read()).confirmMergeRequestEnabled).toBe(
			false,
		);
	});

	test("persists and reads the versioned boolean setting", async () => {
		const repository = createRepository();
		const disabledSettings = {
			...DEFAULT_SETTINGS,
			dimDraftMergeRequestsEnabled: false,
		};

		expect(
			await repository.update({ dimDraftMergeRequestsEnabled: false }),
		).toEqual(disabledSettings);
		expect(await repository.read()).toEqual(disabledSettings);
	});

	test("persists partial setting updates without disturbing other choices", async () => {
		const repository = createRepository();
		const authoredDisabled = {
			...DEFAULT_SETTINGS,
			highlightAuthoredMergeRequestsEnabled: false,
		};

		await repository.update({ highlightAuthoredMergeRequestsEnabled: false });

		expect(await repository.read()).toEqual(authoredDisabled);

		await repository.update({ filterMyAuthoredMergeRequestsEnabled: false });

		await repository.update({ dimDraftMergeRequestsEnabled: false });

		expect(await repository.read()).toEqual({
			...DEFAULT_SETTINGS,
			dimDraftMergeRequestsEnabled: false,
			filterMyAuthoredMergeRequestsEnabled: false,
			highlightAuthoredMergeRequestsEnabled: false,
		});
	});

	test("merges onto what storage holds now, not onto a caller's snapshot", async () => {
		const repository = createRepository();
		// Another tab turned Draft dimming off after this caller last read.
		await fakeBrowser.storage.local.set({
			[SETTINGS_STORAGE_KEY]: {
				...DEFAULT_SETTINGS,
				dimDraftMergeRequestsEnabled: false,
			},
		});

		expect(
			await repository.update({ highlightAuthoredMergeRequestsEnabled: false }),
		).toEqual({
			...DEFAULT_SETTINGS,
			dimDraftMergeRequestsEnabled: false,
			highlightAuthoredMergeRequestsEnabled: false,
		});
	});

	test("serializes overlapping updates so neither change is lost", async () => {
		const repository = createRepository();

		// Both are issued before either resolves, so an unserialized read-modify-
		// write would have them both read the defaults and the second would win.
		await Promise.all([
			repository.update({ dimDraftMergeRequestsEnabled: false }),
			repository.update({ highlightAuthoredMergeRequestsEnabled: false }),
		]);

		expect(await repository.read()).toEqual({
			...DEFAULT_SETTINGS,
			dimDraftMergeRequestsEnabled: false,
			highlightAuthoredMergeRequestsEnabled: false,
		});
	});

	test("keeps serving updates after one of them fails", async () => {
		const failing = {
			get: () => Promise.reject(new Error("storage unavailable")),
			set: () => Promise.resolve(),
		};
		let shouldFail = true;
		const repository = createSettingsRepository(
			{
				get: (key) =>
					shouldFail ? failing.get() : fakeBrowser.storage.local.get(key),
				set: (items) => fakeBrowser.storage.local.set(items),
			},
			fakeBrowser.storage.onChanged,
			() => {},
		);

		await expect(
			repository.update({ dimDraftMergeRequestsEnabled: false }),
		).rejects.toThrow("storage unavailable");

		shouldFail = false;

		expect(
			await repository.update({ dimDraftMergeRequestsEnabled: false }),
		).toEqual({ ...DEFAULT_SETTINGS, dimDraftMergeRequestsEnabled: false });
	});

	test("upgrades stored schema 1 on read without rewriting it, then persists the current schema", async () => {
		let resets = 0;
		const repository = createRepository(() => {
			resets += 1;
		});
		const storedV1 = { schemaVersion: 1, dimDraftMergeRequestsEnabled: false };
		await fakeBrowser.storage.local.set({ [SETTINGS_STORAGE_KEY]: storedV1 });

		const migrated = await repository.read();

		expect(migrated).toEqual({
			...DEFAULT_SETTINGS,
			dimDraftMergeRequestsEnabled: false,
		});
		expect(resets).toBe(0);
		// Older tabs of a mid-session update keep writing until this build does.
		expect(
			(await fakeBrowser.storage.local.get(SETTINGS_STORAGE_KEY))[
				SETTINGS_STORAGE_KEY
			],
		).toEqual(storedV1);

		await repository.update({ highlightAuthoredMergeRequestsEnabled: false });

		expect(
			(await fakeBrowser.storage.local.get(SETTINGS_STORAGE_KEY))[
				SETTINGS_STORAGE_KEY
			],
		).toEqual({
			...DEFAULT_SETTINGS,
			dimDraftMergeRequestsEnabled: false,
			highlightAuthoredMergeRequestsEnabled: false,
		});
	});

	test("repairs invalid stored state instead of disabling the extension", async () => {
		let resets = 0;
		const repository = createRepository(() => {
			resets += 1;
		});
		await fakeBrowser.storage.local.set({
			[SETTINGS_STORAGE_KEY]: {
				schemaVersion: 1,
				dimDraftMergeRequestsEnabled: "false",
			},
		});

		expect(await repository.read()).toEqual(DEFAULT_SETTINGS);
		expect(resets).toBe(1);
		expect(
			(await fakeBrowser.storage.local.get(SETTINGS_STORAGE_KEY))[
				SETTINGS_STORAGE_KEY
			],
		).toEqual(DEFAULT_SETTINGS);
	});

	test("reading a newer schema uses defaults and leaves storage untouched", async () => {
		const repository = createRepository();
		const newerState = {
			schemaVersion: 99,
			dimDraftMergeRequestsEnabled: false,
		};
		await fakeBrowser.storage.local.set({
			[SETTINGS_STORAGE_KEY]: newerState,
		});

		expect(await repository.read()).toEqual(DEFAULT_SETTINGS);
		expect(
			(await fakeBrowser.storage.local.get(SETTINGS_STORAGE_KEY))[
				SETTINGS_STORAGE_KEY
			],
		).toEqual(newerState);
	});

	test("writing over a newer schema is refused, not silently downgraded", async () => {
		const repository = createRepository();
		const newerState = {
			schemaVersion: 99,
			dimDraftMergeRequestsEnabled: false,
			highlightAuthoredMergeRequestsEnabled: true,
		};
		await fakeBrowser.storage.local.set({
			[SETTINGS_STORAGE_KEY]: newerState,
		});

		await expect(
			repository.update({ dimDraftMergeRequestsEnabled: false }),
		).rejects.toBeInstanceOf(NewerSettingsSchemaError);
		expect(
			(await fakeBrowser.storage.local.get(SETTINGS_STORAGE_KEY))[
				SETTINGS_STORAGE_KEY
			],
		).toEqual(newerState);
	});

	test("notifies subscribers and removes the listener on abort", async () => {
		const repository = createRepository();
		const controller = new AbortController();
		const updates: boolean[] = [];
		repository.subscribe(
			(settings) => updates.push(settings.dimDraftMergeRequestsEnabled),
			controller.signal,
		);

		await repository.update({ dimDraftMergeRequestsEnabled: false });
		controller.abort();
		await repository.update({ dimDraftMergeRequestsEnabled: true });

		expect(updates).toEqual([false]);
	});

	test("delivers defaults to subscribers when a change is unreadable", async () => {
		let resets = 0;
		const repository = createRepository(() => {
			resets += 1;
		});
		const controller = new AbortController();
		const updates: boolean[] = [];
		repository.subscribe(
			(settings) => updates.push(settings.dimDraftMergeRequestsEnabled),
			controller.signal,
		);

		await fakeBrowser.storage.local.set({ [SETTINGS_STORAGE_KEY]: 42 });

		expect(updates).toEqual([DEFAULT_SETTINGS.dimDraftMergeRequestsEnabled]);
		expect(resets).toBe(1);
		controller.abort();
	});
});
