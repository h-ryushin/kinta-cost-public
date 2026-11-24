-- =====================================================================
-- 秘密のものの原価を計算し直したら、原価が同じでも「いつ計算したか」を新しくする（D-173。D-154 の不具合を直す）
--   前の update_secret_costs は、原価が変わったものだけを書き直していた。
--   関係のない材料の値段が変わったあと、オーナーが鍵を開けて計算し直しても、原価が同じだと
--   secret_cost_calculated_at が古いままになり、どの端末でも「原価が古くなっています」と出続けていた。
--   原価の書き直しだけの変更は、これまでどおり操作ログに残らない（D-066）。
-- =====================================================================

create or replace function public.update_secret_costs(p_recipes jsonb, p_preps jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception '秘密の原価は管理者だけが書き直せます' using errcode = 'insufficient_privilege';
  end if;

  update public.recipes r
  set secret_cost = (x ->> 'cost')::numeric, secret_cost_calculated_at = now()
  from jsonb_array_elements(coalesce(p_recipes, '[]'::jsonb)) as x
  where r.id = (x ->> 'id')::uuid and r.is_secret;

  update public.preps p
  set secret_cost = (x ->> 'cost')::numeric, secret_cost_calculated_at = now()
  from jsonb_array_elements(coalesce(p_preps, '[]'::jsonb)) as x
  where p.id = (x ->> 'id')::uuid and p.is_secret;
end;
$$;
