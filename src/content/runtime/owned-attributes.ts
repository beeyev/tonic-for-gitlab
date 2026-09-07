interface OwnedAttributeState {
	clear(): void;
	retain(elements: Iterable<HTMLElement>): void;
	set(element: HTMLElement, attribute: string, enabled: boolean): void;
}

export function createOwnedAttributeRegistry(): {
	forSignal(signal: AbortSignal): OwnedAttributeState;
} {
	const states = new WeakMap<AbortSignal, OwnedAttributeState>();

	return {
		forSignal(signal) {
			const existingState = states.get(signal);

			if (existingState) {
				return existingState;
			}

			const attributesByElement = new Map<HTMLElement, Set<string>>();
			const state: OwnedAttributeState = {
				clear() {
					for (const [element, attributes] of attributesByElement) {
						for (const attribute of attributes) {
							element.removeAttribute(attribute);
						}
					}

					attributesByElement.clear();
				},
				retain(elements) {
					const retainedElements = new Set(elements);

					for (const [element, attributes] of attributesByElement) {
						if (retainedElements.has(element)) {
							continue;
						}

						for (const attribute of attributes) {
							element.removeAttribute(attribute);
						}

						attributesByElement.delete(element);
					}
				},
				set(element, attribute, enabled) {
					if (enabled) {
						element.setAttribute(attribute, "");

						const attributes = attributesByElement.get(element) ?? new Set();
						attributes.add(attribute);
						attributesByElement.set(element, attributes);
						return;
					}

					element.removeAttribute(attribute);
					const attributes = attributesByElement.get(element);
					attributes?.delete(attribute);

					if (attributes?.size === 0) {
						attributesByElement.delete(element);
					}
				},
			};

			states.set(signal, state);
			signal.addEventListener(
				"abort",
				() => {
					state.clear();
					states.delete(signal);
				},
				{ once: true },
			);

			return state;
		},
	};
}
