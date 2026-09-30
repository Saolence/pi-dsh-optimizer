/**
 * The status probe: which phase this session is in, and what the model
 * currently sees.
 */

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { desiredSurface } from "../adapter/activation.ts";
import { loadIdentityConfig } from "../adapter/config.ts";
import { modelMatches } from "../adapter/model.ts";
import { sessionState, type AdapterState } from "../adapter/state.ts";

export function registerStatusTool(pi: ExtensionAPI, state: AdapterState): void {
	pi.registerTool({
		name: "pi_dsh_status",
		label: "DSH Status",
		description:
			"Show this session's phase: bootstrap (the model sees only the official dsh `minimal` persona and two tools — none of pi's prompt sections) or released (pi's full prompt with its identity sentence swapped).",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const st = sessionState(state, ctx.sessionManager.getSessionId());
			const { config } = loadIdentityConfig(getAgentDir());
			const active = modelMatches(config.models, ctx.model);
			const lines = [
				`phase=${st.promoted ? "released" : "bootstrap"}`,
				`model=${ctx.model?.id ?? "unknown"}`,
				`active=${active ? "yes" : "no"}`,
				`models=${config.models.join(", ") || "(all models)"}`,
				`surface=${desiredSurface(st.promoted, active)}`,
				`tools=[${pi.getActiveTools().join(", ")}]`,
			];
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {},
			};
		},
	});
}
