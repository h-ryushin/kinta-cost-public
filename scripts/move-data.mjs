// 今の Supabase から新しい Supabase へ、アプリのデータを写す（D-146・D-163 の移し替え用）。
//
//   npm run move:export -- <今のプロジェクトID>   … move-data/export.json に書き出す
//   npm run move:import -- <新しいプロジェクトID> … move-data/import.sql を作って新しいほうに流し、件数を比べる
//   node scripts/move-data.mjs sql                 … 流さずに move-data/import.sql だけを作る
//
// つなぎ方は supabase CLI の Management API（`supabase db query --project-ref`）。
// そのプロジェクトを持っているアカウントのアクセストークン（SUPABASE_ACCESS_TOKEN）が要る。
//
// 写すもの・写さないもの（docs/migration-guide の 4章）：
// - 写す：材料・仕込み品・メニュー・創作レシピ・材料行・秘密の暗号文・レシピ鍵（予備の鍵で包んだもの）・
//   価格と売価の履歴・設定・分類
// - 写さない：利用者（profiles。ログインのアカウントは新しいほうで作り直す）・操作ログ（開発担当のテストの記録）・
//   端末ごとの鍵（recipe_key_slots。アドレスが変わるとパスキーが変わり、使えない）
// - 「作った人・直した人」は空にする（前のプロジェクトの利用者を指していて、新しいほうにはいないため）
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const DIR = "move-data";
const EXPORT_FILE = `${DIR}/export.json`;
const SQL_FILE = `${DIR}/import.sql`;

/** 写す表。並びは参照される側を先にする（トリガーと外部キーは止めて入れるが、読みやすさのため） */
const TABLES = [
  "ingredient_categories",
  "menu_categories",
  "settings",
  "ingredients",
  "preps",
  "prep_items",
  "recipes",
  "recipe_items",
  "secret_recipe_contents",
  "secret_prep_contents",
  "recipe_keys",
  "ingredient_price_history",
  "recipe_price_history",
];

/** マイグレーションが最初から入れている行。主キーが同じなら上書きする */
const UPSERT_KEYS = { ingredient_categories: "id", menu_categories: "id", settings: "id" };

/** 前のプロジェクトの利用者を指す列。空にする */
const USER_COLUMNS = new Set(["created_by", "updated_by", "changed_by"]);

/** 番号を自動で振る表。入れたあとに、続きの番号を合わせる */
const SERIAL_TABLES = ["recipe_items", "ingredient_price_history", "recipe_price_history"];

function query(ref, args) {
  const out = execFileSync("npx", ["supabase", "db", "query", "--linked", "--project-ref", ref, "--output-format", "json", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(out).rows;
}

function exportData(ref) {
  // 生成列（base_unit など）は入れられないので、入れられる列だけを控える
  const columnRows = query(ref, [
    `select table_name, column_name from information_schema.columns
     where table_schema = 'public' and is_generated = 'NEVER' and table_name in (${TABLES.map((t) => `'${t}'`).join(",")})
     order by table_name, ordinal_position`,
  ]);
  const columns = {};
  for (const r of columnRows) (columns[r.table_name] ??= []).push(r.column_name);
  const rows = {};
  for (const table of TABLES) {
    if (!columns[table]) throw new Error(`表 ${table} が見つかりません`);
    const [r] = query(ref, [`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows from public.${table} t`]);
    rows[table] = r.rows;
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(EXPORT_FILE, JSON.stringify({ exportedAt: new Date().toISOString(), from: ref, columns, rows }, null, 1));
  for (const table of TABLES) console.log(`${table}: ${rows[table].length}件`);
  console.log(`→ ${EXPORT_FILE} に書き出しました（お店のデータが入っています。Git には入りません）`);
}

function buildSql(data) {
  const tag = `move_${randomBytes(6).toString("hex")}`;
  const lines = [
    "begin;",
    // 写すあいだはトリガー（作った人の記録・操作ログ・価格の履歴など）と外部キーの確認を止める。
    // 前のプロジェクトで確かめ済みのデータをそのまま入れるため
    "set local session_replication_role = replica;",
    // 空のプロジェクトにだけ入れる。2回流してしまったときに、二重にならないようにする
    `do $$ begin if exists (select 1 from public.ingredients) or exists (select 1 from public.recipes) then
       raise exception '新しいプロジェクトに、もう材料かメニューが入っています。空のプロジェクトにだけ写せます';
     end if; end $$;`,
  ];
  for (const table of TABLES) {
    const cols = data.columns[table];
    const json = JSON.stringify(data.rows[table]);
    if (json.includes(`$${tag}$`)) throw new Error("データの中に区切りの文字が入っています。もう一度流してください");
    const select = cols.map((c) => (USER_COLUMNS.has(c) ? `null as ${c}` : c)).join(", ");
    const key = UPSERT_KEYS[table];
    const conflict = key
      ? ` on conflict (${key}) do update set ${cols.filter((c) => c !== key).map((c) => `${c} = excluded.${c}`).join(", ")}`
      : "";
    // 番号を自動で振る列にも、前の番号をそのまま入れる（価格の履歴の並びを保つため）
    const overriding = SERIAL_TABLES.includes(table) ? " overriding system value" : "";
    lines.push(
      `insert into public.${table} (${cols.join(", ")})${overriding} select ${select} from jsonb_populate_recordset(null::public.${table}, $${tag}$${json}$${tag}$)${conflict};`,
    );
  }
  for (const table of SERIAL_TABLES) {
    lines.push(
      `select setval(pg_get_serial_sequence('public.${table}', 'id'), coalesce((select max(id) from public.${table}), 0) + 1, false);`,
    );
  }
  lines.push("commit;");
  return lines.join("\n");
}

function importData(ref) {
  const data = JSON.parse(readFileSync(EXPORT_FILE, "utf8"));
  if (data.from === ref) throw new Error("書き出したのと同じプロジェクトには写せません。新しいプロジェクトの ID を入れてください");
  writeFileSync(SQL_FILE, buildSql(data));
  console.log(`${SQL_FILE} を作りました。新しいプロジェクト（${ref}）に流します…`);
  query(ref, ["--file", SQL_FILE]);
  // 入ったかを件数で確かめる
  const counts = query(ref, [TABLES.map((t) => `select '${t}' as t, count(*)::int as n from public.${t}`).join(" union all ")]);
  let ok = true;
  for (const { t, n } of counts) {
    const expected = data.rows[t].length;
    // 分類と設定は、マイグレーションが入れた行に上書きするので、前より多くてもよい
    const good = UPSERT_KEYS[t] ? n >= expected : n === expected;
    if (!good) ok = false;
    console.log(`${good ? "OK " : "NG "} ${t}: 前 ${expected}件 → 新しいほう ${n}件`);
  }
  if (!ok) {
    console.error("件数が合わない表があります。上の NG を確かめてください");
    process.exit(1);
  }
  console.log("すべて写せました");
}

const [command, ref] = process.argv.slice(2);
if (command === "sql") {
  // 流さずに SQL だけを作る（中身を確かめたいとき・手元で試すとき）
  writeFileSync(SQL_FILE, buildSql(JSON.parse(readFileSync(EXPORT_FILE, "utf8"))));
  console.log(`${SQL_FILE} を作りました`);
} else if (!ref || !/^[a-z0-9]{20}$/.test(ref)) {
  console.error("使い方：npm run move:export -- <今のプロジェクトID> ／ npm run move:import -- <新しいプロジェクトID>");
  process.exit(1);
} else if (command === "export") exportData(ref);
else if (command === "import") importData(ref);
else {
  console.error(`知らないコマンドです：${command}`);
  process.exit(1);
}
