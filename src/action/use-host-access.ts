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

export type AddOriginRejection = TargetOriginRejection | "busy";

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
	 * user typed and show why. Permission is requested by a separate Grant click
	 * because Firefox loses user activation after the asynchronous storage write.
	 */
	addOrigin(input: string): AddOriginRejection | undefined;
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
	const accessMutationInFlight = useRef(false);

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
		(input: string): AddOriginRejection | undefined => {
			const resolved = resolveTargetOrigin(
				input,
				targets.map((target) => target.origin),
			);

			if (resolved.status === "rejected") {
				return resolved.reason;
			}
			if (accessMutationInFlight.current) {
				return "busy";
			}
			accessMutationInFlight.current = true;

			setFailure(undefined);
			setIsAdding(true);

			void (async () => {
				try {
					/*
					 * This is deliberately a separate step from Grant. Firefox loses
					 * extension user activation after an await, while Chrome may close
					 * the popup as soon as a permission prompt opens. Persisting here
					 * and requesting synchronously from Grant satisfies both contracts.
					 */
					const persisted = await repository.add(resolved.origin);

					try {
						await applyOrigins(persisted.origins);
					} catch (error) {
						console.error("Tonic could not refresh the instance list", error);

						if (isMounted.current) {
							setFailure("reconcile-failed");
						}
					}
				} catch (error) {
					console.error("Tonic could not add a GitLab instance", error);

					if (isMounted.current) {
						setFailure("add-failed");
					}
				} finally {
					if (isMounted.current) {
						setIsAdding(false);
					}
					accessMutationInFlight.current = false;
				}
			})();

			return undefined;
		},
		[repository, applyOrigins, targets],
	);

	const grantOrigin = useCallback(
		(origin: string) => {
			if (accessMutationInFlight.current) {
				return;
			}
			accessMutationInFlight.current = true;
			setFailure(undefined);
			setBusyOrigin(origin);

			void (async () => {
				try {
					/* Keep this as the first operation: Firefox requires the API call
					 * itself to run in the Grant click's synchronous event stack. */
					await requestTargetAccess(origin, apis);
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
					accessMutationInFlight.current = false;
				}
			})();
		},
		[apis, repository, applyOrigins],
	);

	const removeOrigin = useCallback(
		(origin: string) => {
			if (accessMutationInFlight.current) {
				return;
			}
			accessMutationInFlight.current = true;
			setFailure(undefined);
			setBusyOrigin(origin);

			void (async () => {
				try {
					const resolution = await repository.read();

					if (isUntrustedTargets(resolution.outcome)) {
						if (isMounted.current) {
							setFailure("untrusted-targets");
						}

						return;
					}

					// Unregister and revoke first: see `releaseTargetAccess`.
					await releaseTargetAccess(
						origin,
						resolution.targets.origins.filter((entry) => entry !== origin),
						apis,
					);
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
					accessMutationInFlight.current = false;
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
