/**
 * Cloudflare Workers のエントリ（D-083）。
 * ふだんは out/ に書き出した静的ファイルをそのまま配信するだけ。
 * 1日1回の定時実行（Cron）で Supabase を叩き、1週間の無アクセスで止まるのを防ぐ（D-007）。
 */
const worker = {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env) {
    // 失敗しても画面には影響しないが、続くと Supabase が止まる。気づけるよう、成否を必ずログに残す（D-155）。
    // ログは1行の JSON にする（Workers Logs で項目ごとに絞り込める）
    try {
      const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ping`, {
        method: "POST",
        headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await response.text()).slice(0, 200);
      const log = { event: "supabase_ping", ok: response.ok, status: response.status, body };
      if (response.ok) console.log(JSON.stringify(log));
      else console.error(JSON.stringify(log));
    } catch (error) {
      console.error(JSON.stringify({ event: "supabase_ping", ok: false, error: String(error) }));
    }
  },
};

export default worker;
