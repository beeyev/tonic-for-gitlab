import { afterEach, describe, expect, test } from "bun:test";
import { act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readDuoAgentPlatformFixture,
	readFileTreeBrowserFeedbackFixture,
	readJobLogFixture,
	readMergeRequestCommentFormFixture,
	readMergeRequestHeaderFixture,
	readMergeRequestListFixture,
	readMergeRequestMergeWidgetFixture,
	readMergeRequestTabBarFixture,
	readTopBarFixture,
	settleGitLabDom,
} from "../../tests/helpers/gitlab-dom";
import type { ControlSurfaceStatus } from "../control-surface/status-protocol";
import { APPROVE_MERGE_REQUEST_FROM_TABS_ATTRIBUTE } from "../features/approve-merge-request-from-tabs/selectors";
import {
	CONFIRM_MERGE_REQUEST_CANCEL_ATTRIBUTE,
	CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE,
} from "../features/confirm-merge-request/selectors";
import { COPY_MERGE_REQUEST_LINK_ATTRIBUTE } from "../features/copy-merge-request-link/selectors";
import { DRAFT_ROW_ATTRIBUTE } from "../features/dim-draft-merge-requests/selectors";
import { FILTER_MY_AUTHORED_MERGE_REQUESTS_ACTION_ATTRIBUTE } from "../features/filter-my-authored-merge-requests/selectors";
import {
	HIDDEN_ENTRYPOINT_ATTRIBUTE,
	HIDDEN_RAIL_ATTRIBUTE,
} from "../features/hide-duo-agent-platform-entrypoint/selectors";
import { HIDDEN_FEEDBACK_LINK_ATTRIBUTE } from "../features/hide-file-tree-browser-feedback-button/selectors";
import { AUTHORED_ROW_ATTRIBUTE } from "../features/highlight-authored-merge-requests/selectors";
import type { ListFilterStoreController } from "../features/remember-merge-request-list-filters/list-filters-store";
import { THREAD_DEFAULT_FORM_ATTRIBUTE } from "../features/start-threads-by-default/selectors";
import { TOGGLE_JOB_LOG_SECTIONS_ATTRIBUTE } from "../features/toggle-job-log-sections/selectors";
import {
	DEFAULT_SETTINGS,
	type SettingsRepository,
	type TonicSettings,
} from "../settings/repository";
import {
	type ContentRuntimeDependencies,
	startContentRuntime as startContentRuntimeWithDependencies,
} from "./index";
import type { Feature } from "./runtime/feature-context";

const inactiveBroadcastDismissal: Feature = {
	id: "test-inactive-broadcast-dismissal",
	matches: () => false,
	activate: () => {},
};

function startContentRuntime(
	dependencies: Omit<ContentRuntimeDependencies, "broadcastDismissal"> & {
		broadcastDismissal?: Feature;
	},
): () => void {
	return startContentRuntimeWithDependencies({
		broadcastDismissal: inactiveBroadcastDismissal,
		...dependencies,
	});
}

/**
 * A store that remembers nothing, so these bootstrap tests observe settings
 * behaviour without any link rewriting. The feature's own tests cover the store.
 */
function createEmptyListFilterStore(): ListFilterStoreController {
	return {
		read: () => undefined,
		isWritable: () => true,
		remember: () => {},
		start: () => {},
	};
}

afterEach(() => {
	closeGitLabTestWindows();
	document.body.replaceChildren();
});

/**
 * A repository whose read never settles until the test releases it, so the
 * bootstrap's behaviour before stored settings arrive is observable.
 */
function createDeferredRepository(): {
	repository: SettingsRepository;
	resolveRead(settings: TonicSettings): void;
	rejectRead(error: Error): void;
	/** A change event for a value storage now holds, as another tab produces. */
	emit(settings: TonicSettings): void;
	/**
	 * A change event carrying an older snapshot than storage now holds, which is
	 * what this tab's own earlier write produces once a later one has landed.
	 */
	emitStaleEcho(settings: TonicSettings): void;
	/** Rejects the next update, leaving stored settings untouched. */
	failNextUpdate(): void;
	/** Resolves the next update without storing it, as a real no-op write does. */
	skipNextUpdate(): void;
	writes: TonicSettings[];
} {
	const listeners = new Set<(settings: TonicSettings) => void>();
	const writes: TonicSettings[] = [];
	let stored: TonicSettings = { ...DEFAULT_SETTINGS };
	let failNext = false;
	let skipNext = false;
	let resolveRead!: (settings: TonicSettings) => void;
	let rejectRead!: (error: Error) => void;
	const read = new Promise<TonicSettings>((resolve, reject) => {
		resolveRead = resolve;
		rejectRead = reject;
	});
	const dispatch = (settings: TonicSettings) => {
		for (const listener of listeners) {
			listener(settings);
		}
	};

	return {
		repository: {
			read: () => read,
			// Mirrors the real repository: the change is merged into what storage
			// holds now, not into anything the caller remembers.
			async update(change) {
				if (failNext) {
					failNext = false;
					throw new Error("storage unavailable");
				}

				if (skipNext) {
					skipNext = false;
					return stored;
				}

				stored = { ...stored, ...change };
				writes.push(stored);

				return stored;
			},
			subscribe(listener, signal) {
				listeners.add(listener);
				signal.addEventListener("abort", () => listeners.delete(listener), {
					once: true,
				});
			},
		},
		resolveRead(settings) {
			stored = settings;
			resolveRead(settings);
		},
		rejectRead,
		emit(settings) {
			stored = settings;
			dispatch(settings);
		},
		emitStaleEcho: dispatch,
		failNextUpdate() {
			failNext = true;
		},
		skipNextUpdate() {
			skipNext = true;
		},
		writes,
	};
}

function countDimmedRows(testWindow: Window): number {
	return testWindow.document.querySelectorAll(`[${DRAFT_ROW_ATTRIBUTE}]`)
		.length;
}

function countAuthoredRows(testWindow: Window): number {
	return testWindow.document.querySelectorAll(`[${AUTHORED_ROW_ATTRIBUTE}]`)
		.length;
}

function addMergeRequestFilterBar(testWindow: Window): void {
	const bar = testWindow.document.createElement("div");
	bar.setAttribute("data-testid", "issuable-search-container");
	testWindow.document.querySelector(".issuable-list-container")?.before(bar);
}

function countMyMergeRequestActions(testWindow: Window): number {
	return testWindow.document.querySelectorAll(
		`[${FILTER_MY_AUTHORED_MERGE_REQUESTS_ACTION_ATTRIBUTE}]`,
	).length;
}

function countThreadDefaultForms(testWindow: Window): number {
	return testWindow.document.querySelectorAll(
		`[${THREAD_DEFAULT_FORM_ATTRIBUTE}]`,
	).length;
}

function countMirroredApproveButtons(testWindow: Window): number {
	return testWindow.document.querySelectorAll(
		`[${APPROVE_MERGE_REQUEST_FROM_TABS_ATTRIBUTE}]`,
	).length;
}

function countCopyMergeRequestLinkButtons(testWindow: Window): number {
	return testWindow.document.querySelectorAll(
		`[${COPY_MERGE_REQUEST_LINK_ATTRIBUTE}]`,
	).length;
}

function countJobLogSectionToggles(testWindow: Window): number {
	return testWindow.document.querySelectorAll(
		`[${TOGGLE_JOB_LOG_SECTIONS_ATTRIBUTE}]`,
	).length;
}

function countHiddenFileTreeFeedbackLinks(testWindow: Window): number {
	return testWindow.document.querySelectorAll(
		`[${HIDDEN_FEEDBACK_LINK_ATTRIBUTE}]`,
	).length;
}

function countHiddenDuoEntrypoints(testWindow: Window): number {
	return testWindow.document.querySelectorAll(
		`[${HIDDEN_ENTRYPOINT_ATTRIBUTE}], [${HIDDEN_RAIL_ATTRIBUTE}]`,
	).length;
}

/** Rows carrying both features' markers, which is the composition contract. */
function countComposedRows(testWindow: Window): number {
	return testWindow.document.querySelectorAll(
		`[${DRAFT_ROW_ATTRIBUTE}][${AUTHORED_ROW_ATTRIBUTE}]`,
	).length;
}

describe("content runtime bootstrap", () => {
	test("always registers the supplied broadcast dismissal feature", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const { repository, resolveRead } = createDeferredRepository();
		let activations = 0;
		const broadcastDismissal: Feature = {
			id: "test-broadcast-dismissal",
			matches: () => true,
			activate: () => {
				activations += 1;
			},
		};
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			broadcastDismissal,
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});

		expect(activations).toBe(1);
		resolveRead(DEFAULT_SETTINGS);
		stop();
	});

	test("decorates the first paint from defaults without waiting on storage", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const { repository, resolveRead } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});
		await settleGitLabDom(testWindow);

		expect(countDimmedRows(asBrowserWindow(testWindow))).toBeGreaterThan(0);

		resolveRead(DEFAULT_SETTINGS);
		stop();
	});

	test("applies stored settings once the read resolves", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const { repository, resolveRead } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});
		await settleGitLabDom(testWindow);

		resolveRead({ ...DEFAULT_SETTINGS, dimDraftMergeRequestsEnabled: false });
		await settleGitLabDom(testWindow);

		expect(countDimmedRows(asBrowserWindow(testWindow))).toBe(0);
		stop();
	});

	test("applies each stored setting to only its own feature", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const { repository, resolveRead, emit } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});
		resolveRead(DEFAULT_SETTINGS);
		await settleGitLabDom(testWindow);

		// The fixture has exactly one decorated row and it carries both markers,
		// so this also covers the composition contract: each toggle must leave the
		// other feature's marker on that same row untouched.
		expect(countDimmedRows(asBrowserWindow(testWindow))).toBe(1);
		expect(countAuthoredRows(asBrowserWindow(testWindow))).toBe(1);
		expect(countComposedRows(asBrowserWindow(testWindow))).toBe(1);

		emit({ ...DEFAULT_SETTINGS, highlightAuthoredMergeRequestsEnabled: false });
		await settleGitLabDom(testWindow);

		expect(countAuthoredRows(asBrowserWindow(testWindow))).toBe(0);
		expect(countDimmedRows(asBrowserWindow(testWindow))).toBe(1);
		expect(countComposedRows(asBrowserWindow(testWindow))).toBe(0);

		emit({ ...DEFAULT_SETTINGS, dimDraftMergeRequestsEnabled: false });
		await settleGitLabDom(testWindow);

		expect(countAuthoredRows(asBrowserWindow(testWindow))).toBe(1);
		expect(countDimmedRows(asBrowserWindow(testWindow))).toBe(0);
		expect(countComposedRows(asBrowserWindow(testWindow))).toBe(0);

		// Re-enabling both restores the composed row rather than one marker.
		emit(DEFAULT_SETTINGS);
		await settleGitLabDom(testWindow);

		expect(countComposedRows(asBrowserWindow(testWindow))).toBe(1);

		stop();
	});

	test("gates the authored-list shortcut on its own setting", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		addMergeRequestFilterBar(asBrowserWindow(testWindow));
		const { repository, resolveRead, emit } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});
		resolveRead(DEFAULT_SETTINGS);
		await settleGitLabDom(testWindow);

		expect(countMyMergeRequestActions(asBrowserWindow(testWindow))).toBe(1);

		emit({ ...DEFAULT_SETTINGS, filterMyAuthoredMergeRequestsEnabled: false });
		await settleGitLabDom(testWindow);
		expect(countMyMergeRequestActions(asBrowserWindow(testWindow))).toBe(0);

		emit(DEFAULT_SETTINGS);
		await settleGitLabDom(testWindow);
		expect(countMyMergeRequestActions(asBrowserWindow(testWindow))).toBe(1);

		stop();
		expect(countMyMergeRequestActions(asBrowserWindow(testWindow))).toBe(0);
	});

	test("gates Duo entrypoint hiding on its own setting", async () => {
		const testWindow = createGitLabTestWindow(
			await readDuoAgentPlatformFixture("19"),
		);
		const { repository, resolveRead, emit } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});

		expect(countHiddenDuoEntrypoints(asBrowserWindow(testWindow))).toBe(0);

		resolveRead({
			...DEFAULT_SETTINGS,
			hideDuoAgentPlatformEntrypointEnabled: true,
		});
		await settleGitLabDom(testWindow);
		expect(countHiddenDuoEntrypoints(asBrowserWindow(testWindow))).toBe(1);

		emit(DEFAULT_SETTINGS);
		await settleGitLabDom(testWindow);
		expect(countHiddenDuoEntrypoints(asBrowserWindow(testWindow))).toBe(0);

		stop();
		expect(countHiddenDuoEntrypoints(asBrowserWindow(testWindow))).toBe(0);
	});

	test("gates the file tree feedback link on its own default-on setting", async () => {
		const testWindow = createGitLabTestWindow(
			await readFileTreeBrowserFeedbackFixture("18"),
			"https://gitlab.com/example/project/-/blob/main/versions.tf",
			"projects:blob:show",
		);
		const { repository, resolveRead, emit } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});

		// Reversible, so it decorates the first paint from the default rather than
		// waiting for the storage read.
		expect(countHiddenFileTreeFeedbackLinks(asBrowserWindow(testWindow))).toBe(
			1,
		);

		resolveRead({
			...DEFAULT_SETTINGS,
			hideFileTreeBrowserFeedbackButtonEnabled: false,
		});
		await settleGitLabDom(testWindow);
		expect(countHiddenFileTreeFeedbackLinks(asBrowserWindow(testWindow))).toBe(
			0,
		);

		emit(DEFAULT_SETTINGS);
		await settleGitLabDom(testWindow);
		expect(countHiddenFileTreeFeedbackLinks(asBrowserWindow(testWindow))).toBe(
			1,
		);

		stop();
		expect(countHiddenFileTreeFeedbackLinks(asBrowserWindow(testWindow))).toBe(
			0,
		);
	});

	test("protects pending settings reads, then follows its default-off setting", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestMergeWidgetFixture("19", "immediate"),
			"https://gitlab.com/example/project/-/merge_requests/2",
			"projects:merge_requests:show",
		);
		const action = testWindow.document.querySelector(
			'[data-testid="merge-button"]',
		) as unknown as HTMLElement;
		let actionClicks = 0;
		action.addEventListener("click", () => {
			actionClicks += 1;
		});
		const { repository, resolveRead, emit } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});

		action.click();
		expect(actionClicks).toBe(0);
		expect(
			testWindow.document.querySelector(
				`[${CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE}]`,
			),
		).not.toBeNull();
		(
			testWindow.document.querySelector(
				`[${CONFIRM_MERGE_REQUEST_CANCEL_ATTRIBUTE}]`,
			) as unknown as HTMLButtonElement
		).click();

		resolveRead(DEFAULT_SETTINGS);
		await settleGitLabDom(testWindow);
		action.click();
		expect(actionClicks).toBe(1);

		emit({ ...DEFAULT_SETTINGS, confirmMergeRequestEnabled: true });
		await settleGitLabDom(testWindow);
		action.click();

		expect(actionClicks).toBe(1);
		const confirmationDialog = testWindow.document.querySelector(
			`[${CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE}]`,
		) as unknown as HTMLDialogElement | null;
		expect(confirmationDialog?.open).toBe(true);

		emit(DEFAULT_SETTINGS);
		await settleGitLabDom(testWindow);
		expect(
			testWindow.document.querySelector(
				`[${CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE}]`,
			),
		).toBeNull();

		action.click();
		expect(actionClicks).toBe(2);
		stop();
	});

	test("drops temporary merge protection when the settings read fails", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestMergeWidgetFixture("19", "immediate"),
			"https://gitlab.com/example/project/-/merge_requests/2",
			"projects:merge_requests:show",
		);
		const action = testWindow.document.querySelector(
			'[data-testid="merge-button"]',
		) as unknown as HTMLElement;
		let actionClicks = 0;
		action.addEventListener("click", () => {
			actionClicks += 1;
		});
		const { repository, rejectRead } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});

		action.click();
		expect(actionClicks).toBe(0);

		rejectRead(new Error("storage unavailable"));
		await settleGitLabDom(testWindow);
		expect(
			testWindow.document.querySelector(
				`[${CONFIRM_MERGE_REQUEST_DIALOG_ATTRIBUTE}]`,
			),
		).toBeNull();

		action.click();
		expect(actionClicks).toBe(1);
		stop();
	});

	test("gates the copy merge request link action on its own setting", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestHeaderFixture("19"),
			"https://gitlab.com/example/project/-/merge_requests/7/diffs?view=parallel#note_1",
			"projects:merge_requests:show",
		);
		const { repository, resolveRead, emit } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});

		// This reversible action can decorate the first paint from its default.
		expect(countCopyMergeRequestLinkButtons(asBrowserWindow(testWindow))).toBe(
			1,
		);
		expect(
			testWindow.document
				.querySelector(`[${COPY_MERGE_REQUEST_LINK_ATTRIBUTE}]`)
				?.hasAttribute("data-clipboard-text"),
		).toBe(false);

		resolveRead({ ...DEFAULT_SETTINGS, copyMergeRequestLinkEnabled: false });
		await settleGitLabDom(testWindow);
		expect(countCopyMergeRequestLinkButtons(asBrowserWindow(testWindow))).toBe(
			0,
		);

		emit(DEFAULT_SETTINGS);
		await settleGitLabDom(testWindow);
		expect(countCopyMergeRequestLinkButtons(asBrowserWindow(testWindow))).toBe(
			1,
		);

		stop();
		expect(countCopyMergeRequestLinkButtons(asBrowserWindow(testWindow))).toBe(
			0,
		);
	});

	test("gates the mirrored approve button on its own setting", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestTabBarFixture(),
			"https://gitlab.com/example/project/-/merge_requests/7/diffs",
			"projects:merge_requests:show",
		);
		const { repository, resolveRead, emit } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});

		// Adding a button changes nothing until it is pressed, so the default paints.
		expect(countMirroredApproveButtons(asBrowserWindow(testWindow))).toBe(1);

		resolveRead({
			...DEFAULT_SETTINGS,
			approveMergeRequestFromTabsEnabled: false,
		});
		await settleGitLabDom(testWindow);
		expect(countMirroredApproveButtons(asBrowserWindow(testWindow))).toBe(0);

		emit(DEFAULT_SETTINGS);
		await settleGitLabDom(testWindow);
		expect(countMirroredApproveButtons(asBrowserWindow(testWindow))).toBe(1);

		stop();
		expect(countMirroredApproveButtons(asBrowserWindow(testWindow))).toBe(0);
	});

	test("gates the job log section toggle on its own setting", async () => {
		const testWindow = createGitLabTestWindow(
			await readJobLogFixture(),
			"https://gitlab.com/example/project/-/jobs/1234",
			"projects:jobs:show",
		);
		const { repository, resolveRead, emit } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});

		// Adding a button changes nothing until it is pressed, so the default paints.
		expect(countJobLogSectionToggles(asBrowserWindow(testWindow))).toBe(1);

		resolveRead({ ...DEFAULT_SETTINGS, toggleJobLogSectionsEnabled: false });
		await settleGitLabDom(testWindow);
		expect(countJobLogSectionToggles(asBrowserWindow(testWindow))).toBe(0);

		emit(DEFAULT_SETTINGS);
		await settleGitLabDom(testWindow);
		expect(countJobLogSectionToggles(asBrowserWindow(testWindow))).toBe(1);

		stop();
		expect(countJobLogSectionToggles(asBrowserWindow(testWindow))).toBe(0);
	});

	/*
	 * The collapsed job log default rides on the toggle button's own setting.
	 * With the button gated off there would be no way to expand a collapsed log,
	 * which is what the panel's dependency notice tells the user, and the only
	 * thing enforcing it is that the feature never activates at all.
	 */
	test("keeps the whole job log feature off when its toggle setting is off", async () => {
		const testWindow = createGitLabTestWindow(
			await readJobLogFixture(),
			"https://gitlab.com/example/project/-/jobs/1234",
			"projects:jobs:show",
		);
		const { repository, resolveRead } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});

		resolveRead({
			...DEFAULT_SETTINGS,
			collapseJobLogSectionsByDefaultEnabled: true,
			toggleJobLogSectionsEnabled: false,
		});
		await settleGitLabDom(testWindow);

		// Nothing is mounted, so nothing reads the collapsed default either.
		expect(countJobLogSectionToggles(asBrowserWindow(testWindow))).toBe(0);

		stop();
	});

	/*
	 * The merge request detail features are gated the same way as the list ones,
	 * on a page the list fixtures never reach, so nothing else proves this
	 * feature's wrapper reads its own setting.
	 */
	test("gates the comment-type default on its own setting", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestCommentFormFixture("19"),
			"https://gitlab.com/example/project/-/merge_requests/2",
			"projects:merge_requests:show",
		);
		const { repository, resolveRead, emit } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});
		await settleGitLabDom(testWindow);

		/*
		 * Not from the defaults, unlike the list features. Driving GitLab's
		 * comment-type control cannot be taken back, so acting before the stored
		 * value arrives would select a thread for a user who turned it off.
		 */
		expect(countThreadDefaultForms(asBrowserWindow(testWindow))).toBe(0);

		resolveRead(DEFAULT_SETTINGS);
		await settleGitLabDom(testWindow);

		expect(countThreadDefaultForms(asBrowserWindow(testWindow))).toBe(1);

		emit({ ...DEFAULT_SETTINGS, startThreadsByDefaultEnabled: false });
		await settleGitLabDom(testWindow);

		expect(countThreadDefaultForms(asBrowserWindow(testWindow))).toBe(0);

		stop();
	});

	test("never drives the comment control when storage disabled it", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestCommentFormFixture("19"),
			"https://gitlab.com/example/project/-/merge_requests/2",
			"projects:merge_requests:show",
		);
		const threadOption = testWindow.document.querySelector(
			'[data-testid="listbox-item-discussion"]',
		) as unknown as HTMLElement;
		let threadClicks = 0;
		threadOption.addEventListener("click", () => {
			threadClicks += 1;
		});
		const { repository, resolveRead } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});
		await settleGitLabDom(testWindow);

		resolveRead({ ...DEFAULT_SETTINGS, startThreadsByDefaultEnabled: false });
		await settleGitLabDom(testWindow);

		expect(threadClicks).toBe(0);
		expect(countThreadDefaultForms(asBrowserWindow(testWindow))).toBe(0);

		stop();
	});

	test("keeps the list features working when the settings read fails", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const { repository, rejectRead } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});

		rejectRead(new Error("storage unavailable"));
		await settleGitLabDom(testWindow);

		expect(countDimmedRows(asBrowserWindow(testWindow))).toBeGreaterThan(0);
		stop();
	});

	test("mounts the panel and fans a stored change out to it and the features", async () => {
		const testWindow = createGitLabTestWindow(
			await readTopBarFixture("19"),
			"https://gitlab.com/example/project/-/merge_requests",
		);
		const { repository, resolveRead, emit } = createDeferredRepository();
		let getStatus: (() => ControlSurfaceStatus) | undefined;
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: ":host { color: CanvasText; }",
			registerStatusResponder: (next) => {
				getStatus = next;
			},
		});
		resolveRead(DEFAULT_SETTINGS);
		await settleGitLabDom(testWindow);

		const host = testWindow.document.querySelector(
			"[data-tonic-for-gitlab-in-page-control-panel-root]",
		);
		expect(host).not.toBeNull();
		expect(getStatus?.()).toEqual({ status: "mounted" });
		const switchBefore = host?.shadowRoot?.querySelector('[role="switch"]');
		expect(switchBefore).toBeNull(); // popover closed, switch not rendered yet

		emit({ ...DEFAULT_SETTINGS, dimDraftMergeRequestsEnabled: false });
		await settleGitLabDom(testWindow);

		// One host, still mounted, and the panel received the new settings.
		expect(
			testWindow.document.querySelectorAll(
				"[data-tonic-for-gitlab-in-page-control-panel-root]",
			),
		).toHaveLength(1);
		expect(getStatus?.()).toEqual({ status: "mounted" });
		stop();
		expect(
			testWindow.document.querySelectorAll(
				"[data-tonic-for-gitlab-in-page-control-panel-root]",
			),
		).toHaveLength(0);
	});

	test("persists the Duo switch through the panel's partial-update path", async () => {
		document.body.innerHTML = `${await readTopBarFixture("19")}${await readDuoAgentPlatformFixture("19")}`;
		const { repository, resolveRead, writes } = createDeferredRepository();
		const user = userEvent.setup({ document });
		let stop: (() => void) | undefined;

		await act(async () => {
			stop = startContentRuntime({
				runtimeWindow: window,
				repository,
				listFilters: createEmptyListFilterStore(),
				stylesheet: ":host { color: CanvasText; }",
				registerStatusResponder: () => {},
			});
			resolveRead(DEFAULT_SETTINGS);
		});

		const shadowRoot = document.querySelector(
			"[data-tonic-for-gitlab-in-page-control-panel-root]",
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
		await user.click(
			within(dialog).getByRole("switch", {
				name: "Hide unavailable GitLab Duo entry point",
			}),
		);

		expect(writes).toEqual([
			{
				...DEFAULT_SETTINGS,
				hideDuoAgentPlatformEntrypointEnabled: true,
			},
		]);
		expect(document.querySelector(`[${HIDDEN_RAIL_ATTRIBUTE}]`)).not.toBeNull();

		await act(async () => {
			stop?.();
		});
	});

	/*
	 * These drive the real panel in the global test document, because what is
	 * under test is the object the runtime ends up persisting when writes and
	 * chrome.storage change events interleave.
	 */
	test("applies a stale echo without letting it corrupt the next write", async () => {
		document.body.innerHTML = await readTopBarFixture("19");
		const { repository, resolveRead, emitStaleEcho, writes } =
			createDeferredRepository();
		const user = userEvent.setup({ document });
		let stop: (() => void) | undefined;

		await act(async () => {
			stop = startContentRuntime({
				runtimeWindow: window,
				repository,
				listFilters: createEmptyListFilterStore(),
				stylesheet: ":host { color: CanvasText; }",
				registerStatusResponder: () => {},
			});
			resolveRead(DEFAULT_SETTINGS);
		});

		const shadowRoot = document.querySelector(
			"[data-tonic-for-gitlab-in-page-control-panel-root]",
		)?.shadowRoot as ShadowRoot;
		const mountingPoint = shadowRoot.querySelector("div") as HTMLElement;
		await user.click(
			within(mountingPoint).getByRole("button", { name: "Tonic settings" }),
		);
		const dialog = shadowRoot.querySelector<HTMLElement>(
			'[data-slot="popover-content"]',
		) as HTMLElement;

		await user.click(
			within(dialog).getByRole("switch", { name: "Dim draft merge requests" }),
		);
		await user.click(
			within(dialog).getByRole("switch", {
				name: "Highlight my merge requests",
			}),
		);

		// The first write's change event lands while the second is already made,
		// so it carries storage state from before the second write. Applying it is
		// correct, but the next write must still merge onto what storage holds.
		await act(async () => {
			emitStaleEcho(writes[0] as TonicSettings);
		});

		await user.click(
			within(dialog).getByRole("switch", { name: "Dim draft merge requests" }),
		);

		expect(writes[2]).toEqual({
			...DEFAULT_SETTINGS,
			dimDraftMergeRequestsEnabled: true,
			highlightAuthoredMergeRequestsEnabled: false,
		});

		await act(async () => {
			stop?.();
		});
	});

	test("chains a second setting change onto the first instead of reverting it", async () => {
		document.body.innerHTML = await readTopBarFixture("19");
		const { repository, resolveRead, writes } = createDeferredRepository();
		const user = userEvent.setup({ document });
		let stop: (() => void) | undefined;

		await act(async () => {
			stop = startContentRuntime({
				runtimeWindow: window,
				repository,
				listFilters: createEmptyListFilterStore(),
				stylesheet: ":host { color: CanvasText; }",
				registerStatusResponder: () => {},
			});
			resolveRead(DEFAULT_SETTINGS);
		});

		const shadowRoot = document.querySelector(
			"[data-tonic-for-gitlab-in-page-control-panel-root]",
		)?.shadowRoot;
		expect(shadowRoot).not.toBeUndefined();
		const mountingPoint = (shadowRoot as ShadowRoot).querySelector("div");
		await user.click(
			within(mountingPoint as HTMLElement).getByRole("button", {
				name: "Tonic settings",
			}),
		);
		const dialog = (shadowRoot as ShadowRoot).querySelector<HTMLElement>(
			'[data-slot="popover-content"]',
		);
		expect(dialog).not.toBeNull();

		// No change event is emitted between the clicks, so the applied settings
		// still say both features are on while the second write is issued.
		await user.click(
			within(dialog as HTMLElement).getByRole("switch", {
				name: "Dim draft merge requests",
			}),
		);
		await user.click(
			within(dialog as HTMLElement).getByRole("switch", {
				name: "Highlight my merge requests",
			}),
		);

		expect(writes).toEqual([
			{ ...DEFAULT_SETTINGS, dimDraftMergeRequestsEnabled: false },
			{
				...DEFAULT_SETTINGS,
				dimDraftMergeRequestsEnabled: false,
				highlightAuthoredMergeRequestsEnabled: false,
			},
		]);

		await act(async () => {
			stop?.();
		});
	});

	test("does not revert a setting saved before a rejected update", async () => {
		document.body.innerHTML = await readTopBarFixture("19");
		const { repository, resolveRead, emitStaleEcho, failNextUpdate, writes } =
			createDeferredRepository();
		const user = userEvent.setup({ document });
		let stop: (() => void) | undefined;

		await act(async () => {
			stop = startContentRuntime({
				runtimeWindow: window,
				repository,
				listFilters: createEmptyListFilterStore(),
				stylesheet: ":host { color: CanvasText; }",
				registerStatusResponder: () => {},
			});
			resolveRead(DEFAULT_SETTINGS);
		});

		const shadowRoot = document.querySelector(
			"[data-tonic-for-gitlab-in-page-control-panel-root]",
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

		// Draft dimming is saved, but its change event has not arrived yet.
		await user.click(
			within(dialog).getByRole("switch", { name: "Dim draft merge requests" }),
		);

		failNextUpdate();
		await user.click(
			within(dialog).getByRole("switch", {
				name: "Highlight my merge requests",
			}),
		);
		expect(within(dialog).getByRole("alert").textContent).toContain(
			"Could not save",
		);

		// The echo of the saved change lands only now, after the failure.
		await act(async () => {
			emitStaleEcho(writes[0] as TonicSettings);
		});

		await user.click(
			within(dialog).getByRole("switch", {
				name: "Highlight my merge requests",
			}),
		);

		// The retry must not carry the pre-change value of the setting that was
		// already saved. Rebuilding a whole settings object in this tab is what
		// used to reintroduce it.
		expect(writes[1]).toEqual({
			...DEFAULT_SETTINGS,
			dimDraftMergeRequestsEnabled: false,
			highlightAuthoredMergeRequestsEnabled: false,
		});

		await act(async () => {
			stop?.();
		});
	});

	test("releases the optimistic value when a write stores no change", async () => {
		document.body.innerHTML = await readTopBarFixture("19");
		const { repository, resolveRead, emit, skipNextUpdate } =
			createDeferredRepository();
		const user = userEvent.setup({ document });
		let stop: (() => void) | undefined;

		await act(async () => {
			stop = startContentRuntime({
				runtimeWindow: window,
				repository,
				listFilters: createEmptyListFilterStore(),
				stylesheet: ":host { color: CanvasText; }",
				registerStatusResponder: () => {},
			});
			resolveRead(DEFAULT_SETTINGS);
		});

		const shadowRoot = document.querySelector(
			"[data-tonic-for-gitlab-in-page-control-panel-root]",
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
		const dimSwitch = within(dialog).getByRole("switch", {
			name: "Dim draft merge requests",
		});

		/*
		 * chrome.storage dispatches no change event when a write does not alter
		 * the stored value, so an optimistic value released by a change event
		 * would never be released here and would mask every later change.
		 */
		skipNextUpdate();
		await user.click(dimSwitch);

		expect(dimSwitch.getAttribute("aria-checked")).toBe("true");

		await act(async () => {
			emit({ ...DEFAULT_SETTINGS, dimDraftMergeRequestsEnabled: false });
		});

		expect(dimSwitch.getAttribute("aria-checked")).toBe("false");

		await act(async () => {
			stop?.();
		});
	});

	test("reports a stylesheet failure instead of dropping the status responder", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const { repository, resolveRead } = createDeferredRepository();
		let getStatus: (() => ControlSurfaceStatus) | undefined;
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: (next) => {
				getStatus = next;
			},
		});

		expect(getStatus?.()).toEqual({
			status: "unavailable",
			reason: "stylesheet-unavailable",
		});

		resolveRead(DEFAULT_SETTINGS);
		stop();
	});

	test("applies a settings change made in another tab", async () => {
		const testWindow = createGitLabTestWindow(
			await readMergeRequestListFixture("19"),
		);
		const { repository, resolveRead, emit } = createDeferredRepository();
		const stop = startContentRuntime({
			runtimeWindow: asBrowserWindow(testWindow),
			repository,
			listFilters: createEmptyListFilterStore(),
			stylesheet: undefined,
			registerStatusResponder: () => {},
		});
		resolveRead(DEFAULT_SETTINGS);
		await settleGitLabDom(testWindow);

		const disabled = {
			...DEFAULT_SETTINGS,
			dimDraftMergeRequestsEnabled: false,
		};
		expect(countDimmedRows(asBrowserWindow(testWindow))).toBeGreaterThan(0);

		emit(disabled);
		await settleGitLabDom(testWindow);

		expect(countDimmedRows(asBrowserWindow(testWindow))).toBe(0);
		stop();
	});
});

describe("foreign documents on a granted origin", () => {
	/*
	 * A target is a whole origin, so this script also loads on a wiki or CI
	 * server sharing the host. It must answer the toolbar action and start
	 * nothing else, in particular no body-wide MutationObserver.
	 */
	test("answers not-gitlab and starts no runtime", () => {
		document.body.innerHTML = '<div id="app">Build #42</div>';
		document.body.removeAttribute("data-page");

		const observed: unknown[] = [];
		const RealObserver = globalThis.MutationObserver;
		globalThis.MutationObserver = class {
			observe(...args: unknown[]) {
				observed.push(args);
			}
			disconnect() {}
			takeRecords() {
				return [];
			}
		} as unknown as typeof MutationObserver;

		let reported: unknown;
		let readCount = 0;
		const repository = {
			read: async () => {
				readCount++;
				return { ...DEFAULT_SETTINGS };
			},
			update: async () => ({ ...DEFAULT_SETTINGS }),
			subscribe: () => {
				throw new Error("must not subscribe on a foreign document");
			},
		};

		try {
			const stop = startContentRuntime({
				runtimeWindow: window,
				repository,
				listFilters: createEmptyListFilterStore(),
				stylesheet: "",
				registerStatusResponder: (getStatus) => {
					reported = getStatus();
				},
			});

			expect(reported).toEqual({ status: "not-gitlab" });
			expect(observed).toEqual([]);
			expect(readCount).toBe(0);
			stop();
		} finally {
			globalThis.MutationObserver = RealObserver;
		}
	});

	test("starts normally once the document carries a GitLab marker", () => {
		document.body.innerHTML = '<header class="js-super-topbar"></header>';

		let reported: unknown;
		const stop = startContentRuntime({
			runtimeWindow: window,
			repository: {
				read: async () => ({ ...DEFAULT_SETTINGS }),
				update: async () => ({ ...DEFAULT_SETTINGS }),
				subscribe: () => {},
			},
			listFilters: createEmptyListFilterStore(),
			stylesheet: "",
			registerStatusResponder: (getStatus) => {
				reported = getStatus();
			},
		});

		expect(reported).not.toEqual({ status: "not-gitlab" });
		stop();
	});
});
