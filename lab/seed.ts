/**
 * Seeds every lab GitLab instance with users, groups, projects and merge requests.
 *
 * Runs inside the compose network as a one-shot service. Each instance is reached
 * by its service name; the admin token is minted by the instance itself after
 * reconfigure and published on the shared `tokens` volume.
 *
 * Every step is idempotent: existing objects are reused, never recreated.
 *
 * The fixture set is chosen to cover the data shapes features need:
 * bot authors, approvals, resolved and unresolved threads, discussion pagination,
 * merged and closed rows, a non-default target branch, a large diff, a nested
 * subgroup with a long project path, and duplicate display names.
 */

import { existsSync, readFileSync } from "node:fs";

type Instance = {
	id: string;
	baseUrl: string;
	publicUrl: string;
	tokenFile: string;
};

// One entry per service in compose.yaml, which is one per supported GitLab major.
const INSTANCES: Instance[] = [
	{
		id: "19",
		baseUrl: "http://gitlab-19",
		publicUrl: "http://localhost:10019",
		tokenFile: "/lab/token-19",
	},
];

const ROOT_PASSWORD = "Kestrel-Anchor-7413";
const USER_PASSWORD = "Basalt-Meadow-2610";
const GROUP_PATH = "tonic-lab";
const GROUP_NAME = "Tonic Lab";
const SUBGROUP_PATH = "platform";
const SUBGROUP_NAME = "Platform";
const MILESTONE_TITLE = "Sprint 42";

type LabUser = { username: string; name: string };

const USERS: LabUser[] = [
	{ username: "alice", name: "Alice Ivanova" },
	{ username: "bob", name: "Bob Petrov" },
	{ username: "carol", name: "Carol Sidorova" },
	// Same display name, different accounts: the case that makes usernames worth showing.
	{ username: "a.ivanov", name: "Alexander Ivanov" },
	{ username: "alex.ivanov", name: "Alexander Ivanov" },
	// A bot running as an ordinary account, which is how Renovate is usually deployed.
	{ username: "renovate", name: "Renovate Bot" },
];

type LabelSpec = { name: string; color: string };

// `::` names are plain labels in CE. Scoped-label behavior itself is Premium,
// but the naming convention is what shows up in lists and is worth having here.
const LABELS: LabelSpec[] = [
	{ name: "bug", color: "#d9534f" },
	{ name: "needs-review", color: "#428bca" },
	{ name: "priority::high", color: "#c9302c" },
	{ name: "priority::low", color: "#5bc0de" },
];

type FileSpec = { path: string; content: string };

type ThreadSpec = { author: string; body: string; resolved: boolean };

type MergeRequestSpec = {
	/** Username, or the access token name when `projectBot` is set. */
	author: string;
	branch: string;
	title: string;
	draft?: boolean;
	/** Defaults to the project default branch. */
	target?: string;
	labels?: string[];
	milestone?: boolean;
	reviewers?: string[];
	approvals?: string[];
	state?: "merged" | "closed";
	threads?: ThreadSpec[];
	/** Bulk threads, to exercise discussion pagination past GitLab's page size. */
	bulkThreads?: number;
	/** Defaults to a single small note file. */
	files?: FileSpec[];
	/** Author through a project access token. GitLab records a `project_N_bot_*` user. */
	projectBot?: boolean;
};

/** Rows every project gets: drafts and ready work from every human author. */
const BASE_MERGE_REQUESTS: MergeRequestSpec[] = [
	{
		author: "root",
		draft: true,
		branch: "root-toolbar",
		title: "Rework the toolbar layout",
	},
	{
		author: "root",
		draft: false,
		branch: "root-cache",
		title: "Cache resolved settings",
		labels: ["bug"],
		milestone: true,
	},
	{
		author: "alice",
		draft: true,
		branch: "alice-router",
		title: "Split the router module",
		threads: [
			{ author: "bob", body: "Why split this file at all?", resolved: false },
			{ author: "carol", body: "Naming looks fine now.", resolved: true },
		],
	},
	{
		author: "alice",
		draft: false,
		branch: "alice-icons",
		title: "Refresh the icon set",
		reviewers: ["bob"],
		// Approved by someone else: the row that must not read as approved by me.
		approvals: ["bob"],
	},
	{
		author: "bob",
		draft: true,
		branch: "bob-logging",
		title: "Add structured logging",
	},
	{
		author: "bob",
		draft: false,
		branch: "bob-retry",
		title: "Retry failed uploads",
		reviewers: ["root"],
		// Approved by root, which is the account the lab is normally driven from.
		approvals: ["root"],
	},
	{
		author: "carol",
		draft: false,
		branch: "carol-docs",
		title: "Document the API surface",
		labels: ["needs-review", "priority::high"],
	},
];

/** Everything that only exists on the busiest project. */
const EXTRA_MERGE_REQUESTS: MergeRequestSpec[] = [
	{
		author: "renovate",
		branch: "renovate-lodash",
		title: "chore(deps): bump lodash from 4.17.20 to 4.17.21",
	},
	{
		author: "dependabot",
		projectBot: true,
		branch: "dependabot-npm",
		title: "chore(deps): bump the npm group with 3 updates",
	},
	{
		author: "alice",
		branch: "alice-ttl",
		title: "Tune the cache TTL",
		state: "merged",
	},
	{
		author: "bob",
		branch: "bob-uploader",
		title: "Drop the legacy uploader",
		state: "closed",
	},
	{
		author: "carol",
		branch: "carol-backport",
		title: "Prepare the 1.x backport",
		// Targets a maintenance branch instead of the default one.
		target: "release/1.x",
	},
	{
		author: "alice",
		branch: "alice-lockfile",
		title: "Rebuild the lockfile",
		files: largeChangeset(),
	},
	{
		author: "bob",
		branch: "bob-settings",
		title: "Refactor the settings store",
		// Past GitLab's 20-per-page discussion default, which is where upstream
		// implementations have historically counted only the first page.
		bulkThreads: 25,
	},
];

/** Rows for the nested project, so group-level lists span three projects. */
const NESTED_MERGE_REQUESTS: MergeRequestSpec[] = [
	{
		author: "alice",
		branch: "alice-runner",
		title: "Pin the runner image",
	},
	{
		author: "a.ivanov",
		branch: "ivanov-metrics",
		title: "Export build metrics",
	},
	{
		// Pairs with the row above: same display name, different account, so a list
		// actually renders the ambiguity instead of only the user directory holding it.
		author: "alex.ivanov",
		branch: "ivanov-tracing",
		title: "Add request tracing",
	},
	{
		author: "renovate",
		branch: "renovate-actions",
		title: "chore(deps): bump the ci group with 2 updates",
	},
];

type ProjectSpec = {
	path: string;
	name: string;
	nested?: boolean;
	mergeRequests: MergeRequestSpec[];
	/** Extra branches to create before merge requests, for non-default targets. */
	branches?: string[];
};

const PROJECTS: ProjectSpec[] = [
	{
		path: "frontend",
		name: "Frontend",
		mergeRequests: [...BASE_MERGE_REQUESTS, ...EXTRA_MERGE_REQUESTS],
		branches: ["release/1.x"],
	},
	{ path: "backend", name: "Backend", mergeRequests: BASE_MERGE_REQUESTS },
	{
		// Long path on purpose: list rows truncate it, which is a backlog item.
		path: "internal-developer-platform",
		name: "Internal Developer Platform",
		nested: true,
		mergeRequests: NESTED_MERGE_REQUESTS,
	},
];

/** A changeset big enough to exercise diff collapsing, file trees and filtering. */
function largeChangeset(): FileSpec[] {
	const files: FileSpec[] = [
		{
			path: "bun.lock",
			content: Array.from(
				{ length: 800 },
				(_unused, index) => `  "package-${index}": "1.0.${index}",`,
			).join("\n"),
		},
		{
			path: "dist/bundle.generated.js",
			content: "// generated, do not edit\n",
		},
		// Without this GitLab has no reason to treat the file above as generated,
		// and the collapsed-by-default case never appears.
		{ path: ".gitattributes", content: "dist/** linguist-generated=true\n" },
	];

	for (let index = 1; index <= 10; index++) {
		files.push({
			path: `src/module-${index}/index.ts`,
			content: `export const module${index} = ${index};\n`,
		});
	}

	return files;
}

type ApiResult = { status: number; body: unknown };

type RequestOptions = {
	body?: unknown;
	sudo?: string;
	allowStatus?: number[];
	/** Statuses worth waiting out instead of failing, e.g. lagging authorization. */
	retryStatus?: number[];
};

class Client {
	private readonly instance: Instance;
	private readonly token: string;

	constructor(instance: Instance, token: string) {
		this.instance = instance;
		this.token = token;
	}

	async request(
		method: string,
		path: string,
		options: RequestOptions = {},
	): Promise<ApiResult> {
		const headers: Record<string, string> = { "PRIVATE-TOKEN": this.token };

		// `root` owns the token already; sending Sudo for it is a no-op with extra risk.
		if (options.sudo !== undefined && options.sudo !== "root") {
			headers.Sudo = options.sudo;
		}

		let payload: string | undefined;
		if (options.body !== undefined) {
			headers["Content-Type"] = "application/json";
			payload = JSON.stringify(options.body);
		}

		const url = `${this.instance.baseUrl}/api/v4${path}`;
		const allowed = options.allowStatus ?? [];
		const retryable = options.retryStatus ?? [];

		let lastError = "";
		// GitLab can still be wiring up Workhorse right after the health probe passes.
		for (let attempt = 1; attempt <= 20; attempt++) {
			try {
				const response = await fetch(url, { method, headers, body: payload });
				const text = await response.text();
				const parsed = parseBody(text);

				if (response.ok || allowed.includes(response.status)) {
					return { status: response.status, body: parsed };
				}

				if (response.status < 500 && !retryable.includes(response.status)) {
					throw new Error(
						`${method} ${path} failed with ${response.status}: ${text.slice(0, 400)}`,
					);
				}

				lastError = `${response.status}: ${text.slice(0, 200)}`;
			} catch (error) {
				if (error instanceof Error && error.message.includes("failed with")) {
					throw error;
				}
				lastError = error instanceof Error ? error.message : String(error);
			}

			if (attempt < 20) {
				await sleep(3000);
			}
		}

		throw new Error(`${method} ${path} kept failing: ${lastError}`);
	}

	async get(path: string, options: RequestOptions = {}): Promise<ApiResult> {
		return this.request("GET", path, options);
	}

	async post(path: string, options: RequestOptions = {}): Promise<ApiResult> {
		return this.request("POST", path, options);
	}

	async put(path: string, options: RequestOptions = {}): Promise<ApiResult> {
		return this.request("PUT", path, options);
	}
}

function parseBody(text: string): unknown {
	if (text === "") {
		return null;
	}
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(
			`Expected an object, got ${JSON.stringify(value).slice(0, 200)}`,
		);
	}
	return value as Record<string, unknown>;
}

function numberField(value: unknown, field: string): number {
	const raw = asRecord(value)[field];
	if (typeof raw !== "number") {
		throw new Error(
			`Expected numeric "${field}" in ${JSON.stringify(value).slice(0, 200)}`,
		);
	}
	return raw;
}

function stringField(value: unknown, field: string): string {
	const raw = asRecord(value)[field];
	if (typeof raw !== "string") {
		throw new Error(
			`Expected string "${field}" in ${JSON.stringify(value).slice(0, 200)}`,
		);
	}
	return raw;
}

function booleanField(value: unknown, field: string): boolean {
	const raw = asRecord(value)[field];
	if (typeof raw !== "boolean") {
		throw new Error(
			`Expected boolean "${field}" in ${JSON.stringify(value).slice(0, 200)}`,
		);
	}
	return raw;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function sameSet(left: string[], right: string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	const sortedLeft = [...left].sort();
	const sortedRight = [...right].sort();
	return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/** Follows pagination, because 100 per page is GitLab's hard maximum. */
async function fetchAll(client: Client, path: string): Promise<unknown[]> {
	const items: unknown[] = [];
	const separator = path.includes("?") ? "&" : "?";

	for (let page = 1; page <= 20; page++) {
		const result = await client.get(
			`${path}${separator}per_page=100&page=${page}`,
		);
		const batch = asArray(result.body);
		items.push(...batch);
		if (batch.length < 100) {
			break;
		}
	}

	return items;
}

async function readToken(instance: Instance): Promise<string> {
	const deadline = Date.now() + 20 * 60 * 1000;

	while (Date.now() < deadline) {
		if (existsSync(instance.tokenFile)) {
			const token = readFileSync(instance.tokenFile, "utf8").trim();
			if (token !== "") {
				return token;
			}
		}
		await sleep(2000);
	}

	throw new Error(`No admin token appeared at ${instance.tokenFile}`);
}

async function ensureApplicationSettings(client: Client): Promise<void> {
	const settings = await client.get("/application/settings");
	const wantedBooleans = {
		auto_devops_enabled: false,
		gravatar_enabled: false,
		repository_checks_enabled: false,
		update_runner_versions_enabled: false,
		version_check_enabled: false,
	};
	const changes: Record<string, boolean | string> = {};

	for (const [name, wanted] of Object.entries(wantedBooleans)) {
		if (booleanField(settings.body, name) !== wanted) {
			changes[name] = wanted;
		}
	}

	if (stringField(settings.body, "whats_new_variant") !== "disabled") {
		changes.whats_new_variant = "disabled";
	}

	if (Object.keys(changes).length === 0) {
		return;
	}

	await client.put("/application/settings", {
		body: changes,
	});
}

async function ensureUser(client: Client, user: LabUser): Promise<number> {
	const existing = await client.get(
		`/users?username=${encodeURIComponent(user.username)}`,
	);
	if (Array.isArray(existing.body) && existing.body.length > 0) {
		return numberField(existing.body[0], "id");
	}

	const created = await client.post("/users", {
		body: {
			email: `${user.username}@lab.test`,
			username: user.username,
			name: user.name,
			password: USER_PASSWORD,
			skip_confirmation: true,
		},
	});

	return numberField(created.body, "id");
}

type Namespace = { id: number; path: string };

async function ensureGroup(
	client: Client,
	path: string,
	name: string,
	parent?: Namespace,
): Promise<Namespace> {
	const fullPath = parent === undefined ? path : `${parent.path}/${path}`;
	const existing = await client.get(`/groups/${encodeURIComponent(fullPath)}`, {
		allowStatus: [404],
	});
	if (existing.status === 200) {
		return { id: numberField(existing.body, "id"), path: fullPath };
	}

	const created = await client.post("/groups", {
		body: { name, path, visibility: "public", parent_id: parent?.id },
	});

	return { id: numberField(created.body, "id"), path: fullPath };
}

async function ensureMember(
	client: Client,
	groupId: number,
	userId: number,
): Promise<void> {
	// 409 means the membership is already there.
	await client.post(`/groups/${groupId}/members`, {
		body: { user_id: userId, access_level: 30 },
		allowStatus: [409],
	});
}

async function ensureLabels(client: Client, groupId: number): Promise<void> {
	for (const label of LABELS) {
		await client.post(`/groups/${groupId}/labels`, {
			body: { name: label.name, color: label.color },
			allowStatus: [409],
		});
	}
}

async function ensureMilestone(
	client: Client,
	groupId: number,
): Promise<number> {
	const existing = await client.get(
		`/groups/${groupId}/milestones?search=${encodeURIComponent(MILESTONE_TITLE)}`,
	);
	for (const milestone of asArray(existing.body)) {
		if (stringField(milestone, "title") === MILESTONE_TITLE) {
			return numberField(milestone, "id");
		}
	}

	const created = await client.post(`/groups/${groupId}/milestones`, {
		body: { title: MILESTONE_TITLE },
	});

	return numberField(created.body, "id");
}

type Project = { id: number; defaultBranch: string };

async function ensureProject(
	client: Client,
	namespace: Namespace,
	spec: ProjectSpec,
): Promise<Project> {
	const fullPath = encodeURIComponent(`${namespace.path}/${spec.path}`);
	const existing = await client.get(`/projects/${fullPath}`, {
		allowStatus: [404],
	});

	let project =
		existing.status === 200
			? existing.body
			: (
					await client.post("/projects", {
						body: {
							name: spec.name,
							path: spec.path,
							namespace_id: namespace.id,
							visibility: "public",
							initialize_with_readme: true,
						},
					})
				).body;

	const id = numberField(project, "id");

	// The initial commit is created asynchronously, so default_branch can lag.
	// The payload in hand usually already carries it; only poll when it does not.
	for (let attempt = 1; attempt <= 30; attempt++) {
		const branch = asRecord(project).default_branch;
		if (typeof branch === "string" && branch !== "") {
			return { id, defaultBranch: branch };
		}
		await sleep(2000);
		project = (await client.get(`/projects/${id}`)).body;
	}

	throw new Error(`Project ${spec.path} never reported a default branch`);
}

/**
 * GitLab protects the default branch with Maintainer-only push and merge, so the
 * Developer-level lab users get no Merge button on a merge request that targets it.
 * Lower merge access to Developer. CE cannot patch access levels on an existing
 * rule, so an unwanted rule is dropped and rebuilt.
 */
async function ensureDeveloperMergeAccess(
	client: Client,
	project: Project,
): Promise<void> {
	const path = `/projects/${project.id}/protected_branches/${encodeURIComponent(project.defaultBranch)}`;
	const existing = await client.get(path, { allowStatus: [404] });

	if (existing.status === 200) {
		if (allowsDeveloperMerge(existing.body)) {
			return;
		}

		await client.request("DELETE", path);
	}

	// Push access is left at the GitLab default, Maintainers: merging goes through
	// GitLab itself, and the lab users only ever push to their feature branches.
	await client.post(`/projects/${project.id}/protected_branches`, {
		body: { name: project.defaultBranch, merge_access_level: 30 },
	});
}

function allowsDeveloperMerge(rule: unknown): boolean {
	return asArray(asRecord(rule).merge_access_levels).some((entry) => {
		const level = asRecord(entry).access_level;

		return typeof level === "number" && level <= 30;
	});
}

async function ensureBranch(
	client: Client,
	project: Project,
	branch: string,
): Promise<void> {
	const existing = await client.get(
		`/projects/${project.id}/repository/branches/${encodeURIComponent(branch)}`,
		{ allowStatus: [404] },
	);
	if (existing.status === 200) {
		return;
	}

	await client.post(
		`/projects/${project.id}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(project.defaultBranch)}`,
	);
}

/**
 * Mints a project access token. GitLab represents the holder as a bot user, which
 * is the shape bot-detection features have to recognize. The token value cannot be
 * read back later, so this only runs when the bot's merge request is missing.
 */
async function mintBotToken(
	client: Client,
	project: Project,
	name: string,
): Promise<string> {
	// Names are not unique, and every token gets its own bot user, so a second
	// mint after a half-finished run would leave two bots behind. Rotate instead.
	const found = await client.get(`/projects/${project.id}/access_tokens`);
	for (const token of asArray(found.body)) {
		if (stringField(token, "name") === name) {
			const rotated = await client.post(
				`/projects/${project.id}/access_tokens/${numberField(token, "id")}/rotate`,
				{ body: { expires_at: expiryDate() } },
			);
			return stringField(rotated.body, "token");
		}
	}

	const created = await client.post(`/projects/${project.id}/access_tokens`, {
		body: {
			name,
			scopes: ["api"],
			access_level: 40,
			expires_at: expiryDate(),
		},
	});

	return stringField(created.body, "token");
}

function expiryDate(): string {
	const date = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000);
	return date.toISOString().slice(0, 10);
}

function fileActions(spec: MergeRequestSpec): unknown[] {
	const files = spec.files ?? [
		{
			path: `lab/${spec.branch}.md`,
			content: `# ${spec.title}\n\nLab fixture branch for ${spec.author}.\n`,
		},
	];

	return files.map((file) => ({
		action: "create",
		file_path: file.path,
		content: file.content,
	}));
}

async function ensureMergeRequest(
	client: Client,
	instance: Instance,
	project: Project,
	spec: MergeRequestSpec,
	context: SeedContext,
	existing: unknown,
): Promise<void> {
	const branch = `feature/${spec.branch}`;
	const target = spec.target ?? project.defaultBranch;

	let iid: number;
	if (existing !== undefined) {
		iid = await reconcileMergeRequest(client, project, spec, existing, context);
	} else {
		// A project access token author needs its own client; Sudo cannot impersonate a bot.
		const author = spec.projectBot
			? new Client(instance, await mintBotToken(client, project, spec.author))
			: client;
		const sudo = spec.projectBot ? undefined : spec.author;

		const branchProbe = await client.get(
			`/projects/${project.id}/repository/branches/${encodeURIComponent(branch)}`,
			{ allowStatus: [404] },
		);

		if (branchProbe.status === 404) {
			// A freshly created project authorizes its inherited members through a
			// background worker, so a group developer can get 403 for a few seconds.
			await author.post(`/projects/${project.id}/repository/commits`, {
				sudo,
				retryStatus: [403],
				body: {
					branch,
					start_branch: target,
					commit_message: `Add lab notes for ${spec.branch}`,
					actions: fileActions(spec),
				},
			});
		}

		const created = await author.post(
			`/projects/${project.id}/merge_requests`,
			{
				sudo,
				retryStatus: [403],
				body: {
					source_branch: branch,
					target_branch: target,
					title: spec.draft ? `Draft: ${spec.title}` : spec.title,
					description: `Lab merge request authored by ${spec.author}.`,
					// Give root some assigned rows to look at without authoring them.
					assignee_id: spec.author === "root" ? undefined : context.rootId,
					reviewer_ids: spec.reviewers?.map((name) => context.userId(name)),
					labels: spec.labels?.join(","),
					milestone_id: spec.milestone ? context.milestoneId : undefined,
					// A merged row keeps its branch so branch-cleanup features have work to do.
					remove_source_branch: spec.state !== "merged",
				},
			},
		);

		iid = numberField(created.body, "iid");
	}

	await ensureThreads(client, project, iid, spec);
	await ensureApprovals(client, project, iid, spec);
	await ensureState(client, project, iid, spec);
}

/**
 * Brings an existing merge request back to the shape of its spec. Fixture edits
 * would otherwise never reach a lab that was seeded by an earlier revision, and
 * the run would report success while the data stayed stale.
 */
async function reconcileMergeRequest(
	client: Client,
	project: Project,
	spec: MergeRequestSpec,
	existing: unknown,
	context: SeedContext,
): Promise<number> {
	const record = asRecord(existing);
	const iid = numberField(record, "iid");
	if (stringField(record, "state") !== "opened") {
		return iid;
	}

	const changes: Record<string, unknown> = {};

	const title = spec.draft ? `Draft: ${spec.title}` : spec.title;
	if (record.title !== title) {
		changes.title = title;
	}

	const target = spec.target ?? project.defaultBranch;
	if (record.target_branch !== target) {
		changes.target_branch = target;
	}

	const labels = spec.labels ?? [];
	if (!sameSet(asArray(record.labels).map(String), labels)) {
		changes.labels = labels.join(",");
	}

	// `0` is how GitLab unassigns a milestone.
	const milestoneId = spec.milestone ? context.milestoneId : 0;
	const milestone = record.milestone;
	const currentMilestone =
		milestone === null || milestone === undefined
			? 0
			: numberField(milestone, "id");
	if (currentMilestone !== milestoneId) {
		changes.milestone_id = milestoneId;
	}

	const reviewers = (spec.reviewers ?? []).map((name) => context.userId(name));
	const currentReviewers = asArray(record.reviewers).map((user) =>
		numberField(user, "id"),
	);
	if (!sameSet(currentReviewers.map(String), reviewers.map(String))) {
		changes.reviewer_ids = reviewers;
	}

	// Give root some assigned rows to look at without authoring them.
	const assignees = spec.author === "root" ? [] : [context.rootId];
	const currentAssignees = asArray(record.assignees).map((user) =>
		numberField(user, "id"),
	);
	if (!sameSet(currentAssignees.map(String), assignees.map(String))) {
		changes.assignee_ids = assignees;
	}

	if (Object.keys(changes).length > 0) {
		await client.put(`/projects/${project.id}/merge_requests/${iid}`, {
			body: changes,
		});
	}

	return iid;
}

async function ensureThreads(
	client: Client,
	project: Project,
	iid: number,
	spec: MergeRequestSpec,
): Promise<void> {
	const wanted = spec.threads ?? [];
	const bulk = spec.bulkThreads ?? 0;
	if (wanted.length === 0 && bulk === 0) {
		return;
	}

	const path = `/projects/${project.id}/merge_requests/${iid}/discussions`;

	// Matched by note body rather than counted: a run interrupted part way through
	// would otherwise append the whole set again on the next pass.
	// System notes (label changes, state changes) arrive as individual notes.
	const byBody = new Map<string, unknown>();
	for (const discussion of await fetchAll(client, path)) {
		if (asRecord(discussion).individual_note !== false) {
			continue;
		}
		const first = asArray(asRecord(discussion).notes)[0];
		if (first !== undefined) {
			byBody.set(stringField(first, "body"), discussion);
		}
	}

	for (const thread of wanted) {
		let discussion = byBody.get(thread.body);
		if (discussion === undefined) {
			discussion = (
				await client.post(path, {
					sudo: thread.author,
					body: { body: thread.body },
				})
			).body;
		}

		// Re-checked every run: a resolve that failed last time must still land.
		const first = asArray(asRecord(discussion).notes)[0];
		const resolved = first !== undefined && asRecord(first).resolved === true;
		if (thread.resolved && !resolved) {
			await client.put(
				`${path}/${stringField(discussion, "id")}?resolved=true`,
			);
		}
	}

	const authors = ["alice", "bob", "carol"];
	for (let index = 1; index <= bulk; index++) {
		const body = `Bulk lab thread ${index}.`;
		if (byBody.has(body)) {
			continue;
		}
		await client.post(path, {
			sudo: authors[index % authors.length],
			body: { body },
		});
	}
}

async function ensureApprovals(
	client: Client,
	project: Project,
	iid: number,
	spec: MergeRequestSpec,
): Promise<void> {
	const wanted = spec.approvals ?? [];
	if (wanted.length === 0) {
		return;
	}

	// GitLab answers 401 both for a repeat approval and for a user who cannot
	// approve yet, so treating 401 as success would hide the second case. Read the
	// current approvals instead, and let a lagging membership retry into place.
	const current = await client.get(
		`/projects/${project.id}/merge_requests/${iid}/approvals`,
	);
	const already = new Set(
		asArray(asRecord(current.body).approved_by).map((entry) =>
			stringField(asRecord(entry).user, "username"),
		),
	);

	for (const approver of wanted) {
		if (already.has(approver)) {
			continue;
		}
		await client.post(`/projects/${project.id}/merge_requests/${iid}/approve`, {
			sudo: approver,
			retryStatus: [401],
		});
	}
}

async function ensureState(
	client: Client,
	project: Project,
	iid: number,
	spec: MergeRequestSpec,
): Promise<void> {
	if (spec.state === undefined) {
		return;
	}

	const current = await client.get(
		`/projects/${project.id}/merge_requests/${iid}`,
	);
	if (stringField(current.body, "state") !== "opened") {
		return;
	}

	if (spec.state === "closed") {
		await client.put(
			`/projects/${project.id}/merge_requests/${iid}?state_event=close`,
		);
		return;
	}

	// GitLab 19 rejects a merge without the head SHA. The SHA appears once the
	// diff is computed, which is a background job.
	let sha = asRecord(current.body).sha;
	for (let attempt = 1; attempt <= 30 && typeof sha !== "string"; attempt++) {
		await sleep(2000);
		const refreshed = await client.get(
			`/projects/${project.id}/merge_requests/${iid}`,
		);
		sha = asRecord(refreshed.body).sha;
	}

	if (typeof sha !== "string") {
		throw new Error(`Merge request ${iid} never reported a head SHA`);
	}

	// Mergeability is computed in the background, so a fresh MR answers 405 for a
	// moment. 409 and 406 are permanent for a fixed `sha`, so retrying them would
	// only burn the whole retry budget and bury the real reason.
	await client.put(`/projects/${project.id}/merge_requests/${iid}/merge`, {
		body: { sha },
		retryStatus: [405, 422],
	});
}

type SeedContext = {
	rootId: number;
	milestoneId: number;
	userId: (username: string) => number;
};

async function seedInstance(instance: Instance): Promise<void> {
	const log = (message: string) =>
		console.log(`[gitlab-${instance.id}] ${message}`);

	log("waiting for the admin token");
	const client = new Client(instance, await readToken(instance));

	const version = await client.get("/version");
	log(`version ${stringField(version.body, "version")}`);
	await ensureApplicationSettings(client);
	log("application settings ready");

	const rootId = numberField((await client.get("/user")).body, "id");
	const group = await ensureGroup(client, GROUP_PATH, GROUP_NAME);
	const subgroup = await ensureGroup(
		client,
		SUBGROUP_PATH,
		SUBGROUP_NAME,
		group,
	);
	await ensureLabels(client, group.id);
	const milestoneId = await ensureMilestone(client, group.id);
	log(`group ${GROUP_PATH} ready with labels and ${MILESTONE_TITLE}`);

	const ids = new Map<string, number>([["root", rootId]]);
	for (const user of USERS) {
		const userId = await ensureUser(client, user);
		await ensureMember(client, group.id, userId);
		ids.set(user.username, userId);
	}
	log(`users ready: ${USERS.map((user) => user.username).join(", ")}`);

	const context: SeedContext = {
		rootId,
		milestoneId,
		userId: (username) => {
			const id = ids.get(username);
			if (id === undefined) {
				throw new Error(`Unknown lab user ${username}`);
			}
			return id;
		},
	};

	for (const spec of PROJECTS) {
		const namespace = spec.nested ? subgroup : group;
		const project = await ensureProject(client, namespace, spec);
		await ensureDeveloperMergeAccess(client, project);

		for (const branch of spec.branches ?? []) {
			await ensureBranch(client, project, branch);
		}

		// One list per project instead of one lookup per merge request.
		const existing = new Map<string, unknown>();
		for (const mergeRequest of await fetchAll(
			client,
			`/projects/${project.id}/merge_requests?state=all`,
		)) {
			existing.set(stringField(mergeRequest, "source_branch"), mergeRequest);
		}

		for (const mergeRequest of spec.mergeRequests) {
			await ensureMergeRequest(
				client,
				instance,
				project,
				mergeRequest,
				context,
				existing.get(`feature/${mergeRequest.branch}`),
			);
		}

		log(
			`project ${namespace.path}/${spec.path} ready with ${spec.mergeRequests.length} merge requests`,
		);
	}

	log(`done: ${instance.publicUrl}/${GROUP_PATH}`);
}

async function main(): Promise<void> {
	// Sequential on purpose: two omnibus instances under load are slow enough already.
	for (const instance of INSTANCES) {
		await seedInstance(instance);
	}

	console.log("");
	console.log("Lab ready:");
	for (const instance of INSTANCES) {
		console.log(`  GitLab ${instance.id}: ${instance.publicUrl}`);
		console.log(
			`    project list:  ${instance.publicUrl}/${GROUP_PATH}/frontend/-/merge_requests`,
		);
		console.log(
			`    group list:    ${instance.publicUrl}/groups/${GROUP_PATH}/-/merge_requests`,
		);
	}
	console.log(`  root / ${ROOT_PASSWORD}`);
	console.log(
		`  ${USERS.map((user) => user.username).join(", ")} / ${USER_PASSWORD}`,
	);
}

await main();
