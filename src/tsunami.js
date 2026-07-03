import * as THREE from 'three';

// 津波の時系列再現。
// 沿岸水位タイムラインは公開調査の代表値による近似(QUESTIONS.md 参照):
//   14:46 地震 / 〜15:20 引き波 / 15:26頃 防潮堤越流 / 15:32頃 最大水位(+14m級)
//   その後、第二波(16:10頃)・第三波(16:40頃)
// 内陸へは海からの距離に応じて遅延して伝わる(平地の遡上速度 約8m/s)。

const INLAND_SPEED = 8; // m/s

// [地震からの秒数, 沿岸水位 m(T.P.近似)]
const TIMELINE = [
  [0, 0],
  [900, -0.4],    // 15:01 引き波はじまり
  [2040, -1.0],   // 15:20 最大引き
  [2400, 6.0],    // 15:26 防潮堤越流
  [2760, 14.0],   // 15:32 第一波最大
  [3300, 8.0],    // 15:41
  [4000, 2.5],    // 15:52 引き
  [5040, 8.5],    // 16:10 第二波
  [5940, 3.0],    // 16:25
  [6840, 6.5],    // 16:40 第三波
  [8040, 2.0],    // 17:00
  [11640, 0.5],   // 18:00
];

// HUD 用のイベント(情報の再現。演出ではなく事実ベース)
export const EVENTS = [
  [0, '14:46 三陸沖を震源とする強い地震(揺れ 約3分)'],
  [180, '14:49 大津波警報発表(岩手県 予想高さ 3m)'],
  [1680, '15:14 予想高さ 6m に引き上げ'],
  [2040, '15:20 海面が大きく引いている'],
  [2400, '15:26 津波が防潮堤を越えはじめた'],
  [2760, '15:32 市街地に津波が到達・浸水拡大'],
  [5040, '16:10 第二波'],
  [6840, '16:40 第三波'],
];

export class Tsunami {
  constructor(terrain) {
    this.terrain = terrain;
    this.dist = this.#computeDistanceField(); // 海からの距離 [m]
    this.mesh = this.#buildWaterMesh();
    this.coastLevel = 0;
  }

  // 沿岸の水位 [m]
  levelAtCoast(t) {
    const tl = TIMELINE;
    if (t <= tl[0][0]) return tl[0][1];
    for (let i = 1; i < tl.length; i++) {
      if (t < tl[i][0]) {
        const [t0, v0] = tl[i - 1];
        const [t1, v1] = tl[i];
        return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
      }
    }
    return tl[tl.length - 1][1];
  }

  // 地点 (x,z) の水面高さ [m](海からの距離による遅延込み)
  waterLevelAt(x, z, t) {
    const d = this.#distAt(x, z);
    return this.levelAtCoast(t - d / INLAND_SPEED);
  }

  // 地点の浸水深 [m](0以下 = 浸水なし)
  depthAt(x, z, t) {
    return this.waterLevelAt(x, z, t) - this.terrain.heightAt(x, z);
  }

  // その地点で最終的に到達する最大浸水深 [m](結果表示用)
  maxDepthAt(x, z) {
    let maxLevel = -Infinity;
    for (const [, v] of TIMELINE) maxLevel = Math.max(maxLevel, v);
    return maxLevel - this.terrain.heightAt(x, z);
  }

  // 毎フレーム: 水面メッシュを現在時刻に合わせて変形
  update(t) {
    this.coastLevel = this.levelAtCoast(t);
    const pos = this.mesh.geometry.attributes.position;
    const { gh, delay } = this._grid;
    for (let i = 0; i < pos.count; i++) {
      const wl = this.levelAtCoast(t - delay[i]);
      // 水面が地面より低い場所は地面の少し下に隠す
      pos.setY(i, wl > gh[i] + 0.02 ? wl : gh[i] - 0.6);
    }
    pos.needsUpdate = true;
  }

  #distAt(x, z) {
    const t = this.terrain;
    const gx = Math.round(x / t.cell + (t.W - 1) / 2);
    const gz = Math.round(z / t.cell + (t.H - 1) / 2);
    const cx = Math.min(Math.max(gx, 0), t.W - 1);
    const cz = Math.min(Math.max(gz, 0), t.H - 1);
    return this.dist[cz * t.W + cx];
  }

  // 海(標高0m以下)からの距離場をBFSで前計算
  #computeDistanceField() {
    const t = this.terrain;
    const { W, H, cell } = t;
    const dist = new Float32Array(W * H).fill(Infinity);
    const qx = new Int32Array(W * H);
    const qz = new Int32Array(W * H);
    let head = 0, tail = 0;
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        if (t.heights[z * W + x] <= 0.0) {
          dist[z * W + x] = 0;
          qx[tail] = x; qz[tail] = z; tail++;
        }
      }
    }
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (head < tail) {
      const x = qx[head], z = qz[head];
      head++;
      const d = dist[z * W + x];
      for (const [dx, dz] of nb) {
        const nx2 = x + dx, nz2 = z + dz;
        if (nx2 < 0 || nz2 < 0 || nx2 >= W || nz2 >= H) continue;
        const idx = nz2 * W + nx2;
        if (dist[idx] === Infinity) {
          dist[idx] = d + cell;
          qx[tail] = nx2; qz[tail] = nz2; tail++;
        }
      }
    }
    return dist;
  }

  #buildWaterMesh() {
    const t = this.terrain;
    const W = 200; // 水面メッシュの分割数(地形より粗くて十分)
    const size = t.worldW;
    const geo = new THREE.PlaneGeometry(size, size, W, W);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({
      color: 0x2e4a5e,
      transparent: true,
      opacity: 0.88,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'tsunami';

    // 頂点ごとの地形高と伝播遅延は不変なので前計算しておく
    const pos = geo.attributes.position;
    const gh = new Float32Array(pos.count);
    const delay = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      gh[i] = this.terrain.heightAt(x, z);
      delay[i] = this.#distAt(x, z) / INLAND_SPEED;
    }
    this._grid = { W, gh, delay };
    return mesh;
  }
}
