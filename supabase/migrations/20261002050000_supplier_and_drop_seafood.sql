-- =====================================================================
-- 材料に仕入れ先（任意）を足し、材料の種類「魚介」をなくす（D-053）
-- =====================================================================

alter table public.ingredients
  add column supplier text not null default '' check (char_length(supplier) <= 50);

update public.ingredients set category_id = 'other' where category_id = 'seafood';
delete from public.ingredient_categories where id = 'seafood';
