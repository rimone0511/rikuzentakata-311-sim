import * as THREE from 'three';

// 地形: assets/terrain.bin(Float32 標高グリッド)からメッシュを生成する。
// ワールド座標: 原点=グリッド中心、X=東、Z=南、Y=標高[m]

export class Terrain {
  constructor(meta, heights) {
    this.meta = meta;
    this.heights = heights; // Float32Array, row-major, 北→南
    this.W = meta.width;
    this.H = meta.height;
    this.cell = meta.cell_m;
    this.worldW = (this.W - 1) * this.cell;
    this.worldH = (this.H - 1) * this.cell;
    this.mesh = this.#buildMesh();
  }

  static async load(baseUrl = './assets') {
    const meta = await (await fetch(`${baseUrl}/terrain_meta.json`)).json();
    const buf = await (await fetch(`${baseUrl}/terrain.bin`)).arrayBuffer();
    return new Terrain(meta, new Float32Array(buf));
  }

  // 標高 [m]。範囲外は端の値。バイリニア補間
  heightAt(x, z) {
    const fx = x / this.cell + (this.W - 1) / 2;
    const fz = z / this.cell + (this.H - 1) / 2;
    const cx = Math.min(Math.max(fx, 0), this.W - 1.001);
    const cz = Math.min(Math.max(fz, 0), this.H - 1.001);
    const x0 = Math.floor(cx), z0 = Math.floor(cz);
    const tx = cx - x0, tz = cz - z0;
    const h = this.heights;
    const w = this.W;
    const h00 = h[z0 * w + x0], h10 = h[z0 * w + x0 + 1];
    const h01 = h[(z0 + 1) * w + x0], h11 = h[(z0 + 1) * w + x0 + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  // 緯度経度 → ワールドXZ(メルカトルY方向は線形補間で十分な狭域)
  latLonToWorld(lat, lon) {
    const m = this.meta;
    const mercY = (d) => Math.asinh(Math.tan(d * Math.PI / 180));
    const u = (lon - m.lon_nw) / (m.lon_se - m.lon_nw);
    const v = (mercY(m.lat_nw) - mercY(lat)) / (mercY(m.lat_nw) - mercY(m.lat_se));
    return {
      x: (u - 0.5) * this.W * this.cell,
      z: (v - 0.5) * this.H * this.cell,
    };
  }

  #buildMesh() {
    const { W, H, cell } = this;
    const geo = new THREE.PlaneGeometry(this.worldW, this.worldH, W - 1, H - 1);
    geo.rotateX(-Math.PI / 2); // 平面の上端(北)が -Z を向く

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = this.heights[i];
      pos.setY(i, y);
      this.#elevColor(y, c);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';
    return mesh;
  }

  // 標高に応じた地表色(ジオラマ風の落ち着いた色)
  #elevColor(y, out) {
    if (y <= 0.2) out.set(0xb8a888);        // 砂浜・干潟
    else if (y < 4) out.set(0xa8a396);      // 低地(市街地の地面)
    else if (y < 25) out.set(0x8f9478);     // 平地〜宅地の緑
    else if (y < 80) out.set(0x5f7a4e);     // 山林(低)
    else if (y < 200) out.set(0x4d6743);    // 山林(高)
    else out.set(0x5c6357);                 // 高所
  }
}

// 海面(津波実装までの仮の静的な海)
export function createSea(size) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 2, size * 2),
    new THREE.MeshLambertMaterial({ color: 0x3a5a74, transparent: true, opacity: 0.92 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  mesh.name = 'sea';
  return mesh;
}
