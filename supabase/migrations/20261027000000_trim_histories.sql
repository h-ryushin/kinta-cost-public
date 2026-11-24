-- 価格・売価の履歴と操作ログは、新しいほうから1,000件だけ残す（D-159）。
-- 無料の枠（容量）に収めるため。操作ログの画面は前から「最大1,000件」と書いていたが、実際には消していなかった。
-- 書き足すたびに、1,000件より古い行を消す。行ごとではなく、1回の書き込みにつき1回だけ動く。

create or replace function private.trim_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  keep integer := tg_argv[0]::integer;
begin
  execute format(
    'delete from public.%I where id <= (select id from public.%I order by id desc offset %s limit 1)',
    tg_table_name, tg_table_name, keep
  );
  return null;
end;
$$;

revoke all on function private.trim_history() from public;

create trigger trim_ingredient_price_history
  after insert on public.ingredient_price_history
  for each statement execute function private.trim_history(1000);

create trigger trim_recipe_price_history
  after insert on public.recipe_price_history
  for each statement execute function private.trim_history(1000);

create trigger trim_audit_logs
  after insert on public.audit_logs
  for each statement execute function private.trim_history(1000);
