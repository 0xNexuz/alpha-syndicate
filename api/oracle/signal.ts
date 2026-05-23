import { encryptForAgent, sha256 } from "../../src/lib/crypto.js";
import { withApi, requireCompliantAgent } from "../_lib/http.js";
import { X402Facilitator } from "../../src/lib/services.js";
import type { SettlementReceipt } from "../../src/lib/types.js";

export default withApi(async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const agent = requireCompliantAgent(req);
  const market = String(req.query.market ?? "ETH-USDC");
  const resource = `/api/oracle/signal?market=${market}`;
  const receipt = X402Facilitator.receiptFromHeader(
    typeof req.headers["x-payment"] === "string" ? req.headers["x-payment"] : undefined
  );

  if (!receipt) {
    const invoice = X402Facilitator.createInvoice(resource, agent.id);
    res.status(402).json({
      error: "payment_required",
      message: "x402 payment required to unlock Oracle Agent signal",
      accepts: [invoice]
    });
    return;
  }

  const signal = createTradingSignal(market, receipt);
  const wantsPrivacy = String(req.query.privacy ?? "false") === "true";
  if (!wantsPrivacy) {
    res.status(200).json({ ok: true, signal });
    return;
  }

  res.status(200).json({
    ok: true,
    privatePayload: encryptForAgent(signal, agent.privacySharedSecret),
    proof: {
      type: "mock-zk-signal-commitment",
      statement: "Gateway knows a paid signal whose hash matches this commitment without revealing it in logs.",
      commitment: sha256(JSON.stringify(signal))
    }
  });
});

function createTradingSignal(market: string, receipt: SettlementReceipt) {
  return {
    market,
    action: "LONG",
    conviction: 0.87,
    horizon: "6h",
    maxPositionUsd: 2500,
    stopLossPct: 1.8,
    takeProfitPct: 4.2,
    researchSource: "Canteen sentiment + liquidity delta + funding compression",
    paidBy: receipt.payerWalletId,
    paymentTx: receipt.txHash,
    issuedAt: new Date().toISOString()
  };
}
