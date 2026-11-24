import { describe, expect, it } from "vitest";
import { groupByDay, isRealPriceChange, isShownPriceChange, isUnitChange, isUnitRelabel, yieldRateChange, priceChangeDays, salePriceChangeAfter, priceImpacts, priceImpactsByDay, salePriceChanges } from "./price-impact";
import { DEFAULT_RATIO_TARGETS, STORE_VERSION, type Ingredient, type StoreData } from "./types";

const t = "2026-10-03T00:00:00.000Z";
const ing = (id: string, price: number, qty: number, unit: Ingredient["purchaseUnit"]): Ingredient => ({
  id,
  name: id,
  category: "その他",
  supplier: "",
  yieldRate: 100,
  purchasePrice: price,
  purchaseQuantity: qty,
  purchaseUnit: unit,
  createdAt: t,
  updatedAt: t,
});

/** 牛タンを 4,500円/kg → 5,000円/kg に値上げしたあとのデータ */
const data: StoreData = {
  version: STORE_VERSION,
  settings: { purchaseTaxRate: 8, saleTaxRate: 10, ratioTargets: DEFAULT_RATIO_TARGETS },
  ingredients: [ing("gyutan", 5000, 1, "kg"), ing("shio", 150, 1, "kg")],
  priceHistory: [
    {
      id: "h1",
      ingredientId: "gyutan",
      changedAt: t,
      oldPrice: 4500,
      oldQuantity: 1,
      oldUnit: "kg",
      newPrice: 5000,
      newQuantity: 1,
      newUnit: "kg",
    },
  ],
  salePriceHistory: [],
  preps: [],
  recipes: [
    {
      id: "m1",
      kind: "menu",
      category: "焼肉（塩）",
      name: "タン塩",
      secret: false,
      salePrice: 1280,
      memo: "",
      items: [
        { type: "ingredient", id: "gyutan", quantity: 80 },
        { type: "ingredient", id: "shio", quantity: 2 },
      ],
      createdAt: t,
      updatedAt: t,
    },
    {
      id: "m2",
      kind: "menu",
      category: "ご飯物",
      name: "ごはん",
      secret: false,
      salePrice: 300,
      memo: "",
      items: [{ type: "ingredient", id: "shio", quantity: 1 }],
      createdAt: t,
      updatedAt: t,
    },
  ],
  logs: [],
};

describe("priceImpacts（D-098）", () => {
  it("値上げで原価が変わったメニューを出す", () => {
    const [impact] = priceImpacts(data);
    expect(impact.ingredientName).toBe("gyutan");
    expect(impact.rate).toBeCloseTo(5000 / 4500, 4);
    // タン塩：牛タン80g（360→400円）＋塩2g（0.3円）。塩しか使わない「ごはん」は出ない
    expect(impact.changes.map((c) => [c.name, c.before, c.after])).toEqual([["タン塩", 360.3, 400.3]]);
  });

  it("変わったあとの原価率も出す", () => {
    const [impact] = priceImpacts(data);
    // 売価は税込1,280円 → 税抜1,164円（1,163.6… を切り上げ：D-181）。400.3 / 1164 = 34.39%
    expect(impact.changes[0].ratioAfter).toBeCloseTo(34.39, 2);
  });

  it("使っているメニューがなければ、変化なしとして出す", () => {
    const alone: StoreData = { ...data, recipes: [] };
    const [impact] = priceImpacts(alone);
    expect(impact.changes).toEqual([]);
  });
});

describe("priceImpactsByDay（D-107）", () => {
  const history = (id: string, ingredientId: string, changedAt: string, oldPrice: number, newPrice: number) => ({
    id,
    ingredientId,
    changedAt,
    oldPrice,
    oldQuantity: 1,
    oldUnit: "kg" as const,
    newPrice,
    newQuantity: 1,
    newUnit: "kg" as const,
  });
  // 日本時間 10/4 に牛タンを2回（4,000→4,500→5,000）と塩を値上げ、10/3 に牛タンを 3,500→4,000
  const multi: StoreData = {
    ...data,
    ingredients: [ing("gyutan", 5000, 1, "kg"), ing("shio", 300, 1, "kg")],
    priceHistory: [
      history("h4", "shio", "2026-10-04T05:00:00.000Z", 150, 300),
      history("h3", "gyutan", "2026-10-04T03:00:00.000Z", 4500, 5000),
      history("h2", "gyutan", "2026-10-04T01:00:00.000Z", 4000, 4500),
      history("h1", "gyutan", "2026-10-03T01:00:00.000Z", 3500, 4000),
    ],
  };
  const now = new Date("2026-10-04T12:00:00.000Z");

  it("日本時間の日ごとにまとめ、今日・昨日と出す", () => {
    const days = priceImpactsByDay(multi, 30, now);
    expect(days.map((d) => [d.day, d.label, d.impacts.length])).toEqual([
      ["2026-10-04", "今日（10月4日）", 3],
      ["2026-10-03", "昨日（10月3日）", 1],
    ]);
  });

  it("その日の変更をまとめて、その日の最初の値段と比べる", () => {
    const [today] = priceImpactsByDay(multi, 30, now);
    // タン塩：牛タン 80g 4,000円/kg → 5,000円/kg（320→400）、塩 2g 150→300円/kg（0.3→0.6）
    // ごはん：塩 1g（0.15→0.2円、0.3円）。0.1円単位なので、ここも変わる（D-171）
    expect(today.changes.map((c) => [c.name, c.before, c.after])).toEqual([
      ["タン塩", 320.3, 400.6],
      ["ごはん", 0.2, 0.3],
    ]);
  });

  it("日本時間の0時をまたぐ変更は、日本の日付で分ける", () => {
    // UTC 10/3 15:30 は日本時間 10/4 0:30
    const late: StoreData = { ...data, priceHistory: [history("h", "gyutan", "2026-10-03T15:30:00.000Z", 4500, 5000)] };
    expect(priceImpactsByDay(late, 30, now)[0].day).toBe("2026-10-04");
  });
});

describe("仕込み品の原価の変化（D-114）", () => {
  const withPrep: StoreData = {
    ...data,
    preps: [
      {
        id: "p1",
        name: "タンの下ごしらえ",
        secret: false,
        items: [{ type: "ingredient", id: "gyutan", quantity: 100 }],
        yieldQuantity: 80,
        yieldUnit: "g",
        memo: "",
        createdAt: t,
        updatedAt: t,
      },
      {
        id: "p2",
        name: "塩だけ",
        secret: false,
        items: [{ type: "ingredient", id: "shio", quantity: 10 }],
        yieldQuantity: 10,
        yieldUnit: "g",
        memo: "",
        createdAt: t,
        updatedAt: t,
      },
    ],
  };

  it("材料の値上げで1回分の原価が変わった仕込み品を出す（使っていないものは出さない）", () => {
    // 牛タン100g：4,500円/kg → 5,000円/kg で 450 → 500円
    const [impact] = priceImpacts(withPrep);
    expect(impact.prepChanges.map((p) => [p.name, p.before, p.after])).toEqual([["タンの下ごしらえ", 450, 500]]);
  });

  it("日ごとのまとめにも出す", () => {
    const [day] = priceImpactsByDay(withPrep);
    expect(day.prepChanges.map((p) => p.name)).toEqual(["タンの下ごしらえ"]);
  });
});

describe("isRealPriceChange", () => {
  const h = { ...data.priceHistory[0] };
  it("1本 → 1kg のように比べられない単位の付け替えは、値段の変更として出さない", () => {
    expect(isRealPriceChange({ ...h, oldPrice: 1340, oldQuantity: 1, oldUnit: "本", newPrice: 1340, newQuantity: 1, newUnit: "kg" })).toBe(false);
  });
  it("kg → g は比べられる（1,000円/kg → 1,200円/1000g は値上げ）", () => {
    expect(isRealPriceChange({ ...h, oldPrice: 1000, oldQuantity: 1, oldUnit: "kg", newPrice: 1200, newQuantity: 1000, newUnit: "g" })).toBe(true);
    expect(isRealPriceChange({ ...h, oldPrice: 1000, oldQuantity: 1, oldUnit: "kg", newPrice: 1000, newQuantity: 1000, newUnit: "g" })).toBe(false);
  });
});

describe("priceChangeDays・onlyDays（D-111）", () => {
  const h = (id: string, changedAt: string) => ({ ...data.priceHistory[0], id, changedAt });
  const twoDays: StoreData = {
    ...data,
    priceHistory: [h("b", "2026-10-04T03:00:00.000Z"), h("a", "2026-10-02T03:00:00.000Z")],
  };

  it("値段が変わった日を新しい順に返す", () => {
    expect(priceChangeDays(twoDays)).toEqual(["2026-10-04", "2026-10-02"]);
  });

  it("onlyDays を渡すと、その日だけを計算する", () => {
    const days = priceImpactsByDay(twoDays, Infinity, new Date("2026-10-04T12:00:00.000Z"), new Set(["2026-10-02"]));
    expect(days.map((d) => d.day)).toEqual(["2026-10-02"]);
  });
});

describe("salePriceChanges（D-111）", () => {
  const withSale: StoreData = {
    ...data,
    salePriceHistory: [
      { id: "s2", recipeId: "m1", changedAt: "2026-10-04T03:00:00.000Z", oldPrice: 1180, newPrice: 1280 },
      { id: "s1", recipeId: "deleted", changedAt: "2026-10-03T03:00:00.000Z", oldPrice: 100, newPrice: 200 },
    ],
  };

  it("今の原価で、売価を変える前と後の原価率を出す", () => {
    const [change] = salePriceChanges(withSale);
    // タン塩の今の原価は 400.3円（牛タン80g 400円＋塩2g 0.3円）
    expect(change.cost).toBe(400.3);
    // 売価の記録は税込（D-181）。1,180円 → 税抜1,073円、1,280円 → 税抜1,164円で原価率を出す
    expect(change.ratioBefore).toBeCloseTo((400.3 / 1073) * 100, 4);
    expect(change.ratioAfter).toBeCloseTo((400.3 / 1164) * 100, 4);
  });

  it("消えたメニューの記録は出さない", () => {
    expect(salePriceChanges(withSale).map((c) => c.name)).toEqual(["タン塩"]);
  });

  it("売価を空欄にしたときは、原価率を出さない", () => {
    const cleared: StoreData = {
      ...data,
      salePriceHistory: [{ id: "s", recipeId: "m1", changedAt: "2026-10-04T03:00:00.000Z", oldPrice: 1280, newPrice: null }],
    };
    expect(salePriceChanges(cleared)[0].ratioAfter).toBeNull();
  });
});

describe("groupByDay（D-111）", () => {
  it("並び順のまま、日本時間の日ごとに分ける", () => {
    const at = ["2026-10-04T03:00:00.000Z", "2026-10-03T16:00:00.000Z", "2026-10-03T03:00:00.000Z"];
    const groups = groupByDay(at, (x) => x, new Date("2026-10-04T12:00:00.000Z"));
    // UTC 10/3 16:00 は日本時間 10/4 1:00
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ["今日（10月4日）", 2],
      ["昨日（10月3日）", 1],
    ]);
  });
});

describe("salePriceChangeAfter（D-119・D-122）", () => {
  // 牛タンの値上げ（h1）は 2026-10-03T00:00Z（日本時間 10/3 9:00）
  const day = { day: "2026-10-03", impacts: priceImpacts(data) };
  const sale = (id: string, changedAt: string, oldPrice: number, newPrice: number) => ({ id, recipeId: "m1", changedAt, oldPrice, newPrice });

  it("売価を変えていなければ null", () => {
    expect(salePriceChangeAfter(data, "m1", day)).toBeNull();
  });

  it("値段が変わったあとに売価を変えていれば、最初の前と最後の後の売価", () => {
    const changed: StoreData = {
      ...data,
      salePriceHistory: [sale("s2", "2026-10-03T05:00:00.000Z", 1180, 1280), sale("s1", "2026-10-03T03:00:00.000Z", 1080, 1180)],
    };
    expect(salePriceChangeAfter(changed, "m1", day)).toEqual({ from: 1080, to: 1280 });
  });

  it("値段が変わる前の売価の変更は数えない", () => {
    const before: StoreData = { ...data, salePriceHistory: [sale("s", "2026-10-02T03:00:00.000Z", 1180, 1280)] };
    expect(salePriceChangeAfter(before, "m1", day)).toBeNull();
  });

  it("上げてから元に戻したときは、変えていないのと同じ", () => {
    const back: StoreData = {
      ...data,
      salePriceHistory: [sale("s2", "2026-10-03T06:00:00.000Z", 1380, 1280), sale("s1", "2026-10-03T05:00:00.000Z", 1280, 1380)],
    };
    expect(salePriceChangeAfter(back, "m1", day)).toBeNull();
  });
});

describe("あとの日の変更を混ぜない（D-120）", () => {
  const h = (id: string, changedAt: string, oldPrice: number, newPrice: number) => ({
    id,
    ingredientId: "gyutan",
    changedAt,
    oldPrice,
    oldQuantity: 1,
    oldUnit: "kg" as const,
    newPrice,
    newQuantity: 1,
    newUnit: "kg" as const,
  });
  // 10/3 に 4,500 → 5,000 → 4,500 と上げて戻し、10/7 に 4,500 → 9,000 に上げた。今は 9,000円/kg
  const later: StoreData = {
    ...data,
    ingredients: [{ ...data.ingredients[0], purchasePrice: 9000 }, data.ingredients[1]],
    priceHistory: [
      h("h3", "2026-10-07T03:00:00.000Z", 4500, 9000),
      h("h2", "2026-10-03T05:00:00.000Z", 5000, 4500),
      h("h1", "2026-10-03T03:00:00.000Z", 4500, 5000),
    ],
  };
  const now = new Date("2026-10-08T03:00:00.000Z");

  it("上げて戻した日は、原価が変わっていない（あとの日の値上げは入らない）", () => {
    const days = priceImpactsByDay(later, Infinity, now);
    const oct3 = days.find((d) => d.day === "2026-10-03")!;
    expect(oct3.changes).toEqual([]);
  });

  it("あとの日の値上げは、その日の欄にだけ出る", () => {
    const oct7 = priceImpactsByDay(later, Infinity, now).find((d) => d.day === "2026-10-07")!;
    // タン塩：牛タン80g 4,500円/kg（360円）→ 9,000円/kg（720円）。塩2gは0.3円のまま
    expect(oct7.changes.map((c) => [c.name, c.before, c.after])).toEqual([["タン塩", 360.3, 720.3]]);
  });

  it("材料ごとの影響も、その変更の前と後の値段で比べる", () => {
    const first = priceImpacts(later, Infinity).find((i) => i.history.id === "h1")!;
    // 4,500 → 5,000円/kg：360 → 400円（今の 9,000円/kg ではない）
    expect(first.changes.map((c) => [c.before, c.after])).toEqual([[360.3, 400.3]]);
  });
});

describe("使える割合（サク取り）の変更（D-126）", () => {
  // 牛タンの値段は 5,000円/kg のまま、使える割合を 100% → 80% にした
  const yieldOnly = {
    ...data.priceHistory[0],
    id: "y1",
    oldPrice: 5000,
    newPrice: 5000,
    oldYieldRate: 100,
    newYieldRate: 80,
  };
  const cut: StoreData = {
    ...data,
    ingredients: [{ ...data.ingredients[0], yieldRate: 80 }, data.ingredients[1]],
    priceHistory: [yieldOnly],
  };

  it("値段が同じでも、使える割合が減れば値上げとして出す（1g あたり 1.25倍）", () => {
    expect(isRealPriceChange(yieldOnly)).toBe(true);
    expect(priceImpacts(cut)[0].rate).toBeCloseTo(1.25, 4);
  });

  it("原価が変わったメニューも出す", () => {
    // タン塩：牛タン80g 5,000円/kg（400円）→ 使えるのが80%なので 500円。塩2gは0.3円のまま
    expect(priceImpacts(cut)[0].changes.map((c) => [c.name, c.before, c.after])).toEqual([["タン塩", 400.3, 500.3]]);
  });

  it("使える割合を変えていない古い履歴は、今の割合のまま比べる", () => {
    expect(yieldRateChange(data.priceHistory[0])).toBeNull();
  });
});

describe("単位の変更（D-172）", () => {
  // ブラックペッパーを 1,903円/1缶 → 1,903円/420g に直した。タン塩で 0.5 使っている
  const pepperFix = {
    id: "u1",
    ingredientId: "pepper",
    changedAt: "2026-11-03T03:00:00.000Z",
    oldPrice: 1903,
    oldQuantity: 1,
    oldUnit: "缶" as const,
    newPrice: 1903,
    newQuantity: 420,
    newUnit: "g" as const,
  };
  // 使っていない材料の 個 → 本 の言い換え（D-071 のときの付け替え）
  const relabel = {
    ...pepperFix,
    id: "u2",
    ingredientId: "lemon",
    oldPrice: 100,
    oldQuantity: 1,
    oldUnit: "個" as const,
    newPrice: 100,
    newQuantity: 1,
    newUnit: "本" as const,
  };
  const withPepper: StoreData = {
    ...data,
    ingredients: [...data.ingredients, ing("pepper", 1903, 420, "g"), ing("lemon", 100, 1, "本")],
    priceHistory: [pepperFix, relabel],
    recipes: [
      { ...data.recipes[0], items: [...data.recipes[0].items, { type: "ingredient", id: "pepper", quantity: 0.5 }] },
      { ...data.recipes[1], items: [...data.recipes[1].items, { type: "ingredient", id: "lemon", quantity: 1 }] },
    ],
  };

  it("分量の意味が変わる単位の変更を見分ける（kg → g は違う）", () => {
    expect(isUnitChange(pepperFix)).toBe(true);
    expect(isUnitChange(relabel)).toBe(true);
    expect(isUnitChange(data.priceHistory[0])).toBe(false);
  });

  it("単位の変更は出し、言い換えだけのものは出さない（D-175）", () => {
    expect(isShownPriceChange(pepperFix)).toBe(true);
    expect(isUnitRelabel(relabel)).toBe(true);
    expect(isShownPriceChange(relabel)).toBe(false);
    expect(priceChangeDays(withPepper)).toEqual(["2026-11-03"]);
  });

  it("使っていない材料の単位の変更も出す（塩ダレ 687円/1回 → 900円/1,540g など：D-175）", () => {
    const unused = { ...pepperFix, id: "u3", ingredientId: "nothing", oldPrice: 687, oldUnit: "回" as const, newPrice: 900, newQuantity: 1540 };
    expect(isUnitRelabel(unused)).toBe(false);
    expect(isShownPriceChange(unused)).toBe(true);
  });

  it("数える単位どうしでも、値段か量が変わっていれば言い換えではない", () => {
    expect(isUnitRelabel({ ...relabel, newPrice: 120 })).toBe(false);
    expect(isUnitRelabel({ ...relabel, newQuantity: 2 })).toBe(false);
  });

  it("率は出さず、原価が変わったメニューを出す", () => {
    const [impact] = priceImpacts(withPepper);
    expect(impact.history.id).toBe("u1");
    expect(impact.rate).toBeNull();
    // ブラックペッパー 0.5缶 = 951.5円 → 0.5g = 1903 × 0.5 ÷ 420 = 2.26… → 2.3円
    expect(impact.changes.map((c) => [c.name, c.before, c.after])).toEqual([["タン塩", 1351.8, 402.6]]);
  });
});
