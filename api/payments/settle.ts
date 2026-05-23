import { withApi, requireCompliantAgent } from "../_lib/http.js";
import { X402Facilitator } from "../../src/lib/services.js";
import type { PaymentAuthorization } from "../../src/lib/types.js";

export default withApi(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  requireCompliantAgent(req);
  const receipt = await X402Facilitator.settle(req.body as PaymentAuthorization);
  res.status(201).json({
    ok: true,
    receipt,
    xPayment: Buffer.from(JSON.stringify(receipt), "utf8").toString("base64url")
  });
});
