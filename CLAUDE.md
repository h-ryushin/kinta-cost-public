@AGENTS.md

# きんた 原価計算アプリ

焼肉店「きんた」の材料原価とメニュー原価を計算するWebアプリ。要件は `要件定義書.md` を参照。

作業を始める前に、次の3つを必ず読む。

@docs/conventions.md
@docs/decisions.md
@docs/progress.md

## 作業のルール

- **`main` に直接コミット・push しない。** 作業は `develop` ブランチで行う。`main` は Cloudflare に自動でデプロイされる公開中のアプリなので、オーナーが「公開して」と承認したときだけ `develop` を取り込む（D-049）。

- 何かを決めたり、要件定義書と違うことをしたりしたら、`docs/decisions.md` に番号つきで追記する。
- 作業が一区切りしたら、`docs/progress.md` の一番上に、やったことと残りを追記する。
- `AGENTS.md` は `next dev` が自動で書き直すファイルなので、編集しない。
- データベースを変えるときは `docs/database.md` も直し、`npm run test:db` を通す。
- 確認コマンド：`npm run check`（型チェック・lint・テスト）、`npm run test:db`（データベースの権限）、`npm run dev`（http://localhost:3000）
