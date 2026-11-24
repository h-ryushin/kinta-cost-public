-- =====================================================================
-- 社員もメニューを作れる・消せる・創作レシピをメニューに登録できるようにする（D-077）
--   オーナーの方針：「知られたくないレシピが秘密にできていればよい。メニューの操作は社員にも任せる」。
--   秘密のもの（is_secret）は、これまでどおり管理者だけが書き換えられる。
-- =====================================================================

drop policy "write recipes" on public.recipes;
create policy "write recipes" on public.recipes
  for insert to authenticated
  with check ((select private.is_admin()) or ((select private.is_member()) and not is_secret));

drop policy "update recipes" on public.recipes;
create policy "update recipes" on public.recipes
  for update to authenticated
  using ((select private.is_admin()) or ((select private.is_member()) and not is_secret))
  with check ((select private.is_admin()) or ((select private.is_member()) and not is_secret));

drop policy "delete recipes" on public.recipes;
create policy "delete recipes" on public.recipes
  for delete to authenticated
  using ((select private.is_admin()) or ((select private.is_member()) and not is_secret));

-- 材料行も、秘密でないレシピなら社員が書ける（メニューか創作レシピかは問わない）
drop policy "write recipe items" on public.recipe_items;
create policy "write recipe items" on public.recipe_items
  for all to authenticated
  using (
    (select private.is_member())
    and exists (select 1 from public.recipes r where r.id = recipe_id and not r.is_secret)
  )
  with check (
    (select private.is_member())
    and exists (select 1 from public.recipes r where r.id = recipe_id and not r.is_secret)
  );
