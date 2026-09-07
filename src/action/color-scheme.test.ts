import { describe, expect, test } from "bun:test";
import { applyPreferredColorScheme } from "./color-scheme";

function createView(initiallyDark: boolean) {
	const listeners = new Set<() => void>();
	const root = document.createElement("html");
	const query = {
		matches: initiallyDark,
		addEventListener(_type: "change", listener: () => void) {
			listeners.add(listener);
		},
		removeEventListener(_type: "change", listener: () => void) {
			listeners.delete(listener);
		},
	};

	return {
		root,
		listenerCount: () => listeners.size,
		setDark(dark: boolean) {
			query.matches = dark;
			for (const listener of listeners) {
				listener();
			}
		},
		view: { matchMedia: () => query, document: { documentElement: root } },
	};
}

describe("action colour scheme", () => {
	test("applies the current preference before anything renders", () => {
		const dark = createView(true);
		applyPreferredColorScheme(dark.view);
		expect(dark.root.getAttribute("data-tonic-theme")).toBe("dark");

		const light = createView(false);
		applyPreferredColorScheme(light.view);
		expect(light.root.hasAttribute("data-tonic-theme")).toBe(false);
	});

	test("follows a preference that changes while the popup is open", () => {
		const { root, setDark, view } = createView(false);
		applyPreferredColorScheme(view);

		setDark(true);
		expect(root.getAttribute("data-tonic-theme")).toBe("dark");

		// Back to light again: the dark state has to be removed, not just added,
		// or the popup keeps a stale theme the OS no longer asks for.
		setDark(false);
		expect(root.hasAttribute("data-tonic-theme")).toBe(false);
	});

	test("stops listening once torn down", () => {
		const { listenerCount, view } = createView(false);
		const teardown = applyPreferredColorScheme(view);
		expect(listenerCount()).toBe(1);

		teardown();

		expect(listenerCount()).toBe(0);
	});
});
