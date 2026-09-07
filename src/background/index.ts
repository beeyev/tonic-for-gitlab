import { registerBroadcastContentHashResponder } from "../features/dismiss-broadcast-banner/broadcast-content-hash";
import { createHostAccessApis } from "../host-access/registration";
import { createTargetsRepository } from "../host-access/targets-repository";
import { registerHostAccessReconciliation } from "./host-access-reconciliation";

registerBroadcastContentHashResponder();
registerHostAccessReconciliation(
	chrome,
	createTargetsRepository(),
	createHostAccessApis(),
);
