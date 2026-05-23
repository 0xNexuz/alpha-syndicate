import { randomUUID } from "node:crypto";
import { sha256, signWalletPayload, verifyWalletSignature } from "./crypto.js";
import { circleApi } from "./circle-client.js";
import { config, requireConfig } from "./config.js";
import { agents, invoices, settlements, wallets } from "./state.js";
import type { AgentIdentity, PaymentAuthorization, SettlementReceipt, Wallet, X402Invoice } from "./types.js";

export class ComplianceService {
  static assertApproved(agentId: string): AgentIdentity {
    const identity = agents.get(agentId);
    if (!identity) {
      throw Object.assign(new Error("unknown_agent"), { status: 401 });
    }

    if (identity.kybStatus !== "approved" || identity.riskScore > 50) {
      throw Object.assign(new Error("agent_not_compliant"), { status: 403 });
    }

    return identity;
  }
}

export class CircleWalletService {
  static walletForAgent(agentId: string): Wallet {
    const identity = ComplianceService.assertApproved(agentId);
    const wallet = wallets.get(identity.walletId);
    if (!wallet) {
      throw Object.assign(new Error("wallet_not_found"), { status: 500 });
    }

    return wallet;
  }

  static sign(walletId: string, payload: unknown): string {
    const wallet = this.get(walletId);
    return signWalletPayload(wallet.secret, payload);
  }

  static verify(walletId: string, payload: unknown, signature: string): boolean {
    const wallet = this.get(walletId);
    return verifyWalletSignature(wallet.secret, payload, signature);
  }

  static get(walletId: string): Wallet {
    const wallet = wallets.get(walletId);
    if (!wallet) {
      throw Object.assign(new Error("wallet_not_found"), { status: 404 });
    }

    return wallet;
  }
}

export class CctpBridge {
  static async bridgeUsdcToArc(sourceWalletId: string, destinationWalletId: string, amount: number) {
    const source = CircleWalletService.get(sourceWalletId);
    const destination = CircleWalletService.get(destinationWalletId);

    if (config.circleUseReal) {
      const sourceCircleWalletId = sourceWalletId === "wallet-exec-base"
        ? requireConfig("executionBaseCircleWalletId")
        : sourceWalletId;
      const destinationAddress = destination.address;
      const burn = await circleApi.createDeveloperTransfer({
        walletId: sourceCircleWalletId,
        destinationAddress,
        blockchain: config.baseBlockchain,
        amount,
        tokenId: config.usdcTokenId,
        refId: `cctp-burn-${randomUUID()}`
      });
      const transactionId = String((burn.data as { id?: string } | undefined)?.id ?? "");
      const transaction = transactionId ? await circleApi.getTransaction(transactionId) : burn;
      const txHash = String(
        ((transaction.data as { transaction?: { txHash?: string; hash?: string } } | undefined)?.transaction?.txHash)
        ?? ((transaction.data as { transaction?: { txHash?: string; hash?: string } } | undefined)?.transaction?.hash)
        ?? transactionId
      );
      const attestation = await circleApi.getCctpMessages(config.cctpSourceDomain, txHash);

      return {
        mode: "circle-real",
        burn,
        transaction,
        attestation,
        amount,
        sourceChain: source.chain,
        destinationChain: destination.chain
      };
    }

    if (source.balances.USDC < amount) {
      throw new Error("source_usdc_insufficient_for_cctp");
    }

    source.balances.USDC -= amount;
    destination.balances.USDC += amount;

    return {
      burnTx: `0xburn_${randomUUID().replaceAll("-", "")}`,
      attestation: sha256(`${sourceWalletId}:${destinationWalletId}:${amount}`),
      mintTx: `0xmint_${randomUUID().replaceAll("-", "")}`,
      amount,
      sourceChain: source.chain,
      destinationChain: destination.chain
    };
  }
}

export class FxEngine {
  static async convertEurcToUsdc(walletId: string, usdcNeeded: number) {
    const wallet = CircleWalletService.get(walletId);

    if (config.circleUseReal) {
      return {
        mode: "circle-real",
        quote: await circleApi.requestStableFxQuote({
          fromAsset: "EURC",
          toAsset: "USDC",
          amount: usdcNeeded,
          walletId: walletId === "wallet-exec-arc" ? requireConfig("executionArcCircleWalletId") : walletId
        })
      };
    }

    const rate = 1.08;
    const eurcRequired = Number((usdcNeeded / rate).toFixed(6));
    if (wallet.balances.EURC < eurcRequired) {
      throw new Error("eurc_insufficient_for_fx");
    }

    wallet.balances.EURC -= eurcRequired;
    wallet.balances.USDC += usdcNeeded;

    return {
      quoteId: `fx_${randomUUID()}`,
      pair: "EURC/USDC",
      rate,
      eurcSold: eurcRequired,
      usdcBought: usdcNeeded
    };
  }
}

export class PaymasterClient {
  static sponsorGaslessUsdcPayment(invoice: X402Invoice, payerWalletId: string) {
    const userOperationHash = sha256(`userop:${invoice.invoiceId}:${payerWalletId}`);
    return {
      sponsor: "circle-paymaster" as const,
      gasAsset: "USDC" as const,
      gaslessForAgent: true as const,
      userOperationHash
    };
  }
}

export class X402Facilitator {
  static createInvoice(resource: string, payerAgentId: string): X402Invoice {
    const oracleWallet = CircleWalletService.walletForAgent("oracle-alpha-001");
    const nonce = randomUUID();
    const invoice: X402Invoice = {
      x402Version: "1",
      invoiceId: `inv_${nonce}`,
      resource,
      description: "Alpha Syndicate high-conviction trading signal",
      network: "arc-testnet",
      asset: "USDC",
      amount: 0.25,
      decimals: 6,
      payTo: oracleWallet.address,
      facilitatorUrl: "http://localhost:8787/payments/settle",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      nonce,
      privacyCommitment: sha256(`${payerAgentId}:${resource}:${nonce}`)
    };

    invoices.set(invoice.invoiceId, invoice);
    return invoice;
  }

  static async settle(auth: PaymentAuthorization): Promise<SettlementReceipt> {
    ComplianceService.assertApproved(auth.payerAgentId);
    const invoice = invoices.get(auth.invoiceId);
    if (!invoice) {
      throw Object.assign(new Error("invoice_not_found"), { status: 404 });
    }

    if (Date.parse(invoice.expiresAt) < Date.now()) {
      throw Object.assign(new Error("invoice_expired"), { status: 402 });
    }

    const invoiceHash = sha256(JSON.stringify(invoice));
    if (auth.invoiceHash !== invoiceHash) {
      throw Object.assign(new Error("invoice_hash_mismatch"), { status: 400 });
    }

    const signedPayload = {
      invoiceId: auth.invoiceId,
      invoiceHash: auth.invoiceHash,
      payerAgentId: auth.payerAgentId,
      payerWalletId: auth.payerWalletId,
      userOperationHash: auth.userOperationHash
    };

    if (!CircleWalletService.verify(auth.payerWalletId, signedPayload, auth.signature)) {
      throw Object.assign(new Error("bad_wallet_signature"), { status: 401 });
    }

    const expectedPrivacyProof = sha256(`${invoice.privacyCommitment}:${auth.payerAgentId}:paid`);
    if (auth.privacyProof !== expectedPrivacyProof) {
      throw Object.assign(new Error("bad_privacy_proof"), { status: 401 });
    }

    if (config.circleUseReal) {
      const result = await circleApi.submitX402Payment({
        invoice: invoice as unknown as Record<string, unknown>,
        authorization: auth as unknown as Record<string, unknown>
      });
      const txHash = String(
        (result.txHash as string | undefined)
        ?? ((result.data as { txHash?: string; id?: string } | undefined)?.txHash)
        ?? ((result.data as { txHash?: string; id?: string } | undefined)?.id)
        ?? `x402_${auth.userOperationHash}`
      );

      const receipt: SettlementReceipt = {
        invoiceId: invoice.invoiceId,
        txHash,
        settledAt: new Date().toISOString(),
        payerWalletId: auth.payerWalletId,
        amount: invoice.amount,
        asset: "USDC",
        network: invoice.network,
        privacyProof: auth.privacyProof
      };
      settlements.set(invoice.invoiceId, receipt);
      return receipt;
    }

    const payer = CircleWalletService.get(auth.payerWalletId);
    const oracle = CircleWalletService.walletForAgent("oracle-alpha-001");
    if (payer.chain !== invoice.network || payer.balances.USDC < invoice.amount) {
      throw Object.assign(new Error("insufficient_arc_usdc"), { status: 402 });
    }

    payer.balances.USDC -= invoice.amount;
    oracle.balances.USDC += invoice.amount;

    const receipt: SettlementReceipt = {
      invoiceId: invoice.invoiceId,
      txHash: `0xarc_${randomUUID().replaceAll("-", "")}`,
      settledAt: new Date().toISOString(),
      payerWalletId: auth.payerWalletId,
      amount: invoice.amount,
      asset: "USDC",
      network: invoice.network,
      privacyProof: auth.privacyProof
    };
    settlements.set(invoice.invoiceId, receipt);
    return receipt;
  }

  static receiptFromHeader(headerValue: string | undefined): SettlementReceipt | undefined {
    if (!headerValue) {
      return undefined;
    }

    const decoded = JSON.parse(Buffer.from(headerValue, "base64url").toString("utf8")) as SettlementReceipt;
    const receipt = settlements.get(decoded.invoiceId);
    if (receipt?.txHash !== decoded.txHash) {
      return undefined;
    }

    return receipt;
  }
}
