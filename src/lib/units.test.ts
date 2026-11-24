import { describe, expect, it } from "vitest";
import { baseUnitOf, PURCHASE_UNITS, toBaseQuantity, unitsWithSameBase } from "./units";

describe("baseUnitOf（D-071・D-080）", () => {
  it("重さ・かさは g・ml にそろえる", () => {
    expect(baseUnitOf("kg")).toBe("g");
    expect(baseUnitOf("g")).toBe("g");
    expect(baseUnitOf("L")).toBe("ml");
    expect(baseUnitOf("ml")).toBe("ml");
  });

  it("数える単位は、そのまま基本単位", () => {
    for (const unit of ["個", "本", "袋", "缶", "パック", "束", "食", "回"] as const) {
      expect(baseUnitOf(unit)).toBe(unit);
    }
  });

  it("ml・L は ml のまま（比重で g に直さない：D-163）", () => {
    expect(baseUnitOf("L")).toBe("ml");
    expect(baseUnitOf("ml")).toBe("ml");
  });
});

describe("toBaseQuantity（D-071）", () => {
  it("kg・L は1000倍にする", () => {
    expect(toBaseQuantity(1.5, "kg")).toBe(1500);
    expect(toBaseQuantity(2, "L")).toBe(2000);
  });

  it("数える単位は掛けない", () => {
    expect(toBaseQuantity(3, "本")).toBe(3);
  });
});

describe("unitsWithSameBase（D-014）", () => {
  it("kg の材料は g・kg にだけ変えられる", () => {
    expect(unitsWithSameBase("kg")).toEqual(["g", "kg"]);
  });

  it("本の材料は本のまま（袋などには変えられない）", () => {
    expect(unitsWithSameBase("本")).toEqual(["本"]);
  });

  it("どの単位も、自分自身を含む", () => {
    for (const unit of PURCHASE_UNITS) expect(unitsWithSameBase(unit)).toContain(unit);
  });
});
