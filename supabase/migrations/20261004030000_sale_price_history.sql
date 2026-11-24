-- =====================================================================
-- メニューの売価の履歴（D-111）
--   材料の価格の履歴（ingredient_price_history）と同じく、トリガーだけが書く（D-033）。
--   「値段の変化」の画面で、売価をいつ・いくらからいくらに変えたかを見るため。
--   新しく作ったとき（insert）は「変更」ではないので残さない。
-- =====================================================================

create table public.recipe_price_history (
  id bigint generated always as identity primary key,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles (id) on delete set null,
  -- 売価は空欄（原価率を出さない）にできるので null を許す
  old_price integer,
  new_price integer
);

comment on table public.recipe_price_history is 'メニュー・創作レシピの売価（税抜）の履歴。トリガーだけが書く（D-111）';

create index recipe_price_history_recipe_idx
  on public.recipe_price_history (recipe_id, changed_at desc);

-- security definer：履歴テーブルは画面から書けない（insert の RLS ポリシーがない）ため
create or replace function private.record_sale_price_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sale_price is distinct from old.sale_price then
    insert into public.recipe_price_history (recipe_id, changed_by, old_price, new_price)
    values (new.id, auth.uid(), old.sale_price, new.sale_price);
  end if;
  return new;
end;
$$;

create trigger recipes_price_history
  after update of sale_price on public.recipes
  for each row execute function private.record_sale_price_history();

alter table public.recipe_price_history enable row level security;

-- 読めるのは、そのレシピを読める人だけ（秘密の創作レシピは社員から見えない）。recipes の RLS がそのまま効く
create policy "members read sale price history" on public.recipe_price_history
  for select to authenticated
  using ((select private.is_member()) and exists (select 1 from public.recipes r where r.id = recipe_id));

-- バックアップ用のユーザーも読めるようにする（D-067）
grant select on public.recipe_price_history to kinta_backup;
create policy "backup reads all" on public.recipe_price_history for select to kinta_backup using (true);
