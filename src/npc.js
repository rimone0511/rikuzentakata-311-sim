import * as THREE from 'three';

// NPC(避難する住民)の生成と行動シミュレーション。
// PLAN.md 工程9: 公開された避難行動調査に基づく5類型の「匿名の合成キャラクター」。
// 実在個人の再現はしない。被災表現は静かに(フェードアウトのみ、演出なし)。

// 決定的な乱数(buildings.js と同じ mulberry32)
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NPC_COUNT = 40;
const RADIUS = 0.4;          // 衝突半径(プレイヤーと同じ)
const EVAC_HEIGHT = 20;      // この標高に達したら避難完了とみなす
const SUBSTEP = 0.1;         // update() 内部の最大分割幅(秒)
const COLLISION_INTERVAL = 0.2; // 衝突判定の間隔(秒)
const STUCK_CHECK = 0.5;     // 詰まり判定の間隔(秒)
const STUCK_DIST = 0.3;      // この距離未満しか動けなければ迂回
const SINK_DURATION = 3.0;   // 被災後、消えるまでの時間(秒)
const CATCH_DEPTH = 0.5;     // この浸水深で被災とみなす

// spawn候補地(周辺半径300mにランダム散布)
const SPAWN_AREAS = [
  { name: '旧駅前', lat: 39.0155, lon: 141.6250 },
  { name: '旧市役所', lat: 39.0163, lon: 141.6290 },
  { name: '市民会館', lat: 39.0175, lon: 141.6297 },
  { name: '今泉', lat: 39.0060, lon: 141.6150 },
  { name: '松原', lat: 39.0035, lon: 141.6252 },
];
const SPAWN_RADIUS = 300; // m

// 高台の目標点(最寄りを選ぶ)
const HIGH_GROUND = [
  { name: '本丸公園', lat: 39.0190, lon: 141.6291 },
  { name: '西の山裾', lat: 39.0075, lon: 141.6085 },
  { name: '東の高台', lat: 39.0204, lon: 141.6332 },
];

// 服の色パレット(くすんだ色数色)
const CLOTH_COLORS = [0x5a6b57, 0x6b5a4a, 0x4a5568, 0x7a6a55, 0x5a4a5a, 0x6a6a4a];

// 行動類型(比率)
const TYPE_RATIOS = [
  ['flee_soon', 0.25],     // 1. すぐ逃げる
  ['ignore', 0.25],        // 2. 本気にしない
  ['watch_sea', 0.15],     // 3. 海を見に行く
  ['flee_late', 0.20],     // 4. 第一波後に慌てて逃げる
  ['return_back', 0.15],   // 5. 引き返す
];

function pickType(rand) {
  const r = rand();
  let acc = 0;
  for (const [type, ratio] of TYPE_RATIOS) {
    acc += ratio;
    if (r < acc) return type;
  }
  return TYPE_RATIOS[TYPE_RATIOS.length - 1][0];
}

export class NPCManager {
  constructor(terrain, town, tsunami) {
    this.terrain = terrain;
    this.town = town;
    this.tsunami = tsunami;

    this.group = new THREE.Group();
    this.group.name = 'npcs';

    // 見た目はプレイヤーの #makeAvatar と同構造。ジオメトリ/頭マテリアルは共有する。
    this._bodyGeo = new THREE.CapsuleGeometry(0.28, 0.85, 4, 8);
    this._headGeo = new THREE.SphereGeometry(0.16, 12, 10);
    this._headMat = new THREE.MeshLambertMaterial({ color: 0xd8b89a });
    this._clothMats = CLOTH_COLORS.map((c) => new THREE.MeshLambertMaterial({ color: c }));

    // 高台の候補をワールド座標へ変換
    this._highGround = HIGH_GROUND.map((h) => {
      const p = terrain.latLonToWorld(h.lat, h.lon);
      return { name: h.name, x: p.x, z: p.z };
    });

    this._stats = { total: 0, evacuated: 0, caught: 0 };
    this._npcs = [];

    this.#spawnAll();
  }

  get stats() {
    return { ...this._stats };
  }

  // ---- 生成 ----
  #spawnAll() {
    const rand = mulberry32(0x9e3779b9);
    const t = this.terrain;

    for (let i = 0; i < NPC_COUNT; i++) {
      // spawnエリアを順繰りに選び偏りを抑える(決定的)
      const area = SPAWN_AREAS[i % SPAWN_AREAS.length];
      const base = t.latLonToWorld(area.lat, area.lon);

      // 半径300m以内にランダム散布(円内一様分布)
      const ang = rand() * Math.PI * 2;
      const rad = Math.sqrt(rand()) * SPAWN_RADIUS;
      let x = base.x + Math.cos(ang) * rad;
      let z = base.z + Math.sin(ang) * rad;

      // 標高1〜5mの低地に収まるよう軽く探索(見つからなければそのまま使う)
      let y = t.heightAt(x, z);
      let tries = 0;
      while ((y < 1 || y > 5) && tries < 12) {
        const a2 = rand() * Math.PI * 2;
        const r2 = Math.sqrt(rand()) * SPAWN_RADIUS;
        x = base.x + Math.cos(a2) * r2;
        z = base.z + Math.sin(a2) * r2;
        y = t.heightAt(x, z);
        tries++;
      }
      // 建物の中にめり込まないよう補正
      const resolved = this.town.resolveCollision(x, z, RADIUS);
      x = resolved.x; z = resolved.z;
      y = t.heightAt(x, z);

      const type = pickType(rand);
      const walkSpeed = 1.0 + rand() * 0.3;
      const runSpeed = 2.2 + rand() * 0.6;
      const clothMat = this._clothMats[Math.floor(rand() * this._clothMats.length)];

      // 最寄りの高台を選ぶ
      const goal = this.#nearestHighGround(x, z);

      const npc = {
        id: i,
        type,
        walkSpeed,
        runSpeed,
        pos: new THREE.Vector3(x, y, z),
        heading: rand() * Math.PI * 2, // 現在の進行方位(ラジアン、0=+X)
        state: 'idle',          // idle / walk_goal / wander / walk_shore / return / flee
        goal,                    // 現在向かっている目標点 {x,z}
        phaseTimer: 0,            // 行動フェーズ内の経過時間
        detourTimer: 0,           // 迂回方向を保持する時間
        detourAngle: 0,
        stuckPos: new THREE.Vector2(x, z),
        stuckTimer: 0,
        collisionTimer: rand() * COLLISION_INTERVAL, // 位相をずらして負荷分散
        evacuated: false,
        caught: false,
        sinking: false,
        sinkTimer: 0,
        // 行動類型ごとの個体差タイミング(基準値に個体差を加える)
        t1: 0, t2: 0,
        flag: rand() < 0.5, // ignoreタイプ: 15:20に走り出すか/最後まで留まるか の半々判定などに使う
        mesh: null,
      };

      // 類型別の初期タイミング
      switch (type) {
        case 'flee_soon':
          npc.t1 = 120 + rand() * 180; // 120〜300秒
          npc.state = 'idle';
          break;
        case 'ignore':
          npc.state = 'wander';
          npc.wanderTarget = null;
          break;
        case 'watch_sea': {
          npc.t1 = 300 + rand() * 600; // 300〜900秒: 海へ向かう
          npc.state = 'idle';
          // 海岸方向の目標(スポーン地点から見て南=+Z寄りの浜、標高0.3m付近を目安に少し先へ)
          const dir = new THREE.Vector3(0, 0, 1); // 大まかに南(海)方向
          npc.shoreGoal = { x: x + dir.x * 250, z: z + dir.z * 250 };
          break;
        }
        case 'flee_late':
          npc.state = 'idle'; // 浸水検知 or 2400秒で起動
          break;
        case 'return_back':
          npc.state = 'walk_goal'; // 最初は高台へ
          npc.t1 = 600 + rand() * 600;  // 600〜1200秒で反転
          npc.homeSpot = { x, z };       // 戻る先(元の場所付近)
          break;
      }

      npc.mesh = this.#makeAvatar(clothMat);
      npc.mesh.position.set(x, y, z);
      this.group.add(npc.mesh);

      this._npcs.push(npc);
    }

    this._stats.total = this._npcs.length;
  }

  #makeAvatar(clothMat) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this._bodyGeo, clothMat);
    body.position.y = 0.85;
    const head = new THREE.Mesh(this._headGeo, this._headMat);
    head.position.y = 1.55;
    g.add(body, head);
    return g;
  }

  #nearestHighGround(x, z) {
    let best = this._highGround[0];
    let bestD = Infinity;
    for (const h of this._highGround) {
      const d = (h.x - x) ** 2 + (h.z - z) ** 2;
      if (d < bestD) { bestD = d; best = h; }
    }
    return { x: best.x, z: best.z };
  }

  // ---- 毎フレーム更新 ----
  update(simTime, dt) {
    if (dt <= 0) return;
    // 大きな dt(倍速時)は内部で細かく分割する
    let remain = dt;
    while (remain > 0) {
      const step = Math.min(remain, SUBSTEP);
      this.#updateStep(simTime - remain + step, step);
      remain -= step;
    }
  }

  #updateStep(simTime, dt) {
    for (const npc of this._npcs) {
      if (npc.evacuated) continue;

      if (npc.caught) {
        if (!npc.done) this.#updateSinking(npc, dt);
        continue;
      }

      this.#updateBehavior(npc, simTime, dt);
      this.#updateMovement(npc, simTime, dt);

      // 被災判定
      const depth = this.tsunami.depthAt(npc.pos.x, npc.pos.z, simTime);
      if (depth > CATCH_DEPTH) {
        npc.caught = true;
        npc.sinking = true;
        npc.sinkTimer = 0;
        this._stats.caught++;
        continue;
      }

      // 避難完了判定
      if (npc.pos.y >= EVAC_HEIGHT) {
        npc.evacuated = true;
        this._stats.evacuated++;
        continue;
      }

      // 見た目の反映
      npc.mesh.position.set(npc.pos.x, npc.pos.y, npc.pos.z);
      npc.mesh.rotation.y = npc.heading;
    }
  }

  // 波にのまれた後: 静かに沈んで消える(演出・音なし)
  #updateSinking(npc, dt) {
    // 最初の1回だけマテリアルを個体用に複製する
    if (!npc.sinkMats) {
      npc.sinkMats = [];
      npc.mesh.traverse((o) => {
        if (o.isMesh) {
          o.material = o.material.clone();
          o.material.transparent = true;
          npc.sinkMats.push(o.material);
        }
      });
    }
    npc.sinkTimer += dt;
    const p = Math.min(npc.sinkTimer / SINK_DURATION, 1);
    npc.mesh.position.y = npc.pos.y - p * 1.6;
    for (const m of npc.sinkMats) m.opacity = 1 - p;
    if (p >= 1) {
      this.group.remove(npc.mesh);
      npc.done = true;
    }
  }

  // ---- 行動パターン(状態遷移) ----
  #updateBehavior(npc, simTime, dt) {
    npc.phaseTimer += dt;

    switch (npc.type) {
      case 'flee_soon':
        if (npc.state === 'idle' && simTime >= npc.t1) {
          npc.state = 'walk_goal';
        }
        break;

      case 'ignore': {
        // 15:20(2040秒)に半分は走り出す、半分は最後まで留まる
        if (simTime >= 2040 && npc.flag && npc.state !== 'flee') {
          npc.state = 'flee';
        }
        // 走り出さない個体はその場をゆっくりうろつき続ける(wander維持)
        break;
      }

      case 'watch_sea':
        if (npc.state === 'idle' && simTime >= npc.t1) {
          npc.state = 'walk_shore';
        }
        // 15:20 に引き波を見て反転、全力で高台へ
        if (npc.state === 'walk_shore' && simTime >= 2040) {
          npc.state = 'flee';
        }
        break;

      case 'flee_late': {
        if (npc.state === 'idle') {
          const depth = this.tsunami.depthAt(npc.pos.x, npc.pos.z, simTime);
          if (depth > 0 || simTime >= 2400) {
            npc.state = 'flee';
          }
        }
        break;
      }

      case 'return_back':
        if (npc.state === 'walk_goal' && simTime >= npc.t1) {
          npc.state = 'return';
        }
        if (npc.state === 'return' && simTime >= 2400) {
          npc.state = 'flee';
        }
        break;
    }
  }

  // ---- 移動処理 ----
  #updateMovement(npc, simTime, dt) {
    const t = this.terrain;

    // 状態から目標点と速度を決める
    let target = null;
    let running = false;
    let moving = true;

    switch (npc.state) {
      case 'idle':
        moving = false;
        break;
      case 'walk_goal':
        target = npc.goal;
        break;
      case 'walk_shore':
        target = npc.shoreGoal;
        break;
      case 'return':
        target = npc.homeSpot;
        break;
      case 'flee':
        target = npc.goal;
        running = true;
        break;
      case 'wander':
        target = this.#wanderTarget(npc, simTime);
        break;
      default:
        moving = false;
    }

    if (!moving || !target) {
      npc.mesh.position.set(npc.pos.x, npc.pos.y, npc.pos.z);
      return;
    }

    const dx0 = target.x - npc.pos.x;
    const dz0 = target.z - npc.pos.z;
    const distToTarget = Math.hypot(dx0, dz0);
    if (distToTarget < 1.0) {
      npc.mesh.position.set(npc.pos.x, npc.pos.y, npc.pos.z);
      return; // 到着済み(wanderは別途扱う)
    }

    // 迂回中でなければ目標方向へ、迂回中なら振った方向を使う
    npc.detourTimer -= dt;
    let dirAngle;
    if (npc.detourTimer > 0) {
      dirAngle = Math.atan2(dx0, dz0) + npc.detourAngle;
    } else {
      dirAngle = Math.atan2(dx0, dz0);
      npc.detourAngle = 0;
    }
    npc.heading = dirAngle;

    const spd = running ? npc.runSpeed : npc.walkSpeed;
    const dx = Math.sin(dirAngle) * spd * dt;
    const dz = Math.cos(dirAngle) * spd * dt;
    let nx = npc.pos.x + dx;
    let nz = npc.pos.z + dz;

    // 衝突判定は間隔を空けて実施(負荷軽減)。それ以外は前回の押し戻しなしでそのまま進む
    npc.collisionTimer -= dt;
    if (npc.collisionTimer <= 0) {
      const r = this.town.resolveCollision(nx, nz, RADIUS);
      nx = r.x; nz = r.z;
      npc.collisionTimer = COLLISION_INTERVAL;
    }

    // マップ外に出さない
    const lim = t.worldW / 2 - 10;
    nx = Math.min(Math.max(nx, -lim), lim);
    nz = Math.min(Math.max(nz, -lim), lim);

    npc.pos.x = nx;
    npc.pos.z = nz;
    npc.pos.y = t.heightAt(nx, nz);

    // 詰まり検知(0.5秒でSTUCK_DIST未満しか進めない場合は迂回)
    npc.stuckTimer += dt;
    if (npc.stuckTimer >= STUCK_CHECK) {
      const moved = Math.hypot(npc.pos.x - npc.stuckPos.x, npc.pos.z - npc.stuckPos.y);
      if (moved < STUCK_DIST && npc.detourTimer <= 0) {
        // ±45〜90度振って迂回。数秒後に目標方向へ戻す
        const sign = Math.random() < 0.5 ? -1 : 1;
        npc.detourAngle = sign * (Math.PI / 4 + Math.random() * Math.PI / 4);
        npc.detourTimer = 2 + Math.random() * 2;
      }
      npc.stuckPos.set(npc.pos.x, npc.pos.z);
      npc.stuckTimer = 0;
    }
  }

  // 「本気にしない」タイプの周辺徘徊目標(その場周辺をゆっくり)
  #wanderTarget(npc, simTime) {
    if (!npc.wanderTarget || npc.phaseTimer > 20) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 5 + Math.random() * 15;
      npc.wanderTarget = {
        x: npc.pos.x + Math.cos(ang) * rad,
        z: npc.pos.z + Math.sin(ang) * rad,
      };
      npc.phaseTimer = 0;
    }
    return npc.wanderTarget;
  }
}
