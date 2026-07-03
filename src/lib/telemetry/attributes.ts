// GenAI semantic-convention attribute names (OTel semconv registry,
// https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/).
// The NAMES are the standard; the JS package exports them only from its
// explicitly-unstable /incubating entrypoint, so we pin the strings here
// instead of depending on it (ADR-0006). Stable attributes (service.name)
// come from @opentelemetry/semantic-conventions proper.

export const ATTR_GEN_AI_OPERATION_NAME = "gen_ai.operation.name";
export const ATTR_GEN_AI_PROVIDER_NAME = "gen_ai.provider.name";
export const ATTR_GEN_AI_REQUEST_MODEL = "gen_ai.request.model";
export const ATTR_GEN_AI_RESPONSE_FINISH_REASONS = "gen_ai.response.finish_reasons";
export const ATTR_GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens";
export const ATTR_GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens";
export const ATTR_GEN_AI_TOOL_NAME = "gen_ai.tool.name";

// Root-span names — shared by the loops (producers) and the budget gate /
// dashboard queries (consumers) so the strings can never drift apart.
export const SPAN_NAME_ASK = "mlip.ask";
export const SPAN_NAME_CHAT_TURN = "mlip.chat_turn";

// Project-namespaced attributes — cost is not part of the gen_ai semconv,
// and the eval runner uses these to correlate spans to runs/cases.
export const ATTR_MLIP_COST_MICROUSD = "mlip.cost_microusd";
export const ATTR_MLIP_ITERATIONS = "mlip.iterations";
export const ATTR_MLIP_TOOL_OK = "mlip.tool.ok";
export const ATTR_MLIP_EVAL_RUN_ID = "mlip.eval.run_id";
export const ATTR_MLIP_EVAL_CASE_ID = "mlip.eval.case_id";
