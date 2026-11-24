-- =====================================================================
-- メニューの分類を、お店のハンディ（注文端末）のボタンに合わせる（D-045）
-- 焼肉は部位（牛・ホルモン）ではなく、味付け（塩・タレ）と量（特盛）で分ける
-- =====================================================================

-- sort_order は一意なので、いったん全部を後ろへずらしてから付け直す
update public.menu_categories set sort_order = sort_order + 1000;

-- 名前だけ変えるもの
update public.menu_categories set name = 'おつまみ・刺身・薬味' where id = 'otsumami';
update public.menu_categories set name = 'ご飯物' where id = 'rice';
update public.menu_categories set name = 'スープ・クッパ' where id = 'soup';
update public.menu_categories set name = 'ビール・ノンアル' where id = 'beer';
update public.menu_categories set name = '焼酎・日本酒' where id = 'sake_shochu';
update public.menu_categories set name = 'チューハイ・サワー' where id = 'sour';
update public.menu_categories set name = '梅酒・ワイン・マッコリ' where id = 'wine';

-- 新しく足すもの
insert into public.menu_categories (id, name, sort_order) values
  ('yakiniku_shio', '焼肉（塩）', 1),
  ('yakiniku_tare', '焼肉（タレ）', 2),
  ('tokumori_shio', '特盛（塩）', 3),
  ('tokumori_tare', '特盛（タレ）', 4),
  ('bottle', 'ボトル', 5),
  ('kids_drink', 'キッズドリンク', 6),
  ('course', 'コース', 7),
  ('takeout', 'テイクアウト', 8),
  ('nomihodai', '飲み放題', 9);

-- 牛・ホルモンのメニューを、名前から塩・タレ・特盛に分ける（画面の推測と同じ考え方：
-- 「タレ」「味噌」ならタレ、「塩」なら塩、どちらもなければネギ系とタンは塩、それ以外はタレ）
update public.recipes
set category_id = case
  when name like '%特盛%' then
    case when name ~ '(タレ|たれ|味噌)' then 'tokumori_tare'
         when name like '%塩%' or name ~ '(タン|ネギ|ねぎ)' then 'tokumori_shio'
         else 'tokumori_tare' end
  else
    case when name ~ '(タレ|たれ|味噌)' then 'yakiniku_tare'
         when name like '%塩%' or name ~ '(タン|ネギ|ねぎ)' then 'yakiniku_shio'
         else 'yakiniku_tare' end
end
where category_id in ('horumon', 'beef');

update public.recipes set category_id = 'otsumami' where category_id = 'sashimi';
update public.recipes set category_id = 'other' where category_id = 'other_drink';

delete from public.menu_categories where id in ('horumon', 'beef', 'sashimi', 'other_drink');

-- 並び順をハンディに合わせて付け直す
update public.menu_categories as c set sort_order = v.sort_order
from (values
  ('yakiniku_shio', 10), ('yakiniku_tare', 20), ('tokumori_shio', 30), ('tokumori_tare', 40),
  ('otsumami', 50), ('salad', 60), ('rice', 70), ('soup', 80), ('dessert', 90),
  ('beer', 110), ('soft_drink', 111), ('highball', 112), ('sake_shochu', 113), ('sour', 114),
  ('wine', 115), ('bottle', 116), ('kids_drink', 117),
  ('course', 800), ('takeout', 810), ('nomihodai', 820), ('other', 900)
) as v(id, sort_order)
where c.id = v.id;
