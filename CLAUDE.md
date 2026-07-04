# 陸前高田 3.11 津波避難シミュレーション

防災教育のためのブラウザ3Dシミュレーション。2011年3月11日の陸前高田市街地で、
地震発生(14:46)から津波到達までの避難を追体験する。詳細な設計思想と工程は PLAN.md を参照。

## 技術構成

- ビルド不要の静的サイト。Three.js は index.html の importmap で CDN から読み込む
- Node.js は環境に無い。ツール類はすべて Python 3.11(標準ライブラリのみ)
- 開発サーバー: `python -m http.server 8000` (`.claude/launch.json` に定義済み)

## ディレクトリ

- `index.html` — エントリ。importmap と HUD の DOM
- `src/` — ES modules(main.js / terrain.js / buildings.js / landmarks3d.js / player.js / tsunami.js / npc.js / audio.js)。
  各モジュールの責務・データの流れ・壊しやすい箇所は ARCHITECTURE.md を参照(変更前に読む)
- `assets/` — 前処理済みデータ(地形バイナリ、道路 JSON など)。git 管理する
- `tools/` — Python のデータ取得・前処理スクリプト。生成物は assets/ に出力
- `tools/cache/` — ダウンロードした生タイル等のキャッシュ(git 管理外)

## データの出自(必ず合法・公開のものを使う)

- 地形: 国土地理院 標高タイル(https://cyberjapandata.gsi.go.jp/xyz/dem5a/ 等)。出典明記が必要
- 道路網: OpenStreetMap(Overpass API、ODbL)。出典明記が必要
- 津波時系列: 公開された調査報告(到達時刻・浸水深)に基づく近似

## 座標系

- ワールド座標はメートル単位。原点 = 対象領域の中心(terrain_meta.json の origin)
- X=東、Z=南(緯度経度→ローカル平面近似)。Y=標高(T.P. 基準)

## 表現上の約束(PLAN.md の設計思想を厳守)

- ゲームオーバー演出なし。波に追いつかれたら白転+事実の表示のみ
- スコア・ランキング・煽り演出なし
- 実在個人の再現なし(匿名の合成キャラクターのみ)
