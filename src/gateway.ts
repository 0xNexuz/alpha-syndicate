import express, { type NextFunction, type Request, type Response } from "express";
import { encryptForAgent, sha256 } from "./lib/crypto.js";
import { agents, EXECUTION_AGENT_ID } from "./lib/state.js";
import {
  CctpBridge,
  CircleWalletService,
  ComplianceService,
  FxEngine,
  PaymasterClient,
  X402Facilitator
} from "./lib/services.js";
import type { PaymentAuthorization, SettlementReceipt } from "./lib/types.js";

const app = express();
app.use((req, res, next) => {
  const allowedOrigin = process.env.GATEWAY_ALLOWED_ORIGIN ?? "*";
  res.header("access-control-allow-origin", allowedOrigin);
  res.header("access-control-allow-headers", "content-type,x-agent-id,x-payment");
  res.header("access-control-allow-methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});
app.use(express.json());

function asyncRoute(handler: (req: Request, res: Response) => Promise<void> | void) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

function requireCompliantAgent(req: Request, _res: Response, next: NextFunction) {
  try {
    const agentId = req.header("x-agent-id");
    if (!agentId) {
      throw Object.assign(new Error("missing_x_agent_id"), { status: 401 });
    }

    resLocals(req).agent = ComplianceService.assertApproved(agentId);
    next();
  } catch (error) {
    next(error);
  }
}

app.post("/payments/settle", requireCompliantAgent, asyncRoute(async (req, res) => {
  const receipt = await X402Facilitator.settle(req.body as PaymentAuthorization);
  res.status(201).json({
    ok: true,
    receipt,
    xPayment: Buffer.from(JSON.stringify(receipt), "utf8").toString("base64url")
  });
}));

app.post("/agent/funding/cctp", requireCompliantAgent, asyncRoute(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "invalid_amount" });
    return;
  }

  const bridge = await CctpBridge.bridgeUsdcToArc("wallet-exec-base", "wallet-exec-arc", amount);
  res.status(201).json({ ok: true, bridge });
}));

app.post("/agent/funding/fx", requireCompliantAgent, asyncRoute(async (req, res) => {
  const usdcNeeded = Number(req.body.usdcNeeded);
  if (!Number.isFinite(usdcNeeded) || usdcNeeded <= 0) {
    res.status(400).json({ error: "invalid_amount" });
    return;
  }

  const fx = await FxEngine.convertEurcToUsdc("wallet-exec-arc", usdcNeeded);
  res.status(201).json({ ok: true, fx });
}));

app.post("/agent/run-signal", requireCompliantAgent, asyncRoute(async (req, res) => {
  const agent = resLocals(req).agent;
  const market = String(req.body.market ?? "BTC-USDC");
  const wantsPrivacy = Boolean(req.body.privacy ?? true);
  const resource = `/oracle/signal?market=${market}`;
  const timeline: Array<{
    step: string;
    status: "done" | "live" | "warn";
    detail: string;
    at: string;
    data?: unknown;
  }> = [];

  pushTimeline(timeline, "Compliance", "done", `KYB approved for ${agent.id}; risk score ${agent.riskScore}.`);

  const before = walletSnapshot();
  const invoice = X402Facilitator.createInvoice(resource, agent.id);
  const invoiceHash = sha256(JSON.stringify(invoice));
  pushTimeline(timeline, "x402 invoice", "done", `Gateway quoted ${invoice.amount} ${invoice.asset} on ${invoice.network}.`, {
    invoiceId: invoice.invoiceId,
    invoiceHash,
    payTo: invoice.payTo
  });

  const arcWallet = CircleWalletService.walletForAgent(agent.id);
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
    payerAgentId: agent.id,
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
    privacyProof: sha256(`${invoice.privacyCommitment}:${agent.id}:paid`)
  };

  const receipt = await X402Facilitator.settle(paymentAuth);
  const xPayment = Buffer.from(JSON.stringify(receipt), "utf8").toString("base64url");
  pushTimeline(timeline, "Settlement", "done", `Paid Oracle Agent with tx ${receipt.txHash}.`, receipt);

  const signal = createTradingSignal(market, receipt);
  const privatePayload = wantsPrivacy ? encryptForAgent(signal, agent.privacySharedSecret) : undefined;
  const proof = {
    type: wantsPrivacy ? "encrypted-payload-commitment" : "clear-json-commitment",
    commitment: sha256(JSON.stringify(signal)),
    privacyProof: paymentAuth.privacyProof
  };
  pushTimeline(timeline, "Oracle unlock", "done", wantsPrivacy
    ? "Encrypted signal payload returned with commitment proof."
    : "Clear JSON signal returned with commitment proof.");

  res.status(201).json({
    ok: true,
    mode: "server-side-agent-wallet",
    market,
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
    signal: wantsPrivacy ? undefined : signal,
    privatePayload,
    balances: {
      before,
      after: walletSnapshot()
    },
    timeline
  });
}));

app.post("/api/agent/run-signal", requireCompliantAgent, asyncRoute(async (req, res) => {
  const agent = resLocals(req).agent;
  const market = String(req.body.market ?? "BTC-USDC");
  const wantsPrivacy = Boolean(req.body.privacy ?? true);
  const resource = `/oracle/signal?market=${market}`;
  const timeline: Array<{
    step: string;
    status: "done" | "live" | "warn";
    detail: string;
    at: string;
    data?: unknown;
  }> = [];

  pushTimeline(timeline, "Compliance", "done", `KYB approved for ${agent.id}; risk score ${agent.riskScore}.`);

  const before = walletSnapshot();
  const invoice = X402Facilitator.createInvoice(resource, agent.id);
  const invoiceHash = sha256(JSON.stringify(invoice));
  pushTimeline(timeline, "x402 invoice", "done", `Gateway quoted ${invoice.amount} ${invoice.asset} on ${invoice.network}.`, {
    invoiceId: invoice.invoiceId,
    invoiceHash,
    payTo: invoice.payTo
  });

  const arcWallet = CircleWalletService.walletForAgent(agent.id);
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
    payerAgentId: agent.id,
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
    privacyProof: sha256(`${invoice.privacyCommitment}:${agent.id}:paid`)
  };

  const receipt = await X402Facilitator.settle(paymentAuth);
  const xPayment = Buffer.from(JSON.stringify(receipt), "utf8").toString("base64url");
  pushTimeline(timeline, "Settlement", "done", `Paid Oracle Agent with tx ${receipt.txHash}.`, receipt);

  const signal = createTradingSignal(market, receipt);
  const privatePayload = wantsPrivacy ? encryptForAgent(signal, agent.privacySharedSecret) : undefined;
  const proof = {
    type: wantsPrivacy ? "encrypted-payload-commitment" : "clear-json-commitment",
    commitment: sha256(JSON.stringify(signal)),
    privacyProof: paymentAuth.privacyProof
  };
  pushTimeline(timeline, "Oracle unlock", "done", wantsPrivacy
    ? "Encrypted signal payload returned with commitment proof."
    : "Clear JSON signal returned with commitment proof.");

  res.status(201).json({
    ok: true,
    mode: "server-side-agent-wallet",
    market,
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
    signal: wantsPrivacy ? undefined : signal,
    privatePayload,
    balances: {
      before,
      after: walletSnapshot()
    },
    timeline
  });
}));

app.get("/oracle/signal", requireCompliantAgent, asyncRoute((req, res) => {
  const agent = resLocals(req).agent;
  const resource = `${req.path}?market=${String(req.query.market ?? "ETH-USDC")}`;
  const receipt = X402Facilitator.receiptFromHeader(req.header("x-payment"));

  if (!receipt) {
    const invoice = X402Facilitator.createInvoice(resource, agent.id);
    res.status(402).json({
      error: "payment_required",
      message: "x402 payment required to unlock Oracle Agent signal",
      accepts: [invoice]
    });
    return;
  }

  const signal = createTradingSignal(String(req.query.market ?? "ETH-USDC"), receipt);

  const wantsPrivacy = String(req.query.privacy ?? "false") === "true";
  if (!wantsPrivacy) {
    res.json({ ok: true, signal });
    return;
  }

  res.json({
    ok: true,
    privatePayload: encryptForAgent(signal, agent.privacySharedSecret),
    proof: {
      type: "mock-zk-signal-commitment",
      statement: "Gateway knows a paid signal whose hash matches this commitment without revealing it in logs.",
      commitment: sha256(JSON.stringify(signal))
    }
  });
}));

app.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  res.status(error.status ?? 500).json({
    error: error.message,
    status: error.status ?? 500
  });
});

function resLocals(req: Request) {
  return req.res!.locals as { agent: NonNullable<ReturnType<typeof agents.get>> };
}

function pushTimeline(
  timeline: Array<{ step: string; status: "done" | "live" | "warn"; detail: string; at: string; data?: unknown }>,
  step: string,
  status: "done" | "live" | "warn",
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

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`Alpha Syndicate gateway listening on http://localhost:${port}`);
});
