"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Empty, Loading, PageHeader, Pager } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { paginate } from "@/lib/paginate";
import { useStore } from "@/lib/store";

/** 1ページに出す件数。上からずっと並ばないよう、ページ送りにする（D-112） */
const LOGS_PER_PAGE = 30;

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <LogsPage />
    </Suspense>
  );
}

function LogsPage() {
  const store = useStore();
  // ページは URL（?page=2）で持つ
  const requestedPage = Number(useSearchParams().get("page") ?? "1");
  // ページを送ったら、先頭から読めるようにする
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [requestedPage]);
  // 操作ログは社員も見られる（D-162）
  if (!store.loaded) return <Loading />;
  const { logs } = store.data;
  const { items, page, pageCount } = paginate(logs, requestedPage, LOGS_PER_PAGE);
  const first = (page - 1) * LOGS_PER_PAGE + 1;

  return (
    <>
      <PageHeader title="操作ログ" description="材料・価格・レシピの変更の記録。新しい順に最大1,000件まで残します" />
      {logs.length === 0 ? (
        <Empty>まだ記録がありません。</Empty>
      ) : (
        <>
          <p className="num mb-2 text-sm text-muted">
            全{logs.length.toLocaleString("ja-JP")}件のうち {first}〜{first + items.length - 1}件目
          </p>
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            <table className="w-full text-left">
              <thead className="hidden border-b border-border bg-surface-muted text-sm text-muted sm:table-header-group">
                <tr>
                  <th className="w-44 px-5 py-3 font-bold">日時</th>
                  <th className="w-48 px-3 py-3 font-bold">操作</th>
                  <th className="px-3 py-3 font-bold">内容</th>
                  <th className="w-32 px-5 py-3 font-bold">操作した人</th>
                </tr>
              </thead>
              <tbody>
                {items.map((log) => (
                  <tr key={log.id} className="flex flex-col gap-0.5 border-t border-border px-4 py-3 first:border-0 sm:table-row sm:p-0">
                    <td className="num order-2 text-xs text-muted sm:px-5 sm:py-3 sm:text-sm">{dateTime(log.at)}</td>
                    <td className="order-1 font-bold sm:px-3 sm:py-3">{log.action}</td>
                    <td className="num order-3 wrap-break-word text-sm sm:px-3 sm:py-3 sm:text-base">{log.detail || "—"}</td>
                    <td className="hidden text-sm text-muted sm:table-cell sm:px-5 sm:py-3">{log.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageCount={pageCount} href={(p) => (p > 1 ? `/logs?page=${p}` : "/logs")} />
        </>
      )}
    </>
  );
}
