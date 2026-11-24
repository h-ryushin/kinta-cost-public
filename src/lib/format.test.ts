import { describe, expect, it } from "vitest";
import { dateTime, dayKey, dayLabel, percent, taxIncluded, timeOfDay, toNumber, withoutTax, withTax, yen, yenDecimal, yenWithTax } from "./format";

describe("toNumber", () => {
  it("半角の数字を読む", () => {
    expect(toNumber("1")).toBe(1);
    expect(toNumber("0.5")).toBe(0.5);
    expect(toNumber("4,500")).toBe(4500);
  });

  it("全角の数字・小数点を読む", () => {
    expect(toNumber("１")).toBe(1);
    expect(toNumber("０．５")).toBe(0.5);
    expect(toNumber("４，５００")).toBe(4500);
  });

  it("後ろに付けた単位を無視する", () => {
    expect(toNumber("80g")).toBe(80);
    expect(toNumber("1ml")).toBe(1);
    expect(toNumber("１ｍｌ")).toBe(1);
    expect(toNumber("1L")).toBe(1);
    expect(toNumber("2kg")).toBe(2);
    expect(toNumber("500円")).toBe(500);
    expect(toNumber("3個")).toBe(3);
  });

  it("分数を読む", () => {
    expect(toNumber("1/2")).toBe(0.5);
    expect(toNumber("１／４")).toBe(0.25);
    expect(toNumber("1/0")).toBeNaN();
  });

  it("空欄や読めない値は NaN", () => {
    expect(toNumber("")).toBeNaN();
    expect(toNumber("  ")).toBeNaN();
    expect(toNumber("abc")).toBeNaN();
  });
});

describe("税込の表示（D-101・D-105）", () => {
  it("税抜に税率を掛けて、1円未満は切り捨てる", () => {
    expect(withTax(1255, 10)).toBe(1380);
    expect(withTax(1000, 8)).toBe(1080);
    expect(yenWithTax(1255, 10)).toBe("1,255円（税込1,380円）");
  });
});

describe("税込から税抜を出す（D-179）", () => {
  it("税込を税率で割って、1円未満は切り上げる", () => {
    expect(withoutTax(600, 10)).toBe(546); // 545.45… → 546（四捨五入だと545で、税込が599円になる）
    expect(withoutTax(1380, 10)).toBe(1255);
    expect(withoutTax(1100, 10)).toBe(1000); // 割り切れるときはそのまま
    expect(withoutTax(1080, 8)).toBe(1000);
  });
  it("切り上げた税抜を税込に戻すと、入れた値段か1円多い値段になる", () => {
    expect(withTax(withoutTax(600, 10), 10)).toBe(600);
    expect(withTax(withoutTax(450, 10), 10)).toBe(451); // 税抜を1円単位にすると、ぴったり戻らない値段
    for (let t = 1; t <= 20_000; t++) {
      const back = withTax(withoutTax(t, 10), 10);
      expect(back === t || back === t + 1).toBe(true);
    }
  });
  it("保存済みの税抜を税込に直して戻しても、税抜は変わらない（欄を触らずに保存したとき）", () => {
    for (const rate of [8, 10]) {
      for (let x = 1; x <= 20_000; x++) expect(withoutTax(withTax(x, rate), rate)).toBe(x);
    }
  });
});

describe("日付の出し方（D-107）", () => {
  const now = new Date("2026-10-04T12:00:00.000Z");
  it("今日・昨日・それより前を分ける（日本時間）", () => {
    expect(dayLabel("2026-10-04T01:00:00.000Z", now)).toBe("今日（10月4日）");
    expect(dayLabel("2026-10-03T01:00:00.000Z", now)).toBe("昨日（10月3日）");
    expect(dayLabel("2026-10-01T01:00:00.000Z", now)).toBe("10月1日（木）");
    expect(dayLabel("2025-12-31T01:00:00.000Z", now)).toBe("2025年12月31日（水）");
  });
  it("時刻は日本時間で出す", () => {
    expect(timeOfDay("2026-10-04T05:07:00.000Z")).toBe("14:07");
    expect(dayKey("2026-10-03T15:30:00.000Z")).toBe("2026-10-04");
    // 操作ログの日時も日本時間（UTC 10/3 15:30 は日本時間 10/4 0:30）
    expect(dateTime("2026-10-03T15:30:00.000Z")).toBe("2026/10/04 00:30");
  });
});

describe("金額と率の出し方", () => {
  it("円は3桁ごとに区切る", () => {
    expect(yen(0)).toBe("0円");
    expect(yen(1234567)).toBe("1,234,567円");
  });

  it("単価は小数第4位まで、末尾の0は付けない", () => {
    expect(yenDecimal(0.84)).toBe("0.84円");
    expect(yenDecimal(3.818181)).toBe("3.8182円");
    expect(yenDecimal(6)).toBe("6円");
  });

  it("税込は1円未満を切り捨てる（D-101）", () => {
    expect(withTax(986, 10)).toBe(1084);
    expect(withTax(999, 8)).toBe(1078);
    expect(withTax(0, 10)).toBe(0);
  });

  it("小数の誤差で1円少なく出ない（整数で計算する：D-161）", () => {
    // 100 * 1.15 は小数だと 114.99999999999999 になる
    expect(withTax(100, 15)).toBe(115);
    expect(withTax(1000, 8.5)).toBe(1085);
    expect(withTax(545, 10)).toBe(599);
  });

  it("入力の途中（空欄）でも止まらない", () => {
    expect(withTax(Number.NaN, 10)).toBeNaN();
    expect(withTax(1000, Number.NaN)).toBeNaN();
  });

  it("原価率は小数第1位まで。売価がないときは「—」", () => {
    expect(percent(29.234)).toBe("29.2%");
    expect(percent(null)).toBe("—");
  });
});

describe("taxIncluded", () => {
  it("「税込 ◯円」の形にする（端数は切り捨て：D-101）", () => {
    expect(taxIncluded(1255, 10)).toBe("税込 1,380円");
    expect(taxIncluded(1000, 8)).toBe("税込 1,080円");
  });
});
