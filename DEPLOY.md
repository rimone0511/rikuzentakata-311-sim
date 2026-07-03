# 公開手順(ホームページ化)

ビルド不要の静的サイトなので、ファイル一式を置くだけで公開できる。
以下は無料の GitHub Pages を使う手順(ユーザー作業が必要な箇所に 👤 印)。

## 公開前チェック(重要)

- [ ] QUESTIONS.md の「表現の判断」を確認(注意書き文面・犠牲者数の表記)
- [ ] 👤 市・伝承施設(東日本大震災津波伝承館など)への事前相談を行うか判断
      (PLAN.md 設計思想。教育目的でも、地元への配慮として推奨)
- [ ] index.html のタイトルから「(開発版)」を外す

## GitHub Pages での公開手順

1. 👤 GitHub アカウントを作成(https://github.com — 無料)
2. 👤 新しいリポジトリを作成(例: `rikuzentakata-311-sim`、Public)
3. このプロジェクトを push:
   ```
   git remote add origin https://github.com/<ユーザー名>/rikuzentakata-311-sim.git
   git push -u origin main
   ```
4. 👤 リポジトリの Settings → Pages → Branch を `main` / `(root)` にして Save
5. 数分後、`https://<ユーザー名>.github.io/rikuzentakata-311-sim/` で公開される

※ tools/cache/ は .gitignore 済みなので push されない。assets/ の前処理済みデータは
リポジトリに含まれるため、閲覧者側でのデータ取得は発生しない(国土地理院・OSMの
サーバーに負荷をかけない)。

## 出典表示(公開時に必須)

開始画面に表示済み:
- 地形: 国土地理院 標高タイル(測量法に基づく出典明示)
- 地図データ: © OpenStreetMap contributors(ODbL)

## 代替手段

- Cloudflare Pages / Netlify(いずれもアカウント登録が必要、手順はほぼ同様)
- 自前のレンタルサーバーがあれば、プロジェクト一式をそのままアップロードでも可
