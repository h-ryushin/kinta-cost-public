/** Supabase は1回に1,000行までしか返さず、超えた分はエラーにならずに切れる */
export const PAGE_ROWS = 1000;

type Page<T> = { data: T[] | null; error: unknown };

/**
 * 1,000行ずつ続けて読み、全部をつなげて返す。返ってきた行が1,000行より少なければ終わり。
 * 呼ぶ側は、ページの境目でずれないよう、重ならない列（主キー）で並べて頼む。
 */
export async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await fetchPage(from, from + PAGE_ROWS - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_ROWS) return all;
  }
}
