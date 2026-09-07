import { afterEach, describe, expect, test } from "bun:test";
import type {
	HTMLButtonElement as HappyHTMLButtonElement,
	HTMLElement as HappyHTMLElement,
	Window,
} from "happy-dom";
import {
	asBrowserWindow,
	closeGitLabTestWindows,
	createGitLabTestWindow,
	readBroadcastBannerFixture,
	settleGitLabDom,
} from "../../../tests/helpers/gitlab-dom";
import { activateFeatureRuntime } from "../../content/runtime/feature-lifecycle";
import { hashBroadcastContent } from "./broadcast-content-hash";
import type {
	BroadcastDismissalsRepository,
	BroadcastDismissalsResolution,
	TonicBroadcastDismissals,
} from "./broadcast-dismissals-repository";
import {
	createDismissBroadcastBannerFeature,
	serializeBroadcastContent,
} from "./dismiss-broadcast-banner";
import {
	BROADCAST_BANNER_SELECTOR,
	BROADCAST_DISMISS_CONTROL_ATTRIBUTE,
	BROADCAST_HIDDEN_ATTRIBUTE,
	BROADCAST_MESSAGE_TEXT_SELECTOR,
} from "./selectors";

const FINGERPRINT_A = "a".repeat(64);
const FINGERPRINT_B = "b".repeat(64);

interface ObservedCall {
	fingerprint: string;
	forceVisible: boolean;
	origin: string;
}

function storedResolution(
	origins: TonicBroadcastDismissals["origins"] = {},
): BroadcastDismissalsResolution {
	return {
		outcome: "stored",
		broadcastDismissals: { schemaVersion: 1, origins },
		dropped: [],
	};
}

function createRepository(
	initial = storedResolution(),
): BroadcastDismissalsRepository & {
	emit(resolution: BroadcastDismissalsResolution): void;
	observed: ObservedCall[];
	dismissed: { fingerprint: string; origin: string }[];
	failObserve?: boolean;
	failDismiss?: boolean;
	readCount: number;
} {
	let current = initial;
	const listeners = new Set<
		(resolution: BroadcastDismissalsResolution) => void
	>();
	const repository = {
		observed: [] as ObservedCall[],
		dismissed: [] as { fingerprint: string; origin: string }[],
		failObserve: false,
		failDismiss: false,
		readCount: 0,
		async read() {
			repository.readCount += 1;
			return current;
		},
		async observe(origin: string, fingerprint: string, forceVisible: boolean) {
			repository.observed.push({ origin, fingerprint, forceVisible });

			if (repository.failObserve) {
				throw new Error("storage unavailable");
			}

			current = storedResolution({
				...current.broadcastDismissals.origins,
				[origin]: { fingerprint, dismissed: false },
			});
			return current.broadcastDismissals;
		},
		async dismiss(origin: string, fingerprint: string) {
			repository.dismissed.push({ origin, fingerprint });

			if (repository.failDismiss) {
				throw new Error("storage unavailable");
			}

			current = storedResolution({
				...current.broadcastDismissals.origins,
				[origin]: { fingerprint, dismissed: true },
			});
			return current.broadcastDismissals;
		},
		subscribe(
			listener: (resolution: BroadcastDismissalsResolution) => void,
			signal: AbortSignal,
		) {
			listeners.add(listener);
			signal.addEventListener("abort", () => listeners.delete(listener), {
				once: true,
			});
		},
		emit(resolution: BroadcastDismissalsResolution) {
			current = resolution;
			for (const listener of listeners) {
				listener(resolution);
			}
		},
	};

	return repository;
}

function startFeature(
	testWindow: Window,
	repository: BroadcastDismissalsRepository,
	hashContent: (content: string) => Promise<string> = async (content) =>
		content.includes("v2") ? FINGERPRINT_B : FINGERPRINT_A,
	reportError: (error: unknown) => void = () => {},
): AbortController {
	const controller = new AbortController();
	activateFeatureRuntime(
		asBrowserWindow(testWindow),
		[createDismissBroadcastBannerFeature(repository, hashContent, reportError)],
		controller.signal,
	);
	return controller;
}

function getBanner(testWindow: Window): HappyHTMLElement {
	return testWindow.document.querySelector(
		BROADCAST_BANNER_SELECTOR,
	) as HappyHTMLElement;
}

function getDismissButton(testWindow: Window): HappyHTMLButtonElement | null {
	return testWindow.document.querySelector(
		`[${BROADCAST_DISMISS_CONTROL_ATTRIBUTE}]`,
	) as HappyHTMLButtonElement | null;
}

function userClick(
	testWindow: Window,
	button: HappyHTMLButtonElement | null,
): void {
	expect(button).not.toBeNull();
	const event = new testWindow.Event("click", {
		bubbles: true,
		cancelable: true,
	});

	Object.defineProperty(event, "isTrusted", { value: true });
	button?.dispatchEvent(event);
}

function serializeTestBroadcastContent(messageText: HappyHTMLElement): string {
	return serializeBroadcastContent(messageText as unknown as HTMLElement);
}

afterEach(() => {
	closeGitLabTestWindows();
});

describe("dismiss broadcast banner", () => {
	for (const version of ["18", "19"] as const) {
		test(`injects the native-shaped accessible control for GitLab ${version}`, async () => {
			const testWindow = createGitLabTestWindow(
				await readBroadcastBannerFixture(version, "non-dismissible"),
			);
			const repository = createRepository();
			const controller = startFeature(testWindow, repository);
			await settleGitLabDom(testWindow);

			const button = getDismissButton(testWindow);
			expect(button).not.toBeNull();
			expect(button?.type).toBe("button");
			expect(button?.getAttribute("aria-label")).toBe("Close");
			expect(button?.className).toBe(
				"gl-button btn btn-icon btn-sm btn-default btn-default-tertiary gl-broadcast-message-dismiss",
			);
			expect(
				button?.classList.contains("js-dismiss-current-broadcast-notification"),
			).toBeFalse();
			expect(button?.hasAttribute("data-id")).toBeFalse();
			expect(button?.hasAttribute("data-cookie-key")).toBeFalse();
			expect(button?.querySelector("use")?.getAttribute("href")).toBe(
				"/assets/icons-synthetic.svg#close",
			);
			expect(repository.observed).toEqual([
				{
					origin: "https://gitlab.com",
					fingerprint: FINGERPRINT_A,
					forceVisible: false,
				},
			]);

			controller.abort();
			expect(getDismissButton(testWindow)).toBeNull();
		});

		test(`leaves GitLab ${version} native dismissal entirely untouched`, async () => {
			const testWindow = createGitLabTestWindow(
				await readBroadcastBannerFixture(version, "native-dismissible"),
			);
			const nativeButton = testWindow.document.querySelector(
				".js-dismiss-current-broadcast-notification",
			);
			const originalMarkup = nativeButton?.outerHTML;
			const repository = createRepository();
			const controller = startFeature(testWindow, repository);
			await settleGitLabDom(testWindow);

			expect(getDismissButton(testWindow)).toBeNull();
			expect(nativeButton?.outerHTML).toBe(originalMarkup);
			expect(repository.readCount).toBe(0);
			expect(repository.observed).toEqual([]);

			controller.abort();
		});
	}

	test("uses a stable SHA-256 fingerprint", async () => {
		const content = JSON.stringify({
			text: "Hello world Help",
			links: ["https://gitlab.com/help"],
		});

		expect(await hashBroadcastContent(content)).toMatch(/^[0-9a-f]{64}$/);
		expect(await hashBroadcastContent(content)).toBe(
			await hashBroadcastContent(content),
		);
	});

	test("fingerprints the canonical semantic message tree", async () => {
		const testWindow = createGitLabTestWindow(
			await readBroadcastBannerFixture("19", "non-dismissible"),
		);
		const messageText = testWindow.document.querySelector(
			BROADCAST_MESSAGE_TEXT_SELECTOR,
		) as HappyHTMLElement;
		let hashedContent: string | undefined;
		const controller = startFeature(
			testWindow,
			createRepository(),
			async (content) => {
				hashedContent = content;
				return FINGERPRINT_A;
			},
		);
		await settleGitLabDom(testWindow);

		expect(hashedContent).toBe(serializeTestBroadcastContent(messageText));
		expect(
			messageText.querySelector("[data-tonic-for-gitlab-broadcast-dismiss]"),
		).toBeNull();
		controller.abort();
	});

	test("ignores presentation-only message DOM changes", () => {
		const testWindow = createGitLabTestWindow(`
			<div class="gl-broadcast-message-text">
				<p class="before">Hello   world</p>
				<a data-v-app="first" href="/help">Help</a>
			</div>
		`);
		const messageText = testWindow.document.querySelector(
			BROADCAST_MESSAGE_TEXT_SELECTOR,
		) as HappyHTMLElement;
		const before = serializeTestBroadcastContent(messageText);

		messageText.querySelector("p")?.setAttribute("class", "after");
		messageText.querySelector("a")?.setAttribute("data-v-app", "second");
		messageText.prepend(testWindow.document.createTextNode("\n\t"));

		expect(serializeTestBroadcastContent(messageText)).toBe(before);
		messageText.querySelector("a")?.setAttribute("href", "/different");
		expect(serializeTestBroadcastContent(messageText)).not.toBe(before);
	});

	test("retains supported message structure and media targets", () => {
		const testWindow = createGitLabTestWindow(`
			<div class="gl-broadcast-message-text">
				<p>Deploy<br>at 10:00</p>
				<img src="/maintenance.png" alt="Maintenance">
			</div>
		`);
		const messageText = testWindow.document.querySelector(
			BROADCAST_MESSAGE_TEXT_SELECTOR,
		) as HappyHTMLElement;
		const before = serializeTestBroadcastContent(messageText);

		messageText.querySelector("br")?.remove();
		const withoutBreak = serializeTestBroadcastContent(messageText);
		expect(withoutBreak).not.toBe(before);

		messageText.querySelector("img")?.setAttribute("src", "/restored.png");
		expect(serializeTestBroadcastContent(messageText)).not.toBe(withoutBreak);
	});

	test("keeps relative link identity stable across page paths", () => {
		const markup = `
			<div class="gl-broadcast-message-text">
				<a href="details">Maintenance details</a>
			</div>
		`;
		const projectWindow = createGitLabTestWindow(
			markup,
			"https://gitlab.example/group/project/-/merge_requests",
		);
		const helpWindow = createGitLabTestWindow(
			markup,
			"https://gitlab.example/help",
		);
		const projectMessage = projectWindow.document.querySelector(
			BROADCAST_MESSAGE_TEXT_SELECTOR,
		) as HappyHTMLElement;
		const helpMessage = helpWindow.document.querySelector(
			BROADCAST_MESSAGE_TEXT_SELECTOR,
		) as HappyHTMLElement;

		expect(serializeTestBroadcastContent(projectMessage)).toBe(
			serializeTestBroadcastContent(helpMessage),
		);
	});

	test("excludes GitLab's localized service heading from message identity", () => {
		const testWindow = createGitLabTestWindow(`
			<div class="gl-broadcast-message-text">
				<h2 class="gl-sr-only">Admin message</h2>
				<p>Maintenance at 10:00</p>
			</div>
		`);
		const messageText = testWindow.document.querySelector(
			BROADCAST_MESSAGE_TEXT_SELECTOR,
		) as HappyHTMLElement;
		const before = serializeTestBroadcastContent(messageText);

		const heading = messageText.querySelector("h2");
		if (heading) {
			heading.textContent = "Nachricht des Administrators";
		}

		expect(serializeTestBroadcastContent(messageText)).toBe(before);
	});

	test("finishes hashing after an unrelated mutation inside the same banner", async () => {
		const testWindow = createGitLabTestWindow(
			await readBroadcastBannerFixture("19", "non-dismissible"),
		);
		let resolveFingerprint: ((fingerprint: string) => void) | undefined;
		const fingerprint = new Promise<string>((resolve) => {
			resolveFingerprint = resolve;
		});
		const repository = createRepository();
		const controller = startFeature(
			testWindow,
			repository,
			async () => fingerprint,
		);
		const unrelated = testWindow.document.createElement("span");
		unrelated.textContent = "Unrelated banner child";
		getBanner(testWindow).append(unrelated);
		await settleGitLabDom(testWindow);

		resolveFingerprint?.(FINGERPRINT_A);
		await settleGitLabDom(testWindow);

		expect(getDismissButton(testWindow)).not.toBeNull();
		expect(repository.observed).toHaveLength(1);
		controller.abort();
	});

	test("is a safe no-op for ambiguous banners and invalid sprite contracts", async () => {
		const fixture = await readBroadcastBannerFixture("19", "non-dismissible");
		const testWindow = createGitLabTestWindow(`${fixture}${fixture}`);
		const repository = createRepository();
		const controller = startFeature(testWindow, repository);
		await settleGitLabDom(testWindow);

		expect(getDismissButton(testWindow)).toBeNull();
		expect(repository.readCount).toBe(0);

		getBanner(testWindow).remove();
		const remainingUse = testWindow.document.querySelector(
			`${BROADCAST_BANNER_SELECTOR} [data-testid="bullhorn-icon"] use`,
		);
		remainingUse?.setAttribute(
			"href",
			"https://assets.example/icons.svg#bullhorn",
		);
		await settleGitLabDom(testWindow);

		expect(getDismissButton(testWindow)).toBeNull();
		expect(repository.readCount).toBe(0);
		controller.abort();
	});

	test("is a safe no-op for a notification surface", async () => {
		const testWindow = createGitLabTestWindow(
			'<div class="notification"><button aria-label="Close"></button></div>',
		);
		const repository = createRepository();
		const controller = startFeature(testWindow, repository);
		await settleGitLabDom(testWindow);

		expect(getDismissButton(testWindow)).toBeNull();
		expect(repository.readCount).toBe(0);
		controller.abort();
	});

	test("restores a matching dismissed banner and reverses owned DOM on abort", async () => {
		const testWindow = createGitLabTestWindow(
			await readBroadcastBannerFixture("19", "non-dismissible"),
		);
		const repository = createRepository(
			storedResolution({
				"https://gitlab.com": {
					fingerprint: FINGERPRINT_A,
					dismissed: true,
				},
			}),
		);
		const controller = startFeature(testWindow, repository);
		await settleGitLabDom(testWindow);

		const banner = getBanner(testWindow);
		expect(banner.hidden).toBeTrue();
		expect(banner.hasAttribute(BROADCAST_HIDDEN_ATTRIBUTE)).toBeTrue();
		expect(repository.observed).toEqual([]);

		controller.abort();
		expect(banner.hidden).toBeFalse();
		expect(banner.hasAttribute(BROADCAST_HIDDEN_ATTRIBUTE)).toBeFalse();
		expect(getDismissButton(testWindow)).toBeNull();
	});

	test("persists dismissal before hiding and fails open on a rejected write", async () => {
		const testWindow = createGitLabTestWindow(
			await readBroadcastBannerFixture("19", "non-dismissible"),
		);
		const repository = createRepository();
		repository.failDismiss = true;
		const errors: unknown[] = [];
		const controller = startFeature(
			testWindow,
			repository,
			undefined,
			(error) => errors.push(error),
		);
		await settleGitLabDom(testWindow);

		const banner = getBanner(testWindow);
		const button = getDismissButton(testWindow) as HappyHTMLButtonElement;
		userClick(testWindow, button);
		expect(banner.hidden).toBeFalse();
		await settleGitLabDom(testWindow);

		expect(repository.dismissed).toHaveLength(1);
		expect(banner.hidden).toBeFalse();
		expect(button.disabled).toBeFalse();
		expect(errors).toHaveLength(1);

		repository.failDismiss = false;
		userClick(testWindow, button);
		expect(banner.hidden).toBeFalse();
		await settleGitLabDom(testWindow);
		expect(banner.hidden).toBeTrue();
		controller.abort();
	});

	test("refuses a click synthesized by GitLab page script", async () => {
		const testWindow = createGitLabTestWindow(
			await readBroadcastBannerFixture("19", "non-dismissible"),
		);
		const repository = createRepository();
		const controller = startFeature(testWindow, repository);
		await settleGitLabDom(testWindow);

		const banner = getBanner(testWindow);
		const button = getDismissButton(testWindow) as HappyHTMLButtonElement;
		button.click();
		await settleGitLabDom(testWindow);

		expect(repository.dismissed).toEqual([]);
		expect(banner.hidden).toBeFalse();
		expect(button.disabled).toBeFalse();
		controller.abort();
	});

	test("completes dismissal after a same-content reconcile and re-enables its control", async () => {
		const testWindow = createGitLabTestWindow(
			await readBroadcastBannerFixture("19", "non-dismissible"),
		);
		const repository = createRepository();
		let resolveDismiss:
			| ((broadcastDismissals: TonicBroadcastDismissals) => void)
			| undefined;
		repository.dismiss = async (origin, fingerprint) => {
			repository.dismissed.push({ origin, fingerprint });
			return new Promise<TonicBroadcastDismissals>((resolve) => {
				resolveDismiss = resolve;
			});
		};
		const controller = startFeature(testWindow, repository);
		await settleGitLabDom(testWindow);

		const button = getDismissButton(testWindow) as HappyHTMLButtonElement;
		userClick(testWindow, button);
		expect(button.disabled).toBeTrue();
		testWindow.document
			.querySelector(BROADCAST_MESSAGE_TEXT_SELECTOR)
			?.append(testWindow.document.createTextNode("\n\t"));
		await settleGitLabDom(testWindow);

		resolveDismiss?.(
			storedResolution({
				"https://gitlab.com": {
					fingerprint: FINGERPRINT_A,
					dismissed: true,
				},
			}).broadcastDismissals,
		);
		await settleGitLabDom(testWindow);

		expect(getBanner(testWindow).hidden).toBeTrue();
		expect(button.disabled).toBeFalse();
		expect(repository.observed).toHaveLength(1);
		repository.emit(
			storedResolution({
				"https://gitlab.com": {
					fingerprint: FINGERPRINT_B,
					dismissed: false,
				},
			}),
		);
		expect(getBanner(testWindow).hidden).toBeFalse();
		expect(button.disabled).toBeFalse();
		controller.abort();
	});

	test("shows and records every DOM content transition, including an A to B to A cycle", async () => {
		const testWindow = createGitLabTestWindow(
			await readBroadcastBannerFixture("19", "non-dismissible"),
		);
		const repository = createRepository();
		const controller = startFeature(testWindow, repository);
		await settleGitLabDom(testWindow);

		const text = testWindow.document.querySelector(
			BROADCAST_MESSAGE_TEXT_SELECTOR,
		) as HappyHTMLElement;
		const originalContent = text.innerHTML;
		text.innerHTML = "<p>Tonic broadcast probe v2</p>";
		await settleGitLabDom(testWindow);
		text.innerHTML = originalContent;
		await settleGitLabDom(testWindow);

		expect(
			repository.observed.map(({ fingerprint, forceVisible }) => ({
				fingerprint,
				forceVisible,
			})),
		).toEqual([
			{ fingerprint: FINGERPRINT_A, forceVisible: false },
			{ fingerprint: FINGERPRINT_B, forceVisible: true },
			{ fingerprint: FINGERPRINT_A, forceVisible: true },
		]);
		expect(getBanner(testWindow).hidden).toBeFalse();
		controller.abort();
	});

	test("applies storage changes to visibility without writing from the subscriber", async () => {
		const testWindow = createGitLabTestWindow(
			await readBroadcastBannerFixture("19", "non-dismissible"),
		);
		const repository = createRepository();
		const controller = startFeature(testWindow, repository);
		await settleGitLabDom(testWindow);
		expect(repository.observed).toHaveLength(1);

		repository.emit(
			storedResolution({
				"https://gitlab.com": {
					fingerprint: FINGERPRINT_A,
					dismissed: true,
				},
			}),
		);
		expect(getBanner(testWindow).hidden).toBeTrue();
		repository.emit(
			storedResolution({
				"https://gitlab.com": {
					fingerprint: FINGERPRINT_B,
					dismissed: true,
				},
			}),
		);

		expect(getBanner(testWindow).hidden).toBeFalse();
		expect(repository.observed).toHaveLength(1);
		controller.abort();
	});

	test("does not let a late initial read overwrite a storage change", async () => {
		const testWindow = createGitLabTestWindow(
			await readBroadcastBannerFixture("19", "non-dismissible"),
		);
		const repository = createRepository();
		let resolveRead:
			| ((resolution: BroadcastDismissalsResolution) => void)
			| undefined;
		repository.read = async () =>
			new Promise<BroadcastDismissalsResolution>((resolve) => {
				resolveRead = resolve;
			});
		const controller = startFeature(testWindow, repository);
		await settleGitLabDom(testWindow);

		repository.emit(
			storedResolution({
				"https://gitlab.com": {
					fingerprint: FINGERPRINT_A,
					dismissed: true,
				},
			}),
		);
		resolveRead?.(storedResolution());
		await settleGitLabDom(testWindow);

		expect(getBanner(testWindow).hidden).toBeTrue();
		controller.abort();
	});

	test("moves ownership to a replaced banner without duplicating state", async () => {
		const fixture = await readBroadcastBannerFixture("19", "non-dismissible");
		const testWindow = createGitLabTestWindow(fixture);
		const repository = createRepository();
		const controller = startFeature(testWindow, repository);
		await settleGitLabDom(testWindow);
		const firstButton = getDismissButton(testWindow);

		const replacementWindow = createGitLabTestWindow(fixture);
		const replacement = replacementWindow.document
			.querySelector(BROADCAST_BANNER_SELECTOR)
			?.cloneNode(true);

		if (!replacement) {
			throw new Error("Broadcast fixture has no banner");
		}

		getBanner(testWindow).replaceWith(replacement);
		await settleGitLabDom(testWindow);

		expect(firstButton?.isConnected).toBeFalse();
		expect(
			firstButton?.hasAttribute(BROADCAST_DISMISS_CONTROL_ATTRIBUTE),
		).toBeFalse();
		expect(
			testWindow.document.querySelectorAll(
				`[${BROADCAST_DISMISS_CONTROL_ATTRIBUTE}]`,
			),
		).toHaveLength(1);
		expect(repository.observed).toHaveLength(1);
		controller.abort();
	});

	test("reclaims its surviving control marker without creating a duplicate", async () => {
		const testWindow = createGitLabTestWindow(
			await readBroadcastBannerFixture("19", "non-dismissible"),
		);
		const repository = createRepository();
		const controller = startFeature(testWindow, repository);
		await settleGitLabDom(testWindow);
		const button = getDismissButton(testWindow) as HappyHTMLButtonElement;

		button.removeAttribute(BROADCAST_DISMISS_CONTROL_ATTRIBUTE);
		getBanner(testWindow).append(testWindow.document.createTextNode("\n"));
		await settleGitLabDom(testWindow);

		expect(getDismissButton(testWindow)).toBe(button);
		expect(
			testWindow.document.querySelectorAll(
				`[${BROADCAST_DISMISS_CONTROL_ATTRIBUTE}]`,
			),
		).toHaveLength(1);
		controller.abort();
	});

	test("fails open and injects no broken control when hashing fails", async () => {
		const testWindow = createGitLabTestWindow(
			await readBroadcastBannerFixture("19", "non-dismissible"),
		);
		const repository = createRepository();
		const errors: unknown[] = [];
		const controller = startFeature(
			testWindow,
			repository,
			async () => {
				throw new Error("crypto unavailable");
			},
			(error) => errors.push(error),
		);
		await settleGitLabDom(testWindow);

		expect(getBanner(testWindow).hidden).toBeFalse();
		expect(getDismissButton(testWindow)).toBeNull();
		expect(repository.readCount).toBe(0);
		expect(errors).toHaveLength(1);
		controller.abort();
	});

	test("keeps the message visible when the initial storage read fails", async () => {
		const testWindow = createGitLabTestWindow(
			await readBroadcastBannerFixture("19", "non-dismissible"),
		);
		const repository = createRepository();
		repository.read = async () => {
			repository.readCount += 1;
			throw new Error("storage unavailable");
		};
		const errors: unknown[] = [];
		const controller = startFeature(
			testWindow,
			repository,
			undefined,
			(error) => errors.push(error),
		);
		await settleGitLabDom(testWindow);

		expect(getBanner(testWindow).hidden).toBeFalse();
		expect(getDismissButton(testWindow)).not.toBeNull();
		expect(repository.observed).toEqual([]);
		expect(errors).toHaveLength(1);
		controller.abort();
	});

	test("keeps new content visible when recording its state fails", async () => {
		const testWindow = createGitLabTestWindow(
			await readBroadcastBannerFixture("19", "non-dismissible"),
		);
		const repository = createRepository();
		repository.failObserve = true;
		const errors: unknown[] = [];
		const controller = startFeature(
			testWindow,
			repository,
			undefined,
			(error) => errors.push(error),
		);
		await settleGitLabDom(testWindow);

		expect(getBanner(testWindow).hidden).toBeFalse();
		expect(getDismissButton(testWindow)).not.toBeNull();
		expect(repository.observed).toHaveLength(1);
		expect(errors).toHaveLength(1);
		controller.abort();
	});

	test("removes Tonic state if GitLab later renders a native control", async () => {
		const testWindow = createGitLabTestWindow(
			await readBroadcastBannerFixture("19", "non-dismissible"),
		);
		const repository = createRepository();
		const controller = startFeature(testWindow, repository);
		await settleGitLabDom(testWindow);
		expect(getDismissButton(testWindow)).not.toBeNull();

		const nativeButton = testWindow.document.createElement("button");
		nativeButton.className = "js-dismiss-current-broadcast-notification";
		getBanner(testWindow).append(nativeButton);
		await settleGitLabDom(testWindow);

		expect(getDismissButton(testWindow)).toBeNull();
		expect(nativeButton.isConnected).toBeTrue();
		controller.abort();
	});
});
