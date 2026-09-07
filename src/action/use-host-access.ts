import { useCallback, useEffect, useRef, useState } from "react";
import {
	createHostAccessApis,
	type HostAccessApis,
	reconcileTargets,
	releaseTargetAccess,
	requestTargetAccess,
	type TargetState,
} from "../host-access/registration";
import { consumeStaleTabs } from "../host-access/stale-tabs";
import {
	resolveTargetOrigin,
	type TargetOriginRejection,
} from "../host-access/target-origin";
import {
	createTargetsRepository,
	isUntrustedTargets,
	type TargetsRepository,
} from "../host-access/targets-repository";

export type HostAccessFailure =
	| "reconcile-failed"
	| "untrusted-targets"
	| "add-failed"
	| "grant-failed"
	| "remove-failed";

export interface HostAccess {
	isLoading: boolean;
	targets: TargetState[];
	/** Origin whose row has an operation in flight, if any. */
	busyOrigin: string | undefined;
	isAdding: boolean;
	failure: HostAccessFailure | undefined;
	/**
	 * True once this popup has changed access, because a tab that is already open
	 * does not pick the change up. `registerContentScripts` applies to future
	 * navigations only, and unregistering does not stop a script that is already
	 * running in a loaded document.
	 */
	hasStaleTabs: boolean;
	/**
	 * Validates and starts the add. Returns the rejection when the input was
	 * refused before anything was persisted, so the caller can keep the text the
	 * user typed and show why. Resolving is synchronous on purpose: the
	 * permission request that follows has to stay inside the click's user
	 * activation.
	 */
	addOrigin(input: string): TargetOriginRejection | undefined;
	grantOrigin(origin: string): void;
	removeOrigin(origin: string): void;
}

/**
 * Owns the toolbar action's view of self-managed origins.
 *
 * Reconciliation runs once when the popup opens and again after every change.
 * The background worker runs the same reconciliation on install, startup, and
 * permission changes, so this is one of two contexts that converge on the same
 * browser state rather than the only one; see `registration.ts`.
 */
export function useHostAccess(
	repositoryInput?: TargetsRepository,
	apisInput?: HostAccessApis,
): HostAccess {
	/*
	 * Pinned at mount, deliberately not plain default arguments.
	 *
	 * Defaults are re-evaluated on every render, so `repository` and `apis` were
	 * a new object each time. That invalidated the load effect's dependencies,
	 * the effect re-read storage and re-reconciled, and its own setState
	 * scheduled the next render. A live popup measured about 1100 storage reads
	 * per second before this was pinned. Identity is fixed at mount; a caller
	 * that passes a different instance later is intentionally ignored.
	 */
	const [repository] = useState(
		() => repositoryInput ?? createTargetsRepository(),
	);
	const [apis] = useState(() => apisInput ?? createHostAccessApis());
	const [targets, setTargets] = useState<TargetState[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [busyOrigin, setBusyOrigin] = useState<string>();
	const [isAdding, setIsAdding] = useState(false);
	const [failure, setFailure] = useState<HostAccessFailure>();
	const [hasStaleTabs, setHasStaleTabs] = useState(false);

	// The popup can be dismissed mid-request; nothing may set state after that.
	const isMounted = useRef(true);
	useEffect(() => {
		isMounted.current = true;

		return () => {
			isMounted.current = false;
		};
	}, []);

	const applyOrigins = useCallback(
		async (origins: readonly string[]) => {
			const reconciliation = await reconcileTargets(origins, apis);

			if (isMounted.current) {
				setTargets(reconciliation.targets);

				/*
				 * Registering or unregistering a script never reaches a document
				 * that is already loaded. Deriving the notice from what actually
				 * changed also covers the case the add flow cannot: granting closes
				 * the popup, so the registration lands on the next open instead.
				 */
				if (reconciliation.changed) {
					setHasStaleTabs(true);
				}
			}
		},
		[apis],
	);

	useEffect(() => {
		void (async () => {
			try {
				const resolution = await repository.read();

				/*
				 * The empty list a newer schema or an unusable container resolves to
				 * means "unknown", not "none configured". Reconciling against it
				 * unregisters every custom script and leaves granted permissions
				 * with no row to revoke them from.
				 */
				if (isUntrustedTargets(resolution.outcome)) {
					if (isMounted.current) {
						setFailure("untrusted-targets");
					}

					return;
				}

				await applyOrigins(resolution.targets.origins);

				/*
				 * The worker usually performs the registration a grant enables,
				 * because Chrome dismisses this popup when it prompts. By now that
				 * script is already registered, so the reconciliation above reports
				 * no change and only this flag knows tabs need reloading.
				 */
				if (isMounted.current && (await consumeStaleTabs())) {
					setHasStaleTabs(true);
				}
			} catch (error) {
				console.error("Tonic could not read GitLab instance access", error);

				if (isMounted.current) {
					setFailure("reconcile-failed");
				}
			} finally {
				if (isMounted.current) {
					setIsLoading(false);
				}
			}
		})();
	}, [repository, applyOrigins]);

	const addOrigin = useCallback(
		(input: string): TargetOriginRejection | undefined => {
			const resolved = resolveTargetOrigin(
				input,
				targets.map((target) => target.origin),
			);

			if (resolved.status === "rejected") {
				return resolved.reason;
			}

			setFailure(undefined);
			setIsAdding(true);

			void (async () => {
				let persisted: readonly string[] | undefined;

				try {
					/*
					 * Persisted before the permission is requested, and awaited.
					 *
					 * Chrome closes the toolbar popup when it raises the permission
					 * prompt, which destroys this document and every promise still
					 * running in it. Requesting first and persisting "in parallel"
					 * therefore lost the origin outright: the write is a read then a
					 * write, and the popup died before the write was dispatched. The
					 * user saw the prompt, granted it, and found an empty list.
					 *
					 * The cost is one storage round trip between the click and the
					 * request. Transient user activation lasts about five seconds and
					 * survives an await, so the gesture is still valid. If it ever is
					 * not, the request rejects and the origin stays visible as
					 * `permission-required` with a Grant control, which is a far
					 * better failure than silently discarding it.
					 */
					persisted = (await repository.add(resolved.origin)).origins;

					await requestTargetAccess(resolved.origin, apis);
				} catch (error) {
					console.error(
						persisted
							? "Tonic could not request GitLab instance access"
							: "Tonic could not add a GitLab instance",
						error,
					);

					if (isMounted.current) {
						setFailure(persisted === undefined ? "add-failed" : "grant-failed");
					}
				} finally {
					/*
					 * Reconciled even when the request failed. The origin is already
					 * stored by then, and reporting a failure while the list still
					 * shows no trace of it tells the user the opposite of the truth.
					 * Only reached at all when the popup survived the prompt.
					 */
					if (persisted && isMounted.current) {
						try {
							await applyOrigins(persisted);
						} catch (error) {
							console.error("Tonic could not refresh the instance list", error);
						}
					}

					if (isMounted.current) {
						setIsAdding(false);
					}
				}
			})();

			return undefined;
		},
		[apis, repository, applyOrigins, targets],
	);

	const grantOrigin = useCallback(
		(origin: string) => {
			setFailure(undefined);
			setBusyOrigin(origin);

			const permissionRequest = requestTargetAccess(origin, apis);

			void (async () => {
				try {
					await permissionRequest;
					const resolution = await repository.read();

					/*
					 * The same guard the load path and the worker apply. Add and
					 * remove fail closed through `NewerTargetsSchemaError`, but this
					 * path only reads, so without the check it would reconcile against
					 * an empty list that means "unknown" and unregister a newer
					 * build's scripts.
					 */
					if (isUntrustedTargets(resolution.outcome)) {
						if (isMounted.current) {
							setFailure("untrusted-targets");
						}

						return;
					}

					await applyOrigins(resolution.targets.origins);
				} catch (error) {
					console.error("Tonic could not grant GitLab instance access", error);

					if (isMounted.current) {
						setFailure("grant-failed");
					}
				} finally {
					if (isMounted.current) {
						setBusyOrigin(undefined);
					}
				}
			})();
		},
		[apis, repository, applyOrigins],
	);

	const removeOrigin = useCallback(
		(origin: string) => {
			setFailure(undefined);
			setBusyOrigin(origin);

			void (async () => {
				try {
					// Unregister and revoke first: see `releaseTargetAccess`.
					await releaseTargetAccess(origin, apis);
					const stored = await repository.remove(origin);
					await applyOrigins(stored.origins);

					if (isMounted.current) {
						setHasStaleTabs(true);
					}
				} catch (error) {
					console.error("Tonic could not remove a GitLab instance", error);

					if (isMounted.current) {
						setFailure("remove-failed");
					}
				} finally {
					if (isMounted.current) {
						setBusyOrigin(undefined);
					}
				}
			})();
		},
		[apis, repository, applyOrigins],
	);

	return {
		isLoading,
		targets,
		busyOrigin,
		isAdding,
		failure,
		hasStaleTabs,
		addOrigin,
		grantOrigin,
		removeOrigin,
	};
}
