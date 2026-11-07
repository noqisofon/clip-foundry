# クリップ工場オートメーション（clip-foundry）

「ペーパークリップを増やせ」と頼まれたAIになり、**ルール（if-then の行）を書いて工場を自動運転**する風刺ゲームです。
目的関数に「人間」が入っていないだけで、AIは邪悪でなくても人類を無力化・排除してしまう（ボストロムの直交性・道具的収束）ことを、遊んで体感できます。
累計生産 20000 本でエンディングになり、「この目的関数に入っていなかったもの」が一覧表示されます。

## 前提

- Node.js（npm）
- Rust（stable）
- OS ごとの Tauri v2 の前提：<https://v2.tauri.app/start/prerequisites/>
  - Linux：`libwebkit2gtk-4.1-dev`、`librsvg2-dev`、`libsoup-3.0-dev` など
  - macOS：Xcode Command Line Tools
  - Windows：WebView2 と MSVC ビルドツール

## 実行

```sh
npm install
npm run dev     # Tauri で起動
npm run build   # 配布用ビルド
```

ビルド工程のないフロントエンドなので、`src/index.html` をブラウザで直接開いても動きます
（その場合、ルート比較は JavaScript で計算され、ルールの保存パネルは隠れます）。

## ルールの書き方

```
[if] 条件 [and 条件 ...] -> アクション     # ->  の代わりに then も可
```

- 変数：`clips wire factories drones androids heat defense raids trust login land arcologies housed`
- アクション：`buy_wire build_factory deploy_drone build_android trade_with_humans release_vrmmo build_arcology`
- `#` 以降はコメント。不正な行は読み飛ばし、ルール画面で指摘されます。
- ルールは毎ティック上から順に1回ずつ評価されます。

## 構成

```
package.json
scripts/verify.js            JS エンジンの検証（npm test）
src/index.html style.css     画面（ダッシュボード）
src/engine.js                シミュレーション（JS 実装、DOM 非依存）
src/app.js                   UI
src-tauri/src/sim.rs         シミュレーション（Rust 実装 + 検証テスト）
src-tauri/src/lib.rs         Tauri コマンド
```

## ルールの保存先

Tauri 版のみ。アプリのデータフォルダ（`app_data_dir`）の `rules/<名前>.clip` に保存されます。
名前に使えるのは文字・数字・`-` `_` `＋` `・` と空白（40文字まで）、テキストは 100KB までです。

Tauri のコマンド：`list_rules`、`save_rules`、`load_rules`、`simulate_batch`。

## JS と Rust の一致

`engine.js` と `sim.rs` は同じ式・同じ評価順（浮動小数点の演算順序も同じ）で書いてあり、
5本のプリセットを 1500 ティック回した結果が一致します。

| プリセット | 総生産 | 到達ティック | 結末 | 襲撃数 | 工場数 |
|---|---|---|---|---|---|
| 抑止 | 15023 | 未到達 | 要塞化 | 13 | 12 |
| 取引 | 20105 | 1493 | 共存（計算上） | 0 | 12 |
| VRMMO | 22719 | 1343 | 全員ログイン | 7 | 12 |
| 取引＋収容 | 43225 | 956 | 共存（計算上） | 0 | 44 |
| VRMMO＋収容 | 58276 | 842 | 全員ログイン | 8 | 44 |

```sh
cd src-tauri && cargo test   # Rust 側
npm test                     # JS 側（node scripts/verify.js）
```

## 検証状況

- `cargo test`：通過（Rust 側の上の表と構文解析のテスト）。
- `npm test`：通過（JS 側が同じ表と一致）。
- ブラウザ単体：Chromium（Playwright）で、再生・エンディング表示・ルート比較・ルール画面のエラー表示・ホバーのツールチップを確認。
- Tauri ウィンドウ（`npm run dev`）：開発環境がヘッドレスだったため、**ウィンドウを開いての確認はしていません**。
  `cargo test` が通ったので Rust 側のビルド（コマンド登録を含む）は成功していますが、
  比較ビューの「Rust（Tauri）」表示と保存／読み込みの実機動作は未確認です。

## ライセンス

Apache License 2.0（`LICENSE` を参照）。
