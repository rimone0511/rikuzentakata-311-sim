# 設計書(ARCHITECTURE.md)

このファイルは「コードを変更する前に読む地図」。各モジュールの責務・データの流れ・
壊しやすいポイントをまとめる。表現上の約束(倫理ルール)は PLAN.md と CLAUDE.md が正。

## 全体像

```
index.html(HUD の DOM + importmap)
└─ src/main.js(組み立て・メインループ・白転/結び演出)
   ├─ terrain.js   地形。assets/terrain.bin から標高グリッドを読みメッシュ化
   ├─ buildings.js 道路帯 + 手続き生成の家屋(InstancedMesh)+ ランドマーク配置 + 衝突判定
   ├─ landmarks3d.js ランドマーク個別のローポリ3Dモデル(key で分岐)
   ├─ player.js    WASD+マウス操作、一人称/三人称(V)、傾斜・浸水減速
   ├─ tsunami.js   津波の時系列水位 + 海からの距離場(BFS)で内陸遅延を計算
   ├─ npc.js       合成キャラ40体の行動状態機械(5類型)
   └─ audio.js     Web Audio 合成音(地鳴り・チャイム・サイレン・波音)
```

依存方向は main → 各モジュール、npc → (terrain, town, tsunami)、
tsunami → terrain、buildings → (terrain, landmarks3d)、player → (terrain, town)。
モジュール間の循環依存はない。維持すること。

## 時間の定義(最重要)

- `simTime` = 地震発生(14:46:00)からの経過秒。main.js が唯一の持ち主
- 表示時刻 = 14:46:00 + simTime(main.js の formatClock)
- 倍速(timeScale)対応のため、player は 0.05 秒、npc は 0.1 秒(SUBSTEP)に
  内部分割して更新する。**倍速時の移動距離が実時間と一致することが不変条件**
- 主要な時刻(秒): 180=揺れ終了・大津波警報 / 2040=最大引き波 / 2400=防潮堤越流 /
  2760=第一波最大 / 5040=第二波 / 6840=第三波 / 7200=生存エンディング判定

## 座標系(CLAUDE.md と同じ。全モジュール共通)

- メートル単位。原点=地形グリッド中心。X=東、Z=南、Y=標高(T.P.)
- 緯度経度→ワールドは `terrain.latLonToWorld(lat, lon)` を必ず使う(自前計算しない)
- 地面の高さは `terrain.heightAt(x, z)`(バイリニア補間、範囲外は端の値)
- プレイヤーの yaw=0 は北(-Z)向き。NPC の heading=0 は +X 向きで**規約が違う**ので注意

## 津波の仕組み(tsunami.js)

1. `TIMELINE` = [秒, 沿岸水位m] の折れ線。公開調査の代表値による近似(QUESTIONS.md)
2. 内陸へは「海(標高0m以下)からの距離 ÷ 8m/s」だけ遅延して同じ水位が届く
   - 距離場は起動時に BFS で1回だけ前計算(#computeDistanceField)
3. 判定 API: `waterLevelAt(x,z,t)`(水面標高) / `depthAt(x,z,t)`(浸水深=水面−地面)
- 白転条件(main.js): depth > 0.3m かつ 水面標高 > 1.0m。
  **後者を消すと平常の海や川に入っただけで白転する**(過去に踏んだ落とし穴)
- 水面メッシュは 200×200 分割で、各頂点の地形高と遅延を前計算済み(this._grid)。
  TIMELINE を変えても再計算は不要だが、地形データを差し替えたら全て作り直しになる

## NPC の仕組み(npc.js)

- 5類型: flee_soon(すぐ逃げる)/ ignore(本気にしない)/ watch_sea(海を見に行く)/
  flee_late(第一波後に慌てる)/ return_back(引き返す)。比率は TYPE_RATIOS
- 状態: idle / walk_goal / wander / walk_shore / return / flee(#updateBehavior が遷移、
  #updateMovement が移動)。経路探索はなく「目標へ直進+詰まったら±45〜90°迂回」
- 被災 = 浸水深 0.5m 超。演出なしで 3 秒かけて静かに沈んで消える(#updateSinking)。
  避難完了 = 標高 20m 到達。統計は内部値のみで**画面に表示しない**(スコア禁止のため)
- 生成は mulberry32(固定シード) で**毎回同じ配置・同じ性格**になる(検証可能性のため)。
  `Math.random()` を生成処理に混ぜないこと(迂回方向など見た目だけの箇所は使用可)

## 建物と衝突(buildings.js)

- 家屋は道路沿いの手続き生成(実配置ではない)。道路 id をシードに決定的
- 衝突は `town.resolveCollision(x, z, r)` に一本化(プレイヤー・NPC 共用)。
  回転付き AABB に対する押し戻し。colliders 配列は線形走査なので
  **建物を大幅に増やすなら空間ハッシュ化が必要**(現状 grid は配置間隔チェック専用)
- ランドマークは assets/landmarks_manual.json(lat/lon/寸法) + landmarks3d.js のモデル。
  モデル未定義の key は自動で箱になる。追加手順: JSON に1件追加 →
  landmarks3d.js に buildXxx() を書き createLandmarkModel の分岐に登録

## アセット(assets/。すべて tools/ の Python で生成)

| ファイル | 中身 | 生成スクリプト |
|---|---|---|
| terrain.bin / terrain_meta.json | Float32 標高グリッド(row-major、北→南)+ 範囲メタ | fetch_dem.py |
| roads.json | 道路網(class と [lat,lon] 列)。2011年時点の OSM | fetch_osm_2011.py |
| landmarks_manual.json | ランドマーク定義(手入力) | — |
| ortho.jpg / ortho_meta.json | 震災前の空中写真(工程13で地形に貼る予定) | fetch_ortho.py |

- 読み込みは全て `cache: 'no-cache'`(開発時の古いキャッシュ対策)。維持すること
- Node.js は無い環境。ツールは Python 3.11 標準ライブラリのみで書く

## 変更時のチェック早見

- スタート地点の追加 → main.js の START_POINTS に1行(lat/lon/yaw)
- 津波の時刻・水位調整 → tsunami.js の TIMELINE と EVENTS を両方直す(片方だけだと
  HUD の表示と実際の水位がズレる)
- 動作確認はブラウザのコンソールで `__sim` を使う(simTime を直接進められる。
  例: `__sim.simTime = 2700` で第一波直前へ)
- 変更後の検証は .claude/skills/sim-review の観点表に従う

## 既知の近似・未解決(詳細は QUESTIONS.md)

- 現在の地形データは嵩上げ工事後のもので、震災前地形は近似補正
- 津波時系列は公開報告の代表値(地点別の精密値ではない)
- 犠牲者数「1,700人以上」の表記は公開前に要再確認
