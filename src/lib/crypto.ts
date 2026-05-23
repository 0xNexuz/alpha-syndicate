import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function signWalletPayload(walletSecret: string, payload: unknown): string {
  return createHmac("sha256", walletSecret)
    .update(canonicalJson(payload))
    .digest("hex");
}

export function verifyWalletSignature(walletSecret: string, payload: unknown, signature: string): boolean {
  return signWalletPayload(walletSecret, payload) === signature;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}

export function encryptForAgent(plaintext: unknown, sharedSecret: string) {
  const key = createHash("sha256").update(sharedSecret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), "utf8"),
    cipher.final()
  ]);

  return {
    alg: "A256GCM",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url")
  };
}

export function decryptForAgent(payload: {
  iv: string;
  tag: string;
  ciphertext: string;
}, sharedSecret: string): unknown {
  const key = createHash("sha256").update(sharedSecret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64url")),
    decipher.final()
  ]);

  return JSON.parse(plaintext.toString("utf8"));
}
