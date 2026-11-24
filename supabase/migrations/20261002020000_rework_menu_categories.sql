-- =====================================================================
-- メニューの分類の見直し（D-044）
-- - 「辛味噌」をなくし、ホルモン・その他に入れる
-- - 「薬味」をなくし、おつまみ・薬味にまとめる
-- - 「サワー・ハイボール」を「サワー」と「ハイボール」に分ける（今あるものはサワーに移す。ハイボールは画面で分け直す）
-- =====================================================================

-- sort_order は一意なので、ドリンクの並び順をいったん後ろへずらしてから付け直す
update public.menu_categories set sort_order = sort_order + 1000
where id in ('beer', 'sour_highball', 'sake_shochu', 'wine', 'soft_drink', 'other_drink');

insert into public.menu_categories (id, name, sort_order) values
  ('sour', 'サワー', 111),
  ('highball', 'ハイボール', 112);

update public.menu_categories set sort_order = 110 where id = 'beer';
update public.menu_categories set sort_order = 113 where id = 'sake_shochu';
update public.menu_categories set sort_order = 114 where id = 'wine';
update public.menu_categories set sort_order = 115 where id = 'soft_drink';
update public.menu_categories set sort_order = 116 where id = 'other_drink';

update public.recipes set category_id = 'horumon' where category_id = 'karamiso';
update public.recipes set category_id = 'otsumami' where category_id = 'yakumi';
update public.recipes set category_id = 'sour' where category_id = 'sour_highball';

delete from public.menu_categories where id in ('karamiso', 'yakumi', 'sour_highball');
