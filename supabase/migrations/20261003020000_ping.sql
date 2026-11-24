-- =====================================================================
-- 停止を防ぐための ping（D-083）
--   Supabase の無料枠は1週間アクセスがないとプロジェクトが止まる（D-007）。
--   Cloudflare Workers の定時実行（Cron）から1日1回これを呼んで、止まらないようにする。
--   データは何も返さない。ログインしていない人（anon）でも呼べる。
-- =====================================================================

create or replace function public.ping()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'ok'::text
$$;

revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
