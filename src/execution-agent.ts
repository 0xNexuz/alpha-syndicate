import { decryptForAgent, sha256 } from "./lib/crypto.js";
import { EXECUTION_AGENT_ID, agents } from "./lib/state.js";
import {
  CircleWalletService,
  PaymasterClient
} from "./lib/services.js";
import type { PaymentAuthorization, SettlementReceipt, X402Invoice } from "./lib/types.js";

const gatewayBaseUrl = process.env.GATEWAY_URL ?? "http://localhost:8787";
const market = process.env.MARKET ?? "BTC-USDC";
const privacy = process.env.PRIVACY ?? "true";

async function main() {
  const url = `${gatewayBaseUrl}/oracle/signal?market=${encodeURIComponent(market)}&privacy=${privacy}`;
  const firstResponse = await fetch(url, {
    headers: { "x-agent-id": EXECUTION_AGENT_ID }
  });

  if (firstResponse.status !== 402) {
    console.log(await firstResponse.json());
    return;
  }

  const challenge = await firstResponse.json() as { accepts: X402Invoice[] };
  const invoice = challenge.accepts[0];
  console.log("Received x402 invoice", invoice);

  await ensureArcUsdc(invoice.amount);

  const paymentAuth = createPaymentAuthorization(invoice);
  const settlementResponse = await fetch(invoice.facilitatorUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-id": EXECUTION_AGENT_ID
    },
    body: JSON.stringify(paymentAuth)
  });

  if (!settlementResponse.ok) {
    throw new Error(`settlement_failed: ${settlementResponse.status} ${await settlementResponse.text()}`);
  }

  const settlement = await settlementResponse.json() as { receipt: SettlementReceipt; xPayment: string };
  console.log("Settled with paymaster-sponsored payment", settlement.receipt);

  const unlockedResponse = await fetch(url, {
    headers: {
      "x-agent-id": EXECUTION_AGENT_ID,
      "x-payment": settlement.xPayment
    }
  });

  if (!unlockedResponse.ok) {
    throw new Error(`unlock_failed: ${unlockedResponse.status} ${await unlockedResponse.text()}`);
  }

  const unlocked = await unlockedResponse.json();
  const identity = agents.get(EXECUTION_AGENT_ID);
  const signal = unlocked.privatePayload && identity
    ? decryptForAgent(unlocked.privatePayload, identity.privacySharedSecret)
    : unlocked.signal;

  console.log("Unlocked Oracle signal", signal);
  if (unlocked.proof) {
    console.log("Privacy proof", unlocked.proof);
  }
}

async function ensureArcUsdc(requiredUsdc: number) {
  const arcWallet = CircleWalletService.walletForAgent(EXECUTION_AGENT_ID);
  if (arcWallet.balances.USDC >= requiredUsdc) {
    return;
  }

  const shortfall = Number((requiredUsdc - arcWallet.balances.USDC).toFixed(6));
  console.log(`Arc USDC shortfall: ${shortfall}`);

  try {
    const bridgeReceipt = await postFunding("/agent/funding/cctp", { amount: shortfall });
    console.log("Funded Arc wallet through CCTP", bridgeReceipt);
    arcWallet.balances.USDC += shortfall;
  } catch (error) {
    console.log("CCTP funding unavailable, falling back to EURC/USDC FX", (error as Error).message);
  }

  if (arcWallet.balances.USDC >= requiredUsdc) {
    return;
  }

  const remainingShortfall = Number((requiredUsdc - arcWallet.balances.USDC).toFixed(6));
  const fxReceipt = await postFunding("/agent/funding/fx", { usdcNeeded: remainingShortfall });
  arcWallet.balances.USDC += remainingShortfall;
  console.log("Converted EURC to USDC", fxReceipt);
}

async function postFunding(path: string, body: Record<string, number>) {
  const response = await fetch(`${gatewayBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-id": EXECUTION_AGENT_ID
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`${path}_failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function createPaymentAuthorization(invoice: X402Invoice): PaymentAuthorization {
  const wallet = CircleWalletService.walletForAgent(EXECUTION_AGENT_ID);
  const paymaster = PaymasterClient.sponsorGaslessUsdcPayment(invoice, wallet.id);
  const invoiceHash = sha256(JSON.stringify(invoice));

  const signedPayload = {
    invoiceId: invoice.invoiceId,
    invoiceHash,
    payerAgentId: EXECUTION_AGENT_ID,
    payerWalletId: wallet.id,
    userOperationHash: paymaster.userOperationHash
  };

  return {
    ...signedPayload,
    signature: CircleWalletService.sign(wallet.id, signedPayload),
    userOperationHash: paymaster.userOperationHash,
    paymaster: {
      sponsor: paymaster.sponsor,
      gasAsset: paymaster.gasAsset,
      gaslessForAgent: paymaster.gaslessForAgent
    },
    privacyProof: sha256(`${invoice.privacyCommitment}:${EXECUTION_AGENT_ID}:paid`)
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
