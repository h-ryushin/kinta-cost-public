-- =====================================================================
-- メニューの売価を税込で持つ（D-181）
--   お店の値段は税込（メニュー表の値段）が基準なので、recipes.sale_price の中身を税抜から税込に変える。
--   列の名前・保存の関数（save_recipe など）・売価の履歴のトリガーはそのまま使う（入れる値が税込になるだけ）。
--   税抜は、アプリが「税込 ÷（1＋税率）」を1円単位で切り上げて出す（D-179）。
--
--   今の税抜を税込に直す（private.sale_price_with_tax）：
--     まず 税抜 ×（1＋税率）の1円未満を切り捨てる（アプリの withTax と同じ。D-161）。
--     その1円下の値段も、税込 ÷（1＋税率）を切り上げると同じ税抜に戻り、かつ10円単位なら、そちらにする。
--     今の税抜は、メニュー表の税込（10円単位）を切り上げて入れたもの（D-179）なので、元の値段に戻せる。
--     例：税抜710円 → 781円より、780円（780 ÷ 1.1 = 709.09… → 710円）。えだまめ 450円・牛ホルモン 890円なども同じ。
--   税率を0.1%単位の整数にして整数で計算する（D-009）。
--   売価の履歴（recipe_price_history）の前と後も同じく直す。
--
--   直すあいだは、recipes のトリガー（更新者・更新日時・操作ログ・売価の履歴）を止める。
--   中身の言い換えで、だれかが売価を変えたわけではないため。
-- =====================================================================

-- 税抜（p_without_tax）を税込に直す。p_rate は 1000 + 税率×10（10% なら 1100）
create function private.sale_price_with_tax(p_without_tax integer, p_rate integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_without_tax is null then null
    -- 1円下が10円単位で、切り上げると同じ税抜に戻るなら、そちら（メニュー表の値段）
    when (p_without_tax::bigint * p_rate / 1000 - 1) % 10 = 0
      and ((p_without_tax::bigint * p_rate / 1000 - 1) * 1000 + p_rate - 1) / p_rate = p_without_tax
      then (p_without_tax::bigint * p_rate / 1000 - 1)::integer
    else (p_without_tax::bigint * p_rate / 1000)::integer
  end
$$;

do $$
declare
  -- 1000 + 税率×10（10% なら 1100）
  v_rate integer;
begin
  select coalesce(round(1000 + sale_tax_rate * 10)::integer, 1100) into v_rate from public.settings limit 1;
  if v_rate is null then
    v_rate := 1100;
  end if;

  alter table public.recipes disable trigger user;
  update public.recipes
  set sale_price = private.sale_price_with_tax(sale_price, v_rate)
  where sale_price is not null;
  alter table public.recipes enable trigger user;

  alter table public.recipe_price_history disable trigger user;
  update public.recipe_price_history
  set old_price = private.sale_price_with_tax(old_price, v_rate),
      new_price = private.sale_price_with_tax(new_price, v_rate);
  alter table public.recipe_price_history enable trigger user;
end;
$$;

comment on column public.recipes.sale_price is
  '売価（税込・円）。メニュー表の値段。税抜はアプリが 税込 ÷（1＋税率）を1円単位で切り上げて出す（D-179・D-181）';
comment on table public.recipe_price_history is
  'メニュー・創作レシピの売価（税込）の履歴。トリガーだけが書く（D-111・D-181）';

-- 移し替えのためだけの関数なので、使い終わったら消す
drop function private.sale_price_with_tax(integer, integer);
