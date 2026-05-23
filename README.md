# Alpha Syndicate x402 Demo

Prototype for an M2M research marketplace where an Execution Agent pays an Oracle Agent for high-conviction trading signals using an x402-style payment challenge, Circle agent wallets, CCTP funding, FX conversion, and paymaster-sponsored settlement.

## Architecture Blueprint

1. **Circle Wallets**: each autonomous agent has a programmatic wallet identity. The demo uses deterministic mock Circle wallet records in `src/lib/state.ts`; production swaps these calls for Circle Developer-Controlled Wallet APIs.
2. **Identity and Compliance**: the API Gateway checks `x-agent-id` against a KYB/KYC registry before it will quote or settle. Non-approved agents receive `403`.
3. **CCTP Funding**: if the Execution Agent lacks Arc USDC, it burns mock USDC on a source testnet and mints Arc USDC before payment. Production maps this to CCTP `TokenMessenger` burn, Circle attestation, then destination mint.
4. **FX Engine**: if USDC is still short, the agent converts EURC to USDC before settlement. In production, this can route through Circle Mint, Gateway liquidity, or a DEX/RFQ venue.
5. **API Gateway**: Express sits in front of the Oracle Agent at `/oracle/signal`, enforces compliance, issues x402 invoices, validates settlement proofs, and forwards authorized requests.
6. **x402 + Agent Wallets**: first request returns HTTP `402 Payment Required` with an invoice payload. The agent signs and settles the invoice, then retries with `x-payment`.
7. **Paymaster**: settlement is modeled as a gasless ERC-4337-style user operation sponsored by a paymaster. Production should replace the mock with Circle Paymaster-compatible UserOp construction and bundler submission.
8. **Opt-in Privacy**: invoice and response include a privacy commitment and proof. With `privacy=true`, the signal payload is AES-GCM encrypted for the Execution Agent.

## Demo Flow

```bash
npm install
npm run dev:gateway
```

In another terminal:

```bash
npm run dev:agent
```

Expected behavior:

- Agent calls `/oracle/signal`.
- Gateway returns `402` with a USDC invoice.
- Agent runs compliance-aware funding logic, bridges if needed, converts EURC if needed, signs a gasless payment, settles, and retries.
- Gateway returns the trading signal JSON or encrypted private payload.

## Production Swap Points

- `CircleWalletService`: Circle wallet identity and signing. Set `CIRCLE_USE_REAL=true` and provide Circle wallet IDs/addresses in `.env`.
- `CctpBridge`: real mode creates a Circle developer-controlled transfer on the source chain and fetches CCTP Iris messages from `https://iris-api-sandbox.circle.com`.
- `FxEngine`: real mode calls a configured `CIRCLE_STABLEFX_BASE_URL` for EURC/USDC quotes.
- `PaymasterClient`: currently prepares the sponsored UserOp envelope; plug its `userOperationHash` into your Circle Paymaster/bundler flow.
- `X402Facilitator`: real mode calls `CIRCLE_X402_FACILITATOR_URL/verify`; mock mode settles against the local ledger.
- `PrivacyService`: replace hash commitment mock with TLS-notary, ZK proof, TEE attestation, or encrypted signal delivery keys.

## Real Circle Mode

Copy `.env.example` to `.env`, fill in your Circle sandbox/testnet values, then run with:

```bash
CIRCLE_USE_REAL=true npm run dev:gateway
```

The real integration points are intentionally isolated in `src/lib/circle-client.ts` and `src/lib/services.ts`, so the hackathon demo can keep running locally while credentials and final Circle endpoint access are added.

Docs used for the integration shape:

- Circle Developer-Controlled Wallet transfer API: https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/create-developer-transaction-transfer
- CCTP technical guide and Iris endpoints: https://developers.circle.com/cctp/technical-guide/
- x402 Nanopayments concept: https://developers.circle.com/gateway/nanopayments/concepts/x402
- x402 Nanopayments integration guide: https://developers.circle.com/gateway/nanopayments/howtos/x402-integration
