-- =====================================================================
-- 社員を削除する（D-118）
--   オーナーだけが呼べる。オーナー自身・オーナーのアカウントは消せない。
--   ログインのアカウント（auth.users）ごと消すと、profiles も一緒に消える（on delete cascade）。
--   材料・メニューの「作った人・直した人」や価格の履歴は空（null）になるだけで、データは残る。
--   操作ログには名前（actor_name）を残しているので、誰の操作だったかは消えない。
--   呼んだ人の権限（auth.uid()）のまま動くので、操作ログの「利用者を削除」にはオーナーの名前が残る。
-- =====================================================================

-- security definer：画面からは auth.users を消せないため、この関数の中でだけ消す
create or replace function public.delete_staff(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not private.is_admin() then
    raise exception '利用者を削除できるのはオーナーだけです' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception '自分のアカウントは削除できません';
  end if;
  select role into v_role from public.profiles where id = p_user_id;
  if v_role is null then
    raise exception 'その利用者は見つかりません';
  end if;
  if v_role <> 'staff' then
    raise exception 'オーナーのアカウントは削除できません';
  end if;

  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.delete_staff(uuid) from public, anon;
grant execute on function public.delete_staff(uuid) to authenticated;
