import { withApi, requireCompliantAgent } from "../../_lib/http.js";
import { CctpBridge } from "../../../src/lib/services.js";

export default withApi(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  requireCompliantAgent(req);
  const amount = Number((req.body as { amount?: unknown }).amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "invalid_amount" });
    return;
  }

  const bridge = await CctpBridge.bridgeUsdcToArc("wallet-exec-base", "wallet-exec-arc", amount);
  res.status(201).json({ ok: true, bridge });
});
