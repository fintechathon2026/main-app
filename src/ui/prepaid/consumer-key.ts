"use client";

// The browser-held consumer key (architecture §15.3, §24.2, PRD G9/G10). It is generated here,
// stored only in this browser's IndexedDB, and used only to sign prepaid messages. It never goes to
// the server and is never logged: the server only learns the address (POST /api/prepaid/wallet)
// and the signatures. The backup is a password-encrypted file (PBKDF2 + AES-GCM, Web Crypto).

import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";

const DB = "reins-keys";
const STORE = "keys";
const ID = "consumer";
const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function loadKey(): Promise<Hex | null> {
  const k = await idb<unknown>("readonly", (s) => s.get(ID));
  return typeof k === "string" && KEY_RE.test(k) ? (k as Hex) : null;
}

async function saveKey(k: Hex): Promise<void> {
  await idb("readwrite", (s) => s.put(k, ID));
}

/** The consumer account in this browser, or null if none was created here yet. */
export async function consumerAccount(): Promise<PrivateKeyAccount | null> {
  const k = await loadKey();
  return k ? privateKeyToAccount(k) : null;
}

/** Creates the key if there is none, and registers its address. Returns the account. */
export async function ensureConsumerAccount(): Promise<PrivateKeyAccount> {
  let k = await loadKey();
  if (!k) {
    k = generatePrivateKey();
    await saveKey(k);
  }
  const account = privateKeyToAccount(k);
  const r = await fetch("/api/prepaid/wallet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: account.address }),
  });
  if (!r.ok) throw new Error(`wallet register failed (${r.status})`);
  return account;
}

// ---- Encrypted backup ---------------------------------------------------------------------

type Backup = { v: 1; kdf: "PBKDF2-SHA256"; iter: number; salt: string; iv: string; data: string; address: string };
const ITER = 310_000;
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(password: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** A password-encrypted backup file of the key (downloaded by the user, never uploaded). */
export async function exportBackup(password: string): Promise<Blob> {
  if (password.length < 8) throw new Error("Use at least 8 characters.");
  const k = await loadKey();
  if (!k) throw new Error("There is no key in this browser yet.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(password, salt, ITER), new TextEncoder().encode(k)));
  const backup: Backup = { v: 1, kdf: "PBKDF2-SHA256", iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(ct), address: privateKeyToAccount(k).address };
  return new Blob([JSON.stringify(backup)], { type: "application/json" });
}

/** Restores a key from a backup file into this browser and registers its address. */
export async function importBackup(file: File, password: string): Promise<PrivateKeyAccount> {
  const b = JSON.parse(await file.text()) as Backup;
  if (b.v !== 1 || b.kdf !== "PBKDF2-SHA256") throw new Error("This is not a Reins key backup.");
  let k: string;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(b.iv) }, await aesKey(password, unb64(b.salt), b.iter), unb64(b.data));
    k = new TextDecoder().decode(pt);
  } catch {
    throw new Error("Wrong password, or the file is damaged.");
  }
  if (!KEY_RE.test(k)) throw new Error("This is not a Reins key backup.");
  await saveKey(k as Hex);
  return ensureConsumerAccount();
}
