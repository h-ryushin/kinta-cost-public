import { describe, expect, it } from "vitest";
import {
  createRecipeKey,
  createRecoveryCode,
  decryptJson,
  encryptJson,
  formatRecoveryInput,
  unwrapRecipeKey,
  wrapRecipeKey,
  wrappingKeyFromBytes,
  wrappingKeyFromPassphrase,
} from "./crypto";

const items = [{ type: "ingredient", id: "x", quantity: 30 }];

describe("秘密レシピの暗号化（D-093）", () => {
  it("暗号化して元に戻せる", async () => {
    const key = await createRecipeKey();
    const encrypted = await encryptJson(key, { items, memo: "配合はオーナーのみ" });
    expect(encrypted.ciphertext).not.toContain("配合");
    const back = await decryptJson<{ items: unknown[]; memo: string }>(key, encrypted);
    expect(back.memo).toBe("配合はオーナーのみ");
    expect(back.items).toEqual(items);
  });

  it("別の鍵では開けない", async () => {
    const key = await createRecipeKey();
    const other = await createRecipeKey();
    const encrypted = await encryptJson(key, { memo: "秘密" });
    await expect(decryptJson(other, encrypted)).rejects.toThrow();
  });

  it("暗号文を書き換えると開けない（改ざんを検出する）", async () => {
    const key = await createRecipeKey();
    const encrypted = await encryptJson(key, { memo: "秘密" });
    // 先頭の1文字を必ず別の文字にする（「A」に固定すると、もともと A のとき書き換わらず、64回に1回失敗していた）
    const first = encrypted.ciphertext[0] === "A" ? "B" : "A";
    const broken = { ...encrypted, ciphertext: `${first}${encrypted.ciphertext.slice(1)}` };
    await expect(decryptJson(key, broken)).rejects.toThrow();
  });

  it("パスキーから作った鍵で、レシピ鍵を包んで開ける", async () => {
    const recipeKey = await createRecipeKey();
    const prf = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapRecipeKey(await wrappingKeyFromBytes(prf), recipeKey);
    const opened = await unwrapRecipeKey(await wrappingKeyFromBytes(prf), wrapped);
    // 同じレシピ鍵が戻るので、片方で暗号化したものをもう片方で開ける
    const encrypted = await encryptJson(recipeKey, { memo: "塩だれ" });
    expect(await decryptJson<{ memo: string }>(opened, encrypted)).toEqual({ memo: "塩だれ" });
  });

  it("違うパスキーの出力では開けない", async () => {
    const recipeKey = await createRecipeKey();
    const wrapped = await wrapRecipeKey(await wrappingKeyFromBytes(crypto.getRandomValues(new Uint8Array(32))), recipeKey);
    const other = await wrappingKeyFromBytes(crypto.getRandomValues(new Uint8Array(32)));
    await expect(unwrapRecipeKey(other, wrapped)).rejects.toThrow();
  });

  it("復旧キー（合言葉）でも包んで開ける", async () => {
    const recipeKey = await createRecipeKey();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const code = createRecoveryCode();
    const wrapped = await wrapRecipeKey(await wrappingKeyFromPassphrase(code, salt), recipeKey);
    const opened = await unwrapRecipeKey(await wrappingKeyFromPassphrase(code, salt), wrapped);
    const encrypted = await encryptJson(recipeKey, { memo: "復旧できた" });
    expect(await decryptJson<{ memo: string }>(opened, encrypted)).toEqual({ memo: "復旧できた" });
  });

  it("復旧キーは読み間違えやすい文字を使わない", () => {
    const code = createRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9-]+$/);
    expect(code).not.toMatch(/[IO01]/);
    // 12文字を4文字ずつ区切る（D-152）
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});

describe("formatRecoveryInput（D-169）", () => {
  it("4文字ごとに「-」を入れ、大文字にする", () => {
    expect(formatRecoveryInput("abcdefghjkmn")).toBe("ABCD-EFGH-JKMN");
    expect(formatRecoveryInput("ABCDE")).toBe("ABCD-E");
  });

  it("4文字ちょうどのときは、うしろに「-」を付けない（消すときに止まらないように）", () => {
    expect(formatRecoveryInput("ABCD")).toBe("ABCD");
    expect(formatRecoveryInput("ABCD-")).toBe("ABCD");
  });

  it("打った「-」・空白・記号は入れ直すので、二重にならない", () => {
    expect(formatRecoveryInput("ABCD-EFGH-JKMN")).toBe("ABCD-EFGH-JKMN");
    expect(formatRecoveryInput("abcd efgh--jkmn")).toBe("ABCD-EFGH-JKMN");
  });

  it("前の20文字の予備の鍵も入る。それより長い分は切る", () => {
    expect(formatRecoveryInput("ABCDEFGHJKMNPQRSTUVW")).toBe("ABCD-EFGH-JKMN-PQRS-TUVW");
    expect(formatRecoveryInput("ABCDEFGHJKMNPQRSTUVWXYZ")).toBe("ABCD-EFGH-JKMN-PQRS-TUVW");
  });

  it("作った予備の鍵は、そのままの形で入る", () => {
    const code = createRecoveryCode();
    expect(formatRecoveryInput(code)).toBe(code);
  });
});

