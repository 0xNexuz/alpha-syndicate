export const config = {
  circleUseReal: process.env.CIRCLE_USE_REAL === "true",
  circleApiKey: process.env.CIRCLE_API_KEY,
  circleEntitySecretCiphertext: process.env.CIRCLE_ENTITY_SECRET_CIPHERTEXT,
  circleApiBaseUrl: process.env.CIRCLE_API_BASE_URL ?? "https://api.circle.com",
  cctpIrisBaseUrl: process.env.CCTP_IRIS_BASE_URL ?? "https://iris-api-sandbox.circle.com",
  x402FacilitatorUrl: process.env.CIRCLE_X402_FACILITATOR_URL,
  stableFxBaseUrl: process.env.CIRCLE_STABLEFX_BASE_URL,
  arcBlockchain: process.env.CIRCLE_ARC_BLOCKCHAIN ?? "ARC-TESTNET",
  baseBlockchain: process.env.CIRCLE_BASE_BLOCKCHAIN ?? "BASE-SEPOLIA",
  usdcTokenId: process.env.CIRCLE_USDC_TOKEN_ID,
  eurcTokenId: process.env.CIRCLE_EURC_TOKEN_ID,
  cctpSourceDomain: Number(process.env.CCTP_SOURCE_DOMAIN ?? 6),
  cctpDestinationDomain: Number(process.env.CCTP_DESTINATION_DOMAIN ?? 23),
  oracleCircleWalletId: process.env.ORACLE_CIRCLE_WALLET_ID,
  oracleCircleWalletAddress: process.env.ORACLE_CIRCLE_WALLET_ADDRESS,
  executionArcCircleWalletId: process.env.EXECUTION_ARC_CIRCLE_WALLET_ID,
  executionArcCircleWalletAddress: process.env.EXECUTION_ARC_CIRCLE_WALLET_ADDRESS,
  executionBaseCircleWalletId: process.env.EXECUTION_BASE_CIRCLE_WALLET_ID,
  executionBaseCircleWalletAddress: process.env.EXECUTION_BASE_CIRCLE_WALLET_ADDRESS
};

export function requireConfig(name: keyof typeof config): string {
  const value = config[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing_config_${name}`);
  }

  return value;
}
