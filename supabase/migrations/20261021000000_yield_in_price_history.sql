-- =====================================================================
-- 使える割合（サク取り・掃除の歩留まり）を変えたときも、価格の履歴に残す（D-126）
--   使える割合（D-100）を 100% → 80% にすると、同じ仕入れ価格でも原価は上がる。
--   これまで履歴は「仕入れ価格・量・単位」が変わったときだけ残していたので、
--   「値段の変化」に出なかった。履歴に使える割合の前と後も持つ。
--   これより前の履歴は使える割合が分からないので null（その間は変わっていなかったとみなす）。
-- =====================================================================

alter table public.ingredient_price_history
  add column old_yield_rate numeric(5, 2),
  add column new_yield_rate numeric(5, 2);

comment on column public.ingredient_price_history.old_yield_rate is '変更前の使える割合（%）。D-126 より前の履歴は null';
comment on column public.ingredient_price_history.new_yield_rate is '変更後の使える割合（%）。D-126 より前の履歴は null';

-- security definer：履歴テーブルは画面から書けない（insert の RLS ポリシーがない）ため
create or replace function private.record_price_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.purchase_price, new.purchase_quantity, new.purchase_unit, new.yield_rate)
     is distinct from (old.purchase_price, old.purchase_quantity, old.purchase_unit, old.yield_rate) then
    insert into public.ingredient_price_history (
      ingredient_id, changed_by,
      old_price, old_quantity, old_unit, old_yield_rate,
      new_price, new_quantity, new_unit, new_yield_rate
    ) values (
      new.id, auth.uid(),
      old.purchase_price, old.purchase_quantity, old.purchase_unit, old.yield_rate,
      new.purchase_price, new.purchase_quantity, new.purchase_unit, new.yield_rate
    );
  end if;
  return new;
end;
$$;
