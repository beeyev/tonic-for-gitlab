/**
 * Resolves DOM constructors from the realm that owns the node they will be used
 * with, rather than from `globalThis`.
 *
 * Tests run against a Happy DOM window whose constructors differ from the
 * registered globals. Observing a node from that window with the global
 * `MutationObserver` does not merely fail to fire, it throws
 * `target[PropertySymbol.observeMutations] is not a function`, so the realm has
 * to be resolved explicitly at every call site.
 */
export function getMutationObserver(
	scope: Window | Document,
): typeof MutationObserver {
	// `Window` in lib.dom does not declare the constructors that live on
	// `globalThis`, so the lookup is typed here instead of at each call site.
	const view = ("defaultView" in scope ? scope.defaultView : scope) as {
		MutationObserver?: typeof MutationObserver;
	} | null;

	return view?.MutationObserver ?? MutationObserver;
}
