import * as THREE from 'three';

// ランドマーク(震災前の実在建物)の簡易3Dモデル生成。
// 実物写真は参照せず、公開資料の形状特徴の近似で構成する。
// Group原点は接地面の中心、+Yが上。

function group() {
  const g = new THREE.Group();
  return g;
}

function mesh(geo, color, x, y, z, ry = 0) {
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  if (ry) m.rotation.y = ry;
  return m;
}

// 1. 奇跡の一本松: 下2/3は枝の無いすらっとした幹、上部1/3に楕円状の樹冠
function buildIpponmatsu() {
  const g = group();
  const h = 27;
  const trunkH = h * 0.68;
  const crownH = h - trunkH;

  // 基壇(砂色)
  g.add(mesh(new THREE.CylinderGeometry(2, 2.2, 0.4, 12), 0xc9b98a, 0, 0.2, 0));

  // 幹(下が太く上が細い、明るめの茶)
  const trunk = mesh(
    new THREE.CylinderGeometry(0.35, 0.55, trunkH, 8),
    0x8a6a45,
    0, trunkH / 2, 0
  );
  g.add(trunk);

  // 樹冠(楕円状。球を縦につぶして表現、深緑)
  const crown = mesh(
    new THREE.SphereGeometry(2.6, 8, 6),
    0x33502f,
    0, trunkH + crownH * 0.45, 0
  );
  crown.scale.set(1, 1.5, 1);
  g.add(crown);

  return g;
}

// 2. 道の駅高田松原(タピック45): 大きく傾いた白い帆型の大屋根+RC打放し風の躯体
function buildTapic45() {
  const g = group();
  const w = 30, d = 18, wallH = 5;

  // 躯体(RC打放し風グレー)
  g.add(mesh(new THREE.BoxGeometry(w, wallH, d), 0x9a978f, 0, wallH / 2, 0));

  // 片流れの帆型大屋根(高い側12m、低い側は躯体上端付近から傾斜)。
  // 薄い箱を傾けて帆のテント屋根を近似。
  const roofLen = Math.sqrt(w * w + (12 - wallH) * (12 - wallH));
  const roof = mesh(
    new THREE.BoxGeometry(roofLen, 0.5, d + 1.5),
    0xefece2,
    0, (wallH + 12) / 2, 0
  );
  const angle = Math.atan2(12 - wallH, w);
  roof.rotation.z = angle;
  // 高い側をZ軸(奥)寄りに見せるため中心をややオフセット
  roof.position.x = 0;
  g.add(roof);

  return g;
}

// 3. 市民会館: 直方体本体+舞台部のフライタワー(後方に一段高い塔状ボリューム)
function buildShiminkaikan() {
  const g = group();
  const w = 40, d = 25, h = 12;

  g.add(mesh(new THREE.BoxGeometry(w, h, d), 0xcfc3a6, 0, h / 2, 0));

  // フライタワー(舞台部、後方寄りに+4m高い塔)
  const towerW = w * 0.35, towerD = d * 0.35, towerH = h + 4;
  g.add(mesh(
    new THREE.BoxGeometry(towerW, towerH, towerD),
    0xc2b596,
    0, towerH / 2, d / 2 - towerD / 2 - 1
  ));

  return g;
}

// 4. 市民体育館: かまぼこ型(半円筒)屋根+薄いグレーの壁
function buildTaiikukan() {
  const g = group();
  const w = 45, d = 30, wallH = 6;

  g.add(mesh(new THREE.BoxGeometry(w, wallH, d), 0xc4c6c8, 0, wallH / 2, 0));

  // 半円筒屋根(CylinderGeometryを横倒し、開始/終了角で半円に)
  const radius = d / 2;
  const roofGeo = new THREE.CylinderGeometry(radius, radius, w, 16, 1, false, 0, Math.PI);
  const roof = mesh(roofGeo, 0xa9c4bd, 0, wallH, 0);
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = Math.PI / 2;
  g.add(roof);

  return g;
}

// 5. 旧陸前高田市役所: 水平連続窓の帯+正面車寄せ(庇+柱2本)
function buildKyushiyakusho() {
  const g = group();
  const w = 35, d = 20, h = 12;

  g.add(mesh(new THREE.BoxGeometry(w, h, d), 0xb8b8b4, 0, h / 2, 0));

  // 水平連続窓(暗色の帯を各階に)
  const floors = 4;
  for (let i = 1; i <= floors; i++) {
    const y = (h / (floors + 1)) * i;
    g.add(mesh(new THREE.BoxGeometry(w + 0.1, 0.8, d + 0.1), 0x4a4d52, 0, y, 0));
  }

  // 車寄せ(庇)
  const canopyD = 4;
  g.add(mesh(new THREE.BoxGeometry(8, 0.4, canopyD), 0xa8a8a4, 0, 3.2, d / 2 + canopyD / 2));
  // 柱2本
  g.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 3, 8), 0x9a9a96, -3, 1.5, d / 2 + canopyD - 0.5));
  g.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 3, 8), 0x9a9a96, 3, 1.5, d / 2 + canopyD - 0.5));

  return g;
}

// 6. 旧JR陸前高田駅: 切妻屋根の平屋駅舎+横にプラットホーム
function buildEki() {
  const g = group();
  const w = 25, d = 10, wallH = 4;

  g.add(mesh(new THREE.BoxGeometry(w, wallH, d), 0xe8dfc4, 0, wallH / 2, 0));

  // 切妻屋根(三角柱をExtrudeで生成、青灰色)
  const roofOverhang = 0.8;
  const halfW = d / 2 + roofOverhang;
  const ridgeH = 6 - wallH;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, 0);
  shape.lineTo(0, ridgeH);
  shape.lineTo(halfW, 0);
  shape.lineTo(-halfW, 0);
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: w + roofOverhang * 2, bevelEnabled: false });
  roofGeo.translate(0, 0, -(w + roofOverhang * 2) / 2);
  const roof = mesh(roofGeo, 0x6d7c85, 0, wallH, 0);
  roof.rotation.y = Math.PI / 2;
  g.add(roof);

  // プラットホーム(低い細長い基壇)
  g.add(mesh(new THREE.BoxGeometry(30, 1, 3), 0x9a958a, 0, 0.5, d / 2 + 3));

  return g;
}

// 7. 気仙中学校: 長い直方体校舎+窓帯3列+屋上ペントハウス
function buildKesenchu() {
  const g = group();
  const w = 50, d = 15, h = 11;

  g.add(mesh(new THREE.BoxGeometry(w, h, d), 0xc9cbca, 0, h / 2, 0));

  // 窓帯3列
  const rows = 3;
  for (let i = 1; i <= rows; i++) {
    const y = (h / (rows + 1)) * i;
    g.add(mesh(new THREE.BoxGeometry(w + 0.1, 0.7, d + 0.1), 0x454850, 0, y, 0));
  }

  // 屋上ペントハウス
  g.add(mesh(new THREE.BoxGeometry(6, 2.2, 4), 0xb5b7b6, -w / 2 + 6, h + 1.1, 0));

  return g;
}

// 8. 陸前高田ユースホステル: 切妻屋根の素朴なロッジ風、2階建て
function buildYouth() {
  const g = group();
  const w = 25, d = 12, wallH = 5.5;

  g.add(mesh(new THREE.BoxGeometry(w, wallH, d), 0xdccdb0, 0, wallH / 2, 0));

  // 切妻屋根(三角柱、茶色)
  const roofOverhang = 0.6;
  const halfW = d / 2 + roofOverhang;
  const ridgeH = 8 - wallH;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, 0);
  shape.lineTo(0, ridgeH);
  shape.lineTo(halfW, 0);
  shape.lineTo(-halfW, 0);
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: w + roofOverhang * 2, bevelEnabled: false });
  roofGeo.translate(0, 0, -(w + roofOverhang * 2) / 2);
  const roof = mesh(roofGeo, 0x7a5a3d, 0, wallH, 0);
  roof.rotation.y = Math.PI / 2;
  g.add(roof);

  return g;
}

const BUILDERS = {
  ipponmatsu: buildIpponmatsu,
  tapic45: buildTapic45,
  shiminkaikan: buildShiminkaikan,
  taiikukan: buildTaiikukan,
  kyushiyakusho: buildKyushiyakusho,
  eki: buildEki,
  kesenchu: buildKesenchu,
  youth: buildYouth,
};

// key に対応するランドマークの3Dモデル(THREE.Group)を返す。未知のkeyはnull。
export function createLandmarkModel(key) {
  const builder = BUILDERS[key];
  if (!builder) return null;
  const g = builder();
  g.name = `landmark_${key}`;
  return g;
}
