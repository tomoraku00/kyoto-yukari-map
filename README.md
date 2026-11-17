# 京都 ゆかりマップ（完成版）

スマホで使う京都観光マップ。ビルド不要の静的サイトなので、フォルダごと置くだけで動きます。

## ファイル
| ファイル | 内容 |
|---|---|
| index.html | ページ本体 |
| app.js | アプリの動き（一覧・詳細・プラン・気になるリスト・コース案内） |
| data.js | スポット・プラン・仲間グループのデータ（**場所を増やすときはここだけ編集**） |
| style.css | 見た目 |
| vendor/ | 地図ライブラリ Leaflet 1.9.4 |
| manifest.webmanifest / sw.js / icon-* | ホーム画面に追加・電波が弱い場所でも開ける |

## 公開方法（GitHub Pages）
1. GitHubで新しいリポジトリを作る（例：kyoto-yukari-map、Public）
2. このフォルダの中身をすべてリポジトリ直下に置いてpush
3. リポジトリの Settings → Pages → Branch を `main` / `(root)` にして Save
4. 数分後に `https://<ユーザー名>.github.io/kyoto-yukari-map/` で開ける

※ 位置情報・共有メニュー・ホーム画面追加は https でのみ動きます（GitHub Pagesは https）。

## データの増やし方（data.js）
- `SPOTS` に1件追加：id（英数字・重複不可）、name、kana（よみ）、area（AREASのどれか）、genres（GENRESから）、era（ERASのk または null）、year、people（PEOPLEに登録した名前）、lat/lng、stay（滞在分）、short（1〜2行）、long（詳しい説明）、access、seasons（{春:'…'} など）、温泉なら onsen:true
- `PLANS` に追加：stops（3〜5か所のid＋一言note）、legs（区間の移動、stops数−1個）
- 全スポットが最低1つのプランに入るようにする（詳細画面の「ここから行くなら」が空にならないように）
- data.js を差し替えたら sw.js の `CACHE = "kyoto-map-v1"` の数字を1つ上げる（スマホに古いデータが残らないように）

## 地図について
地図画像は OpenStreetMap の公開タイルを使っています（個人利用の範囲）。
移動時間は直線距離からの目安で、正確な経路は各区間の「経路」ボタン（Googleマップ）で確認します。
