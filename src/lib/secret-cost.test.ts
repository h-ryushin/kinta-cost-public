import { describe, expect, it } from "vitest";
import { isSecretCostStale, staleSecrets } from "./secret-cost";

const history = [{ changedAt: "2026-10-20T03:00:00Z" }, { changedAt: "2026-10-10T03:00:00Z" }];

describe("秘密のものの原価が古いか（D-154）", () => {
  it("計算し直したあとに材料の値段が変わっていれば、古い", () => {
    expect(isSecretCostStale({ secret: true, sealed: true, secretCostAt: "2026-10-15T00:00:00Z" }, history)).toBe(true);
  });

  it("いちばん新しい値段の変更よりあとに計算し直していれば、古くない", () => {
    expect(isSecretCostStale({ secret: true, sealed: true, secretCostAt: "2026-10-21T00:00:00Z" }, history)).toBe(false);
  });

  it("鍵を開けて中身が見えているもの・秘密でないものは、古くない（その場で計算している）", () => {
    expect(isSecretCostStale({ secret: true, sealed: false, secretCostAt: "2026-10-01T00:00:00Z" }, history)).toBe(false);
    expect(isSecretCostStale({ secret: false }, history)).toBe(false);
  });

  it("まだ一度も計算していなければ、古い", () => {
    expect(isSecretCostStale({ secret: true, sealed: true, secretCostAt: null }, history)).toBe(true);
  });

  it("古いものだけを返す", () => {
    const items = [
      { id: "a", name: "塩だれ", secret: true, sealed: true, secretCostAt: "2026-10-15T00:00:00Z" },
      { id: "b", name: "上タン塩だれ", secret: true, sealed: true, secretCostAt: "2026-10-22T00:00:00Z" },
    ];
    expect(staleSecrets(items, history).map((i) => i.name)).toEqual(["塩だれ"]);
  });
});
