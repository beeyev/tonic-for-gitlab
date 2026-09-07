import { getMutationObserver } from "./dom-globals";
import { createFeatureContext, type Feature } from "./feature-context";

/*
 * `selector` is the whole feature-owned union as one CSS selector list, not one
 * entry at a time. A list is exactly the OR this needs, so a non-matching node
 * costs one subtree walk instead of one per registered selector. `closest`
 * already tests the element itself, so a separate `matches` call only repeats
 * work `closest` does first.
 */
function asElement(node: Node): Element | undefined {
	return node.nodeType === 1 ? (node as Element) : undefined;
}

/**
 * Whether the element a mutation was reported *on* sits in an owned subtree.
 *
 * `closest` only, deliberately. Asking whether the target's subtree *contains*
 * anything owned answers a different question, and for a target near the root it
 * is always yes: GitLab appends toasts, modals, tooltips, and Vue portals
 * straight to `document.body`, so every one of those childList records has
 * `target === document.body`, whose subtree contains the whole application.
 * That made the filter admit essentially every mutation on a real page while
 * still paying for a subtree walk per record.
 *
 * Nothing is lost by dropping it. A change *inside* an owned subtree matches
 * here through the ancestor walk, and a change that introduces or removes owned
 * content matches through the added and removed nodes below, which do still test
 * their own subtrees.
 */
function targetTouchesSelector(node: Node, selector: string): boolean {
	return asElement(node)?.closest(selector) != null;
}

/**
 * Whether a node that was added or removed is, contains, or sits inside
 * something a feature owns. All three matter: GitLab can add an owned row, add a
 * container holding owned rows, or add an unrelated node inside an owned list.
 */
function changedNodeTouchesSelector(node: Node, selector: string): boolean {
	const element = asElement(node);

	if (!element) {
		return false;
	}

	return (
		element.closest(selector) !== null ||
		element.querySelector(selector) !== null
	);
}

function mutationTouchesSelector(
	mutation: MutationRecord,
	selector: string,
): boolean {
	if (targetTouchesSelector(mutation.target, selector)) {
		return true;
	}

	for (const node of mutation.addedNodes) {
		if (changedNodeTouchesSelector(node, selector)) {
			return true;
		}
	}

	for (const node of mutation.removedNodes) {
		if (changedNodeTouchesSelector(node, selector)) {
			return true;
		}
	}

	return false;
}

export function activateFeatureRuntime(
	runtimeWindow: Window,
	features: readonly Feature[],
	signal: AbortSignal,
): { reconcile(): void } {
	if (signal.aborted) {
		return { reconcile() {} };
	}

	const { document } = runtimeWindow;
	const observationRoot = document.body;

	if (!observationRoot) {
		return { reconcile() {} };
	}

	const activeFeatures = new Map<string, AbortController>();
	const observedAttributes = [
		...new Set(
			features.flatMap(({ observedAttributes }) => observedAttributes ?? []),
		),
	];
	const mutationSelectors = [
		...new Set(
			features.flatMap(({ mutationSelectors }) => mutationSelectors ?? []),
		),
	];
	const mutationSelector = mutationSelectors.join(",");
	const observesEveryMutation = features.some(
		({ mutationSelectors }) => mutationSelectors === undefined,
	);
	let animationFrame: number | undefined;

	const runReconcile = () => {
		animationFrame = undefined;

		if (signal.aborted) {
			return;
		}

		const context = createFeatureContext(runtimeWindow);

		for (const feature of features) {
			/*
			 * One feature's failure must not take the others down with it. GitLab
			 * DOM is untrusted input, and an unguarded throw here skipped every
			 * feature after it in the pass, including the control panel, which is
			 * the surface the user would recover from.
			 *
			 * The failed feature is aborted and forgotten rather than left
			 * half-activated: abort runs its cleanup, and the next pass activates
			 * it again, so a transient DOM state heals instead of latching off.
			 */
			try {
				const activeController = activeFeatures.get(feature.id);

				if (!feature.matches(context)) {
					activeController?.abort();
					activeFeatures.delete(feature.id);
					continue;
				}

				if (activeController) {
					feature.reconcile?.(context, activeController.signal);
					continue;
				}

				const featureController = new AbortController();
				activeFeatures.set(feature.id, featureController);
				feature.activate(context, featureController.signal);
			} catch (error) {
				console.error(`Tonic feature "${feature.id}" failed`, error);
				activeFeatures.get(feature.id)?.abort();
				activeFeatures.delete(feature.id);
			}
		}
	};

	const reconcileNow = () => {
		if (animationFrame !== undefined) {
			runtimeWindow.cancelAnimationFrame(animationFrame);
			animationFrame = undefined;
		}

		runReconcile();
	};

	const scheduleReconcile = () => {
		if (animationFrame !== undefined || signal.aborted) {
			return;
		}

		animationFrame = runtimeWindow.requestAnimationFrame(runReconcile);
	};

	const handleMutations = (mutations: MutationRecord[]) => {
		/*
		 * Observer callbacks are delivered per task, so several batches land
		 * inside one frame on a busy GitLab list. Once a reconcile is queued the
		 * filter below can only reach a `scheduleReconcile` that already
		 * no-ops, so every record it inspects is discarded work.
		 */
		if (animationFrame !== undefined || signal.aborted) {
			return;
		}

		if (observesEveryMutation) {
			scheduleReconcile();
			return;
		}

		if (mutationSelector.length === 0) {
			return;
		}

		for (const mutation of mutations) {
			if (mutationTouchesSelector(mutation, mutationSelector)) {
				scheduleReconcile();
				return;
			}
		}
	};

	const observer = new (getMutationObserver(runtimeWindow))(handleMutations);
	observer.observe(observationRoot, {
		...(observedAttributes.length > 0
			? { attributeFilter: observedAttributes, attributes: true }
			: {}),
		childList: true,
		subtree: true,
	});

	signal.addEventListener(
		"abort",
		() => {
			observer.disconnect();

			if (animationFrame !== undefined) {
				runtimeWindow.cancelAnimationFrame(animationFrame);
			}

			for (const controller of activeFeatures.values()) {
				controller.abort();
			}

			activeFeatures.clear();
		},
		{ once: true },
	);

	runtimeWindow.addEventListener("hashchange", scheduleReconcile, { signal });
	runtimeWindow.addEventListener("popstate", scheduleReconcile, { signal });
	const navigation = (runtimeWindow as Window & { navigation?: EventTarget })
		.navigation;
	navigation?.addEventListener("navigatesuccess", scheduleReconcile, {
		signal,
	});

	reconcileNow();

	return { reconcile: reconcileNow };
}
