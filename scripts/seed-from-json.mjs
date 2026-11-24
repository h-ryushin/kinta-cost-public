/**
 * 今アプリに入っているデータ（ブラウザの localStorage の中身）を、
 * Supabase に貼り付けられる INSERT 文に変える。
 *
 *   npm run db:seed -- ~/Downloads/kinta.json
 *
 * JSON の取り方：アプリを開いて開発者ツールのコンソールで
 *   copy(localStorage.getItem('kinta-genka:v1'))
 * を実行し、貼り付けて .json として保存する。
 *
 * 分類の ID は、マイグレーションを PGlite に流して実物から読むので、名前を変えてもずれない。
 * 秘密のメニュー・仕込み品は出力しない（暗号化してからでないと保存できないため）。
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const input = process.argv[2];
if (!input) {
  console.error("使い方：npm run db:seed -- <JSONファイル>");
  process.exit(1);
}

const data = JSON.parse(readFileSync(input, "utf8"));
if (typeof data !== "object" || data === null || !Array.isArray(data.ingredients)) {
  console.error("アプリのデータとして読めませんでした");
  process.exit(1);
}

// ---- 分類の名前 → ID を、マイグレーションから作る ----
const migrationsDir = new URL("../supabase/migrations/", import.meta.url).pathname;
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
  .join("\n");

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select null::uuid';
  create function auth.jwt() returns jsonb language sql stable as 'select ''{}''::jsonb';
`);
await db.exec(migrations);

const idOf = async (table) =>
  new Map((await db.query(`select id, name from public.${table}`)).rows.map((r) => [r.name, r.id]));
const ingredientCategories = await idOf("ingredient_categories");
const menuCategories = await idOf("menu_categories");

// ---- SQL を組み立てる ----
const q = (value) => (value === null || value === undefined ? "null" : `'${String(value).replaceAll("'", "''")}'`);
const n = (value) => (value === null || value === undefined || Number.isNaN(value) ? "null" : String(value));
const skipped = [];
const lines = [];

const ingredients = data.ingredients.filter((i) => {
  const ok = ingredientCategories.has(i.category);
  if (!ok) skipped.push(`材料「${i.name}」：種類「${i.category}」が分類表にありません`);
  return ok;
});
lines.push("-- 材料");
for (const i of ingredients) {
  lines.push(
    `insert into public.ingredients (id, name, category_id, supplier, purchase_price, purchase_quantity, purchase_unit) values (${q(i.id)}, ${q(i.name)}, ${q(ingredientCategories.get(i.category))}, ${q(i.supplier ?? "")}, ${n(i.purchasePrice)}, ${n(i.purchaseQuantity)}, ${q(i.purchaseUnit)});`,
  );
}

const preps = (data.preps ?? []).filter((p) => {
  if (p.secret) skipped.push(`仕込み品「${p.name}」：秘密のものは暗号化してから入れる`);
  return !p.secret;
});
const prepIds = new Set(preps.map((p) => p.id));
lines.push("", "-- 仕込み品");
for (const p of preps) {
  lines.push(
    `insert into public.preps (id, name, yield_quantity, yield_unit, memo) values (${q(p.id)}, ${q(p.name)}, ${n(p.yieldQuantity)}, ${q(p.yieldUnit)}, ${q(p.memo ?? "")});`,
  );
  p.items.forEach((item, index) => {
    lines.push(
      `insert into public.prep_items (prep_id, ingredient_id, quantity, sort_order) values (${q(p.id)}, ${q(item.id)}, ${n(item.quantity)}, ${index});`,
    );
  });
}

const recipes = (data.recipes ?? []).filter((r) => {
  if (r.secret) skipped.push(`${r.kind === "menu" ? "メニュー" : "創作レシピ"}「${r.name}」：秘密のものは暗号化してから入れる`);
  if (!r.secret && !menuCategories.has(r.category)) {
    skipped.push(`メニュー「${r.name}」：分類「${r.category}」が分類表にありません`);
    return false;
  }
  return !r.secret;
});
lines.push("", "-- メニュー・創作レシピ");
for (const r of recipes) {
  lines.push(
    `insert into public.recipes (id, kind, category_id, name, sale_price, memo) values (${q(r.id)}, ${q(r.kind)}, ${q(menuCategories.get(r.category))}, ${q(r.name)}, ${n(r.salePrice)}, ${q(r.memo ?? "")});`,
  );
  r.items.forEach((item, index) => {
    // 秘密の仕込み品を使っている行は、その仕込み品を入れていないので飛ばす
    if (item.type === "prep" && !prepIds.has(item.id)) {
      skipped.push(`「${r.name}」の材料1行：秘密の仕込み品を使っているため入れない`);
      return;
    }
    const ingredient = item.type === "ingredient" ? q(item.id) : "null";
    const prep = item.type === "prep" ? q(item.id) : "null";
    lines.push(
      `insert into public.recipe_items (recipe_id, ingredient_id, prep_id, quantity, sort_order) values (${q(r.id)}, ${ingredient}, ${prep}, ${n(item.quantity)}, ${index});`,
    );
  });
}

const sql = `-- アプリのデータを Supabase に入れる（${new Date().toLocaleDateString("sv-SE")} 作成）
-- 生成物。npm run db:seed -- <JSONファイル> で作り直す。
-- Supabase の SQL Editor に貼り付けて実行する（先に supabase/all.sql を流しておくこと）。

begin;

${lines.join("\n")}

commit;
`;

// ---- 作った SQL が本当に通るか、その場で確かめる ----
try {
  await db.exec(sql);
} catch (e) {
  console.error("作った SQL がエラーになりました：", e.message);
  process.exit(1);
}

const out = new URL("../supabase/seed.sql", import.meta.url).pathname;
writeFileSync(out, sql);
console.log(`supabase/seed.sql を作りました（材料 ${ingredients.length}・仕込み品 ${preps.length}・レシピ ${recipes.length}）`);
if (skipped.length > 0) console.log(`\n入れなかったもの：\n- ${skipped.join("\n- ")}`);
