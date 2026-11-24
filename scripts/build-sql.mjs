/**
 * supabase/migrations/ の SQL を古い順に1つにまとめて supabase/all.sql に書き出す。
 * Supabase の SQL Editor に貼り付けて、1回で反映するためのもの（docs/database.md 11章）。
 * 生成物なので Git には入れない。`npm run db:sql` で作り直す。
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../supabase/migrations/", import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = files
  .map((f) => `-- ===== ${f} =====\n\n${readFileSync(join(dir, f), "utf8").trim()}\n`)
  .join("\n");

const out = new URL("../supabase/all.sql", import.meta.url).pathname;
writeFileSync(out, `-- きんた 原価計算：データベースの作成（${files.length}ファイルをまとめたもの）\n-- 生成物。直さずに supabase/migrations/ を直して npm run db:sql で作り直す。\n\n${sql}`);
console.log(`supabase/all.sql を作りました（${files.length}ファイル・${sql.split("\n").length}行）`);
