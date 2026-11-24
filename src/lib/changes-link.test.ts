import { describe, expect, it } from "vitest";
import { changesBackHref, changesHref, fromChangesQuery, returnQuery } from "./changes-link";

const params = (query: string) => new URLSearchParams(query);

describe("値段の変化の URL（D-111）", () => {
  it("既定のタブ・1ページ目は付けない", () => {
    expect(changesHref("ingredient")).toBe("/changes");
    expect(changesHref("menu", 2)).toBe("/changes?tab=menu&page=2");
  });

  it("詳細から、開いたときのタブとページに戻れる", () => {
    expect(changesBackHref(params(fromChangesQuery("menu", 3)))).toBe("/changes?tab=menu&page=3");
  });

  it("よその URL には戻さない", () => {
    expect(changesBackHref(params("back=https://example.com"))).toBe("/changes");
    expect(changesBackHref(params("back=//example.com"))).toBe("/changes");
    expect(changesBackHref(params(""))).toBe("/changes");
  });

  it("ダッシュボードから開いたときは、タブやページを変えても、詳細から戻っても from=home が残る（D-124）", () => {
    expect(changesHref("menu", 2, true)).toBe("/changes?tab=menu&page=2&from=home");
    expect(changesBackHref(params(fromChangesQuery("ingredient", 1, true)))).toBe("/changes?from=home");
  });

  it("詳細から編集へ、編集から詳細へ、戻り先を引き継ぐ（D-130）", () => {
    expect(returnQuery(params("id=1&from=home"))).toBe("&from=home");
    expect(returnQuery(params(`id=1&${fromChangesQuery("menu", 2)}`))).toBe(`&${fromChangesQuery("menu", 2)}`);
    expect(returnQuery(params("id=1"))).toBe("");
  });
});
