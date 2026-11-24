-- =====================================================================
-- 「キッズドリンク」をなくし、「その他のドリンク」を足す（D-052）
-- キッズドリンクだったメニューはソフトドリンクに移す
-- =====================================================================

update public.recipes set category_id = 'soft_drink' where category_id = 'kids_drink';

-- キッズドリンクの並び順（117）を、その他のドリンクが使う
delete from public.menu_categories where id = 'kids_drink';

insert into public.menu_categories (id, name, sort_order) values ('other_drink', 'その他のドリンク', 117);
