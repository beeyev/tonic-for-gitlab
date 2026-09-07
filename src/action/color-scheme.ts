const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/** The part of `window` this needs, so a test can drive it without a browser. */
interface ColorSchemeView {
	matchMedia(query: string): {
		matches: boolean;
		addEventListener(type: "change", listener: () => void): void;
		removeEventListener(type: "change", listener: () => void): void;
	};
	document: { documentElement: Element };
}

/**
 * Maps the OS colour preference onto the shared `data-tonic-theme` token state.
 *
 * The in-page panel sets the same attribute from GitLab's own theme class, so
 * one token map serves both surfaces. Applied synchronously at module load,
 * before React renders, so the popup never paints the wrong theme first, and
 * kept current afterwards because the preference can change while the popup is
 * open.
 *
 * Returns a teardown. The popup itself lives as long as its document, so only
 * tests use it.
 */
export function applyPreferredColorScheme(view: ColorSchemeView): () => void {
	const query = view.matchMedia(DARK_SCHEME_QUERY);
	const apply = () => {
		const root = view.document.documentElement;

		if (query.matches) {
			root.setAttribute("data-tonic-theme", "dark");
			return;
		}

		root.removeAttribute("data-tonic-theme");
	};

	apply();
	query.addEventListener("change", apply);

	return () => {
		query.removeEventListener("change", apply);
	};
}
