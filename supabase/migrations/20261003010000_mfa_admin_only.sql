-- =====================================================================
-- 二段階認証は管理者（オーナー）だけ必須にする（D-082）
--   オーナーのアカウントは全部を消せて、秘密も見られるので二段階認証を必須にする。
--   社員は材料と価格の編集が中心で、秘密は見られないため任意にする（登録すれば使える）。
--   要件定義書 4.1 は「両方必須」だが、オーナーの判断で変える。
-- =====================================================================

create or replace function private.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
    -- 管理者だけ、二段階認証（aal2）が済んでいることを求める
    and (p.role <> 'admin' or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2')
$$;
