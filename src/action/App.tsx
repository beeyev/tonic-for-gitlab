import { type ReactNode, useEffect, useState } from "react";
import {
	AlertTriangleIcon,
	CircleCheckIcon,
	CircleInfoIcon,
} from "../ui/components/icons";
import { cn } from "../ui/lib/utils";
import {
	type CurrentTabStatus,
	queryCurrentTabStatus,
} from "./current-tab-status";
import { TargetList } from "./TargetList";
import { useHostAccess } from "./use-host-access";

export function App() {
	const { homepage_url: homepageUrl, version } = chrome.runtime.getManifest();
	if (!homepageUrl) {
		throw new Error("Extension manifest homepage URL is not configured");
	}
	const [currentTabStatus, setCurrentTabStatus] = useState<CurrentTabStatus>({
		status: "loading",
	});
	const hostAccess = useHostAccess();

	useEffect(() => {
		let isCurrent = true;

		void queryCurrentTabStatus(chrome.tabs)
			.then((status) => {
				if (isCurrent) {
					setCurrentTabStatus(status);
				}
			})
			.catch(() => {
				if (isCurrent) {
					setCurrentTabStatus({ status: "invalid-response" });
				}
			});

		return () => {
			isCurrent = false;
		};
	}, []);

	/*
	 * Present only when a Tonic content script answered, which is exactly when
	 * the current tab belongs to a configured instance. It is compared against
	 * the configured origins and never rendered.
	 */
	const currentOrigin =
		currentTabStatus.status === "mounted" ||
		currentTabStatus.status === "not-gitlab" ||
		currentTabStatus.status === "unavailable"
			? currentTabStatus.origin
			: undefined;

	return (
		<main>
			<header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
				<ProjectHomepageLink
					homepageUrl={homepageUrl}
					iconUrl={chrome.runtime.getURL("icons/icon64.png")}
				/>
				<span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground tabular-nums">
					v{version}
				</span>
			</header>
			<div className="space-y-3 p-3">
				<CurrentTabStatusCard status={currentTabStatus} />
				<TargetList
					busyOrigin={hostAccess.busyOrigin}
					currentOrigin={currentOrigin}
					failure={hostAccess.failure}
					hasStaleTabs={hostAccess.hasStaleTabs}
					isAdding={hostAccess.isAdding}
					isLoading={hostAccess.isLoading}
					onAdd={hostAccess.addOrigin}
					onGrant={hostAccess.grantOrigin}
					onRemove={hostAccess.removeOrigin}
					targets={hostAccess.targets}
				/>
			</div>
		</main>
	);
}

export function ProjectHomepageLink({
	homepageUrl,
	iconUrl,
}: {
	homepageUrl: string;
	iconUrl: string;
}) {
	return (
		<a
			aria-label="Open Tonic for GitLab project homepage"
			className="flex min-w-0 flex-1 items-center gap-2.5 rounded-sm transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
			href={homepageUrl}
			rel="noreferrer"
			target="_blank"
		>
			<img
				alt=""
				aria-hidden="true"
				className="size-7 shrink-0"
				height={28}
				src={iconUrl}
				width={28}
			/>
			<div className="min-w-0">
				<h1 className="truncate text-sm leading-5 font-semibold">
					Tonic for GitLab
				</h1>
				<p className="text-xs text-muted-foreground">
					Focused GitLab improvements
				</p>
			</div>
		</a>
	);
}

const TONES = {
	neutral: {
		card: "border-border bg-muted/60",
		icon: "text-muted-foreground",
	},
	active: {
		card: "border-primary/30 bg-primary/10",
		icon: "text-primary",
	},
	warning: {
		card: "border-warning/30 bg-warning/10",
		icon: "text-warning",
	},
} as const;

function StatusCard({
	tone,
	icon,
	children,
}: {
	tone: keyof typeof TONES;
	icon: ReactNode;
	children: ReactNode;
}) {
	return (
		// One polite live region for every state: the result arrives after the
		// popup opens, and swapping content inside a stable region announces the
		// change instead of the region's own arrival.
		<section
			role="status"
			aria-live="polite"
			className={cn(
				"flex items-start gap-2.5 rounded-lg border p-3",
				TONES[tone].card,
			)}
		>
			<span className={cn("mt-px", TONES[tone].icon)}>{icon}</span>
			<div className="min-w-0 flex-1 space-y-1">{children}</div>
		</section>
	);
}

export function CurrentTabStatusCard({ status }: { status: CurrentTabStatus }) {
	if (status.status === "loading") {
		return (
			<StatusCard
				tone="neutral"
				icon={<CircleInfoIcon className="animate-pulse" />}
			>
				<p>Checking page controls...</p>
			</StatusCard>
		);
	}

	if (status.status === "mounted") {
		return (
			<StatusCard tone="active" icon={<CircleCheckIcon />}>
				<h2 className="text-sm leading-5 font-medium">Page controls active</h2>
				<p className="text-xs leading-relaxed text-muted-foreground">
					Open the Tonic button in the GitLab top bar to change settings.
				</p>
			</StatusCard>
		);
	}

	if (status.status === "unavailable") {
		return (
			<StatusCard tone="warning" icon={<AlertTriangleIcon />}>
				<h2 className="text-sm leading-5 font-medium">
					Page controls unavailable
				</h2>
				<p className="text-xs leading-relaxed text-muted-foreground">
					Tonic could not find a compatible GitLab top bar. Reload the page. If
					the problem continues, report the GitLab version with diagnostic code{" "}
					<code className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[0.6875rem] text-foreground">
						{status.reason}
					</code>
					.
				</p>
			</StatusCard>
		);
	}

	// Typed as a total map over the remaining states, so a new status added to
	// the protocol fails to compile instead of silently reusing another message.
	const messages: Record<typeof status.status, string> = {
		/*
		 * Neutral, not a warning. A configured instance is an origin, so Tonic
		 * also loads on whatever else that host serves. Nothing is broken.
		 */
		"not-gitlab": "This page is not GitLab, so Tonic left it alone.",
		"no-active-tab": "No active browser tab is available.",
		"tab-query-failed": "The browser did not report the active tab.",
		"message-failed":
			"Tonic could not contact this page. Reload it if Tonic should be active here.",
		"invalid-response": "The page returned an invalid Tonic status response.",
	};

	return (
		<StatusCard tone="neutral" icon={<CircleInfoIcon />}>
			<p>{messages[status.status]}</p>
		</StatusCard>
	);
}
