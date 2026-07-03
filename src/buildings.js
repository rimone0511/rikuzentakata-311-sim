import * as THREE from 'three';
import { createLandmarkModel } from './landmarks3d.js';

// 道路網の描画と、道路沿いへの簡易建物(箱)の手続き生成。
// 建物は震災前の実配置データではなく骨格表現(フェーズ2で改善)。

const ROAD_WIDTH = {
  trunk: 9, primary: 8, secondary: 7, tertiary: 6,
  unclassified: 5, residential: 4.5, service: 3, track: 2.5,
};

// 建物を生成する道路種別
const BUILDING_ROADS = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential']);

// 決定的な乱数(配置を毎回同じにする)
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Town {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'town';
    // 衝突判定用: {x, z, rot, hw, hd, top}
    this.colliders = [];
    this.grid = new Map(); // 空間ハッシュ(セル20m)
  }

  static async build(terrain, baseUrl = './assets') {
    const town = new Town(terrain);
    const roadsData = await (await fetch(`${baseUrl}/roads.json`, { cache: 'no-cache' })).json();
    const manual = await (await fetch(`${baseUrl}/landmarks_manual.json`, { cache: 'no-cache' })).json();
    town.#buildRoads(roadsData.roads);
    town.#buildHouses(roadsData.roads);
    town.#buildLandmarks(manual.landmarks);
    return town;
  }

  // ---- 道路(地形に沿った帯) ----
  #buildRoads(roads) {
    const positions = [];
    const indices = [];
    const t = this.terrain;
    const lift = 0.25; // 地形へのめり込み防止

    for (const road of roads) {
      const w = (ROAD_WIDTH[road.class] ?? 4) / 2;
      const pts = road.pts.map(([lat, lon]) => {
        const p = t.latLonToWorld(lat, lon);
        return new THREE.Vector3(p.x, 0, p.z);
      });
      if (pts.length < 2) continue;

      const base = positions.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const dir = new THREE.Vector3();
        if (i === 0) dir.subVectors(pts[1], pts[0]);
        else if (i === pts.length - 1) dir.subVectors(pts[i], pts[i - 1]);
        else dir.subVectors(pts[i + 1], pts[i - 1]);
        dir.y = 0;
        if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
        dir.normalize();
        const nx = -dir.z, nz = dir.x; // 左法線
        const p = pts[i];
        const yL = t.heightAt(p.x + nx * w, p.z + nz * w) + lift;
        const yR = t.heightAt(p.x - nx * w, p.z - nz * w) + lift;
        positions.push(p.x + nx * w, yL, p.z + nz * w);
        positions.push(p.x - nx * w, yR, p.z - nz * w);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = base + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x63605c }));
    mesh.name = 'roads';
    this.group.add(mesh);
  }

  // ---- 簡易建物 ----
  #buildHouses(roads) {
    const t = this.terrain;
    const placed = [];
    const cell = 20;
    const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    const canPlace = (x, z, minDist) => {
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = this.grid.get(`${cx + dx},${cz + dz}`);
          if (!list) continue;
          for (const p of list) {
            const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
            if (d2 < minDist * minDist) return false;
          }
        }
      }
      return true;
    };
    const register = (x, z) => {
      const k = key(x, z);
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push({ x, z });
    };

    for (const road of roads) {
      if (!BUILDING_ROADS.has(road.class)) continue;
      const rand = mulberry32(road.id % 2147483647);
      const roadW = (ROAD_WIDTH[road.class] ?? 4) / 2;

      const pts = road.pts.map(([lat, lon]) => t.latLonToWorld(lat, lon));
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i].x, az = pts[i].z;
        const bx = pts[i + 1].x, bz = pts[i + 1].z;
        const segLen = Math.hypot(bx - ax, bz - az);
        if (segLen < 4) continue;
        const dx = (bx - ax) / segLen, dz = (bz - az) / segLen;
        const nx = -dz, nz = dx;
        const rot = Math.atan2(dx, dz); // Z軸基準の向き

        const interval = 16 + rand() * 8;
        for (let s = interval / 2; s < segLen; s += interval) {
          for (const side of [1, -1]) {
            if (rand() < 0.25) continue; // 空き地
            const bw = 7 + rand() * 5;   // 間口
            const bd = 6 + rand() * 4;   // 奥行
            const bh = rand() < 0.75 ? 3.5 + rand() * 3 : 7 + rand() * 3; // 平屋〜3階
            const off = roadW + bd / 2 + 1.5 + rand() * 2;
            const x = ax + dx * s + nx * off * side;
            const z = az + dz * s + nz * off * side;

            const hRoad = t.heightAt(ax + dx * s, az + dz * s);
            const hHere = t.heightAt(x, z);
            if (hHere < 0.8 || hHere > 30) continue;       // 海・川・山を避ける
            if (Math.abs(hHere - hRoad) > 3) continue;      // 崖ぎわを避ける
            if (!canPlace(x, z, 8)) continue;

            placed.push({ x, z, y: hHere, w: bw, d: bd, h: bh, rot, rand: rand() });
            register(x, z);
          }
        }
      }
    }

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial();
    const inst = new THREE.InstancedMesh(geo, mat, placed.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    // 落ち着いた家屋の色(ジオラマ風)
    const palette = [0xcfc8b8, 0xbfb6a4, 0xd8d2c4, 0xb0a898, 0xc4bdae, 0x9fa5ad, 0xb5aa9a];

    placed.forEach((b, i) => {
      q.setFromAxisAngle(up, b.rot);
      m.compose(
        new THREE.Vector3(b.x, b.y + b.h / 2 - 0.2, b.z),
        q,
        new THREE.Vector3(b.w, b.h, b.d)
      );
      inst.setMatrixAt(i, m);
      color.set(palette[Math.floor(b.rand * palette.length)]);
      inst.setColorAt(i, color);
      this.colliders.push({
        x: b.x, z: b.z, rot: b.rot,
        hw: b.w / 2, hd: b.d / 2, top: b.y + b.h,
      });
    });
    inst.name = 'houses';
    this.group.add(inst);
    this.count = placed.length;
  }

  // ---- ランドマーク(個別3Dモデル+ラベル。モデル未定義なら箱) ----
  #buildLandmarks(landmarks) {
    const t = this.terrain;
    this.landmarks = [];
    for (const lm of landmarks) {
      const p = t.latLonToWorld(lm.lat, lm.lon);
      const y = t.heightAt(p.x, p.z);
      const model = createLandmarkModel(lm.key);
      if (model) {
        model.position.set(p.x, y, p.z);
        this.group.add(model);
      } else {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(lm.w, lm.h, lm.d),
          new THREE.MeshLambertMaterial({ color: parseInt(lm.color, 16) })
        );
        mesh.position.set(p.x, y + lm.h / 2, p.z);
        this.group.add(mesh);
      }
      this.group.add(makeLabel(lm.name, p.x, y + lm.h + 12, p.z));
      this.colliders.push({ x: p.x, z: p.z, rot: 0, hw: lm.w / 2, hd: lm.d / 2, top: y + lm.h });
      this.landmarks.push({ ...lm, x: p.x, z: p.z, y });
    }
  }

  // プレイヤー(半径r の円)と建物の衝突。めり込みを押し戻した座標を返す
  resolveCollision(x, z, r) {
    let px = x, pz = z;
    for (const c of this.colliders) {
      // 粗い距離チェック
      if (Math.abs(c.x - px) > c.hw + c.hd + r + 2 || Math.abs(c.z - pz) > c.hw + c.hd + r + 2) continue;
      // 建物ローカル座標へ(Y軸回転 rot の逆変換)
      const cos = Math.cos(c.rot), sin = Math.sin(c.rot);
      const dx = px - c.x, dz = pz - c.z;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      const ox = c.hw + r - Math.abs(lx);
      const oz = c.hd + r - Math.abs(lz);
      if (ox > 0 && oz > 0) {
        // 浅い方の軸へ押し出す
        let mx = 0, mz = 0;
        if (ox < oz) mx = ox * Math.sign(lx || 1);
        else mz = oz * Math.sign(lz || 1);
        // ローカル → ワールド(Y軸回転 rot)
        px += mx * cos + mz * sin;
        pz += -mx * sin + mz * cos;
      }
    }
    return { x: px, z: pz };
  }
}

function makeLabel(text, x, y, z) {
  const pad = 8;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 28px "Yu Gothic UI", sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  canvas.width = w;
  canvas.height = 44;
  ctx.font = 'bold 28px "Yu Gothic UI", sans-serif';
  ctx.fillStyle = 'rgba(20,20,24,0.65)';
  ctx.fillRect(0, 0, w, 44);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, 23);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  const scale = 0.35;
  sprite.scale.set(w * scale, 44 * scale, 1);
  sprite.position.set(x, y, z);
  return sprite;
}
