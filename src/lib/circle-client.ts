import { randomUUID } from "node:crypto";
import { config, requireConfig } from "./config.js";

type JsonObject = Record<string, unknown>;

export class CircleApiClient {
  async createDeveloperTransfer(input: {
    walletId: string;
    destinationAddress: string;
    blockchain: string;
    amount: number;
    tokenId?: string;
    tokenAddress?: string;
    refId: string;
  }) {
    return this.circleFetch("/v1/w3s/developer/transactions/transfer", {
      method: "POST",
      body: {
        idempotencyKey: randomUUID(),
        walletId: input.walletId,
        destinationAddress: input.destinationAddress,
        blockchain: input.blockchain,
        tokenId: input.tokenId,
        tokenAddress: input.tokenAddress,
        amounts: [input.amount.toFixed(6)],
        entitySecretCiphertext: requireConfig("circleEntitySecretCiphertext"),
        feeLevel: "MEDIUM",
        refId: input.refId
      }
    });
  }

  async getTransaction(transactionId: string) {
    return this.circleFetch(`/v1/w3s/transactions/${transactionId}`);
  }

  async getCctpMessages(sourceDomain: number, transactionHash: string) {
    const url = new URL(`/v2/messages/${sourceDomain}`, config.cctpIrisBaseUrl);
    url.searchParams.set("transactionHash", transactionHash);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`circle_cctp_messages_failed:${response.status}:${await response.text()}`);
    }

    return response.json() as Promise<JsonObject>;
  }

  async requestStableFxQuote(input: {
    fromAsset: "EURC";
    toAsset: "USDC";
    amount: number;
    walletId: string;
  }) {
    const baseUrl = requireConfig("stableFxBaseUrl");
    const response = await fetch(new URL("/quotes", baseUrl), {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({
        idempotencyKey: randomUUID(),
        sourceCurrency: input.fromAsset,
        destinationCurrency: input.toAsset,
        amount: input.amount.toFixed(6),
        walletId: input.walletId,
        settlementBlockchain: config.arcBlockchain
      })
    });

    if (!response.ok) {
      throw new Error(`circle_stablefx_quote_failed:${response.status}:${await response.text()}`);
    }

    return response.json() as Promise<JsonObject>;
  }

  async submitX402Payment(input: {
    invoice: JsonObject;
    authorization: JsonObject;
  }) {
    const facilitatorUrl = requireConfig("x402FacilitatorUrl");
    const response = await fetch(new URL("/verify", facilitatorUrl), {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      throw new Error(`circle_x402_facilitator_failed:${response.status}:${await response.text()}`);
    }

    return response.json() as Promise<JsonObject>;
  }

  private async circleFetch(path: string, init?: {
    method?: "GET" | "POST";
    body?: JsonObject;
  }) {
    const response = await fetch(new URL(path, config.circleApiBaseUrl), {
      method: init?.method ?? "GET",
      headers: this.authHeaders(),
      body: init?.body ? JSON.stringify(init.body) : undefined
    });

    if (!response.ok) {
      throw new Error(`circle_api_failed:${response.status}:${await response.text()}`);
    }

    return response.json() as Promise<JsonObject>;
  }

  private authHeaders() {
    return {
      authorization: `Bearer ${requireConfig("circleApiKey")}`,
      "content-type": "application/json",
      "x-request-id": randomUUID()
    };
  }
}

export const circleApi = new CircleApiClient();
