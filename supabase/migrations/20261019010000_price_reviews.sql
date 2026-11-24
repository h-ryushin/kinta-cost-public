-- =====================================================================
-- 原価が変わったメニューを「このままにする」と決めた印（D-119）
--   材料の値段が変わった日ごとに、原価が変わったメニューを「値段の変化」に出している（D-107）。
--   そのメニューの売価を変えたかどうかは売価の履歴（D-111）から分かるが、
--   「売価は変えなくてよい」と決めたことは残す場所がなかった。その印をここに持つ。
--   1つのメニューにつき、材料の値段が変わった日（日本時間）ごとに1行。取り消すときは行を消す。
-- =====================================================================

create table public.price_reviews (
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  -- 材料の値段が変わった日（日本時間）。「値段の変化」の日ごとのまとめと同じ区切り
  change_day date not null,
  decided_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete set null default auth.uid(),
  primary key (recipe_id, change_day)
);

comment on table public.price_reviews is '原価が変わったメニューを「売価はこのまま」と決めた印。日ごとに1行（D-119）';

alter table public.price_reviews enable row level security;

-- 読む・付ける・取り消すのは、そのレシピを読める人（秘密の創作レシピは社員から見えない）。recipes の RLS がそのまま効く
create policy "members read price reviews" on public.price_reviews
  for select to authenticated
  using ((select private.is_member()) and exists (select 1 from public.recipes r where r.id = recipe_id));
create policy "members mark price reviews" on public.price_reviews
  for insert to authenticated
  with check (
    (select private.is_member())
    and decided_by = (select auth.uid())
    and exists (select 1 from public.recipes r where r.id = recipe_id)
  );
create policy "members unmark price reviews" on public.price_reviews
  for delete to authenticated
  using ((select private.is_member()) and exists (select 1 from public.recipes r where r.id = recipe_id));

-- バックアップ用のユーザーも読めるようにする（D-067）
grant select on public.price_reviews to kinta_backup;
create policy "backup reads all" on public.price_reviews for select to kinta_backup using (true);
