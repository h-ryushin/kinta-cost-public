-- =====================================================================
-- 「ビール・ノンアル」と「チューハイ・サワー」を「ビール・チューハイ」1つにまとめる（D-183）
--   分類の id は beer を残して名前を変え、sour のメニューを beer に移してから sour を消す。
--   分類を付け替えるだけで、だれかがメニューを直したわけではないので、
--   recipes のトリガー（更新者・更新日時・操作ログ・売価の履歴）は止めておく（D-181 と同じ）。
-- =====================================================================

update public.menu_categories set name = 'ビール・チューハイ' where id = 'beer';

alter table public.recipes disable trigger user;
update public.recipes set category_id = 'beer' where category_id = 'sour';
alter table public.recipes enable trigger user;

delete from public.menu_categories where id = 'sour';
