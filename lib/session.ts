// Signed session cookie: "<expiry-unix-seconds>.<HMAC-SHA256(expiry)>".
// Uses Web Crypto so the same code runs in proxy.ts and in server actions.
// Fails closed: if AUTH_SECRET is missing, every cookie is treated as invalid.

export const SESSION_COOKIE = "ls_session";
export const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

async function hmacKey(): Promise<CryptoKey> {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is missing or shorter than 32 characters");
  }
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSession(): Promise<string> {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_TTL_S);
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(exp));
  return `${exp}.${Buffer.from(sig).toString("base64url")}`;
}

export async function verifySession(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  const expNum = Number(exp);
  if (!sig || !Number.isInteger(expNum) || expNum < Date.now() / 1000) return false;
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      Buffer.from(sig, "base64url"),
      enc.encode(exp),
    );
  } catch {
    return false;
  }
}
