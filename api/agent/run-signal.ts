import { withApi, requireCompliantAgent } from "../_lib/http.js";
import { runAgentSignal } from "../_lib/agent-run.js";

export default withApi(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const agent = requireCompliantAgent(req);
  const body = typeof req.body === "object" && req.body !== null ? req.body as Record<string, unknown> : {};
  const result = await runAgentSignal({
    agent,
    market: String(body.market ?? "BTC-USDC"),
    privacy: Boolean(body.privacy ?? true)
  });

  res.status(201).json(result);
});
