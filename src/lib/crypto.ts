/**
 * 秘密レシピの暗号化（D-093、要件定義書 4.3）。
 *
 * 考え方：
 * - 中身（材料・使用量・メモ）は **ブラウザの中だけ** で暗号化し、サーバーには暗号文しか送らない。
 * - 暗号化に使う「レシピ鍵」は1つ。これをオーナーの端末ごとに包んで（暗号化して）保存する。
 * - 端末ごとの包み紙の鍵は、パスキー（WebAuthn PRF）か、合言葉から作る。
 *   こうすると、サーバーにもデータベースにも開発者にも、レシピ鍵そのものは渡らない。
 *
 * 使っているのはブラウザ標準の WebCrypto だけ（追加のライブラリなし）。
 * - 中身の暗号化：AES-256-GCM
 * - 合言葉から鍵を作る：PBKDF2（SHA-256・30万回）
 */

const ALGO = "AES-GCM";
const KEY_BITS = 256;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 300_000;

export type Encrypted = { ciphertext: string; iv: string };

// ---------- 文字列との変換（Base64） ----------

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// ---------- レシピ鍵 ----------

/** 新しいレシピ鍵を作る（お店で1つ。版が変わるときだけ作り直す） */
export async function createRecipeKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: ALGO, length: KEY_BITS }, true, ["encrypt", "decrypt"]);
}

/** 生のバイト列からレシピ鍵を戻す */
export async function importRecipeKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: ALGO }, true, ["encrypt", "decrypt"]);
}

export async function exportRecipeKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

// ---------- 中身の暗号化 ----------

/** 中身（JSON にできるもの）を暗号化する */
export async function encryptJson(key: CryptoKey, value: unknown): Promise<Encrypted> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: ALGO, iv }, key, data);
  return { ciphertext: toBase64(cipher), iv: toBase64(iv) };
}

/** 暗号文を元に戻す。鍵が違えば必ず失敗する（改ざんも検出できる） */
export async function decryptJson<T>(key: CryptoKey, encrypted: Encrypted): Promise<T> {
  const iv = fromBase64(encrypted.iv);
  const data = fromBase64(encrypted.ciphertext);
  const plain = await crypto.subtle.decrypt({ name: ALGO, iv: iv as BufferSource }, key, data as BufferSource);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

// ---------- レシピ鍵を包む（端末ごと・合言葉） ----------

/** パスキーや合言葉から作った「包み紙の鍵」で、レシピ鍵を包む */
export async function wrapRecipeKey(wrappingKey: CryptoKey, recipeKey: CryptoKey): Promise<Encrypted> {
  const raw = await exportRecipeKey(recipeKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt({ name: ALGO, iv }, wrappingKey, raw as BufferSource);
  return { ciphertext: toBase64(cipher), iv: toBase64(iv) };
}

/** 包まれたレシピ鍵を開く */
export async function unwrapRecipeKey(wrappingKey: CryptoKey, wrapped: Encrypted): Promise<CryptoKey> {
  const iv = fromBase64(wrapped.iv);
  const data = fromBase64(wrapped.ciphertext);
  const raw = await crypto.subtle.decrypt({ name: ALGO, iv: iv as BufferSource }, wrappingKey, data as BufferSource);
  return importRecipeKey(new Uint8Array(raw));
}

/** パスキー（WebAuthn PRF）から出てきたバイト列を、包み紙の鍵にする */
export async function wrappingKeyFromBytes(bytes: Uint8Array): Promise<CryptoKey> {
  // PRF の出力をそのまま鍵にせず、HKDF で用途を分けてから使う
  const base = await crypto.subtle.importKey("raw", bytes as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("kinta:recipe-key") },
    base,
    { name: ALGO, length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

/** 合言葉（復旧キー）から包み紙の鍵を作る */
export async function wrappingKeyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase.normalize("NFKC")), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    base,
    { name: ALGO, length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * 予備の鍵の入力欄に打った文字を、控えと同じ形（ABCD-EFGH-JKMN）にそろえる（D-169）。
 * 大文字にし、英数字以外を外して4文字ごとに「-」を入れるので、「-」は打たなくてよい。
 * 前の20文字の予備の鍵（D-148）も入るよう、20文字まで受け付ける。
 */
export function formatRecoveryInput(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, 20)
    .replace(/(.{4})(?=.)/g, "$1-");
}

/** 復旧キー（紙に控える用）。読み間違えやすい文字は使わない */
export function createRecoveryCode(length = 12): string {
  // 32文字（2^5）から選ぶので、256 で割り切れて偏りが出ない。12文字で約60ビット（D-152）
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return chars.join("").replace(/(.{4})(?=.)/g, "$1-");
}
