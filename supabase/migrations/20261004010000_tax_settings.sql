-- =====================================================================
-- 金額は税抜で持ち、消費税率は1か所で設定する（D-101）
--   仕入れ価格も売価も税抜。原価率は税抜どうしで出す（会計の見方に合わせる）。
--   画面では「税抜 1,255円（税込 1,380円）」のように併記する。
--   税率は2つ：仕入れ（軽減税率8%）と売価（店内飲食10%）。
-- =====================================================================

create table public.settings (
  -- 1行しか作らせない
  id boolean primary key default true check (id),
  purchase_tax_rate numeric(4, 1) not null default 8 check (purchase_tax_rate >= 0 and purchase_tax_rate <= 100),
  sale_tax_rate numeric(4, 1) not null default 10 check (sale_tax_rate >= 0 and sale_tax_rate <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.settings is 'お店の設定（1行だけ）。消費税率など（D-101）';

insert into public.settings (id) values (true);

create trigger settings_touch
  before update on public.settings
  for each row execute function private.touch_updated_at();

alter table public.settings enable row level security;

create policy "members read settings" on public.settings
  for select to authenticated using ((select private.is_member()));
create policy "admin updates settings" on public.settings
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- バックアップ用のユーザーも読めるようにする（D-067）
grant select on public.settings to kinta_backup;
create policy "backup reads all" on public.settings for select to kinta_backup using (true);

-- ---------------------------------------------------------------------
-- 今入っている売価は、メニュー表の「税込」を入れたもの。税抜に直す（D-101）
-- （データがまだ入っていないプロジェクトでは、何も起きない）
-- ---------------------------------------------------------------------
update public.recipes
set sale_price = round(sale_price / 1.1)
where sale_price is not null;
