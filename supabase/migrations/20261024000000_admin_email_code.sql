-- =====================================================================
-- オーナーは、メールに届いた6桁の数字でも本人確認できる（D-135）
--   iPhone では顔・指紋（パスキー）で入る（D-086）。Windows の PC など顔・指紋が使えないときは、
--   パスワードのあと、オーナーのメールに届いた6桁を入れて入る（Supabase のメールのワンタイムコード）。
--   そのログインは amr が 'otp' になるので、それも管理者の本人確認として通す。
--
--   守りの考え方：パスワードだけでは入れない（メールの6桁が要る）。メールを見られる人は、
--   もともと「パスワードを決めるメール」（D-116）でパスワードを決め直せるので、メールの6桁を
--   認めても、今より弱くはならない。オーナーのメールの守りがいちばん大事になる。
--   招待（invite）・パスワードの決め直し（recovery）のリンクで入っただけでは、これまでどおり通さない。
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
      -- または、パスキー（WebAuthn）か、メールの6桁（otp）でログインしている
      or exists (
        select 1
        from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) as m
        where coalesce(m ->> 'method', m #>> '{}') in ('webauthn', 'passkey', 'otp')
      )
    )
$$;
