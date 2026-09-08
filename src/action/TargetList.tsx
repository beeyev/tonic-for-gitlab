import { type FormEvent, useId, useState } from "react";
import type { TargetAccess, TargetState } from "../host-access/registration";
import { BUILT_IN_ORIGIN } from "../host-access/target-origin";
import { Button } from "../ui/components/button";
import { PlusIcon, TrashIcon } from "../ui/components/icons";
import { Input } from "../ui/components/input";
import type { AddOriginRejection, HostAccessFailure } from "./use-host-access";

const ACCESS_LABELS: Record<TargetAccess, string> = {
	active: "Enabled",
	"permission-required": "Access needed",
	"registration-failed": "Could not be enabled",
};

// Total maps: a new rejection or failure fails to compile rather than
// silently reusing another message.
const REJECTION_MESSAGES: Record<AddOriginRejection, string> = {
	empty: "Enter a GitLab address.",
	"invalid-url": "That is not a valid address.",
	"unsupported-protocol": "Only http:// and https:// addresses work.",
	"credentials-not-allowed":
		"Remove the username and password from the address.",
	"built-in": "GitLab.com is built in and always enabled.",
	duplicate: "That instance is already in the list.",
	busy: "Finish the current access change, then try again.",
};

const FAILURE_MESSAGES: Record<HostAccessFailure, string> = {
	"reconcile-failed":
		"Tonic could not read which instances it has access to. Reopen this popup to retry.",
	"untrusted-targets":
		"Tonic could not read your saved GitLab instances. They may have been written by a newer version. Nothing was changed.",
	"add-failed": "Tonic could not finish adding that instance.",
	"grant-failed": "Tonic could not finish granting access to that instance.",
	"remove-failed": "Tonic could not finish removing that instance.",
};

export interface TargetListProps {
	isLoading: boolean;
	targets: readonly TargetState[];
	/** Origin of the current tab, when a content script answered from one. */
	currentOrigin: string | undefined;
	busyOrigin: string | undefined;
	isAdding: boolean;
	failure: HostAccessFailure | undefined;
	hasStaleTabs: boolean;
	onAdd(input: string): AddOriginRejection | undefined;
	onGrant(origin: string): void;
	onRemove(origin: string): void;
}

export function TargetList({
	isLoading,
	targets,
	currentOrigin,
	busyOrigin,
	isAdding,
	failure,
	hasStaleTabs,
	onAdd,
	onGrant,
	onRemove,
}: TargetListProps) {
	const inputId = useId();
	const messageId = useId();
	const [draft, setDraft] = useState("");
	const [rejection, setRejection] = useState<AddOriginRejection>();
	const isMutating = isAdding || busyOrigin !== undefined;

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		const result = onAdd(draft);
		setRejection(result);

		// Keep the text when it was refused, so the user can correct it.
		if (result === undefined) {
			setDraft("");
		}
	};

	const message = rejection
		? REJECTION_MESSAGES[rejection]
		: failure
			? FAILURE_MESSAGES[failure]
			: undefined;

	return (
		<section className="space-y-2">
			<h2 className="px-1 text-xs font-medium text-muted-foreground">
				GitLab instances
			</h2>
			<ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
				<TargetRow
					access="active"
					isBuiltIn
					isBusy={false}
					isCurrent={currentOrigin === BUILT_IN_ORIGIN}
					origin={BUILT_IN_ORIGIN}
				/>
				{targets.map((target) => (
					<TargetRow
						access={target.access}
						isBusy={isMutating}
						isCurrent={currentOrigin === target.origin}
						key={target.origin}
						onGrant={onGrant}
						onRemove={onRemove}
						origin={target.origin}
					/>
				))}
				{isLoading ? (
					<li className="px-2.5 py-2 text-xs text-muted-foreground">
						Checking added instances...
					</li>
				) : null}
			</ul>

			{/*
			 * A change reaches a tab on its next navigation, never the document that
			 * is already loaded: registration applies to future navigations, and
			 * unregistering does not stop a script already running in a loaded page.
			 * Injecting into, or tearing down, live tabs was considered and dropped
			 * as more moving parts than one honest sentence is worth.
			 */}
			{hasStaleTabs ? (
				<p
					aria-live="polite"
					className="rounded-lg border border-border bg-muted/60 px-2.5 py-2 text-[0.6875rem] leading-relaxed text-muted-foreground"
					role="status"
				>
					Reload any open GitLab tab to apply this change.
				</p>
			) : null}

			<form className="space-y-1.5" onSubmit={handleSubmit}>
				<label className="sr-only" htmlFor={inputId}>
					Self-managed GitLab address
				</label>
				<div className="flex items-start gap-1.5">
					<Input
						aria-describedby={message ? messageId : undefined}
						aria-invalid={rejection !== undefined && rejection !== "busy"}
						autoComplete="off"
						id={inputId}
						onValueChange={(value) => {
							setDraft(value);
							setRejection(undefined);
						}}
						placeholder="gitlab.example.com"
						spellCheck={false}
						value={draft}
					/>
					{/*
					 * Also disabled while loading: the duplicate check reads the
					 * in-memory list, which is empty until the first reconciliation
					 * lands, so an address already configured would be accepted
					 * without the "already in the list" message. Storage still
					 * deduplicates, so nothing was corrupted, only confusing.
					 */}
					<Button disabled={isMutating || isLoading} type="submit">
						<PlusIcon data-icon="inline-start" />
						Add
					</Button>
				</div>
				<p
					className="px-1 text-[0.6875rem] leading-relaxed text-muted-foreground"
					id={messageId}
					// One region for both messages so a result replaces the hint
					// instead of appearing below it.
					role={message ? "alert" : undefined}
				>
					{message ??
						"HTTPS is assumed. For HTTP, include http://. Add the address, then grant access if needed; access covers every port on that hostname."}
				</p>
			</form>
		</section>
	);
}

function TargetRow({
	access,
	isBuiltIn = false,
	isBusy,
	isCurrent,
	onGrant,
	onRemove,
	origin,
}: {
	access: TargetAccess;
	isBuiltIn?: boolean;
	isBusy: boolean;
	isCurrent: boolean;
	onGrant?(origin: string): void;
	onRemove?(origin: string): void;
	origin: string;
}) {
	return (
		<li className="flex items-start gap-2 px-2.5 py-2">
			{/*
			 * The dot is decoration. "Active on this tab" below carries the same
			 * fact in text, so the state never depends on colour or motion alone.
			 */}
			<span aria-hidden="true" className="mt-1.5 size-2 shrink-0">
				{isCurrent ? (
					<span className="tonic-active-dot block size-2 rounded-full bg-primary" />
				) : null}
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate text-xs font-medium" title={origin}>
					{origin}
				</p>
				<p className="text-[0.6875rem] text-muted-foreground">
					{isBuiltIn ? "Built in" : ACCESS_LABELS[access]}
					{isCurrent ? " · Active on this tab" : ""}
				</p>
			</div>
			{access === "permission-required" && onGrant ? (
				<Button
					disabled={isBusy}
					onClick={() => onGrant(origin)}
					size="xs"
					variant="outline"
				>
					Grant access
				</Button>
			) : null}
			{onRemove ? (
				<Button
					aria-label={`Remove ${origin}`}
					disabled={isBusy}
					onClick={() => onRemove(origin)}
					size="icon-xs"
					variant="ghost"
				>
					<TrashIcon />
				</Button>
			) : null}
		</li>
	);
}
