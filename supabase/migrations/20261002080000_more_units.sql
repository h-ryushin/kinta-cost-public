-- =====================================================================
-- 数える単位を増やす（D-071）
--   棚卸し表の摘要に合わせて、本・袋・缶・パック・束・食・回 を使えるようにする。
--   base_unit_of() は kg→g、L→ml 以外はそのまま返すので、関数は変えなくてよい。
-- =====================================================================

alter table public.ingredients drop constraint ingredients_purchase_unit_check;
alter table public.ingredients add constraint ingredients_purchase_unit_check
  check (purchase_unit in ('g', 'kg', 'ml', 'L', '個', '本', '袋', '缶', 'パック', '束', '食', '回'));

alter table public.preps drop constraint preps_yield_unit_check;
alter table public.preps add constraint preps_yield_unit_check
  check (yield_unit in ('g', 'kg', 'ml', 'L', '個', '本', '袋', '缶', 'パック', '束', '食', '回'));
