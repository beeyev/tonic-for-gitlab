import type {
	Feature,
	FeatureContext,
	FeaturePageCompatibility,
} from "../../content/runtime/feature-context";
import { createOwnedAttributeRegistry } from "../../content/runtime/owned-attributes";
import {
	AI_PANELS_SELECTOR,
	DUO_DISABLED_TOGGLE_SELECTOR,
	HIDDEN_ENTRYPOINT_ATTRIBUTE,
	HIDDEN_RAIL_ATTRIBUTE,
	INTERACTIVE_CONTROL_SELECTOR,
} from "./selectors";

export const HIDE_DUO_AGENT_PLATFORM_ENTRYPOINT_ID =
	"hide-duo-agent-platform-entrypoint";

interface DuoEntrypointContract {
	entrypoint: HTMLElement;
	navigation: HTMLElement;
	rail: HTMLElement;
}

const ownedAttributes = createOwnedAttributeRegistry();

function resolveUniqueHTMLElement(
	document: Document,
	selector: string,
	HTMLElementConstructor: typeof HTMLElement | undefined,
): HTMLElement | undefined {
	const elements = document.querySelectorAll<HTMLElement>(selector);
	const [element] = elements;

	if (
		elements.length !== 1 ||
		!HTMLElementConstructor ||
		!(element instanceof HTMLElementConstructor)
	) {
		return undefined;
	}

	return element;
}

function resolveDuoEntrypointContract(
	document: Document,
): DuoEntrypointContract | undefined {
	const HTMLElementConstructor = document.defaultView?.HTMLElement;
	const entrypoint = resolveUniqueHTMLElement(
		document,
		DUO_DISABLED_TOGGLE_SELECTOR,
		HTMLElementConstructor,
	);
	const rail = entrypoint?.closest(AI_PANELS_SELECTOR);

	if (
		!HTMLElementConstructor ||
		!entrypoint ||
		!rail ||
		!(rail instanceof HTMLElementConstructor) ||
		!entrypoint.matches(INTERACTIVE_CONTROL_SELECTOR) ||
		entrypoint.querySelector(INTERACTIVE_CONTROL_SELECTOR) !== null
	) {
		return undefined;
	}

	const navigation = entrypoint.closest("nav");

	if (
		!HTMLElementConstructor ||
		!(navigation instanceof HTMLElementConstructor) ||
		navigation.closest(AI_PANELS_SELECTOR) !== rail
	) {
		return undefined;
	}

	return { entrypoint, navigation, rail };
}

function hasAnotherInteractiveControl({
	entrypoint,
	rail,
}: DuoEntrypointContract): boolean {
	return (
		(rail.matches(INTERACTIVE_CONTROL_SELECTOR) && rail !== entrypoint) ||
		[...rail.querySelectorAll(INTERACTIVE_CONTROL_SELECTOR)].some(
			(control) => control !== entrypoint,
		)
	);
}

export function getHideDuoAgentPlatformEntrypointCompatibility(
	context: FeatureContext,
): FeaturePageCompatibility {
	if (!context.document.querySelector(DUO_DISABLED_TOGGLE_SELECTOR)) {
		return "not-applicable";
	}

	return resolveDuoEntrypointContract(context.document)
		? "supported"
		: "unsupported";
}

function reconcileDuoEntrypoint(
	context: FeatureContext,
	signal: AbortSignal,
): void {
	if (signal.aborted) {
		return;
	}

	const ownedState = ownedAttributes.forSignal(signal);
	const contract = resolveDuoEntrypointContract(context.document);

	if (!contract) {
		ownedState.clear();
		return;
	}

	const { entrypoint, rail } = contract;
	ownedState.retain([entrypoint, rail]);

	if (hasAnotherInteractiveControl(contract)) {
		ownedState.set(rail, HIDDEN_RAIL_ATTRIBUTE, false);
		ownedState.set(entrypoint, HIDDEN_ENTRYPOINT_ATTRIBUTE, true);
		return;
	}

	ownedState.set(entrypoint, HIDDEN_ENTRYPOINT_ATTRIBUTE, false);
	ownedState.set(rail, HIDDEN_RAIL_ATTRIBUTE, true);
}

export const hideDuoAgentPlatformEntrypoint: Feature = {
	id: HIDE_DUO_AGENT_PLATFORM_ENTRYPOINT_ID,
	mutationSelectors: [
		AI_PANELS_SELECTOR,
		DUO_DISABLED_TOGGLE_SELECTOR,
		`[${HIDDEN_ENTRYPOINT_ATTRIBUTE}]`,
		`[${HIDDEN_RAIL_ATTRIBUTE}]`,
	],
	// `href` covers an existing link becoming an actionable rail control. Vue
	// replaces the versioned rail controls through child-list mutations.
	observedAttributes: ["href"],
	// The AI rail is global page chrome, so page paths cannot describe its scope.
	// Reconciliation treats an absent or not-yet-mounted rail as a safe no-op.
	matches: () => true,
	activate(context, signal) {
		reconcileDuoEntrypoint(context, signal);
	},
	reconcile(context, signal) {
		reconcileDuoEntrypoint(context, signal);
	},
};
