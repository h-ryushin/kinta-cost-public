import { describe, expect, it } from "vitest";
import { logAction, logDetail } from "./log-format";

describe("操作ログの表示（D-130・D-132）", () => {
  it("action を日本語にする", () => {
    expect(logAction("auth.login")).toBe("ログイン");
    expect(logAction("ingredient.price_changed")).toBe("価格を変更");
    expect(logAction("user.deleted")).toBe("利用者を削除");
  });

  it("知らない action は、そのまま出す（消さない）", () => {
    expect(logAction("device.approved")).toBe("device.approved");
  });

  it("ふつうの記録は名前だけ", () => {
    expect(logDetail("recipe.updated", { name: "タン塩小" })).toBe("タン塩小");
    expect(logDetail("auth.login", {})).toBe("");
  });

  it("価格の変更は「名前：前 → 後」", () => {
    const detail = {
      name: "米",
      old: { price: 3800, quantity: "5.000", unit: "kg" },
      new: { price: 4200, quantity: 5, unit: "kg" },
    };
    expect(logDetail("ingredient.price_changed", detail)).toBe("米：3,800円 / 5kg → 4,200円 / 5kg");
  });

  it("中身が欠けていても止まらない", () => {
    expect(logDetail("ingredient.price_changed", { name: "米", old: null })).toBe("米： → ");
  });
});
