-- =====================================================================
-- 材料の比重（1ml が何g か）をやめる（D-163。D-080 を置き換える）
--   ml で仕入れたものは ml のまま量る。g で量りたいものは、オーナーが実測して入れる。
--   比重が入っていた材料は、基本単位が g から ml に戻る。使っている材料も含めて戻すので、
--   レシピの使用量（数字）はそのままで、意味が g から ml に変わる。
-- =====================================================================

-- 基本単位の生成列と、単位の変更を止めるトリガーが比重を見ているので、先に外す
drop trigger ingredients_base_unit on public.ingredients;
alter table public.ingredients drop column base_unit;
alter table public.ingredients drop column density;
drop function private.base_unit_of_ingredient(text, numeric);

alter table public.ingredients
  add column base_unit text generated always as (private.base_unit_of(purchase_unit)) stored;

/** 使っている材料・仕込み品は、基本単位が変わる変更ができない（D-014） */
create or replace function private.assert_base_unit_unchanged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'ingredients' then
    if private.base_unit_of(new.purchase_unit) <> private.base_unit_of(old.purchase_unit)
       and (exists (select 1 from public.recipe_items i where i.ingredient_id = new.id)
            or exists (select 1 from public.prep_items p where p.ingredient_id = new.id)) then
      raise exception 'レシピや仕込み品で使っている材料は、基本単位（%）が変わる変更はできません',
        private.base_unit_of(old.purchase_unit);
    end if;
  elsif tg_table_name = 'preps' then
    if private.base_unit_of(new.yield_unit) <> private.base_unit_of(old.yield_unit)
       and exists (select 1 from public.recipe_items i where i.prep_id = new.id) then
      raise exception 'レシピで使っている仕込み品は、基本単位（%）が変わる単位にできません',
        private.base_unit_of(old.yield_unit);
    end if;
  end if;
  return new;
end;
$$;

create trigger ingredients_base_unit
  before update of purchase_unit on public.ingredients
  for each row execute function private.assert_base_unit_unchanged();
