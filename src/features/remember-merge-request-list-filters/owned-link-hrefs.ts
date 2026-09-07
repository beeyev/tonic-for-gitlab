interface OwnedLinkHrefState {
	/**
	 * The href the link had before Tonic first touched it, or `undefined` when
	 * Tonic does not currently own this link's href. Every rebuild starts from
	 * this value, which is what makes repeated reconciliation unable to stack
	 * rewrites.
	 */
	originalHref(link: HTMLAnchorElement): string | undefined;
	rewrite(link: HTMLAnchorElement, href: string): void;
	restore(link: HTMLAnchorElement): void;
	/** Restores every tracked link that is not in `links`. */
	retain(links: Iterable<HTMLAnchorElement>): void;
	clear(): void;
}

interface OwnedHref {
	/** The value GitLab had written when Tonic took the link over. */
	original: string;
	/** The value Tonic wrote. Ownership lasts only while the link still has it. */
	written: string;
}

/**
 * Reversibility for an attribute the shared owned-attribute registry cannot
 * express.
 *
 * `owned-attributes.ts` records only presence of a boolean attribute, so it can
 * remove what Tonic added but cannot put back a value that was already there.
 * An `href` has to be restored, not removed: aborting, disabling the feature, or
 * a link leaving the contract must leave GitLab's own navigation exactly as it
 * was.
 *
 * Ownership is therefore conditional, not permanent. GitLab reuses anchor nodes
 * across same-document navigation, so a link Tonic rewrote can be retargeted in
 * place - the sidebar entry pointing at a different project after a project
 * switch is the ordinary case. Recording only the pre-Tonic value would make
 * every later rebuild and every restore reassert the old destination, and
 * because the shared observer watches `href`, GitLab's own change is what
 * schedules the pass that would overwrite it. Tracking what Tonic wrote as well
 * turns that into a detectable event: an href that is no longer Tonic's is
 * GitLab's current answer, and the remembered original belongs to a destination
 * that no longer applies.
 */
export function createOwnedLinkHrefRegistry(): {
	forSignal(signal: AbortSignal): OwnedLinkHrefState;
} {
	const states = new WeakMap<AbortSignal, OwnedLinkHrefState>();

	return {
		forSignal(signal) {
			const existingState = states.get(signal);

			if (existingState) {
				return existingState;
			}

			const ownedHrefs = new Map<HTMLAnchorElement, OwnedHref>();

			/** The record for a link, dropped if GitLab has taken the href back. */
			const ownedHref = (link: HTMLAnchorElement): OwnedHref | undefined => {
				const owned = ownedHrefs.get(link);

				if (!owned) {
					return undefined;
				}

				if (link.getAttribute("href") !== owned.written) {
					ownedHrefs.delete(link);
					return undefined;
				}

				return owned;
			};

			const restoreLink = (link: HTMLAnchorElement) => {
				const owned = ownedHref(link);

				if (!owned) {
					return;
				}

				ownedHrefs.delete(link);
				link.setAttribute("href", owned.original);
			};

			const state: OwnedLinkHrefState = {
				originalHref(link) {
					return ownedHref(link)?.original;
				},
				rewrite(link, href) {
					const current = link.getAttribute("href") ?? "";
					// Re-baselines on GitLab's value whenever ownership has lapsed.
					const original = ownedHref(link)?.original ?? current;

					/*
					 * Writing the same value still produces a mutation record, and the
					 * shared observer watches `href`, so an unguarded write would
					 * schedule a reconcile that writes again on every frame.
					 */
					if (current !== href) {
						link.setAttribute("href", href);
					}

					ownedHrefs.set(link, { original, written: href });
				},
				restore: restoreLink,
				retain(links) {
					const retainedLinks = new Set(links);

					for (const link of [...ownedHrefs.keys()]) {
						if (!retainedLinks.has(link)) {
							restoreLink(link);
						}
					}
				},
				clear() {
					for (const link of [...ownedHrefs.keys()]) {
						restoreLink(link);
					}

					ownedHrefs.clear();
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
