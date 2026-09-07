import type {
	Feature,
	FeatureContext,
} from "../../content/runtime/feature-context";
import { createOwnedAttributeRegistry } from "../../content/runtime/owned-attributes";
import { isTargetOrigin } from "../../host-access/target-origin";
import {
	hashBroadcastContent,
	isSha256Fingerprint,
	MAX_BROADCAST_CONTENT_LENGTH,
} from "./broadcast-content-hash";
import type {
	BroadcastDismissalsRepository,
	BroadcastDismissalsResolution,
	TonicBroadcastDismissals,
} from "./broadcast-dismissals-repository";
import {
	BROADCAST_BANNER_SELECTOR,
	BROADCAST_BULLHORN_USE_SELECTOR,
	BROADCAST_DISMISS_CONTROL_ATTRIBUTE,
	BROADCAST_HIDDEN_ATTRIBUTE,
	BROADCAST_MESSAGE_TEXT_SELECTOR,
	NATIVE_BROADCAST_DISMISS_SELECTOR,
} from "./selectors";

export const DISMISS_BROADCAST_BANNER_ID = "dismiss-broadcast-banner";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const EMPTY_BROADCAST_CONTENT = "[]";
const COLLAPSIBLE_WHITESPACE_PATTERN = /[\t\n\f\r ]+/gu;
const SEMANTIC_ATTRIBUTE_NAMES = [
	"alt",
	"aria-label",
	"datetime",
	"href",
	"src",
	"title",
] as const;
// GitLab exposes no localized label when it does not render its native control.
const DISMISS_LABEL = "Close";
const ownedAttributes = createOwnedAttributeRegistry();
const activeStates = new WeakMap<AbortSignal, ActiveState>();

interface BroadcastContract {
	banner: HTMLElement;
	closeIconHref: string;
	content: string;
}

interface HiddenBannerState {
	banner: HTMLElement;
	hadHiddenAttribute: boolean;
}

interface CanonicalBroadcastElement {
	type: "element";
	name: string;
	attributes: [string, string][];
	children: CanonicalBroadcastNode[];
}

interface CanonicalBroadcastText {
	type: "text";
	value: string;
}

type CanonicalBroadcastNode =
	| CanonicalBroadcastElement
	| CanonicalBroadcastText;

interface ActiveState {
	context: FeatureContext;
	signal: AbortSignal;
	repository: BroadcastDismissalsRepository;
	hashContent(content: string): Promise<string>;
	reportError(error: unknown): void;
	contract?: BroadcastContract;
	currentFingerprint?: string;
	lastObservedContent?: string;
	observationId: number;
	persistAttemptedObservation?: number;
	forceVisible: boolean;
	forceObservationWrite: boolean;
	buttons: Set<HTMLButtonElement>;
	hidden?: HiddenBannerState;
	storageController?: AbortController;
	storageReady: boolean;
	storageVersion: number;
	resolution?: BroadcastDismissalsResolution;
}

function hasCurrentContract(
	state: ActiveState,
	contract: BroadcastContract,
): boolean {
	return (
		state.contract?.banner === contract.banner &&
		state.contract.content === contract.content
	);
}

function queryUniqueElement<T extends Element>(
	root: ParentNode,
	selector: string,
): T | undefined {
	const elements = root.querySelectorAll<T>(selector);
	return elements.length === 1 ? elements[0] : undefined;
}

function resolveCloseIconHref(
	context: FeatureContext,
	banner: HTMLElement,
): string | undefined {
	const iconUse = queryUniqueElement<SVGUseElement>(
		banner,
		BROADCAST_BULLHORN_USE_SELECTOR,
	);
	const href = iconUse?.getAttribute("href");

	if (!href?.endsWith("#bullhorn")) {
		return undefined;
	}

	let spriteUrl: URL;

	try {
		spriteUrl = new URL(href, context.location.href);
	} catch {
		return undefined;
	}

	if (
		spriteUrl.origin !== context.location.origin ||
		spriteUrl.hash !== "#bullhorn" ||
		!spriteUrl.pathname.endsWith(".svg")
	) {
		return undefined;
	}

	return `${href.slice(0, -"#bullhorn".length)}#close`;
}

function resolveBroadcastContract(
	context: FeatureContext,
	state: ActiveState,
): BroadcastContract | undefined {
	const banner = queryUniqueElement<HTMLElement>(
		context.document,
		BROADCAST_BANNER_SELECTOR,
	);

	const hasNativeDismissControl = banner
		? [...banner.querySelectorAll(NATIVE_BROADCAST_DISMISS_SELECTOR)].some(
				(control) => !state.buttons.has(control as HTMLButtonElement),
			)
		: false;

	if (
		!banner ||
		hasNativeDismissControl ||
		(banner.hidden && state.hidden?.banner !== banner)
	) {
		return undefined;
	}

	const messageText = queryUniqueElement<HTMLElement>(
		banner,
		BROADCAST_MESSAGE_TEXT_SELECTOR,
	);
	const closeIconHref = resolveCloseIconHref(context, banner);

	if (!messageText || !closeIconHref) {
		return undefined;
	}

	const content = serializeBroadcastContent(messageText);

	if (
		content === EMPTY_BROADCAST_CONTENT ||
		content.length > MAX_BROADCAST_CONTENT_LENGTH
	) {
		return undefined;
	}

	return { banner, closeIconHref, content };
}

function normalizeVisibleText(value: string): string | undefined {
	const normalized = value.replace(COLLAPSIBLE_WHITESPACE_PATTERN, " ");
	return normalized.trim().length === 0 ? undefined : normalized;
}

function normalizeSemanticAttribute(value: string): string {
	return value.replace(COLLAPSIBLE_WHITESPACE_PATTERN, " ").trim();
}

function canonicalizeBroadcastNode(
	node: Node,
	messageText: HTMLElement,
): CanonicalBroadcastNode | undefined {
	if (node.nodeType === 3) {
		const value = normalizeVisibleText(node.textContent ?? "");
		return value ? { type: "text", value } : undefined;
	}

	if (node.nodeType !== 1) {
		return undefined;
	}

	const element = node as Element;
	if (
		element.parentElement === messageText &&
		element.localName === "h2" &&
		element.classList.contains("gl-sr-only")
	) {
		return undefined;
	}

	const attributeNames =
		element.localName === "gl-emoji"
			? [...SEMANTIC_ATTRIBUTE_NAMES, "data-name"]
			: SEMANTIC_ATTRIBUTE_NAMES;
	const attributes: [string, string][] = [];

	for (const name of attributeNames) {
		const value = element.getAttribute(name);
		if (value !== null) {
			attributes.push([name, normalizeSemanticAttribute(value)]);
		}
	}

	const children: CanonicalBroadcastNode[] = [];
	for (const child of element.childNodes) {
		const canonicalChild = canonicalizeBroadcastNode(child, messageText);
		if (canonicalChild) {
			children.push(canonicalChild);
		}
	}

	return {
		type: "element",
		name: element.localName,
		attributes,
		children,
	};
}

/** Retains message semantics while ignoring host presentation and hydration churn. */
export function serializeBroadcastContent(messageText: HTMLElement): string {
	const nodes: CanonicalBroadcastNode[] = [];

	for (const child of messageText.childNodes) {
		const canonicalChild = canonicalizeBroadcastNode(child, messageText);
		if (canonicalChild) {
			nodes.push(canonicalChild);
		}
	}

	return JSON.stringify(nodes);
}

function restoreHiddenBanner(state: ActiveState): void {
	const hidden = state.hidden;

	if (!hidden) {
		return;
	}

	if (hidden.banner.hasAttribute(BROADCAST_HIDDEN_ATTRIBUTE)) {
		if (hidden.hadHiddenAttribute) {
			hidden.banner.setAttribute("hidden", "");
		} else {
			hidden.banner.removeAttribute("hidden");
		}
	}

	ownedAttributes
		.forSignal(state.signal)
		.set(hidden.banner, BROADCAST_HIDDEN_ATTRIBUTE, false);
	state.hidden = undefined;
}

function showBanner(state: ActiveState): void {
	restoreHiddenBanner(state);
}

function hideBanner(state: ActiveState, banner: HTMLElement): void {
	if (state.hidden?.banner !== banner) {
		restoreHiddenBanner(state);
		state.hidden = {
			banner,
			hadHiddenAttribute: banner.hasAttribute("hidden"),
		};
		ownedAttributes
			.forSignal(state.signal)
			.set(banner, BROADCAST_HIDDEN_ATTRIBUTE, true);
	}

	banner.setAttribute("hidden", "");
}

function releaseButton(state: ActiveState, button: HTMLButtonElement): void {
	ownedAttributes
		.forSignal(state.signal)
		.set(button, BROADCAST_DISMISS_CONTROL_ATTRIBUTE, false);
	state.buttons.delete(button);
	button.remove();
}

function removeButtons(state: ActiveState): void {
	for (const button of [...state.buttons]) {
		releaseButton(state, button);
	}
}

function applyStoredVisibility(state: ActiveState): void {
	const { contract, currentFingerprint, resolution } = state;

	if (!contract || !currentFingerprint || state.forceVisible || !resolution) {
		showBanner(state);
		return;
	}

	const stored =
		resolution.broadcastDismissals.origins[state.context.location.origin];

	if (stored?.fingerprint === currentFingerprint && stored.dismissed === true) {
		hideBanner(state, contract.banner);
		return;
	}

	showBanner(state);
}

function resolutionFromStored(
	broadcastDismissals: TonicBroadcastDismissals,
): BroadcastDismissalsResolution {
	return {
		outcome: "stored",
		broadcastDismissals,
		dropped: [],
	};
}

function createDismissButton(state: ActiveState): void {
	const { contract, currentFingerprint } = state;

	if (!contract || !currentFingerprint) {
		return;
	}

	let ownedButton: HTMLButtonElement | undefined;
	for (const button of [...state.buttons]) {
		if (button.parentElement === contract.banner && !ownedButton) {
			ownedButton = button;
			continue;
		}

		releaseButton(state, button);
	}

	if (ownedButton) {
		ownedAttributes
			.forSignal(state.signal)
			.set(ownedButton, BROADCAST_DISMISS_CONTROL_ATTRIBUTE, true);
		return;
	}

	const existing = contract.banner.querySelector<HTMLButtonElement>(
		`[${BROADCAST_DISMISS_CONTROL_ATTRIBUTE}]`,
	);

	if (existing) {
		// A page-provided project marker is not proof that Tonic owns the node.
		return;
	}

	const button = state.context.document.createElement("button");
	const icon = state.context.document.createElementNS(SVG_NAMESPACE, "svg");
	const iconUse = state.context.document.createElementNS(SVG_NAMESPACE, "use");

	button.type = "button";
	button.className =
		"gl-button btn btn-icon btn-sm btn-default btn-default-tertiary gl-broadcast-message-dismiss";
	button.setAttribute("aria-label", DISMISS_LABEL);
	icon.setAttribute("class", "s16 gl-icon gl-button-icon");
	icon.setAttribute("aria-hidden", "true");
	iconUse.setAttribute("href", contract.closeIconHref);
	icon.append(iconUse);
	button.append(icon);
	contract.banner.append(button);
	state.buttons.add(button);
	ownedAttributes
		.forSignal(state.signal)
		.set(button, BROADCAST_DISMISS_CONTROL_ATTRIBUTE, true);

	button.addEventListener(
		"click",
		(event) => {
			/* GitLab page script can reach this light-DOM control and synthesize clicks. */
			if (!event.isTrusted) {
				return;
			}

			const fingerprint = state.currentFingerprint;
			const currentContract = state.contract;

			if (
				!fingerprint ||
				!currentContract ||
				currentContract.banner !== button.parentElement
			) {
				return;
			}

			button.disabled = true;
			const storageVersion = state.storageVersion;

			void state.repository
				.dismiss(state.context.location.origin, fingerprint)
				.then((broadcastDismissals) => {
					if (
						state.signal.aborted ||
						state.currentFingerprint !== fingerprint ||
						!hasCurrentContract(state, currentContract)
					) {
						return;
					}

					button.disabled = false;
					state.storageReady = true;
					state.forceVisible = false;
					state.forceObservationWrite = false;

					if (state.storageVersion === storageVersion) {
						state.resolution = resolutionFromStored(broadcastDismissals);
					}

					applyStoredVisibility(state);
				})
				.catch((error: unknown) => {
					if (!state.signal.aborted) {
						if (
							state.currentFingerprint === fingerprint &&
							hasCurrentContract(state, currentContract)
						) {
							button.disabled = false;
							showBanner(state);
						}

						state.reportError(error);
					}
				});
		},
		{ signal: state.signal },
	);
}

function persistObservedContent(state: ActiveState): void {
	if (
		!state.storageReady ||
		!state.resolution ||
		!state.currentFingerprint ||
		!state.contract ||
		state.resolution.outcome === "newer-schema"
	) {
		applyStoredVisibility(state);
		return;
	}

	const fingerprint = state.currentFingerprint;
	const stored =
		state.resolution.broadcastDismissals.origins[state.context.location.origin];
	const shouldPersist =
		state.forceVisible || stored?.fingerprint !== fingerprint;

	if (!shouldPersist) {
		createDismissButton(state);
		applyStoredVisibility(state);
		return;
	}

	state.forceVisible = true;
	createDismissButton(state);
	showBanner(state);

	if (state.persistAttemptedObservation === state.observationId) {
		return;
	}

	state.persistAttemptedObservation = state.observationId;
	const observationId = state.observationId;
	const storageVersion = state.storageVersion;

	void state.repository
		.observe(
			state.context.location.origin,
			fingerprint,
			state.forceObservationWrite,
		)
		.then((broadcastDismissals) => {
			if (
				state.signal.aborted ||
				state.observationId !== observationId ||
				state.currentFingerprint !== fingerprint
			) {
				return;
			}

			state.forceVisible = false;
			state.forceObservationWrite = false;

			if (state.storageVersion === storageVersion) {
				state.resolution = resolutionFromStored(broadcastDismissals);
			}

			applyStoredVisibility(state);
		})
		.catch((error: unknown) => {
			if (!state.signal.aborted && state.observationId === observationId) {
				showBanner(state);
				state.reportError(error);
			}
		});
}

function startStorage(state: ActiveState): void {
	if (state.storageController || state.signal.aborted) {
		return;
	}

	const controller = new AbortController();
	const storageVersion = state.storageVersion;
	state.storageController = controller;
	state.storageReady = false;

	state.repository.subscribe((resolution) => {
		if (state.signal.aborted || controller.signal.aborted) {
			return;
		}

		state.storageReady = true;
		state.storageVersion += 1;
		state.resolution = resolution;
		// Storage changes update visibility only. They never produce a write.
		applyStoredVisibility(state);
	}, controller.signal);

	void state.repository
		.read()
		.then((resolution) => {
			if (state.signal.aborted || controller.signal.aborted) {
				return;
			}

			if (state.storageVersion === storageVersion) {
				state.resolution = resolution;
			}

			state.storageReady = true;
			persistObservedContent(state);
		})
		.catch((error: unknown) => {
			if (!state.signal.aborted && !controller.signal.aborted) {
				showBanner(state);
				state.reportError(error);
			}
		});
}

function stopStorage(state: ActiveState): void {
	state.storageController?.abort();
	state.storageController = undefined;
	state.storageReady = false;
	state.resolution = undefined;
}

function clearContract(state: ActiveState): void {
	state.observationId += 1;
	state.contract = undefined;
	state.currentFingerprint = undefined;
	state.persistAttemptedObservation = undefined;
	state.forceVisible = false;
	state.forceObservationWrite = false;
	removeButtons(state);
	restoreHiddenBanner(state);
	stopStorage(state);
}

function reconcileBroadcast(state: ActiveState): void {
	if (state.signal.aborted) {
		return;
	}

	const contract = resolveBroadcastContract(state.context, state);

	if (!contract) {
		clearContract(state);
		return;
	}

	if (
		state.contract?.banner === contract.banner &&
		state.contract.content === contract.content
	) {
		state.contract = contract;
		createDismissButton(state);
		applyStoredVisibility(state);
		return;
	}

	removeButtons(state);
	restoreHiddenBanner(state);
	state.observationId += 1;
	const observationId = state.observationId;
	const contentChanged =
		state.lastObservedContent !== undefined &&
		state.lastObservedContent !== contract.content;
	state.lastObservedContent = contract.content;
	state.contract = contract;
	state.currentFingerprint = undefined;
	state.persistAttemptedObservation = undefined;
	state.forceVisible = contentChanged;
	state.forceObservationWrite = contentChanged;
	showBanner(state);

	void state
		.hashContent(contract.content)
		.then((fingerprint) => {
			if (
				state.signal.aborted ||
				state.observationId !== observationId ||
				!hasCurrentContract(state, contract)
			) {
				return;
			}

			if (!isSha256Fingerprint(fingerprint)) {
				throw new TypeError("Broadcast content fingerprint is invalid");
			}

			state.currentFingerprint = fingerprint;
			createDismissButton(state);
			startStorage(state);

			if (state.storageReady) {
				persistObservedContent(state);
			}
		})
		.catch((error: unknown) => {
			if (!state.signal.aborted && state.observationId === observationId) {
				state.currentFingerprint = undefined;
				removeButtons(state);
				showBanner(state);
				stopStorage(state);
				state.reportError(error);
			}
		});
}

export function createDismissBroadcastBannerFeature(
	repository: BroadcastDismissalsRepository,
	hashContent: (content: string) => Promise<string> = hashBroadcastContent,
	reportError: (error: unknown) => void = (error) => {
		console.error("Tonic broadcast dismissal failed", error);
	},
): Feature {
	return {
		id: DISMISS_BROADCAST_BANNER_ID,
		mutationSelectors: [BROADCAST_BANNER_SELECTOR],
		matches({ location }) {
			return isTargetOrigin(location.origin);
		},
		activate(context, signal) {
			if (signal.aborted || activeStates.has(signal)) {
				return;
			}

			const state: ActiveState = {
				context,
				signal,
				repository,
				hashContent,
				reportError,
				observationId: 0,
				forceVisible: false,
				forceObservationWrite: false,
				buttons: new Set(),
				storageReady: false,
				storageVersion: 0,
			};
			activeStates.set(signal, state);
			signal.addEventListener(
				"abort",
				() => {
					removeButtons(state);
					restoreHiddenBanner(state);
					stopStorage(state);
					activeStates.delete(signal);
				},
				{ once: true },
			);
			reconcileBroadcast(state);
		},
		reconcile(_context, signal) {
			const state = activeStates.get(signal);

			if (state) {
				reconcileBroadcast(state);
			}
		},
	};
}
