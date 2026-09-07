export const JOB_LOG_TOP_BAR_SELECTOR = ".js-job-log-top-bar";

/**
 * The scroll-to-top control, used only to locate the icon button group it sits
 * in: the group itself carries nothing but layout classes, and this is the
 * closest production test hook to it.
 */
export const JOB_LOG_TOP_BAR_ANCHOR_SELECTOR =
	'[data-testid="job-top-bar-scroll-top"]';

export const JOB_LOG_TOP_BAR_ICON_SELECTOR = "use[href]";

/**
 * GitLab's search-by-click box in the top bar, from the `jobLogTestId` wrapper
 * attribute `job_log_top_bar.vue` passes to `GlSearchBoxByClick`.
 *
 * Used only to notice that the user is searching the log. Search reads the
 * rendered lines, and a collapsed section renders none of them, so a search is
 * a request to keep whatever is currently open.
 */
export const JOB_LOG_SEARCH_BOX_SELECTOR = '[data-testid="job-log-search-box"]';

export const JOB_LOG_SECTION_HEADER_SELECTOR = ".job-log-line-header";

/**
 * The job log DOM is flat: a closed section's lines, including the headers of
 * any sections nested inside it, are not rendered at all. So a header carries
 * its own open or closed state in the chevron GitLab renders inside it, and
 * that is the only place the state is readable from. The Vuex store that owns
 * it belongs to the page's own JavaScript world.
 */
export const JOB_LOG_SECTION_OPEN_ICON_SELECTOR =
	'svg[data-testid="chevron-lg-down-icon"]';

export const JOB_LOG_SECTION_CLOSED_ICON_SELECTOR =
	'svg[data-testid="chevron-lg-right-icon"]';

export const TOGGLE_JOB_LOG_SECTIONS_ATTRIBUTE =
	"data-tonic-for-gitlab-toggle-job-log-sections";

export const TOGGLE_JOB_LOG_SECTIONS_STATUS_ATTRIBUTE =
	"data-tonic-for-gitlab-toggle-job-log-sections-status";
