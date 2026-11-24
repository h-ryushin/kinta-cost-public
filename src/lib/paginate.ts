/**
 * 長い一覧を、何件かずつのページに分ける（D-111）。
 * ページ番号は1から。範囲の外（消えて件数が減ったときや、URL を書き換えたとき）は、端のページに寄せる。
 */
export function paginate<T>(items: readonly T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1), pageCount);
  const start = (current - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: current, pageCount };
}
