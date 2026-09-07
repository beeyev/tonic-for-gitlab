import type {
	Feature,
	FeatureContext,
	FeaturePageCompatibility,
} from "../../content/runtime/feature-context";
import { isMergeRequestDetailPath } from "../../content/runtime/page-context";
import {
	COPY_MERGE_REQUEST_LINK_ATTRIBUTE,
	COPY_MERGE_REQUEST_LINK_STATUS_ATTRIBUTE,
	MERGE_REQUEST_ACTIONS_ICON_SELECTOR,
	MERGE_REQUEST_ACTIONS_SELECTOR,
	MERGE_REQUEST_CODE_CONTROL_SELECTOR,
	MERGE_REQUEST_CODE_ICON_SELECTOR,
	MERGE_REQUEST_HEADER_ACTIONS_SELECTOR,
} from "./selectors";

export const COPY_MERGE_REQUEST_LINK_ID = "copy-merge-request-link";

const LABEL = "Copy merge request link";
const COPIED_LABEL = "Merge request link copied";
const COPY_FAILED_LABEL = "Could not copy merge request link";
const FEEDBACK_DURATION_MS = 2_000;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const FEEDBACK_ICON_FRAGMENTS = {
	idle: "#copy-to-clipboard",
	success: "#check",
	failure: "#error",
} as const;
const BASE_BUTTON_CLASSES = [
	"gl-button",
	"btn",
	"btn-md",
	"btn-default",
	"btn-icon",
] as const;
const MORE_ACTION_BUTTON_CLASSES = [
	...BASE_BUTTON_CLASSES,
	"btn-default-tertiary",
	"gl-self-start",
] as const;
const STANDALONE_BUTTON_CLASSES = [...BASE_BUTTON_CLASSES, "gl-h-fit"] as const;

interface MergeRequestHeaderContract {
	actions: HTMLElement;
	codeContainer: HTMLElement;
	iconHref: string;
	insertionAnchor: Element | null;
	moreActions?: HTMLElement;
}

interface MountedButton {
	button: HTMLButtonElement;
	icon: SVGSVGElement;
	status: HTMLSpanElement;
	use: SVGUseElement;
	copyIconHref: string | undefined;
	feedback: keyof typeof FEEDBACK_ICON_FRAGMENTS;
	feedbackTimeout: number | undefined;
	copyAttempt: number;
}

type HeaderResolution =
	| { status: "supported"; contract: MergeRequestHeaderContract }
	| { status: "unsupported" };

const buttonsBySignal = new WeakMap<AbortSignal, MountedButton>();
const ownedButtons = new WeakSet<HTMLButtonElement>();

export function buildMergeRequestLink(location: Location): string | undefined {
	let current: URL;

	try {
		current = new URL(location.href);
	} catch {
		return undefined;
	}

	if (
		(current.protocol !== "https:" && current.protocol !== "http:") ||
		current.username !== "" ||
		current.password !== ""
	) {
		return undefined;
	}

	const marker = "/-/merge_requests/";
	const markerIndex = current.pathname.indexOf(marker);

	if (
		markerIndex <= 0 ||
		current.pathname.lastIndexOf(marker) !== markerIndex
	) {
		return undefined;
	}

	const projectAndRootPath = current.pathname.slice(0, markerIndex);
	const remainder = current.pathname.slice(markerIndex + marker.length);
	const match = /^(\d+)(?:\/[^/]+)*\/?$/.exec(remainder);

	if (!match?.[1] || projectAndRootPath.endsWith("/")) {
		return undefined;
	}

	return `${current.origin}${projectAndRootPath}${marker}${match[1]}`;
}

function queryUnique<T extends Element>(
	scope: ParentNode,
	selector: string,
	elementConstructor: abstract new (...args: never[]) => T,
): T | undefined {
	const matches = scope.querySelectorAll(selector);
	const [match] = matches;

	return matches.length === 1 && match instanceof elementConstructor
		? match
		: undefined;
}

function resolveCopyIconHref(
	rawHref: string | null,
	location: Location,
	expectedFragment: string,
): string | undefined {
	if (!rawHref) {
		return undefined;
	}

	let sprite: URL;
	let page: URL;

	try {
		page = new URL(location.href);
		sprite = new URL(rawHref, page);
	} catch {
		return undefined;
	}

	if (
		(sprite.protocol !== "https:" && sprite.protocol !== "http:") ||
		sprite.origin !== page.origin ||
		!sprite.pathname.endsWith(".svg") ||
		sprite.hash !== expectedFragment ||
		sprite.search !== "" ||
		sprite.username !== "" ||
		sprite.password !== ""
	) {
		return undefined;
	}

	const fragmentIndex = rawHref.lastIndexOf("#");

	if (fragmentIndex < 0) {
		return undefined;
	}

	return `${rawHref.slice(0, fragmentIndex)}#copy-to-clipboard`;
}

function findDirectChildContaining(
	ancestor: HTMLElement,
	descendant: HTMLElement,
): HTMLElement | undefined {
	let current = descendant;

	while (current.parentElement && current.parentElement !== ancestor) {
		current = current.parentElement;
	}

	return current.parentElement === ancestor ? current : undefined;
}

function resolveHeader(
	context: FeatureContext,
	ownedButton?: HTMLButtonElement,
): HeaderResolution {
	const { document } = context;
	const HTMLElementConstructor = document.defaultView?.HTMLElement;
	const HTMLButtonElementConstructor = document.defaultView?.HTMLButtonElement;

	if (!HTMLElementConstructor || !HTMLButtonElementConstructor) {
		return { status: "unsupported" };
	}

	const actions = queryUnique(
		document,
		MERGE_REQUEST_HEADER_ACTIONS_SELECTOR,
		HTMLElementConstructor,
	);

	if (!actions) {
		return { status: "unsupported" };
	}

	const codeControl = queryUnique(
		actions,
		MERGE_REQUEST_CODE_CONTROL_SELECTOR,
		HTMLElementConstructor,
	);

	if (!codeControl) {
		return { status: "unsupported" };
	}

	const codeContainer = findDirectChildContaining(actions, codeControl);

	if (!codeContainer) {
		return { status: "unsupported" };
	}

	const moreActionMatches = actions.querySelectorAll(
		MERGE_REQUEST_ACTIONS_SELECTOR,
	);
	const [moreActionMatch] = moreActionMatches;
	const moreActions =
		moreActionMatches.length === 1 &&
		moreActionMatch instanceof HTMLElementConstructor
			? moreActionMatch
			: undefined;

	if (
		moreActionMatches.length > 1 ||
		(moreActionMatches.length === 1 && !moreActions) ||
		(moreActions && moreActions.parentElement !== actions)
	) {
		return { status: "unsupported" };
	}

	let iconHref: string | undefined;

	if (moreActions) {
		const actionIconUses = moreActions.querySelectorAll(
			MERGE_REQUEST_ACTIONS_ICON_SELECTOR,
		);
		const NodeConstructor = document.defaultView?.Node;

		if (
			actionIconUses.length !== 1 ||
			!NodeConstructor ||
			(codeContainer.compareDocumentPosition(moreActions) &
				NodeConstructor.DOCUMENT_POSITION_FOLLOWING) ===
				0
		) {
			return { status: "unsupported" };
		}

		iconHref = resolveCopyIconHref(
			actionIconUses[0]?.getAttribute("href") ?? null,
			context.location,
			"#ellipsis_v",
		);
	} else {
		const codeIconUses = codeControl.querySelectorAll(
			MERGE_REQUEST_CODE_ICON_SELECTOR,
		);

		if (codeIconUses.length !== 1) {
			return { status: "unsupported" };
		}

		iconHref = resolveCopyIconHref(
			codeIconUses[0]?.getAttribute("href") ?? null,
			context.location,
			"#chevron-down",
		);
	}

	if (!iconHref) {
		return { status: "unsupported" };
	}

	const elementAfterCode = codeContainer.nextElementSibling;
	const insertionAnchor =
		moreActions ??
		(elementAfterCode === ownedButton
			? ownedButton.nextElementSibling
			: elementAfterCode);

	const markedElements = document.querySelectorAll(
		`[${COPY_MERGE_REQUEST_LINK_ATTRIBUTE}]`,
	);
	let markedButton: HTMLButtonElement | undefined;

	for (const markedElement of markedElements) {
		if (markedElement === ownedButton) {
			continue;
		}

		if (
			ownedButton ||
			markedButton ||
			!(markedElement instanceof HTMLButtonElementConstructor) ||
			!ownedButtons.has(markedElement)
		) {
			return { status: "unsupported" };
		}

		markedButton = markedElement;
	}

	if (
		markedButton &&
		markedButton !== ownedButton &&
		(markedButton.parentElement !== actions ||
			(moreActions
				? markedButton.nextElementSibling !== moreActions
				: markedButton.previousElementSibling !== codeContainer))
	) {
		return { status: "unsupported" };
	}

	return {
		status: "supported",
		contract: {
			actions,
			codeContainer,
			iconHref,
			insertionAnchor,
			...(moreActions ? { moreActions } : {}),
		},
	};
}

function copyWithExecCommand(document: Document, text: string): boolean {
	if (!document.body || typeof document.execCommand !== "function") {
		return false;
	}

	const textarea = document.createElement("textarea");
	const activeElement = document.activeElement;
	const selection = document.defaultView?.getSelection();
	const selectedRanges = selection
		? Array.from({ length: selection.rangeCount }, (_unused, index) =>
				selection.getRangeAt(index).cloneRange(),
			)
		: [];
	textarea.value = text;
	textarea.readOnly = true;
	textarea.style.position = "fixed";
	textarea.style.inset = "0 auto auto -9999px";
	textarea.style.opacity = "0";
	document.body.append(textarea);
	textarea.select();
	textarea.setSelectionRange(0, text.length);

	try {
		return document.execCommand("copy");
	} finally {
		textarea.remove();
		selection?.removeAllRanges();

		for (const range of selectedRanges) {
			selection?.addRange(range);
		}

		const HTMLElementConstructor = document.defaultView?.HTMLElement;

		if (
			HTMLElementConstructor &&
			activeElement instanceof HTMLElementConstructor
		) {
			activeElement.focus({ preventScroll: true });
		}
	}
}

async function writeClipboardText(
	document: Document,
	text: string,
): Promise<void> {
	let commandError: unknown;

	/* Keep the fallback synchronous inside the click gesture. It also covers
	 * plain-HTTP self-managed instances without adding clipboardWrite. */
	try {
		if (copyWithExecCommand(document, text)) {
			return;
		}
	} catch (error) {
		commandError = error;
	}

	const clipboard = document.defaultView?.navigator.clipboard;

	if (!clipboard || typeof clipboard.writeText !== "function") {
		throw new Error("No clipboard writer is available", {
			cause: commandError,
		});
	}

	try {
		await clipboard.writeText(text);
	} catch (error) {
		throw new Error("Clipboard write failed", { cause: error });
	}
}

function setButtonLabel(button: HTMLButtonElement, label: string): void {
	button.setAttribute("aria-label", label);

	if (button.hasAttribute("data-original-title")) {
		button.setAttribute("data-original-title", label);
	} else {
		button.setAttribute("title", label);
	}
}

function renderFeedbackIcon(mounted: MountedButton): void {
	if (!mounted.copyIconHref) {
		return;
	}

	const fragmentIndex = mounted.copyIconHref.lastIndexOf("#");

	if (fragmentIndex < 0) {
		return;
	}

	const href = `${mounted.copyIconHref.slice(0, fragmentIndex)}${FEEDBACK_ICON_FRAGMENTS[mounted.feedback]}`;

	if (mounted.use.getAttribute("href") !== href) {
		mounted.use.setAttribute("href", href);
	}
}

function clearFeedback(mounted: MountedButton): void {
	const view = mounted.button.ownerDocument.defaultView;

	if (view && mounted.feedbackTimeout !== undefined) {
		view.clearTimeout(mounted.feedbackTimeout);
	}

	mounted.feedbackTimeout = undefined;
	mounted.feedback = "idle";
	mounted.status.textContent = "";
	setButtonLabel(mounted.button, LABEL);
	renderFeedbackIcon(mounted);
}

function showFeedback(
	mounted: MountedButton,
	feedback: "success" | "failure",
	label: string,
): void {
	const view = mounted.button.ownerDocument.defaultView;

	clearFeedback(mounted);
	mounted.feedback = feedback;
	setButtonLabel(mounted.button, label);
	mounted.status.textContent = label;
	renderFeedbackIcon(mounted);

	if (view) {
		mounted.feedbackTimeout = view.setTimeout(() => {
			clearFeedback(mounted);
		}, FEEDBACK_DURATION_MS);
	}
}

function createButton(
	context: FeatureContext,
	signal: AbortSignal,
): MountedButton {
	const existing = buttonsBySignal.get(signal);

	if (existing) {
		return existing;
	}

	const button = context.document.createElement("button");
	const icon = context.document.createElementNS(SVG_NAMESPACE, "svg");
	const use = context.document.createElementNS(SVG_NAMESPACE, "use");
	const status = context.document.createElement("span");
	icon.append(use);
	button.append(icon);
	const mounted: MountedButton = {
		button,
		icon,
		status,
		use,
		copyIconHref: undefined,
		feedback: "idle",
		feedbackTimeout: undefined,
		copyAttempt: 0,
	};
	button.addEventListener(
		"click",
		(event) => {
			event.preventDefault();
			event.stopImmediatePropagation();
			const location = button.ownerDocument.defaultView?.location;
			const target = location ? buildMergeRequestLink(location) : undefined;

			if (!target) {
				button.remove();
				status.remove();
				return;
			}

			const attempt = ++mounted.copyAttempt;
			clearFeedback(mounted);
			void writeClipboardText(button.ownerDocument, target)
				.then(() => {
					if (!signal.aborted && attempt === mounted.copyAttempt) {
						showFeedback(mounted, "success", COPIED_LABEL);
					}
				})
				.catch((error: unknown) => {
					if (!signal.aborted && attempt === mounted.copyAttempt) {
						showFeedback(mounted, "failure", COPY_FAILED_LABEL);
						console.error("Tonic could not copy the merge request link", error);
					}
				});
		},
		{ signal },
	);

	buttonsBySignal.set(signal, mounted);
	ownedButtons.add(button);
	signal.addEventListener(
		"abort",
		() => {
			clearFeedback(mounted);
			button.remove();
			status.remove();
			buttonsBySignal.delete(signal);
			ownedButtons.delete(button);
		},
		{ once: true },
	);

	return mounted;
}

function repairButton(
	mounted: MountedButton,
	contract: MergeRequestHeaderContract,
) {
	const { button, icon, status, use } = mounted;
	mounted.copyIconHref = contract.iconHref;
	const setAttribute = (element: Element, name: string, value: string) => {
		if (element.getAttribute(name) !== value) {
			element.setAttribute(name, value);
		}
	};

	setAttribute(button, "type", "button");
	setAttribute(
		button,
		"class",
		(contract.moreActions
			? MORE_ACTION_BUTTON_CLASSES
			: STANDALONE_BUTTON_CLASSES
		).join(" "),
	);
	setAttribute(button, COPY_MERGE_REQUEST_LINK_ATTRIBUTE, "");
	setAttribute(button, "data-toggle", "tooltip");
	setAttribute(button, "data-placement", "bottom");
	setAttribute(button, "data-container", "body");

	/* GitLab's tooltip may move title to data-original-title. Copy feedback owns
	 * the current label, so reconciliation only fills a missing label. */
	if (!button.hasAttribute("aria-label")) {
		button.setAttribute("aria-label", LABEL);
	}

	if (
		!button.hasAttribute("title") &&
		!button.hasAttribute("data-original-title")
	) {
		button.setAttribute("title", LABEL);
	}

	setAttribute(icon, "class", "s16 gl-icon gl-button-icon");
	setAttribute(icon, "data-testid", "copy-to-clipboard-icon");
	setAttribute(icon, "aria-hidden", "true");
	renderFeedbackIcon(mounted);
	setAttribute(status, "class", "gl-sr-only");
	setAttribute(status, COPY_MERGE_REQUEST_LINK_STATUS_ATTRIBUTE, "");
	setAttribute(status, "role", "status");
	setAttribute(status, "aria-live", "polite");
	setAttribute(status, "aria-atomic", "true");

	if (button.childNodes.length !== 1 || button.firstChild !== icon) {
		button.replaceChildren(icon);
	}

	if (icon.childNodes.length !== 1 || icon.firstChild !== use) {
		icon.replaceChildren(use);
	}
}

function reconcile(context: FeatureContext, signal: AbortSignal): void {
	if (signal.aborted) {
		return;
	}

	const target = buildMergeRequestLink(context.location);
	const mounted = createButton(context, signal);
	const resolution = resolveHeader(context, mounted.button);

	if (!target || resolution.status !== "supported") {
		mounted.button.remove();
		mounted.status.remove();
		return;
	}

	repairButton(mounted, resolution.contract);

	if (
		mounted.button.parentElement !== resolution.contract.actions ||
		mounted.button.nextElementSibling !== resolution.contract.insertionAnchor ||
		(!resolution.contract.moreActions &&
			mounted.button.previousElementSibling !==
				resolution.contract.codeContainer)
	) {
		resolution.contract.actions.insertBefore(
			mounted.button,
			resolution.contract.insertionAnchor,
		);
	}

	if (mounted.status.parentElement !== resolution.contract.actions) {
		resolution.contract.actions.append(mounted.status);
	}
}

export function getCopyMergeRequestLinkCompatibility(
	context: FeatureContext,
): FeaturePageCompatibility {
	if (!isMergeRequestDetailPath(context.location.pathname)) {
		return "not-applicable";
	}

	const target = buildMergeRequestLink(context.location);

	if (!target) {
		return "unsupported";
	}

	const resolution = resolveHeader(context);

	if (resolution.status !== "supported") {
		return "unsupported";
	}

	return "supported";
}

export const copyMergeRequestLink: Feature = {
	id: COPY_MERGE_REQUEST_LINK_ID,
	observedAttributes: ["href"],
	mutationSelectors: [
		MERGE_REQUEST_HEADER_ACTIONS_SELECTOR,
		MERGE_REQUEST_CODE_CONTROL_SELECTOR,
		MERGE_REQUEST_ACTIONS_SELECTOR,
		`[${COPY_MERGE_REQUEST_LINK_ATTRIBUTE}]`,
		`[${COPY_MERGE_REQUEST_LINK_STATUS_ATTRIBUTE}]`,
	],
	matches: ({ location }) => isMergeRequestDetailPath(location.pathname),
	activate: reconcile,
	reconcile,
};
