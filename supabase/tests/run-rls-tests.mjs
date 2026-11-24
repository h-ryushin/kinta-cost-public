/**
 * データベースの権限（RLS）とトリガーのテスト。`npm run test:db` で実行する。
 * PGlite（WASM 版 PostgreSQL）にマイグレーションを流し、管理者・社員・未ログインの立場で操作して確かめる。
 * Supabase の auth スキーマとロールは、同じ動きをする代わりのものを作る。
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const db = new PGlite();
const migrationsDir = new URL("../migrations/", import.meta.url).pathname;
const migration = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
  .join("\n");

// Supabase の auth スキーマとロールの代わり
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  -- Supabase のパスキー（顔・指紋）の鍵の表の代わり。Supabase のログインの仕組みが書き込む（D-144）
  create table auth.webauthn_credentials (id bigint generated always as identity primary key, user_id uuid not null, credential_id text not null);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
`);
await db.exec(migration);
// Supabase の既定の権限（public のテーブルは authenticated に付与されている）
await db.exec(`
  grant usage on schema public to anon, authenticated;
  grant all on all tables in schema public to authenticated;
  grant usage, select on all sequences in schema public to authenticated;
`);

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const STAFF = "00000000-0000-0000-0000-00000000000b";
await db.exec(`
  insert into auth.users values ('${ADMIN}'), ('${STAFF}');
  insert into public.profiles (id, display_name, role) values ('${ADMIN}', 'オーナー', 'admin'), ('${STAFF}', '社員A', 'staff');
`);

let failed = 0;
process.on("exit", (code) => { if (code !== 0 && results.length) console.log(results.join("\n")); });
const results = [];
async function as(who, aal, fn) {
  await db.exec("reset role");
  if (who === "anon") {
    await db.exec("set role anon; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false);");
  } else {
    const id = who === "admin" ? ADMIN : STAFF;
    await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [id, JSON.stringify({ sub: id, aal })]);
    await db.exec("set role authenticated");
  }
  try { return await fn(); } finally { await db.exec("reset role"); }
}
/** ログインのしかた（amr）まで指定して、その人として動かす（D-086・D-135） */
async function asWith(id, claims, fn) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [id, JSON.stringify({ sub: id, ...claims })]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}
async function expectOk(name, fn) {
  try { const r = await fn(); results.push(`OK   ${name}`); return r; }
  catch (e) { failed++; results.push(`FAIL ${name}: ${e.message}`); }
}
async function expectError(name, fn, pattern) {
  try { await fn(); failed++; results.push(`FAIL ${name}: エラーにならなかった`); }
  catch (e) {
    if (pattern && !pattern.test(e.message)) { failed++; results.push(`FAIL ${name}: 想定外のエラー ${e.message}`); }
    else results.push(`OK   ${name}（${e.message.slice(0, 60)}）`);
  }
}
function expectEq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  results.push(`${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : `: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`}`);
}
const rows = async (sql, params) => (await db.query(sql, params)).rows;

// ---- 未ログイン・二段階認証前 ----
await as("anon", null, () => expectError("未ログインは材料を読めない", () => rows("select * from public.ingredients"), /permission denied/));
// 停止を防ぐ ping（D-083）は未ログインでも呼べるが、中身は何も返さない
await as("anon", null, async () => {
  expectEq("未ログインでも ping は呼べる（ok を返すだけ）", (await rows("select public.ping() as v"))[0].v, "ok");
  await expectError("未ログインはログインを記録できない", () => rows("select public.record_login()"), /permission denied/);
  await expectError("未ログインは売価の履歴を読めない", () => rows("select * from public.recipe_price_history"), /permission denied/);
});
// 二段階認証は管理者だけ必須（D-082）
await as("staff", "aal1", async () => {
  expectEq("二段階認証なしでも、社員は分類を読める", (await rows("select * from public.menu_categories")).length > 0, true);
});
await as("admin", "aal1", async () => {
  expectEq("二段階認証前の管理者は、分類が0件", (await rows("select * from public.menu_categories")).length, 0);
  await expectError("二段階認証前の管理者は材料を追加できない", () =>
    rows("insert into public.ingredients (name, category_id, purchase_price, purchase_quantity, purchase_unit) values ('牛タン','meat',4500,1,'kg')"), /row-level security/);
  expectEq("二段階認証前の管理者は操作ログも読めない", (await rows("select * from public.audit_logs")).length, 0);
});
// オーナーの本人確認のしかた（D-086・D-135）
const countCats = async () => (await rows("select count(*)::int as n from public.menu_categories"))[0].n > 0;
expectEq("顔・指紋（パスキー）で入ったオーナーは読める", await asWith(ADMIN, { aal: "aal1", amr: [{ method: "webauthn" }] }, countCats), true);
expectEq("メールの6桁（otp）だけではオーナーとして読めない（D-138 でやめた）", await asWith(ADMIN, { aal: "aal1", amr: [{ method: "otp" }] }, countCats), false);
expectEq("パスワードだけで入ったオーナーは読めない", await asWith(ADMIN, { aal: "aal1", amr: [{ method: "password" }] }, countCats), false);
expectEq("パスワードの決め直しのリンクだけで入ったオーナーは読めない", await asWith(ADMIN, { aal: "aal1", amr: [{ method: "recovery" }] }, countCats), false);
expectEq("招待のリンクだけで入ったオーナーは読めない", await asWith(ADMIN, { aal: "aal1", amr: [{ method: "invite" }] }, countCats), false);

// ほかの端末には、iPhone に出した6桁で入る（D-138）
const PHONE = { aal: "aal1", amr: [{ method: "webauthn" }], session_id: "11111111-1111-1111-1111-111111111111" };
const PC = { aal: "aal1", amr: [{ method: "password" }], session_id: "22222222-2222-2222-2222-222222222222" };
const OTHER_PC = { aal: "aal1", amr: [{ method: "password" }], session_id: "33333333-3333-3333-3333-333333333333" };
const code = (await asWith(ADMIN, PHONE, () => rows("select public.create_device_login_code() as c")))[0].c;
expectEq("顔・指紋で入っている iPhone は6桁を出せる", /^\d{6}$/.test(code), true);
await asWith(STAFF, { aal: "aal1", amr: [{ method: "password" }], session_id: "44444444-4444-4444-4444-444444444444" }, () =>
  expectError("社員は数字を出せない", () => rows("select public.create_device_login_code()"), /オーナーだけ/));
await asWith(ADMIN, PC, () => expectError("パスワードだけの PC は数字を出せない", () => rows("select public.create_device_login_code()"), /オーナーだけ/));
expectEq("違う数字では通らない", (await asWith(ADMIN, PC, () => rows("select public.verify_device_login_code('000000') as ok")))[0].ok === true && code !== "000000", false);
expectEq("数字を入れる前の PC は読めない", await asWith(ADMIN, PC, countCats), false);
expectEq("iPhone の数字を入れると通る", (await asWith(ADMIN, PC, () => rows("select public.verify_device_login_code($1) as ok", [code])))[0].ok, true);
expectEq("数字を入れた PC はオーナーとして読める", await asWith(ADMIN, PC, countCats), true);
expectEq("画面からも確かめ済みと分かる", (await asWith(ADMIN, PC, () => rows("select public.session_verified() as v")))[0].v, true);
expectEq("ほかの PC（別のログイン）は、まだ読めない", await asWith(ADMIN, OTHER_PC, countCats), false);
expectEq("同じ数字は2回使えない", (await asWith(ADMIN, OTHER_PC, () => rows("select public.verify_device_login_code($1) as ok", [code])))[0].ok, false);
expectEq("確かめ済みは操作ログに残る", (await rows("select count(*)::int as n from public.audit_logs where action = 'auth.device_verified'"))[0].n, 1);
await asWith(ADMIN, OTHER_PC, async () => {
  // ここまでに2回間違えている（違う数字・使い終わった数字）。あと3回で5回になり、6回目で止まる
  for (let i = 0; i < 3; i++) await rows("select public.verify_device_login_code('999999')");
  await expectError("打ち間違いは10分に5回まで", () => rows("select public.verify_device_login_code('999999')"), /何度も間違えた/);
});
await expectError("社員は6桁で確かめられない（オーナーだけ）", () => asWith(STAFF, { aal: "aal1", amr: [{ method: "password" }], session_id: "44444444-4444-4444-4444-444444444444" }, () => rows("select public.verify_device_login_code('123456')")), /オーナーだけ/);
await asWith(ADMIN, PC, () => expectError("確かめた数字の表は画面から見えない", () => rows("select * from private.device_login_codes"), /permission denied/));

// もしものときの復旧コード（D-139）
await db.exec("reset role; delete from private.device_login_attempts");
const LOST = { aal: "aal1", amr: [{ method: "password" }], session_id: "55555555-5555-5555-5555-555555555555" };
await asWith(ADMIN, LOST, () => expectError("パスワードだけの端末では復旧コードを作れない", () => rows("select public.create_recovery_codes()"), /オーナーだけ/));
const recovery = (await asWith(ADMIN, PHONE, () => rows("select public.create_recovery_codes() as c")))[0].c;
expectEq("復旧コードは8個、XXXX-XXXX の形", recovery.length === 8 && recovery.every((c) => /^[0-9A-F]{4}-[0-9A-F]{4}$/.test(c)), true);
expectEq("使っていない数を数えられる", (await asWith(ADMIN, PHONE, () => rows("select public.recovery_codes_left() as n")))[0].n, 8);
expectEq("パスワードだけの端末には数を教えない", (await asWith(ADMIN, LOST, () => rows("select public.recovery_codes_left() as n")))[0].n, null);
expectEq("違う復旧コードでは通らない", (await asWith(ADMIN, LOST, () => rows("select public.use_recovery_code('0000-0000') as ok")))[0].ok, false);
expectEq("iPhone がなくても、パスワード＋復旧コードで通る（小文字・空白でもよい）", (await asWith(ADMIN, LOST, () => rows("select public.use_recovery_code($1) as ok", [` ${recovery[0].toLowerCase()} `])))[0].ok, true);
expectEq("復旧コードで入った端末はオーナーとして読める", await asWith(ADMIN, LOST, countCats), true);
expectEq("使った復旧コードは2回使えない", (await asWith(ADMIN, OTHER_PC, () => rows("select public.use_recovery_code($1) as ok", [recovery[0]])))[0].ok, false);
expectEq("残りは7個", (await asWith(ADMIN, PHONE, () => rows("select public.recovery_codes_left() as n")))[0].n, 7);
await asWith(ADMIN, PHONE, () => rows("select public.create_recovery_codes()"));
expectEq("作り直すと、前の復旧コードは使えない", (await asWith(ADMIN, OTHER_PC, () => rows("select public.use_recovery_code($1) as ok", [recovery[1]])))[0].ok, false);
await expectError("社員は復旧コードを使えない", () => asWith(STAFF, { aal: "aal1", amr: [{ method: "password" }], session_id: "66666666-6666-6666-6666-666666666666" }, () => rows("select public.use_recovery_code('AAAA-BBBB')")), /オーナーだけ/);
expectEq("復旧コードの作成と使用は操作ログに残る", (await rows("select count(*)::int as n from public.audit_logs where action in ('auth.recovery_created', 'auth.recovery_used')"))[0].n, 3);
await asWith(ADMIN, PHONE, () => expectError("復旧コードの表は画面から見えない", () => rows("select * from private.recovery_codes"), /permission denied/));

// オーナーの新しい端末の顔・指紋は、本人確認を済ませたときだけ登録できる（D-144）
// 鍵の表に書き込むのは Supabase のログインの仕組みなので、ここでは管理者の権限（reset role）で書き込む
const addKey = (user, id) => db.query("insert into auth.webauthn_credentials (user_id, credential_id) values ($1, $2)", [user, id]);
const removeKey = (id) => db.query("delete from auth.webauthn_credentials where credential_id = $1", [id]);
await db.exec("reset role");
await expectOk("オーナーの最初の顔・指紋は、許可なしで登録できる（はじめての設定）", () => addKey(ADMIN, "iphone"));
await expectError("2つ目からは、許可がないと登録できない（パスワードを知った人が自分の端末を足せない）", () => addKey(ADMIN, "attacker"), /iPhone の6桁/);
expectEq("パスワードだけのオーナーは許可を取れない", (await asWith(ADMIN, { ...PC, session_id: "77777777-7777-7777-7777-777777777777" }, () => rows("select public.allow_passkey_registration() as ok")))[0].ok, false);
await expectError("許可を取れなかったので、やはり登録できない", () => addKey(ADMIN, "attacker"), /iPhone の6桁/);
expectEq("顔・指紋で入っているオーナーは許可を取れる", (await asWith(ADMIN, PHONE, () => rows("select public.allow_passkey_registration() as ok")))[0].ok, true);
await expectOk("許可を取ったあとは登録できる（新しい端末を足す）", () => addKey(ADMIN, "ipad"));
await expectError("許可は1回だけ", () => addKey(ADMIN, "another"), /iPhone の6桁/);
expectEq("iPhone の6桁で入った PC も許可を取れる（Windows Hello を足す）", (await asWith(ADMIN, PC, () => rows("select public.allow_passkey_registration() as ok")))[0].ok, true);
await expectOk("PC の顔・指紋を登録できる", () => addKey(ADMIN, "windows"));
await expectError("オーナーの鍵は、許可がないと消せない（0個にして最初の1個の例外を使わせない）", () => removeKey("iphone"), /本人確認/);
await asWith(ADMIN, PHONE, () => rows("select public.allow_passkey_registration()"));
await expectOk("許可を取れば消せる", () => removeKey("windows"));
await asWith(ADMIN, PHONE, () => rows("select public.allow_passkey_registration()"));
await db.exec("reset role; update private.passkey_registration_grants set expires_at = now() - interval '1 second'");
await expectError("許可は5分で切れる", () => addKey(ADMIN, "late"), /iPhone の6桁/);
expectEq("社員は許可を取れない（社員の登録はもともと見張らない）", (await asWith(STAFF, { aal: "aal1", amr: [{ method: "password" }], session_id: "88888888-8888-8888-8888-888888888888" }, () => rows("select public.allow_passkey_registration() as ok")))[0].ok, false);
await expectOk("社員は許可なしで何個でも登録できる", async () => { await addKey(STAFF, "staff-1"); await addKey(STAFF, "staff-2"); });
await expectOk("社員の鍵は許可なしで消せる", () => removeKey("staff-2"));
await asWith(ADMIN, PHONE, () => expectError("許可の表は画面から見えない", () => rows("select * from private.passkey_registration_grants"), /permission denied/));

// ---- 社員：材料 ----
let gyutan, negi, shio;
await as("staff", "aal2", async () => {
  const menuCategories = await rows("select name from public.menu_categories order by sort_order");
  expectEq("メニューの分類がハンディと同じ順番（料理9・ドリンク7・そのほか4、キッズドリンクはなし）", menuCategories.map((c) => c.name), [
    "焼肉（塩）", "焼肉（タレ）", "特盛（塩）", "特盛（タレ）", "おつまみ・刺身・薬味", "サラダ・焼野菜", "ご飯物", "スープ・クッパ", "デザート",
    "ビール・チューハイ", "ソフトドリンク", "ハイボール", "焼酎・日本酒", "梅酒・ワイン・マッコリ", "ボトル", "その他のドリンク",
    "コース", "テイクアウト", "飲み放題", "その他",
  ]);
  gyutan = (await expectOk("社員が材料を追加", () => rows(`insert into public.ingredients (name, category_id, purchase_price, purchase_quantity, purchase_unit, created_by) values ('牛タン','meat',4500,1,'kg', '${ADMIN}') returning id, created_by, base_unit`)))[0];
  expectEq("作成者は送った値ではなくログイン中の人になる", gyutan.created_by, STAFF);
  expectEq("仕入れ先は入れなくてもよい（空になる）", (await rows(`select supplier from public.ingredients where id = '${gyutan.id}'`))[0].supplier, "");
  await expectOk("仕入れ先を入れられる", () => rows(`update public.ingredients set supplier = '〇〇精肉店' where id = '${gyutan.id}'`));
  expectEq("材料の種類に魚介はない", (await rows("select id from public.ingredient_categories where id = 'seafood'")).length, 0);
  expectEq("基本単位が自動で入る", gyutan.base_unit, "g");
  // 数える単位（D-071）
  const sake = (await expectOk("数える単位（本）で登録できる", () => rows("insert into public.ingredients (name, category_id, purchase_price, purchase_quantity, purchase_unit) values ('赤兎馬','drink',3100,1,'本') returning base_unit")))[0];
  expectEq("数える単位はそのまま基本単位になる", sake.base_unit, "本");
  await expectError("ない単位は登録できない", () => rows("insert into public.ingredients (name, category_id, purchase_price, purchase_quantity, purchase_unit) values ('謎','other',1,1,'ダース')"), /purchase_unit_check/);
  negi = (await rows("insert into public.ingredients (name, category_id, purchase_price, purchase_quantity, purchase_unit) values ('ネギ','vegetable',720,1,'kg') returning id"))[0];
  shio = (await rows("insert into public.ingredients (name, category_id, purchase_price, purchase_quantity, purchase_unit) values ('塩','seasoning',150,1,'kg') returning id"))[0];
  await expectOk("社員が価格を変更", () => rows(`update public.ingredients set purchase_price = 5000 where id = '${gyutan.id}'`));
  expectEq("価格の履歴が残る", (await rows(`select old_price, new_price, changed_by from public.ingredient_price_history where ingredient_id = '${gyutan.id}'`)), [{ old_price: 4500, new_price: 5000, changed_by: STAFF }]);
  // 使える割合（サク取り）を変えたときも履歴に残す（D-126）
  await expectOk("社員が使える割合を変更", () => rows(`update public.ingredients set yield_rate = 80 where id = '${gyutan.id}'`));
  expectEq("使える割合の変更も価格の履歴に残る", (await rows(`select old_price, new_price, old_yield_rate::float as oy, new_yield_rate::float as ny from public.ingredient_price_history where ingredient_id = '${gyutan.id}' and old_yield_rate <> new_yield_rate`)), [{ old_price: 5000, new_price: 5000, oy: 100, ny: 80 }]);
  await rows(`update public.ingredients set yield_rate = 100 where id = '${gyutan.id}'`);
  await expectError("同じ名前の材料は登録できない", () => rows("insert into public.ingredients (name, category_id, purchase_price, purchase_quantity, purchase_unit) values (' 牛タン ','meat',1,1,'kg')"), /すでにあります/);
  await expectError("社員は材料を削除できない（0件）", async () => {
    const r = await db.query(`delete from public.ingredients where id = '${negi.id}'`);
    if (r.affectedRows === 0) throw new Error("0件削除（RLS）");
  }, /0件/);
  // 操作ログは社員も読める（D-162）。書き込み・削除はできない
  expectEq("社員は操作ログを読める", (await rows("select * from public.audit_logs")).length > 0, true);
  await expectError("社員は操作ログを書けない", () => rows("insert into public.audit_logs (action) values ('x')"), /row-level security|permission denied/);
  await expectError("社員は操作ログを消せない（0件）", async () => {
    const r = await db.query("delete from public.audit_logs");
    if (r.affectedRows === 0) throw new Error("0件削除（RLS）");
  }, /0件/);
  await expectError("社員は自分を管理者にできない", async () => {
    const r = await db.query(`update public.profiles set role = 'admin' where id = '${STAFF}'`);
    if (r.affectedRows === 0) throw new Error("0件更新（RLS）");
  }, /0件/);
});

// ---- 社員：仕込み品・創作レシピ・メニュー ----
let ajinegi, draft, staffMenu;
await as("staff", "aal2", async () => {
  ajinegi = (await expectOk("社員が仕込み品を保存", () => rows(`select public.save_prep(null, '味ネギ', 400, 'g', '', $1) as id`, [JSON.stringify([{ ingredient_id: negi.id, quantity: 400 }, { ingredient_id: shio.id, quantity: 6 }])])))[0].id;
  await expectError("材料と同じ名前の仕込み品は作れない", () => rows(`select public.save_prep(null, 'ネギ', 1, 'g', '', '[]')`), /すでにあります/);
  draft = (await expectOk("社員が創作レシピを保存", () => rows(`select public.save_recipe(null, 'draft', 'yakiniku_tare', '厚切りタン', 1680, 'メモ', $1) as id`, [JSON.stringify([{ ingredient_id: gyutan.id, quantity: 120 }, { prep_id: ajinegi, quantity: 30 }])])))[0].id;
  expectEq("材料行が2行入る", (await rows(`select count(*)::int as n from public.recipe_items where recipe_id = '${draft}'`))[0].n, 2);
  await expectOk("社員が創作レシピを編集（材料を差し替え）", () => rows(`select public.save_recipe('${draft}', 'draft', 'yakiniku_tare', '厚切りタン', 1780, '', $1)`, [JSON.stringify([{ ingredient_id: gyutan.id, quantity: 150 }])]));
  expectEq("差し替え後は1行", (await rows(`select quantity::text from public.recipe_items where recipe_id = '${draft}'`)), [{ quantity: "150.000" }]);
  // 売価の履歴（D-111）：トリガーが書き、画面からは書けない
  expectEq("売価を変えると売価の履歴が残る", await rows(`select old_price, new_price, changed_by from public.recipe_price_history where recipe_id = '${draft}'`), [{ old_price: 1680, new_price: 1780, changed_by: STAFF }]);
  await expectError("売価の履歴は画面から書けない", () => rows(`insert into public.recipe_price_history (recipe_id, old_price, new_price) values ('${draft}', 1, 2)`), /row-level security/);
  await expectError("価格の履歴も画面から書けない", () => rows(`insert into public.ingredient_price_history (ingredient_id, old_price, old_quantity, old_unit, new_price, new_quantity, new_unit) values ('${gyutan.id}', 1, 1, 'kg', 2, 1, 'kg')`), /row-level security/);
  await expectError("価格の履歴は消せない", async () => {
    const r = await db.query(`delete from public.ingredient_price_history where ingredient_id = '${gyutan.id}'`);
    if (r.affectedRows === 0) throw new Error("0件（RLS）");
  }, /0件/);
  await expectError("材料と仕込み品を両方指す行はエラー", () => rows(`select public.save_recipe('${draft}', 'draft', 'yakiniku_tare', '厚切りタン', 1780, '', $1)`, [JSON.stringify([{ ingredient_id: gyutan.id, prep_id: ajinegi, quantity: 1 }])]), /recipe_items_one_source/);
  // 社員もメニューを作れる・登録できる（D-077）
  staffMenu = (await expectOk("社員がメニューを作れる", () => rows(`select public.save_recipe(null, 'menu', 'yakiniku_tare', '社員が作ったメニュー', 1280, '', $1) as id`, [JSON.stringify([{ ingredient_id: gyutan.id, quantity: 80 }])])))[0].id;
  expectEq("新しく作ったメニューは、売価の履歴を残さない（D-111）", (await rows(`select count(*)::int as n from public.recipe_price_history where recipe_id = '${staffMenu}'`))[0].n, 0);
  await expectOk("売価を空欄にできる", () => rows(`select public.save_recipe('${staffMenu}', 'menu', 'yakiniku_tare', '社員が作ったメニュー', null, '', $1)`, [JSON.stringify([{ ingredient_id: gyutan.id, quantity: 80 }])]));
  expectEq("売価を空欄にしたことも履歴に残る", await rows(`select old_price, new_price from public.recipe_price_history where recipe_id = '${staffMenu}'`), [{ old_price: 1280, new_price: null }]);
  await expectOk("社員がメニューを消せる", () => rows(`select public.save_recipe('${staffMenu}', 'menu', 'yakiniku_tare', '社員が作ったメニュー', 1280, '', '[]')`));
  await expectOk("社員が自分のメニューを削除できる", async () => {
    const r = await db.query(`delete from public.recipes where id = '${staffMenu}'`);
    if (r.affectedRows !== 1) throw new Error("消えなかった");
  });
  await expectError("社員は秘密レシピを保存できない", () => rows(`select public.save_secret_recipe(null, 'draft', 'yakiniku_tare', '秘伝', 1000, 'x', 'y', 1, 100)`), /管理者だけ/);
  // 使っている材料でも、意味が変わる単位に変えられる（D-170）。基本単位は新しい単位に合わせて変わる
  const toL = (await expectOk("使っている材料でも、基本単位が変わる単位に変えられる（D-170）", () => rows(`update public.ingredients set purchase_unit = 'L' where id = '${gyutan.id}' returning base_unit`)))[0];
  expectEq("基本単位も新しい単位に変わる", toL.base_unit, "ml");
  await expectOk("同じ基本単位なら変えられる（kg→g）", () => rows(`update public.ingredients set purchase_unit = 'g', purchase_quantity = 1000 where id = '${gyutan.id}'`));
});

// ---- 管理者：登録・秘密レシピ・秘密の仕込み品 ----
let secretMenu, secretDraft, shiodare;
await as("admin", "aal2", async () => {
  await expectOk("創作レシピをメニューに登録できる", () => rows(`update public.recipes set kind = 'menu' where id = '${draft}'`));
  secretMenu = (await expectOk("管理者が秘密メニューを保存", () => rows(`select public.save_secret_recipe(null, 'menu', 'yakiniku_tare', '秘伝ダレのカルビ', 1500, 'CIPHERTEXT', 'IV', 1, 420) as id`)))[0].id;
  secretDraft = (await rows(`select public.save_secret_recipe(null, 'draft', 'yakiniku_tare', '秘密の試作', null, 'C2', 'IV2', 1, 300) as id`))[0].id;
  await expectOk("管理者が通常レシピを秘密にする（平文の材料行は消える）", () => rows(`select public.save_secret_recipe('${draft}', 'menu', 'yakiniku_tare', '厚切りタン', 1780, 'C3', 'IV3', 1, 750)`));
  expectEq("秘密にしたレシピの平文の材料行は0", (await rows(`select count(*)::int as n from public.recipe_items where recipe_id = '${draft}'`))[0].n, 0);
  // 秘密のものの中身は暗号文だけ。平文の材料行は持たせない（D-148。D-094 の前に戻した）
  await expectError("秘密メニューに平文の材料行は持たせられない", () => rows(`insert into public.recipe_items (recipe_id, ingredient_id, quantity) values ('${secretMenu}', '${gyutan.id}', 1)`), /暗号化して保存/);
  await expectError("save_recipe で秘密にしたまま平文の中身を送れない", () => rows(`select public.save_recipe('${secretMenu}', 'menu', 'yakiniku_tare', '秘伝ダレのカルビ', 1500, '', $1, true)`, [JSON.stringify([{ ingredient_id: gyutan.id, quantity: 1 }])]), /暗号化して保存/);
  await expectError("秘密レシピに平文のメモは持たせられない", () => rows(`update public.recipes set memo = '作り方' where id = '${secretMenu}'`), /secret_has_no_plain_memo/);
  await expectError("使っている材料は物理削除できない", () => rows(`delete from public.ingredients where id = '${negi.id}'`), /foreign key/);
  await expectOk("材料は archived_at で使わない状態にできる", () => rows(`update public.ingredients set archived_at = now() where id = '${negi.id}'`));
  await expectOk("使わない状態の名前は再利用できる", () => rows("insert into public.ingredients (name, category_id, purchase_price, purchase_quantity, purchase_unit) values ('ネギ','vegetable',800,1,'kg')"));
  const logs = await rows("select action, actor_name from public.audit_logs order by id");
  expectEq("操作ログに価格変更が残る", logs.some((l) => l.action === "ingredient.price_changed" && l.actor_name === "社員A"), true);
  expectEq("操作ログにメニュー登録が残る", logs.some((l) => l.action === "recipe.promoted"), true);
  await expectOk("ログインを記録できる", () => rows("select public.record_login()"));
  // 秘密の仕込み品（D-066）
  shiodare = (await expectOk("管理者が秘密の仕込み品を保存", () => rows(`select public.save_secret_prep(null, '塩だれ', 300, 'ml', 'PCIPHER', 'PIV', 1, 369) as id`)))[0].id;
  await expectError("秘密の仕込み品に平文の材料行は持たせられない", () => rows(`insert into public.prep_items (prep_id, ingredient_id, quantity) values ('${shiodare}', '${gyutan.id}', 1)`), /暗号化して保存/);
  await expectError("秘密の仕込み品に平文のメモは持たせられない", () => rows(`update public.preps set memo = '配合' where id = '${shiodare}'`), /secret_has_no_plain_memo/);
  await expectOk("秘密でない仕込み品を秘密にできる", () => rows(`select public.save_secret_prep('${ajinegi}', '味ネギ', 400, 'g', 'C4', 'IV4', 1, 319)`));
  expectEq("秘密にした仕込み品の平文の材料行は0", (await rows(`select count(*)::int as n from public.prep_items where prep_id = '${ajinegi}'`))[0].n, 0);
  await expectOk("管理者が仕込み品の秘密を外す（暗号文は消える）", () => rows(`select public.save_prep('${ajinegi}', '味ネギ', 400, 'g', '', $1)`, [JSON.stringify([{ ingredient_id: negi.id, quantity: 400 }])]));
  expectEq("秘密を外した仕込み品の暗号文は0", (await rows(`select count(*)::int as n from public.secret_prep_contents where prep_id = '${ajinegi}'`))[0].n, 0);
  expectEq("秘密を外した仕込み品の原価は消える", (await rows(`select secret_cost from public.preps where id = '${ajinegi}'`))[0].secret_cost, null);

  await expectOk("管理者が秘密を外す（暗号文は消える）", () => rows(`select public.save_recipe('${draft}', 'menu', 'yakiniku_tare', '厚切りタン', 1780, '', $1)`, [JSON.stringify([{ ingredient_id: gyutan.id, quantity: 150 }])]));
  expectEq("秘密を外したら暗号文は0", (await rows(`select count(*)::int as n from public.secret_recipe_contents where recipe_id = '${draft}'`))[0].n, 0);
  expectEq("売価が同じままの保存では、売価の履歴は増えない", (await rows(`select count(*)::int as n from public.recipe_price_history where recipe_id = '${draft}'`))[0].n, 1);
  await rows(`update public.recipes set sale_price = 900 where id = '${secretDraft}'`);

  // レシピ鍵（D-148）：包んだ鍵だけを置く
  await expectOk("オーナーはレシピ鍵（予備の鍵で包んだもの）を置ける", () => rows("insert into public.recipe_keys (version, recovery_wrapped_key, recovery_iv, recovery_salt) values (1, 'W', 'I', 'S')"));
  await expectOk("オーナーは自分の端末の包んだ鍵を置ける", () => rows(`insert into public.recipe_key_slots (credential_id, user_id, key_version, wrapped_key, iv) values ('cred-1', '${ADMIN}', 1, 'W', 'I')`));
  await expectError("ほかの人の端末として鍵を置けない", () => rows(`insert into public.recipe_key_slots (credential_id, user_id, key_version, wrapped_key, iv) values ('cred-2', '${STAFF}', 1, 'W', 'I')`), /row-level security/);
  await expectOk("鍵を開けたあと、秘密の原価を書き直せる", () => rows(`select public.update_secret_costs($1, $2)`, [JSON.stringify([{ id: secretMenu, cost: 450 }]), JSON.stringify([{ id: shiodare, cost: 380 }])]));
  expectEq("書き直した原価が入る", (await rows(`select secret_cost from public.recipes where id = '${secretMenu}'`))[0].secret_cost.toString(), "450.0"); // 0.1円単位の列（D-171）
  await rows(`select public.update_secret_costs($1, '[]')`, [JSON.stringify([{ id: draft, cost: 1 }])]);
  expectEq("秘密でないものの原価は書き直さない", (await rows(`select secret_cost from public.recipes where id = '${draft}'`))[0].secret_cost, null);
  await rows(`select public.update_secret_costs($1, $2)`, [JSON.stringify([{ id: secretMenu, cost: 420 }]), JSON.stringify([{ id: shiodare, cost: 369 }])]);
  // 原価が同じでも、計算した時刻は新しくする（D-173）。古いままだと「原価が古くなっています」と出続ける
  await rows(`update public.preps set secret_cost_calculated_at = '2026-01-01' where id = '${shiodare}'`);
  await rows(`select public.update_secret_costs('[]', $1)`, [JSON.stringify([{ id: shiodare, cost: 369 }])]);
  expectEq("原価が同じでも、計算した時刻は新しくなる", (await rows(`select secret_cost_calculated_at > '2026-06-01' as fresh from public.preps where id = '${shiodare}'`))[0].fresh, true);
});
expectEq("原価の書き直しだけでは操作ログに残らない（D-066）", (await rows(`select count(*)::int as n from public.audit_logs where target_id = '${secretMenu}' and action like 'recipe.updated%'`))[0].n, 0);
await asWith(ADMIN, { aal: "aal1", amr: [{ method: "password" }] }, async () =>
  expectEq("パスワードだけのオーナーはレシピ鍵を読めない", (await rows("select * from public.recipe_key_slots")).length, 0));

// ---- 社員から秘密レシピがどう見えるか ----
await as("staff", "aal2", async () => {
  const visible = await rows("select name, is_secret, secret_cost from public.recipes order by name");
  expectEq("社員は秘密メニューの名前と原価は見えるが、秘密の創作レシピは見えない", visible.map((r) => r.name).sort(), ["厚切りタン", "秘伝ダレのカルビ"].sort());
  expectEq("秘密メニューの原価は見える", visible.find((r) => r.name === "秘伝ダレのカルビ")?.secret_cost?.toString(), "420.0");
  expectEq("社員は暗号文を読めない", (await rows("select * from public.secret_recipe_contents")).length, 0);
  expectEq("社員は秘密の創作レシピを ID で指定しても読めない", (await rows(`select * from public.recipes where id = '${secretDraft}'`)).length, 0);
  expectEq("社員は秘密の創作レシピの売価の履歴を読めない", (await rows(`select * from public.recipe_price_history where recipe_id = '${secretDraft}'`)).length, 0);
  expectEq("社員はほかの売価の履歴は読める", (await rows(`select * from public.recipe_price_history where recipe_id = '${draft}'`)).length, 1);
  await expectError("社員は秘密メニューを編集できない", () => rows(`select public.save_recipe('${secretMenu}', 'menu', 'yakiniku_tare', '乗っ取り', 1, '', '[]')`), /権限がありません/);
  // 秘密の仕込み品（D-066）：名前と1回分の原価は見えるが、中身は見えない・変えられない
  const preps = await rows("select name, is_secret, secret_cost from public.preps order by name");
  expectEq("社員は秘密の仕込み品の名前と1回分の原価が見える", { ...preps.find((p) => p.name === "塩だれ"), secret_cost: Number(preps.find((p) => p.name === "塩だれ")?.secret_cost) }, { name: "塩だれ", is_secret: true, secret_cost: 369 });
  expectEq("社員は仕込み品の暗号文を読めない", (await rows("select * from public.secret_prep_contents")).length, 0);
  expectEq("社員は秘密の仕込み品の材料行を読めない（D-094）", (await rows(`select * from public.prep_items where prep_id = '${shiodare}'`)).length, 0);
  expectEq("社員は秘密メニューの材料行を読めない（D-094）", (await rows(`select * from public.recipe_items where recipe_id = '${secretMenu}'`)).length, 0);
  await expectError("社員は秘密の仕込み品を編集できない", () => rows(`select public.save_prep('${shiodare}', '乗っ取り', 1, 'g', '', '[]')`), /権限がありません/);
  await expectError("社員は秘密の仕込み品を保存できない", () => rows(`select public.save_secret_prep(null, '秘伝のタレ', 1, 'g', 'x', 'y', 1, 1)`), /管理者だけ/);
  expectEq("社員は秘密でない仕込み品の材料は読める", (await rows("select count(*)::int as n from public.prep_items"))[0].n > 0, true);
  expectEq("社員は端末・鍵を読めない", (await rows("select * from public.recipe_key_slots")).length + (await rows("select * from public.recipe_keys")).length, 0);
  await expectError("社員は秘密の原価を書き直せない", () => rows(`select public.update_secret_costs($1, '[]')`, [JSON.stringify([{ id: secretMenu, cost: 1 }])]), /管理者だけ/);
});

// ---- お店の設定（D-101・D-110）：読むのは全員、変えるのはオーナーだけ ----
await as("staff", "aal1", async () => {
  expectEq(
    "社員は設定（消費税・原価率の目安）を読める",
    (await rows("select sale_tax_rate::float as sale, drink_ratio_good::float as dg, meat_ratio_high::float as mh from public.settings"))[0],
    { sale: 10, dg: 20, mh: 32 },
  );
  await rows("update public.settings set drink_ratio_good = 5");
  expectEq("社員は設定を変えられない（RLS で0行）", (await rows("select drink_ratio_good::float as v from public.settings"))[0].v, 20);
});
await as("admin", "aal2", async () => {
  await expectOk("オーナーは原価率の目安を変えられる", () => rows("update public.settings set drink_ratio_good = 18, drink_ratio_high = 24"));
  expectEq("変えた目安が残る", (await rows("select drink_ratio_good::float as g, drink_ratio_high::float as h from public.settings"))[0], { g: 18, h: 24 });
  await expectError("「良好」の線を「高い」の線以上にはできない", () => rows("update public.settings set meat_ratio_good = 40"), /settings_meat_ratio_check/);
  await expectError("100%を超える目安は入れられない", () => rows("update public.settings set side_ratio_high = 120"), /settings_side_ratio_check|numeric field overflow/);
  await expectError("設定の行は増やせない", () => rows("insert into public.settings (id) values (false)"), /settings_id_check|violates check|row-level security/);
  await rows("update public.settings set drink_ratio_good = 20, drink_ratio_high = 25");
});

// ---- オーナーは1人だけ（D-090） ----
await expectError("管理者をもう1人は作れない", async () => {
  await db.exec("insert into auth.users values ('00000000-0000-0000-0000-00000000000c')");
  await db.query("insert into public.profiles (id, display_name, role) values ('00000000-0000-0000-0000-00000000000c', 'もう1人のオーナー', 'admin')");
}, /profiles_single_admin|duplicate key/);
await expectOk("社員は何人でも作れる", () => rows("insert into public.profiles (id, display_name, role) values ('00000000-0000-0000-0000-00000000000c', '社員B', 'staff')"));

// ---- 社員の削除（D-118）：オーナーだけ。オーナー自身は消せない ----
const STAFF_B = "00000000-0000-0000-0000-00000000000c";
await as("staff", "aal2", async () => {
  await expectError("社員は利用者を削除できない", () => rows(`select public.delete_staff('${STAFF_B}')`), /オーナーだけ/);
});
await as("anon", null, async () => {
  await expectError("未ログインでは削除の関数を呼べない", () => rows(`select public.delete_staff('${STAFF_B}')`), /permission denied/);
});
await as("admin", "aal2", async () => {
  await expectError("オーナーは自分を削除できない", () => rows(`select public.delete_staff('${ADMIN}')`), /自分のアカウント/);
  await expectOk("オーナーは社員を削除できる", () => rows(`select public.delete_staff('${STAFF_B}')`));
  expectEq("削除した社員は利用者の一覧から消える", (await rows(`select count(*)::int as n from public.profiles where id = '${STAFF_B}'`))[0].n, 0);
  expectEq("削除は操作ログに、オーナーの名前で残る", (await rows("select actor_name, detail->>'name' as name from public.audit_logs where action = 'user.deleted'")), [{ actor_name: "オーナー", name: "社員B" }]);
  await expectError("もういない利用者は削除できない", () => rows(`select public.delete_staff('${STAFF_B}')`), /見つかりません/);
});

// ---- バックアップ用のユーザー（D-067）：読むだけできる ----
await db.exec("reset role; set role kinta_backup");
expectEq("バックアップ用のユーザーは全部の材料を読める", (await rows("select count(*)::int as n from public.ingredients"))[0].n > 0, true);
expectEq("バックアップ用のユーザーは秘密の暗号文も読める（復元に要るため）", (await rows("select count(*)::int as n from public.secret_recipe_contents"))[0].n > 0, true);
await expectError("バックアップ用のユーザーは書き込めない", () => rows("insert into public.ingredients (name, category_id, purchase_price, purchase_quantity, purchase_unit) values ('x','meat',1,1,'kg')"), /permission denied/);
await expectError("バックアップ用のユーザーは消せない", () => rows("delete from public.audit_logs"), /permission denied/);
await db.exec("reset role");

// ---- 履歴と操作ログは新しいほうから1,000件だけ残す（D-159） ----
await db.exec(`
  insert into public.ingredient_price_history (ingredient_id, old_price, old_quantity, old_unit, new_price, new_quantity, new_unit)
  select (select id from public.ingredients limit 1), g, 1, 'kg', g + 1, 1, 'kg' from generate_series(1, 1005) g;
`);
expectEq("価格の履歴は1,000件までになる", (await rows("select count(*)::int as n from public.ingredient_price_history"))[0].n, 1000);
expectEq("価格の履歴は新しいほうが残る", (await rows("select max(new_price)::int as n from public.ingredient_price_history"))[0].n, 1006);
await db.exec(`
  insert into public.recipe_price_history (recipe_id, old_price, new_price)
  select (select id from public.recipes limit 1), g, g + 1 from generate_series(1, 1001) g;
`);
expectEq("売価の履歴も1,000件までになる", (await rows("select count(*)::int as n from public.recipe_price_history"))[0].n, 1000);
await db.exec("insert into public.audit_logs (action) select 'test.trim' from generate_series(1, 1001)");
expectEq("操作ログも1,000件までになる", (await rows("select count(*)::int as n from public.audit_logs"))[0].n, 1000);
await db.exec("insert into public.audit_logs (action) values ('test.trim.last')");
expectEq("1,000件のあとに足すと、いちばん古いものが消える", (await rows("select count(*)::int as n, max(action) filter (where id = (select max(id) from public.audit_logs)) as last from public.audit_logs"))[0], { n: 1000, last: "test.trim.last" });

// ---- 停止した社員 ----
await db.exec(`update public.profiles set is_active = false where id = '${STAFF}'`);
await as("staff", "aal2", async () => {
  expectEq("停止した社員は何も読めない", (await rows("select * from public.ingredients")).length, 0);
});

if (failed === 0) {
  console.log(results.join("\n"));
  console.log(`\nすべて成功（${results.length}件）`);
} else {
  console.log(`\n失敗 ${failed}件`);
}
process.exit(failed === 0 ? 0 : 1);
