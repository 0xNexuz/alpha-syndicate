import { withApi, requireCompliantAgent } from "../../_lib/http.js";
import { FxEngine } from "../../../src/lib/services.js";

export default withApi(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  requireCompliantAgent(req);
  const usdcNeeded = Number((req.body as { usdcNeeded?: unknown }).usdcNeeded);
  if (!Number.isFinite(usdcNeeded) || usdcNeeded <= 0) {
    res.status(400).json({ error: "invalid_amount" });
    return;
  }

  const fx = await FxEngine.convertEurcToUsdc("wallet-exec-arc", usdcNeeded);
  res.status(201).json({ ok: true, fx });
});
