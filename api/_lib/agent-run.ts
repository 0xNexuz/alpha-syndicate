import { encryptForAgent, sha256 } from "../../src/lib/crypto.js";
import { EXECUTION_AGENT_ID } from "../../src/lib/state.js";
import {
  CctpBridge,
  CircleWalletService,
  FxEngine,
  PaymasterClient,
  X402Facilitator
} from "../../src/lib/services.js";
import type { AgentIdentity, PaymentAuthorization, SettlementReceipt } from "../../src/lib/types.js";

type TimelineEntry = {
  step: string;
  status: "done" | "live" | "warn";
  detail: string;
  at: string;
  data?: unknown;
};

export async function runAgentSignal(input: {
  agent: AgentIdentity;
  market: string;
  privacy: boolean;
}) {
  const timeline: TimelineEntry[] = [];
  const resource = `/oracle/signal?market=${input.market}`;

  pushTimeline(timeline, "Compliance", "done", `KYB approved for ${input.agent.id}; risk score ${input.agent.riskScore}.`);

  const before = walletSnapshot();
  const invoice = X402Facilitator.createInvoice(resource, input.agent.id);
  const invoiceHash = sha256(JSON.stringify(invoice));
  pushTimeline(timeline, "x402 invoice", "done", `Gateway quoted ${invoice.amount} ${invoice.asset} on ${invoice.network}.`, {
    invoiceId: invoice.invoiceId,
    invoiceHash,
    payTo: invoice.payTo
  });

  const arcWallet = CircleWalletService.walletForAgent(input.agent.id);
  if (arcWallet.balances.USDC < invoice.amount) {
    const shortfall = Number((invoice.amount - arcWallet.balances.USDC).toFixed(6));
    try {
      const bridge = await CctpBridge.bridgeUsdcToArc("wallet-exec-base", arcWallet.id, shortfall);
      pushTimeline(timeline, "CCTP refill", "done", `Bridged ${shortfall} USDC into Arc operations.`, bridge);
    } catch (error) {
      pushTimeline(timeline, "CCTP refill", "warn", `Bridge unavailable: ${(error as Error).message}. Falling back to EURC FX.`);
      const fx = await FxEngine.convertEurcToUsdc(arcWallet.id, shortfall);
      pushTimeline(timeline, "FX conversion", "done", `Converted EURC into ${shortfall} USDC at payment time.`, fx);
    }
  } else {
    pushTimeline(timeline, "Funding", "done", "Arc wallet already holds enough USDC.");
  }

  const paymaster = PaymasterClient.sponsorGaslessUsdcPayment(invoice, arcWallet.id);
  pushTimeline(timeline, "Paymaster", "done", "Sponsored ERC-4337-style UserOp prepared for gasless settlement.", {
    userOperationHash: paymaster.userOperationHash,
    sponsor: paymaster.sponsor
  });

  const signedPayload = {
    invoiceId: invoice.invoiceId,
    invoiceHash,
    payerAgentId: input.agent.id,
    payerWalletId: arcWallet.id,
    userOperationHash: paymaster.userOperationHash
  };
  const paymentAuth: PaymentAuthorization = {
    ...signedPayload,
    signature: CircleWalletService.sign(arcWallet.id, signedPayload),
    paymaster: {
      sponsor: paymaster.sponsor,
      gasAsset: paymaster.gasAsset,
      gaslessForAgent: paymaster.gaslessForAgent
    },
    privacyProof: sha256(`${invoice.privacyCommitment}:${input.agent.id}:paid`)
  };

  const receipt = await X402Facilitator.settle(paymentAuth);
  const xPayment = Buffer.from(JSON.stringify(receipt), "utf8").toString("base64url");
  pushTimeline(timeline, "Settlement", "done", `Paid Oracle Agent with tx ${receipt.txHash}.`, receipt);

  const signal = createTradingSignal(input.market, receipt);
  const privatePayload = input.privacy ? encryptForAgent(signal, input.agent.privacySharedSecret) : undefined;
  const proof = {
    type: input.privacy ? "encrypted-payload-commitment" : "clear-json-commitment",
    commitment: sha256(JSON.stringify(signal)),
    privacyProof: paymentAuth.privacyProof
  };
  pushTimeline(timeline, "Oracle unlock", "done", input.privacy
    ? "Encrypted signal payload returned with commitment proof."
    : "Clear JSON signal returned with commitment proof.");

  return {
    ok: true,
    mode: "server-side-agent-wallet",
    market: input.market,
    invoice,
    invoiceHash,
    paymentAuth: {
      payerAgentId: paymentAuth.payerAgentId,
      payerWalletId: paymentAuth.payerWalletId,
      userOperationHash: paymentAuth.userOperationHash,
      paymaster: paymentAuth.paymaster,
      signaturePreview: `${paymentAuth.signature.slice(0, 14)}...${paymentAuth.signature.slice(-8)}`
    },
    receipt,
    xPayment,
    proof,
    signal: input.privacy ? undefined : signal,
    privatePayload,
    balances: {
      before,
      after: walletSnapshot()
    },
    timeline
  };
}

function pushTimeline(
  timeline: TimelineEntry[],
  step: string,
  status: TimelineEntry["status"],
  detail: string,
  data?: unknown
) {
  timeline.push({ step, status, detail, at: new Date().toISOString(), data });
}

function walletSnapshot() {
  const arc = CircleWalletService.walletForAgent(EXECUTION_AGENT_ID);
  const base = CircleWalletService.get("wallet-exec-base");
  return {
    arc: {
      walletId: arc.id,
      address: arc.address,
      usdc: Number(arc.balances.USDC.toFixed(6)),
      eurc: Number(arc.balances.EURC.toFixed(6))
    },
    source: {
      walletId: base.id,
      address: base.address,
      usdc: Number(base.balances.USDC.toFixed(6))
    }
  };
}

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
