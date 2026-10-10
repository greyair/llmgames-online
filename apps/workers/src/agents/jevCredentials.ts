import { z } from "zod";
import type { Env } from "../types";
import { pruneOldJevUsage } from "./jevUsage";

export interface JevCredential {
  id: string;
  ciphertext: string;
  nonce: string;
  key_version: string;
  verified_at: number;
  daily_limit: number;
}

const encoder = new TextEncoder();

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const decode = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

// A versioned keyring permits rotation without reusing the session signing secret.
async function encryptionKey(env: Env, version: string) {
  const keys = z.record(z.string(), z.string()).parse(JSON.parse(env.JEV_CREDENTIAL_KEYS ?? "{}"));
  const raw = decode(keys[version] ?? "");

  if (raw.length !== 32) throw new Error("Credential encryption unavailable");

  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function credentialStorageReady(env: Env) {
  try {
    await encryptionKey(env, env.JEV_CREDENTIAL_KEY_VERSION ?? "v1");

    return true;
  } catch {
    return false;
  }
}

export async function encryptJevKey(env: Env, ownerId: string, id: string, apiKey: string) {
  const version = env.JEV_CREDENTIAL_KEY_VERSION ?? "v1";
  const nonce = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: encoder.encode(JSON.stringify([ownerId, id, version])),
    },
    await encryptionKey(env, version),
    encoder.encode(apiKey),
  );

  return {
    ciphertext: encode(new Uint8Array(ciphertext)),
    nonce: encode(nonce),
    key_version: version,
  };
}

export async function decryptJevKey(
  env: Env,
  ownerId: string,
  row: Pick<JevCredential, "id" | "ciphertext" | "nonce" | "key_version">,
) {
  const bytes = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decode(row.nonce),
      additionalData: encoder.encode(JSON.stringify([ownerId, row.id, row.key_version])),
    },
    await encryptionKey(env, row.key_version),
    decode(row.ciphertext),
  );

  return new TextDecoder().decode(bytes);
}

export async function getJevCredential(env: Env, ownerId: string) {
  return env.DB.prepare(
    "SELECT id, ciphertext, nonce, key_version, verified_at, daily_limit FROM jev_credentials WHERE owner_id = ?",
  )
    .bind(ownerId)
    .first<JevCredential>();
}

// Atomic reservation also checks revocation/replacement before every paid request.
export async function reservePersonalJevCall(env: Env, ownerId: string, id: string) {
  const day = new Date().toISOString().slice(0, 10);
  await pruneOldJevUsage(env.DB, day);

  const row = await env.DB.prepare(`INSERT INTO jev_personal_usage (owner_id, day, calls)
    SELECT ?, ?, 1 FROM jev_credentials WHERE owner_id = ? AND id = ?
    ON CONFLICT(owner_id, day) DO UPDATE SET calls = calls + 1
    WHERE calls < (SELECT daily_limit FROM jev_credentials WHERE owner_id = ? AND id = ?)
    RETURNING calls`)
    .bind(ownerId, day, ownerId, id, ownerId, id)
    .first();

  return Boolean(row);
}
