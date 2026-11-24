-- =====================================================================
-- 管理者の本人確認を「パスキー」でも認める（D-086）
--   認証アプリ（6桁）は使わない方針にしたため、パスキー（WebAuthn）でログインした
--   管理者も通す。パスキーは「端末を持っていること」と「顔・指紋」がそろって初めて
--   使え、偽サイトでは使えないので、6桁より強い本人確認になる。
--   社員はこれまでどおり任意（D-082）。守りの強さは下げていない。
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
    and (
      -- 社員は本人確認の方法を問わない
      p.role <> 'admin'
      -- 管理者は、二段階認証（aal2）が済んでいる
      or coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
      -- または、パスキー（WebAuthn）でログインしている
      or exists (
        select 1
        from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) as m
        where coalesce(m ->> 'method', m #>> '{}') in ('webauthn', 'passkey')
      )
    )
$$;
