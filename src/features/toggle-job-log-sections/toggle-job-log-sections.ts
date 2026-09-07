import type {
	Feature,
	FeatureContext,
	FeaturePageCompatibility,
} from "../../content/runtime/feature-context";
import { isJobDetailPath } from "../../content/runtime/page-context";
import {
	JOB_LOG_SEARCH_BOX_SELECTOR,
	JOB_LOG_SECTION_CLOSED_ICON_SELECTOR,
	JOB_LOG_SECTION_HEADER_SELECTOR,
	JOB_LOG_SECTION_OPEN_ICON_SELECTOR,
	JOB_LOG_TOP_BAR_ANCHOR_SELECTOR,
	JOB_LOG_TOP_BAR_ICON_SELECTOR,
	JOB_LOG_TOP_BAR_SELECTOR,
	TOGGLE_JOB_LOG_SECTIONS_ATTRIBUTE,
	TOGGLE_JOB_LOG_SECTIONS_STATUS_ATTRIBUTE,
} from "./selectors";

export const TOGGLE_JOB_LOG_SECTIONS_ID = "toggle-job-log-sections";

const COLLAPSE_LABEL = "Collapse all log sections";
const EXPAND_LABEL = "Expand all log sections";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * `collapse` and `expand`, not the chevrons the section headers use: the group
 * this button joins already spends `chevron-down` on "Scroll to next result",
 * so a chevron here would read as another scroll control.
 */
const ICON_FRAGMENTS = {
	collapse: "#collapse",
	expand: "#expand",
} as const;

const BUTTON_CLASSES = [
	"btn",
	"gl-button",
	"btn-default",
	"btn-md",
	"btn-icon",
] as const;

/**
 * Expanding is bounded rather than run to a fixed point. Nesting depth is small
 * in every real job log, but the passes are driven by GitLab's own rendering,
 * and a log that kept producing closed headers would otherwise keep this
 * running for as long as the page is open.
 */
const MAX_EXPAND_PASSES = 20;

/**
 * GitLab's own log line anchors, which its search and its permalinks both
 * scroll to. A line inside a closed section is not in the document at all, so
 * opening such a link with the collapsed default applied would land on nothing.
 */
const LOG_LINE_HASH_PATTERN = /^#L\d+$/;

type SectionState = "collapsible" | "expandable" | "empty";

/**
 * Whether a job log still opens collapsed, and which job that answer belongs to.
 *
 * The answer is decided once per job and then only ever revoked. A job log is
 * not delivered in one piece: a running job streams its sections in over
 * minutes, so the collapsed default has to keep applying to sections that do
 * not exist yet, and the only thing that ends it is the user taking over.
 */
interface AutoCollapseState {
	/** The job path `isDecided` and `isArmed` describe. */
	path: string | undefined;
	/**
	 * Whether the setting has been read for this job. It is read once, and a
	 * later change to it deliberately does not reach the log the user is already
	 * reading; it applies from the next job log opened.
	 */
	isDecided: boolean;
	isArmed: boolean;
	/**
	 * Held for the whole of a pass this feature drives. The pass clicks section
	 * headers, and without this the very first click would look like the user
	 * taking over and disarm the feature immediately.
	 */
	isRunning: boolean;
	/**
	 * Held between a pass that clicked and the render those clicks produce.
	 *
	 * GitLab applies a section toggle to its store synchronously but renders the
	 * chevron that reports it on a later task, and this feature reads that
	 * chevron. Two passes inside one task would therefore find the same headers
	 * still marked open and click them a second time, reopening every section
	 * the first pass had just closed. Reconciliation frequency is not this
	 * feature's to control, so the pass has to be safe at any of them.
	 */
	isSettling: boolean;
}

interface JobLogTopBarContract {
	group: HTMLElement;
	spritePrefix: string;
}

type TopBarResolution =
	| { status: "supported"; contract: JobLogTopBarContract }
	| { status: "unsupported" };

interface MountedToggle {
	wrapper: HTMLElement;
	button: HTMLButtonElement;
	icon: SVGSVGElement;
	use: SVGUseElement;
	status: HTMLSpanElement;
	spritePrefix: string | undefined;
	isExpanding: boolean;
	refreshFrame: number | undefined;
	hasSectionListener: boolean;
	autoCollapse: AutoCollapseState;
}

const togglesBySignal = new WeakMap<AbortSignal, MountedToggle>();
const ownedWrappers = new WeakSet<HTMLElement>();

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

/**
 * The sprite path of a GitLab icon, with its fragment stripped.
 *
 * Only the path is this feature's contract, so unlike the merge request header
 * action this accepts any fragment rather than one expected icon: which icons
 * the job log top bar happens to render is GitLab's business, and the fragment
 * is replaced here anyway. What still has to hold is that the reference is a
 * same-origin GitLab asset and not somewhere a page value could redirect it.
 */
function resolveSpritePrefix(
	rawHref: string | null,
	location: Location,
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
		sprite.hash === "" ||
		sprite.search !== "" ||
		sprite.username !== "" ||
		sprite.password !== ""
	) {
		return undefined;
	}

	const fragmentIndex = rawHref.lastIndexOf("#");

	return fragmentIndex < 0 ? undefined : rawHref.slice(0, fragmentIndex);
}

function readTopBarSpritePrefix(
	topBar: HTMLElement,
	location: Location,
	ownedWrapper?: HTMLElement,
): string | undefined {
	for (const use of topBar.querySelectorAll(JOB_LOG_TOP_BAR_ICON_SELECTOR)) {
		if (ownedWrapper?.contains(use)) {
			continue;
		}

		/*
		 * Only the first GitLab icon in the bar is consulted, and a reference
		 * that does not validate disables the feature rather than falling
		 * through to the next one. Searching on would let a rewritten href hide
		 * behind a later icon instead of being refused.
		 */
		return resolveSpritePrefix(use.getAttribute("href"), location);
	}

	return undefined;
}

function resolveTopBar(
	context: FeatureContext,
	ownedWrapper?: HTMLElement,
): TopBarResolution {
	const { document } = context;
	const HTMLElementConstructor = document.defaultView?.HTMLElement;

	if (!HTMLElementConstructor) {
		return { status: "unsupported" };
	}

	const topBar = queryUnique(
		document,
		JOB_LOG_TOP_BAR_SELECTOR,
		HTMLElementConstructor,
	);

	if (!topBar) {
		return { status: "unsupported" };
	}

	const anchor = queryUnique(
		topBar,
		JOB_LOG_TOP_BAR_ANCHOR_SELECTOR,
		HTMLElementConstructor,
	);

	/*
	 * Each control in the group is wrapped in a div that carries its tooltip, so
	 * the group is the anchor's grandparent. A flattened structure walks past the
	 * top bar instead, which is why the result has to be strictly inside it: the
	 * bar itself, or the page around it, is not an icon button group.
	 */
	const wrapper = anchor?.parentElement;
	const group = wrapper?.parentElement;

	if (
		!wrapper ||
		!group ||
		/*
		 * The wrapper holds its control and nothing else. Without that, a group
		 * whose controls stopped being wrapped would resolve one level too high
		 * and put this button beside the search box instead of among the icons.
		 */
		wrapper.children.length !== 1 ||
		group === topBar ||
		!topBar.contains(group) ||
		!(group instanceof HTMLElementConstructor)
	) {
		return { status: "unsupported" };
	}

	const spritePrefix = readTopBarSpritePrefix(
		topBar,
		context.location,
		ownedWrapper,
	);

	if (spritePrefix === undefined) {
		return { status: "unsupported" };
	}

	const markedElements = document.querySelectorAll(
		`[${TOGGLE_JOB_LOG_SECTIONS_ATTRIBUTE}]`,
	);
	let markedWrapper: HTMLElement | undefined;

	for (const markedElement of markedElements) {
		if (markedElement === ownedWrapper) {
			continue;
		}

		if (
			ownedWrapper ||
			markedWrapper ||
			!(markedElement instanceof HTMLElementConstructor) ||
			!ownedWrappers.has(markedElement)
		) {
			return { status: "unsupported" };
		}

		markedWrapper = markedElement;
	}

	return { status: "supported", contract: { group, spritePrefix } };
}

function readSectionState(document: Document): SectionState {
	if (
		document.querySelector(
			`${JOB_LOG_SECTION_HEADER_SELECTOR} ${JOB_LOG_SECTION_OPEN_ICON_SELECTOR}`,
		)
	) {
		return "collapsible";
	}

	return document.querySelector(JOB_LOG_SECTION_HEADER_SELECTOR)
		? "expandable"
		: "empty";
}

function collectHeaders(
	document: Document,
	chevronSelector: string,
): HTMLElement[] {
	const HTMLElementConstructor = document.defaultView?.HTMLElement;

	if (!HTMLElementConstructor) {
		return [];
	}

	const headers: HTMLElement[] = [];

	for (const header of document.querySelectorAll(
		JOB_LOG_SECTION_HEADER_SELECTOR,
	)) {
		if (
			header instanceof HTMLElementConstructor &&
			header.querySelector(chevronSelector)
		) {
			headers.push(header);
		}
	}

	return headers;
}

/**
 * Collapsing needs one synchronous pass. GitLab re-renders the log from its own
 * store on a later task, so every header collected here is still mounted when
 * it is clicked, including the ones nested inside a section that an earlier
 * click in the same pass has already closed.
 */
function collapseAllSections(document: Document): number {
	const headers = collectHeaders(document, JOB_LOG_SECTION_OPEN_ICON_SELECTOR);

	for (const header of headers) {
		header.click();
	}

	return headers.length;
}

function nextFrame(view: Window): Promise<void> {
	return new Promise((resolve) => {
		view.requestAnimationFrame(() => {
			resolve();
		});
	});
}

/**
 * Expanding needs repeated passes. A closed section's contents are not in the
 * document at all, so the headers of sections nested inside it only exist after
 * GitLab has re-rendered the parent, which is why each pass waits a frame
 * before looking again.
 */
async function expandAllSections(
	document: Document,
	signal: AbortSignal,
): Promise<number> {
	const view = document.defaultView;

	if (!view) {
		return 0;
	}

	let expanded = 0;
	/*
	 * Every job detail path matches this feature, so moving between two jobs
	 * keeps the activation alive and the run would carry on clicking headers in
	 * whichever log the document now holds. The signal alone cannot see that.
	 */
	const jobPath = view.location.pathname;

	for (let pass = 0; pass < MAX_EXPAND_PASSES; pass += 1) {
		if (signal.aborted || view.location.pathname !== jobPath) {
			return expanded;
		}

		const headers = collectHeaders(
			document,
			JOB_LOG_SECTION_CLOSED_ICON_SELECTOR,
		);

		if (headers.length === 0) {
			return expanded;
		}

		for (const header of headers) {
			header.click();
		}

		expanded += headers.length;
		await nextFrame(view);
	}

	return expanded;
}

function describeOutcome(verb: string, count: number): string {
	return `${verb} ${count} log ${count === 1 ? "section" : "sections"}`;
}

function renderToggle(mounted: MountedToggle): void {
	if (mounted.spritePrefix === undefined) {
		return;
	}

	const state = readSectionState(mounted.button.ownerDocument);
	const isDisabled = mounted.isExpanding || state === "empty";
	const label = state === "collapsible" ? COLLAPSE_LABEL : EXPAND_LABEL;
	const href = `${mounted.spritePrefix}${
		state === "collapsible" ? ICON_FRAGMENTS.collapse : ICON_FRAGMENTS.expand
	}`;
	const className = [
		...BUTTON_CLASSES,
		...(isDisabled ? ["disabled"] : []),
	].join(" ");

	if (mounted.button.getAttribute("class") !== className) {
		mounted.button.setAttribute("class", className);
	}

	/*
	 * GitLab's own disabled controls in this group carry `aria-disabled` and the
	 * `disabled` class, never the `disabled` property, which is what keeps them
	 * in the tab order and lets their wrapper still answer a hover. Refusing the
	 * action is the click handler's job, not the property's.
	 */
	if (isDisabled) {
		if (mounted.button.getAttribute("aria-disabled") !== "true") {
			mounted.button.setAttribute("aria-disabled", "true");
		}
	} else if (mounted.button.hasAttribute("aria-disabled")) {
		mounted.button.removeAttribute("aria-disabled");
	}

	for (const [element, name] of [
		[mounted.button, "aria-label"],
		[mounted.button, "title"],
		[mounted.wrapper, "title"],
	] as const) {
		if (element.getAttribute(name) !== label) {
			element.setAttribute(name, label);
		}
	}

	if (mounted.use.getAttribute("href") !== href) {
		mounted.use.setAttribute("href", href);
	}
}

/**
 * GitLab's own re-render happens after its click handler returns, so the button
 * can only read the section state a user's toggle produced on the next frame.
 */
function scheduleRefresh(mounted: MountedToggle): void {
	const view = mounted.button.ownerDocument.defaultView;

	if (!view || mounted.refreshFrame !== undefined) {
		return;
	}

	mounted.refreshFrame = view.requestAnimationFrame(() => {
		mounted.refreshFrame = undefined;
		/* A frame is past every microtask, so whatever render the clicks that
		 * asked for this refresh produced has landed by now. */
		mounted.autoCollapse.isSettling = false;
		renderToggle(mounted);
	});
}

/**
 * Every header click this feature makes itself, across both kinds of run. The
 * expand run spans frames, so its clicks land long after the handler that
 * started it returned, and only the flag it already holds can tell them apart
 * from a user's.
 */
function isFeatureDrivenPass(mounted: MountedToggle): boolean {
	return mounted.autoCollapse.isRunning || mounted.isExpanding;
}

/** The user has taken over this job log; the collapsed default stops applying. */
function disarmAutoCollapse(mounted: MountedToggle): void {
	mounted.autoCollapse.isDecided = true;
	mounted.autoCollapse.isArmed = false;
}

/**
 * Decides once per job whether its log opens collapsed.
 *
 * Activation is not enough on its own. Every job detail path matches this
 * feature, so moving between two jobs keeps the same activation alive and only
 * the path can say that a different log is now on screen.
 *
 * A pending settings read answers `undefined`. Deciding from the defaults there
 * would answer the wrong way for exactly the users who enabled this, because the
 * runtime starts every tab from the defaults and the stored value arrives a
 * storage round trip later.
 */
function updateAutoCollapseArming(
	mounted: MountedToggle,
	location: Location,
	readSetting: () => boolean | undefined,
): void {
	const state = mounted.autoCollapse;

	if (state.path !== location.pathname) {
		state.path = location.pathname;
		state.isDecided = false;
		state.isArmed = false;
	}

	if (state.isDecided) {
		return;
	}

	const isEnabled = readSetting();

	if (isEnabled === undefined) {
		return;
	}

	state.isDecided = true;
	state.isArmed = isEnabled && !LOG_LINE_HASH_PATTERN.test(location.hash);
}

/**
 * Collapses whatever is open right now. Reconciliation runs this on every pass
 * while the feature stays armed, which is what makes the sections a running job
 * streams in arrive collapsed as well. It ends on its own: once everything is
 * closed a pass finds nothing to click and stops producing mutations.
 *
 * It never announces. This is the state the log opens in rather than a result
 * the user asked for, so the live region stays for button presses.
 */
function runAutoCollapse(mounted: MountedToggle, document: Document): void {
	const state = mounted.autoCollapse;

	if (!state.isArmed || state.isSettling) {
		return;
	}

	state.isRunning = true;
	let collapsed = 0;

	try {
		collapsed = collapseAllSections(document);
	} finally {
		state.isRunning = false;
	}

	if (collapsed > 0) {
		/*
		 * The clicks above are not visible in the log until GitLab renders them,
		 * so this pass holds the next one off until that render has happened.
		 * The same frame re-derives the button, which cannot read the result any
		 * sooner either.
		 */
		state.isSettling = true;
		scheduleRefresh(mounted);
	}
}

function createToggle(
	context: FeatureContext,
	signal: AbortSignal,
): MountedToggle {
	const existing = togglesBySignal.get(signal);

	if (existing) {
		return existing;
	}

	const { document } = context;
	const wrapper = document.createElement("div");
	const button = document.createElement("button");
	const icon = document.createElementNS(SVG_NAMESPACE, "svg");
	const use = document.createElementNS(SVG_NAMESPACE, "use");
	const status = document.createElement("span");
	icon.append(use);
	button.append(icon);
	wrapper.append(button, status);
	const mounted: MountedToggle = {
		wrapper,
		button,
		icon,
		use,
		status,
		spritePrefix: undefined,
		isExpanding: false,
		refreshFrame: undefined,
		hasSectionListener: false,
		autoCollapse: {
			path: undefined,
			isDecided: false,
			isArmed: false,
			isRunning: false,
			isSettling: false,
		},
	};

	button.addEventListener(
		"click",
		(event) => {
			event.preventDefault();
			event.stopImmediatePropagation();
			/*
			 * Pressing this button is the user stating what the log should look
			 * like, so the collapsed default stops applying to this job whatever
			 * the press then does. Disarming before the run also keeps the run's
			 * own header clicks out of the intervention path entirely.
			 */
			disarmAutoCollapse(mounted);

			if (mounted.isExpanding || mounted.spritePrefix === undefined) {
				return;
			}

			const runDocument = button.ownerDocument;
			const state = readSectionState(runDocument);

			if (state === "empty") {
				return;
			}

			if (state === "collapsible") {
				mounted.status.textContent = describeOutcome(
					"Collapsed",
					collapseAllSections(runDocument),
				);
				// The log still shows the pre-click state at this point, so the
				// button can only be re-derived once GitLab has re-rendered.
				scheduleRefresh(mounted);
				return;
			}

			mounted.isExpanding = true;
			renderToggle(mounted);
			const runPath = runDocument.defaultView?.location.pathname;
			void expandAllSections(runDocument, signal)
				.then((expanded) => {
					if (signal.aborted) {
						return;
					}

					mounted.isExpanding = false;

					/* The button is re-derived either way, so a run the user
					 * navigated away from cannot leave it disabled. Only the
					 * announcement is withheld, because it would describe a job
					 * the log no longer shows. */
					if (runDocument.defaultView?.location.pathname === runPath) {
						mounted.status.textContent = describeOutcome("Expanded", expanded);
					}

					renderToggle(mounted);
				})
				.catch((error: unknown) => {
					/* A throw from GitLab's own click handler must not leave the
					 * button disabled for the rest of the page's life. */
					if (signal.aborted) {
						return;
					}

					mounted.isExpanding = false;
					renderToggle(mounted);
					console.error("Tonic could not expand the job log sections", error);
				});
		},
		{ signal },
	);

	togglesBySignal.set(signal, mounted);
	ownedWrappers.add(wrapper);
	signal.addEventListener(
		"abort",
		() => {
			const view = wrapper.ownerDocument.defaultView;

			if (view && mounted.refreshFrame !== undefined) {
				view.cancelAnimationFrame(mounted.refreshFrame);
			}

			mounted.refreshFrame = undefined;
			wrapper.remove();
			togglesBySignal.delete(signal);
			ownedWrappers.delete(wrapper);
		},
		{ once: true },
	);

	return mounted;
}

function repairToggle(
	mounted: MountedToggle,
	contract: JobLogTopBarContract,
): void {
	const { wrapper, button, icon, status, use } = mounted;
	mounted.spritePrefix = contract.spritePrefix;
	const setAttribute = (element: Element, name: string, value: string) => {
		if (element.getAttribute(name) !== value) {
			element.setAttribute(name, value);
		}
	};

	setAttribute(wrapper, TOGGLE_JOB_LOG_SECTIONS_ATTRIBUTE, "");
	setAttribute(button, "type", "button");
	setAttribute(icon, "class", "gl-button-icon gl-icon s16 gl-fill-current");
	setAttribute(icon, "role", "img");
	setAttribute(icon, "aria-hidden", "true");
	setAttribute(status, "class", "gl-sr-only");
	setAttribute(status, TOGGLE_JOB_LOG_SECTIONS_STATUS_ATTRIBUTE, "");
	setAttribute(status, "role", "status");
	setAttribute(status, "aria-live", "polite");
	setAttribute(status, "aria-atomic", "true");

	if (icon.childNodes.length !== 1 || icon.firstChild !== use) {
		icon.replaceChildren(use);
	}

	if (button.childNodes.length !== 1 || button.firstChild !== icon) {
		button.replaceChildren(icon);
	}

	if (
		wrapper.childNodes.length !== 2 ||
		wrapper.firstChild !== button ||
		wrapper.lastChild !== status
	) {
		wrapper.replaceChildren(button, status);
	}
}

function reconcile(
	context: FeatureContext,
	signal: AbortSignal,
	readCollapseByDefaultSetting: () => boolean | undefined,
): void {
	if (signal.aborted) {
		return;
	}

	const mounted = createToggle(context, signal);
	/*
	 * Before the contract is resolved, so that the job this decision belongs to
	 * is tracked even across passes where the top bar is missing. Otherwise a
	 * user intervening during such a pass would be credited to the previous job
	 * and the next resolved pass would re-arm over it.
	 */
	updateAutoCollapseArming(
		mounted,
		context.location,
		readCollapseByDefaultSetting,
	);
	const resolution = resolveTopBar(context, mounted.wrapper);

	if (resolution.status !== "supported") {
		mounted.wrapper.remove();
		mounted.spritePrefix = undefined;
		return;
	}

	repairToggle(mounted, resolution.contract);
	renderToggle(mounted);
	const { group } = resolution.contract;

	if (
		mounted.wrapper.parentElement !== group ||
		group.firstElementChild !== mounted.wrapper
	) {
		group.insertBefore(mounted.wrapper, group.firstChild);
	}

	/*
	 * Only once the button is mounted. Collapsing a log this feature cannot
	 * offer to expand again would leave the user reopening sections one at a
	 * time, which is the same reason the setting depends on the button's own.
	 */
	runAutoCollapse(mounted, context.document);
}

function activate(
	context: FeatureContext,
	signal: AbortSignal,
	readCollapseByDefaultSetting: () => boolean | undefined,
): void {
	const mounted = createToggle(context, signal);

	if (!mounted.hasSectionListener) {
		mounted.hasSectionListener = true;
		const ElementConstructor = context.document.defaultView?.Element;

		/*
		 * A user toggling one section by hand changes what this button should do
		 * next, and nothing else would tell it: the log subtree is deliberately
		 * absent from `mutationSelectors`. One delegated listener in the capture
		 * phase covers every header, including the ones that stream in later, and
		 * survives GitLab replacing the log; it also still sees the click if
		 * GitLab's own handler stops propagation.
		 *
		 * It is also where the collapsed default learns that the user has taken
		 * over. `isTrusted` cannot make that call: this feature's own passes click
		 * headers too, and the flag they hold is the only thing that separates
		 * them from a real click.
		 */
		context.document.addEventListener(
			"click",
			(event) => {
				const { target } = event;

				if (!ElementConstructor || !(target instanceof ElementConstructor)) {
					return;
				}

				if (target.closest(JOB_LOG_SEARCH_BOX_SELECTOR)) {
					disarmAutoCollapse(mounted);
					return;
				}

				if (!target.closest(JOB_LOG_SECTION_HEADER_SELECTOR)) {
					return;
				}

				if (!isFeatureDrivenPass(mounted)) {
					disarmAutoCollapse(mounted);
				}

				scheduleRefresh(mounted);
			},
			{ capture: true, signal },
		);

		/*
		 * GitLab's search box submits on Enter without a click anywhere, and
		 * searching only reaches lines the log has actually rendered. A user
		 * searching is asking to read the log, so the collapsed default stops
		 * applying to this job.
		 */
		context.document.addEventListener(
			"keydown",
			(event) => {
				const { target } = event;

				if (
					event.key === "Enter" &&
					ElementConstructor &&
					target instanceof ElementConstructor &&
					target.closest(JOB_LOG_SEARCH_BOX_SELECTOR)
				) {
					disarmAutoCollapse(mounted);
				}
			},
			{ capture: true, signal },
		);
	}

	reconcile(context, signal, readCollapseByDefaultSetting);
}

export function getToggleJobLogSectionsCompatibility(
	context: FeatureContext,
): FeaturePageCompatibility {
	if (!isJobDetailPath(context.location.pathname)) {
		return "not-applicable";
	}

	return resolveTopBar(context).status === "supported"
		? "supported"
		: "unsupported";
}

/**
 * Both halves of this feature read and write the same section state: the button
 * derives its label and icon from the chevrons in the DOM, and the collapsed
 * default drives those chevrons. Splitting them across two features would let
 * them disagree about the same log.
 *
 * `readCollapseByDefaultSetting` answers `undefined` while the stored settings
 * are still being read, which is what keeps the collapsed default from being
 * decided against the runtime's starting defaults. It is read once per job log,
 * never per pass.
 */
export function createToggleJobLogSectionsFeature(
	readCollapseByDefaultSetting: () => boolean | undefined,
): Feature {
	return {
		id: TOGGLE_JOB_LOG_SECTIONS_ID,
		/*
		 * The log subtree itself is deliberately not declared: a running job
		 * streams lines continuously, and the runtime unions these selectors across
		 * every feature, so a selector matching ordinary log lines would schedule a
		 * reconcile pass for all of them on essentially every frame of output.
		 *
		 * Section headers are declared, because they are what this button reports
		 * on and a queued job paints an empty log before the runner streams any of
		 * them in. The runtime's filter tests added and removed nodes against this
		 * list, and an ordinary log line neither is nor contains a header, so only
		 * the handful of section boundaries in a job wake the pass. It is also what
		 * brings a streamed section under the collapsed default while it is armed.
		 * Toggling a leaf section adds no header at all, which is what the delegated
		 * section click listener still covers.
		 */
		mutationSelectors: [
			JOB_LOG_TOP_BAR_SELECTOR,
			JOB_LOG_SECTION_HEADER_SELECTOR,
			`[${TOGGLE_JOB_LOG_SECTIONS_ATTRIBUTE}]`,
		],
		matches: ({ location }) => isJobDetailPath(location.pathname),
		activate(context, signal) {
			activate(context, signal, readCollapseByDefaultSetting);
		},
		reconcile(context, signal) {
			reconcile(context, signal, readCollapseByDefaultSetting);
		},
	};
}
