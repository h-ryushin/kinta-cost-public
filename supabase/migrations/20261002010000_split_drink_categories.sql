-- =====================================================================
-- メニューの分類「ドリンク」を、種類ごとに分ける（D-042）
-- 「ドリンク」になっていたメニューは「その他のドリンク」に移す（画面で分け直す）
-- =====================================================================

-- sort_order は一意なので、先に「ドリンク」を後ろへ動かしてから新しい分類を入れる
update public.menu_categories set sort_order = 999 where id = 'drink';

insert into public.menu_categories (id, name, sort_order) values
  ('beer', 'ビール', 110),
  ('sour_highball', 'サワー・ハイボール', 111),
  ('sake_shochu', '日本酒・焼酎', 112),
  ('wine', 'ワイン・果実酒', 113),
  ('soft_drink', 'ソフトドリンク', 114),
  ('other_drink', 'その他のドリンク', 115);

update public.recipes set category_id = 'other_drink' where category_id = 'drink';

delete from public.menu_categories where id = 'drink';
