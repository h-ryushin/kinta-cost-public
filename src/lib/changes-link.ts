/**
 * 「値段の変化」（/changes）のタブとページを URL で持つ（D-108・D-111）。
 * ダッシュボードから開いたときは from=home を付けたままにし、「← ダッシュボード」で帰れるようにする（D-124）。
 */
export const CHANGES_TABS = ["ingredient", "menu"] as const;
export type ChangesTab = (typeof CHANGES_TABS)[number];

export function changesHref(tab: ChangesTab, page = 1, fromHome = false): string {
  const query = new URLSearchParams();
  if (tab !== "ingredient") query.set("tab", tab);
  if (page > 1) query.set("page", String(page));
  if (fromHome) query.set("from", "home");
  const q = query.toString();
  return q ? `/changes?${q}` : "/changes";
}

/** 「値段の変化」から詳細を開くときの URL。戻ったときに同じタブ・ページに帰れるよう、戻り先を付ける */
export function fromChangesQuery(tab: ChangesTab, page: number, fromHome = false): string {
  return `from=changes&back=${encodeURIComponent(changesHref(tab, page, fromHome))}`;
}

/** 詳細の画面の「← 値段の変化」の戻り先。よそへ飛ばされないよう /changes の中だけを許す */
export function changesBackHref(params: { get(name: string): string | null }): string {
  const back = params.get("back");
  return back && /^\/changes(\?[\w=&]*)?$/.test(back) ? back : "/changes";
}

/**
 * 詳細 → 編集 → 保存・やめる、と進んでも、開いてきた画面（値段の変化・ダッシュボード）に帰れるよう、
 * 戻り先の印を次の URL に引き継ぐ（D-130）。付いていなければ空文字。
 */
export function returnQuery(params: { get(name: string): string | null }): string {
  const from = params.get("from");
  if (from === "home") return "&from=home";
  if (from === "changes") return `&from=changes&back=${encodeURIComponent(changesBackHref(params))}`;
  return "";
}
