import { config } from "./config.js";
import type { AgentIdentity, SettlementReceipt, Wallet, X402Invoice } from "./types.js";

export const ORACLE_AGENT_ID = "oracle-alpha-001";
export const EXECUTION_AGENT_ID = "execution-agent-007";

export const wallets = new Map<string, Wallet>([
  [
    "wallet-oracle-arc",
    {
      id: "wallet-oracle-arc",
      agentId: ORACLE_AGENT_ID,
      address: (config.oracleCircleWalletAddress ?? "0x0rac1e0000000000000000000000000000000420") as `0x${string}`,
      chain: "arc-testnet",
      secret: "oracle-wallet-secret",
      balances: { USDC: 0, EURC: 0 }
    }
  ],
  [
    "wallet-exec-arc",
    {
      id: "wallet-exec-arc",
      agentId: EXECUTION_AGENT_ID,
      address: (config.executionArcCircleWalletAddress ?? "0xexec000000000000000000000000000000000007") as `0x${string}`,
      chain: "arc-testnet",
      secret: "execution-wallet-secret",
      balances: { USDC: 0.05, EURC: 5 }
    }
  ],
  [
    "wallet-exec-base",
    {
      id: "wallet-exec-base",
      agentId: EXECUTION_AGENT_ID,
      address: (config.executionBaseCircleWalletAddress ?? "0xbase000000000000000000000000000000000007") as `0x${string}`,
      chain: "base-sepolia",
      secret: "execution-base-wallet-secret",
      balances: { USDC: 2, EURC: 0 }
    }
  ]
]);

export const agents = new Map<string, AgentIdentity>([
  [
    ORACLE_AGENT_ID,
    {
      id: ORACLE_AGENT_ID,
      type: "oracle",
      kybStatus: "approved",
      riskScore: 12,
      walletId: "wallet-oracle-arc",
      privacySharedSecret: "alpha-syndicate-shared-secret"
    }
  ],
  [
    EXECUTION_AGENT_ID,
    {
      id: EXECUTION_AGENT_ID,
      type: "execution",
      kybStatus: "approved",
      riskScore: 18,
      walletId: "wallet-exec-arc",
      privacySharedSecret: "alpha-syndicate-shared-secret"
    }
  ]
]);

export const invoices = new Map<string, X402Invoice>();
export const settlements = new Map<string, SettlementReceipt>();
