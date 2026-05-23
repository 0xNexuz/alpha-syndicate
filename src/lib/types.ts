export type Chain = "arc-testnet" | "base-sepolia";
export type Asset = "USDC" | "EURC";

export interface Wallet {
  id: string;
  agentId: string;
  address: `0x${string}`;
  chain: Chain;
  secret: string;
  balances: Record<Asset, number>;
}

export interface AgentIdentity {
  id: string;
  type: "oracle" | "execution";
  kybStatus: "approved" | "pending" | "rejected";
  riskScore: number;
  walletId: string;
  privacySharedSecret: string;
}

export interface X402Invoice {
  x402Version: "1";
  invoiceId: string;
  resource: string;
  description: string;
  network: Chain;
  asset: "USDC";
  amount: number;
  decimals: 6;
  payTo: `0x${string}`;
  facilitatorUrl: string;
  expiresAt: string;
  nonce: string;
  privacyCommitment: string;
}

export interface PaymentAuthorization {
  invoiceId: string;
  payerAgentId: string;
  payerWalletId: string;
  invoiceHash: string;
  signature: string;
  userOperationHash: string;
  paymaster: {
    sponsor: "circle-paymaster";
    gasAsset: "USDC";
    gaslessForAgent: true;
  };
  privacyProof: string;
}

export interface SettlementReceipt {
  invoiceId: string;
  txHash: string;
  settledAt: string;
  payerWalletId: string;
  amount: number;
  asset: "USDC";
  network: Chain;
  privacyProof: string;
}
