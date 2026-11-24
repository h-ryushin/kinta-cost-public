"use client";

import { useSyncExternalStore } from "react";
import {
  createRecipeKey,
  createRecoveryCode,
  fromBase64,
  toBase64,
  unwrapRecipeKey,
  wrapRecipeKey,
  wrappingKeyFromBytes,
  wrappingKeyFromPassphrase,
} from "./crypto";
import { supabase } from "./supabase";

/**
 * 秘密レシピの鍵（D-148。要件定義書 4.3、D-145）。
 *
 * - レシピ鍵（AES-256）はお店で1つ。このブラウザの中で作り、サーバーには包んだものしか送らない。
 * - 開け方は2つ。
 *   1. 顔・指紋：パスキーに PRF を頼むと、顔・指紋を通したときだけ「その端末の秘密の値」が返ってくる。
 *      これで包み紙の鍵を作り、端末ごとに包んだレシピ鍵（recipe_key_slots）を開く。
 *   2. 予備の鍵：控えておく12文字（D-152）。PBKDF2 で包み紙の鍵を作り、recipe_keys の包んだ鍵を開く。
 * - 開いた鍵は、この画面のあいだだけメモリに持つ（保存しない）。読み込み直す・ログアウトすると閉じる。
 */

export class RecipeKeyError extends Error {}

/** PRF に渡す値。サイトと用途ごとに固定（変えると、それまでの端末で開けなくなる） */
const PRF_SALT = new TextEncoder().encode("kinta-cost:recipe-key:v1");
const RECOVERY_SALT_BYTES = 16;

export type RecipeKeyStatus = "unknown" | "none" | "locked" | "unlocked";

type Unlocked = { key: CryptoKey; version: number };

let unlocked: Unlocked | null = null;
let status: RecipeKeyStatus = "unknown";
const listeners = new Set<() => void>();

function setState(next: RecipeKeyStatus, key: Unlocked | null = unlocked) {
  status = next;
  unlocked = key;
  listeners.forEach((l) => l());
}

export function useRecipeKeyStatus(): RecipeKeyStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
    () => "unknown" as RecipeKeyStatus,
  );
}

/** 開いているレシピ鍵。閉じていれば null */
export function currentRecipeKey(): Unlocked | null {
  return unlocked;
}

/** 鍵が開いたときに、秘密の中身を読み直すための知らせ（store.ts が登録する） */
let onUnlock: ((key: Unlocked) => Promise<void>) | null = null;
export function setOnRecipeKeyUnlock(handler: (key: Unlocked) => Promise<void>) {
  onUnlock = handler;
}

async function opened(key: Unlocked) {
  setState("unlocked", key);
  await onUnlock?.(key);
}

/** ログアウトしたときに呼ぶ */
export function lockRecipeKey() {
  setState("unknown", null);
}

type KeyRow = { version: number; recovery_wrapped_key: string; recovery_iv: string; recovery_salt: string };

async function latestKeyRow(): Promise<KeyRow | null> {
  const { data, error } = await supabase
    .from("recipe_keys")
    .select("version, recovery_wrapped_key, recovery_iv, recovery_salt")
    .order("version", { ascending: false })
    .limit(1);
  if (error) throw new RecipeKeyError("鍵の情報を読めませんでした。顔・指紋で入り直してください");
  return (data?.[0] as KeyRow | undefined) ?? null;
}

/** 鍵がもう作ってあるかを調べる（オーナーだけが読める） */
export async function refreshRecipeKeyStatus(): Promise<RecipeKeyStatus> {
  if (unlocked) return status;
  const row = await latestKeyRow().catch(() => null);
  setState(row ? "locked" : "none", null);
  return status;
}

// ---------- パスキーの PRF ----------

function base64url(bytes: ArrayBuffer): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type PrfResult = { credentialId: string; secret: Uint8Array };

/**
 * 顔・指紋を通して、パスキーから秘密の値（PRF）をもらう。やめたときは null。
 * 認証そのものはしない（ログインとは別）。値がほしいだけなので、サーバーに確かめてもらう必要はない。
 */
async function passkeySecret(): Promise<PrfResult | null> {
  if (typeof window === "undefined" || typeof window.PublicKeyCredential !== "function") {
    throw new RecipeKeyError("このブラウザは顔・指紋に対応していません。予備の鍵で開いてください");
  }
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        userVerification: "required",
        timeout: 120_000,
        extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError")) return null;
    throw new RecipeKeyError(`顔・指紋を使えませんでした（${e instanceof Error ? e.message : String(e)}）`);
  }
  if (!credential) return null;
  const results = credential.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  const first = results.prf?.results?.first;
  if (!first) {
    throw new RecipeKeyError("この端末の顔・指紋では、秘密レシピの鍵を開けられません（対応していません）。予備の鍵で開いてください");
  }
  return { credentialId: base64url(credential.rawId), secret: new Uint8Array(first) };
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac/.test(ua)) return "Mac";
  return "端末";
}

async function saveSlot(prf: PrfResult, key: Unlocked) {
  const wrapped = await wrapRecipeKey(await wrappingKeyFromBytes(prf.secret), key.key);
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("recipe_key_slots").upsert({
    credential_id: prf.credentialId,
    user_id: user.user?.id,
    key_version: key.version,
    wrapped_key: wrapped.ciphertext,
    iv: wrapped.iv,
    label: deviceLabel(),
  });
  if (error) throw new RecipeKeyError("この端末の鍵を保存できませんでした");
}

// ---------- 作る・開ける ----------

/**
 * はじめに1回だけ、レシピ鍵を作る。予備の鍵（控えておく12文字）を返す。
 * この端末の顔・指紋でも開けるようにする。顔・指紋が使えない端末では作れない（iPhone で作ってもらう）。
 */
export async function setupRecipeKey(): Promise<string | null> {
  if ((await latestKeyRow()) !== null) throw new RecipeKeyError("秘密レシピの鍵は、もう作ってあります");
  const prf = await passkeySecret();
  if (!prf) return null;
  const key: Unlocked = { key: await createRecipeKey(), version: 1 };
  const recovery = createRecoveryCode();
  const salt = crypto.getRandomValues(new Uint8Array(RECOVERY_SALT_BYTES));
  const wrapped = await wrapRecipeKey(await wrappingKeyFromPassphrase(normalizeRecovery(recovery), salt), key.key);
  const { error } = await supabase.from("recipe_keys").insert({
    version: key.version,
    recovery_wrapped_key: wrapped.ciphertext,
    recovery_iv: wrapped.iv,
    recovery_salt: toBase64(salt),
  });
  if (error) throw new RecipeKeyError("秘密レシピの鍵を作れませんでした。顔・指紋で入り直してから、もう一度押してください");
  await saveSlot(prf, key);
  await opened(key);
  return recovery;
}

/** 顔・指紋で開ける。この端末がまだ登録されていなければ、そう知らせる */
export async function unlockWithPasskey(): Promise<boolean> {
  const prf = await passkeySecret();
  if (!prf) return false;
  const { data, error } = await supabase
    .from("recipe_key_slots")
    .select("key_version, wrapped_key, iv")
    .eq("credential_id", prf.credentialId)
    .maybeSingle();
  if (error) throw new RecipeKeyError("鍵の情報を読めませんでした。顔・指紋で入り直してください");
  if (!data) {
    throw new RecipeKeyError("この端末の顔・指紋は、まだ秘密レシピの鍵に登録されていません。予備の鍵で開くと、この端末も登録できます");
  }
  let key: CryptoKey;
  try {
    key = await unwrapRecipeKey(await wrappingKeyFromBytes(prf.secret), { ciphertext: data.wrapped_key, iv: data.iv });
  } catch {
    throw new RecipeKeyError("鍵を開けられませんでした。予備の鍵で開いてください");
  }
  await supabase.from("recipe_key_slots").update({ last_used_at: new Date().toISOString() }).eq("credential_id", prf.credentialId);
  // 開けたあとの読み直し・暗号化し直しの失敗は、鍵の誤りとは別に知らせる
  await opened({ key, version: data.key_version });
  return true;
}

/** 入力の空白・ハイフン・小文字の違いを吸収する */
export function normalizeRecovery(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** 予備の鍵（控えた12文字。前に作った20文字のものも使える）で開ける */
export async function unlockWithRecovery(code: string): Promise<void> {
  const row = await latestKeyRow();
  if (!row) throw new RecipeKeyError("秘密レシピの鍵がまだありません");
  let key: CryptoKey;
  try {
    const wrapping = await wrappingKeyFromPassphrase(normalizeRecovery(code), fromBase64(row.recovery_salt));
    key = await unwrapRecipeKey(wrapping, { ciphertext: row.recovery_wrapped_key, iv: row.recovery_iv });
  } catch {
    throw new RecipeKeyError("予備の鍵が違います。控えた文字を確かめてください");
  }
  await opened({ key, version: row.version });
}

/**
 * 鍵が開いているときに、予備の鍵を作り直す（D-152）。新しい予備の鍵を返す。前の予備の鍵は使えなくなる。
 * レシピ鍵そのものは変えないので、暗号文や端末の登録はそのまま使える。
 */
export async function renewRecoveryKey(): Promise<string> {
  if (!unlocked) throw new RecipeKeyError("先に鍵を開けてください");
  const recovery = createRecoveryCode();
  const salt = crypto.getRandomValues(new Uint8Array(RECOVERY_SALT_BYTES));
  const wrapped = await wrapRecipeKey(await wrappingKeyFromPassphrase(normalizeRecovery(recovery), salt), unlocked.key);
  const { data, error } = await supabase
    .from("recipe_keys")
    .update({ recovery_wrapped_key: wrapped.ciphertext, recovery_iv: wrapped.iv, recovery_salt: toBase64(salt) })
    .eq("version", unlocked.version)
    .select("version");
  if (error || !data || data.length === 0) throw new RecipeKeyError("予備の鍵を作り直せませんでした。顔・指紋で入り直してください");
  return recovery;
}

/** 鍵が開いているときに、この端末の顔・指紋でも開けるようにする */
export async function addThisDevice(): Promise<boolean> {
  if (!unlocked) throw new RecipeKeyError("先に鍵を開けてください");
  const prf = await passkeySecret();
  if (!prf) return false;
  // iCloud で同期した顔・指紋は iPhone と Mac で同じ登録だが、Mac では違う値が返ることがある。
  // 上書きすると iPhone で開けなくなるので、すでにある登録は開けるか確かめるだけにする（D-158）
  const { data, error } = await supabase.from("recipe_key_slots").select("wrapped_key, iv").eq("credential_id", prf.credentialId).maybeSingle();
  if (error) throw new RecipeKeyError("鍵の情報を読めませんでした。顔・指紋で入り直してください");
  if (data) {
    try {
      await unwrapRecipeKey(await wrappingKeyFromBytes(prf.secret), { ciphertext: data.wrapped_key, iv: data.iv });
    } catch {
      throw new RecipeKeyError("この顔・指紋は、ほかの端末（iPhone など）で登録してあります。この端末では、予備の鍵で開いてください");
    }
    return true;
  }
  await saveSlot(prf, unlocked);
  return true;
}

/** 鍵を開けられる端末の数 */
export async function countKeyDevices(): Promise<number> {
  const { count } = await supabase.from("recipe_key_slots").select("credential_id", { count: "exact", head: true });
  return count ?? 0;
}
