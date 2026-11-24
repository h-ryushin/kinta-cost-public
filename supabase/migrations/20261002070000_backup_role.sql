-- =====================================================================
-- バックアップ専用の読み取り専用ユーザー（D-067）
--   毎晩のバックアップ（GitHub Actions）から接続するためのユーザー。
--   読むことしかできないので、接続情報が漏れても書き換え・削除はされない。
--
--   パスワードはここで決めない（Git に残さないため）。オーナーが Supabase の
--   SQL Editor で、次を1回だけ実行してパスワードを決める：
--     alter role kinta_backup with password '（決めたパスワード）';
--   パスワードを決めるまで、このユーザーでは接続できない。
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'kinta_backup') then
    create role kinta_backup login;
  end if;
end;
$$;

comment on role kinta_backup is 'バックアップ専用（読み取りのみ）。パスワードは Supabase の SQL Editor で設定する';

-- 読むためのスキーマと表の権限（書き込みの権限は与えない）
grant usage on schema public to kinta_backup;
grant select on all tables in schema public to kinta_backup;
grant select on all sequences in schema public to kinta_backup;
-- これから増えるテーブルにも、読み取りだけ自動で付ける
alter default privileges in schema public grant select on tables to kinta_backup;
alter default privileges in schema public grant select on sequences to kinta_backup;

/**
 * 全テーブルで RLS を使っているため、権限（grant）だけでは1行も読めない。
 * バックアップのユーザーだけが全行を読めるポリシーを、テーブルごとに足す。
 * BYPASSRLS は使わない（付けられる権限が環境によって違い、効き目も強すぎるため）。
 */
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'ingredient_categories', 'menu_categories', 'ingredients', 'ingredient_price_history',
    'preps', 'prep_items', 'secret_prep_contents', 'recipes', 'recipe_items', 'secret_recipe_contents',
    'recipe_keys', 'admin_devices', 'audit_logs'
  ]
  loop
    execute format(
      'create policy "backup reads all" on public.%I for select to kinta_backup using (true)', t
    );
  end loop;
end;
$$;
