export interface FeatureContext {
	document: Document;
	location: Location;
}

export type FeaturePageCompatibility =
	| "not-applicable"
	| "supported"
	| "unsupported";

export interface Feature {
	readonly id: string;
	readonly mutationSelectors?: readonly string[];
	readonly observedAttributes?: readonly string[];
	matches(context: FeatureContext): boolean;
	activate(context: FeatureContext, signal: AbortSignal): void;
	reconcile?(context: FeatureContext, signal: AbortSignal): void;
}

export function createFeatureContext(runtimeWindow: Window): FeatureContext {
	return {
		document: runtimeWindow.document,
		location: runtimeWindow.location,
	};
}
