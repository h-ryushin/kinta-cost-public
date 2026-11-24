-- =====================================================================
-- 原価率の目安を設定に持たせる（D-102・D-110）
--   まとまり（ドリンク／肉／サイド）ごとに2本の線を持つ。
--   good 以下が「良好」、high を超えると「高い」、そのあいだは「普通」。
--   初期値はオーナーの回答（2026-10-04）の数字。オーナーが「設定」の画面で変えられる。
-- =====================================================================

alter table public.settings
  add column drink_ratio_good numeric(4, 1) not null default 20,
  add column drink_ratio_high numeric(4, 1) not null default 25,
  add column meat_ratio_good numeric(4, 1) not null default 28,
  add column meat_ratio_high numeric(4, 1) not null default 32,
  add column side_ratio_good numeric(4, 1) not null default 28,
  add column side_ratio_high numeric(4, 1) not null default 32;

-- 0〜100% の範囲で、「良好」の線は「高い」の線より小さい
alter table public.settings
  add constraint settings_drink_ratio_check
    check (drink_ratio_good >= 0 and drink_ratio_high <= 100 and drink_ratio_good < drink_ratio_high),
  add constraint settings_meat_ratio_check
    check (meat_ratio_good >= 0 and meat_ratio_high <= 100 and meat_ratio_good < meat_ratio_high),
  add constraint settings_side_ratio_check
    check (side_ratio_good >= 0 and side_ratio_high <= 100 and side_ratio_good < side_ratio_high);

comment on table public.settings is 'お店の設定（1行だけ）。消費税率（D-101）と原価率の目安（D-110）';
