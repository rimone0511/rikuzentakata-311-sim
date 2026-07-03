import * as THREE from 'three';

// プレイヤー操作: WASD移動 + マウス視点 + 一人称/三人称切替(V)
// 速度は PLAN.md 準拠: 徒歩 4km/h、走り 10km/h

const WALK_SPEED = 4 / 3.6;   // m/s
const RUN_SPEED = 10 / 3.6;   // m/s
const EYE_HEIGHT = 1.55;      // m
const RADIUS = 0.4;           // 衝突半径

export class Player {
  constructor(camera, terrain, town, domElement) {
    this.camera = camera;
    this.terrain = terrain;
    this.town = town;
    this.dom = domElement;

    this.pos = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;      // 水平回転(0 = -Z = 北向き)
    this.pitch = 0;
    this.thirdPerson = false;
    this.enabled = false;
    this.keys = new Set();
    this.speed = 0;    // HUD用(m/s)

    this.avatar = this.#makeAvatar();
    this.avatar.visible = false;

    this.#bindEvents();
  }

  spawnAt(x, z, yawDeg = 0) {
    this.pos.set(x, this.terrain.heightAt(x, z), z);
    this.yaw = THREE.MathUtils.degToRad(yawDeg);
    this.pitch = 0;
    this.#updateCamera();
  }

  spawnAtLatLon(lat, lon, yawDeg = 0) {
    const p = this.terrain.latLonToWorld(lat, lon);
    this.spawnAt(p.x, p.z, yawDeg);
  }

  get isRunning() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  update(dt) {
    if (dt > 0.1) dt = 0.1;
    const f = new THREE.Vector2(0, 0); // x=右, y=前
    if (this.keys.has('KeyW')) f.y += 1;
    if (this.keys.has('KeyS')) f.y -= 1;
    if (this.keys.has('KeyA')) f.x -= 1;
    if (this.keys.has('KeyD')) f.x += 1;

    this.speed = 0;
    if (f.lengthSq() > 0) {
      f.normalize();
      let spd = this.isRunning ? RUN_SPEED : WALK_SPEED;
      // 傾斜による減速(上りは急なほど遅い)
      const ahead = this.#groundSlopeAhead(f);
      if (ahead > 0.15) spd *= Math.max(0.35, 1 - ahead * 1.2);
      this.speed = spd;

      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // yaw=0 で -Z(北)へ前進
      const dx = (f.x * cos - f.y * sin) * spd * dt;
      const dz = (-f.x * sin - f.y * cos) * spd * dt;
      let nx = this.pos.x + dx;
      let nz = this.pos.z + dz;

      // 建物との衝突
      const r = this.town.resolveCollision(nx, nz, RADIUS);
      nx = r.x; nz = r.z;

      // マップ外に出さない
      const lim = this.terrain.worldW / 2 - 10;
      nx = Math.min(Math.max(nx, -lim), lim);
      nz = Math.min(Math.max(nz, -lim), lim);

      this.pos.x = nx;
      this.pos.z = nz;
    }
    this.pos.y = this.terrain.heightAt(this.pos.x, this.pos.z);
    this.#updateCamera();
  }

  // 進行方向の傾斜(高低差/距離)
  #groundSlopeAhead(f) {
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const dx = f.x * cos - f.y * sin;
    const dz = -f.x * sin - f.y * cos;
    const d = 2.0;
    const h0 = this.terrain.heightAt(this.pos.x, this.pos.z);
    const h1 = this.terrain.heightAt(this.pos.x + dx * d, this.pos.z + dz * d);
    return (h1 - h0) / d;
  }

  #updateCamera() {
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    if (this.thirdPerson) {
      this.avatar.visible = true;
      this.avatar.position.copy(this.pos);
      this.avatar.rotation.y = this.yaw;
      const back = dir.clone().multiplyScalar(-8);
      const camPos = this.pos.clone().add(back).add(new THREE.Vector3(0, 3.2, 0));
      // カメラが地面に潜らないように
      const gh = this.terrain.heightAt(camPos.x, camPos.z);
      camPos.y = Math.max(camPos.y, gh + 0.6);
      this.camera.position.copy(camPos);
      this.camera.lookAt(this.pos.x, this.pos.y + 1.5, this.pos.z);
    } else {
      this.avatar.visible = false;
      this.camera.position.set(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
      this.camera.lookAt(this.camera.position.clone().add(dir));
    }
  }

  #makeAvatar() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x4a5568 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.85, 4, 8), mat);
    body.position.y = 0.85;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10),
      new THREE.MeshLambertMaterial({ color: 0xd8b89a }));
    head.position.y = 1.55;
    g.add(body, head);
    g.name = 'player-avatar';
    return g;
  }

  #bindEvents() {
    this.dom.addEventListener('click', () => {
      if (this.enabled && document.pointerLockElement !== this.dom) {
        this.dom.requestPointerLock();
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      const lim = Math.PI / 2 - 0.05;
      this.pitch = Math.min(Math.max(this.pitch, -lim), lim);
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyV') this.thirdPerson = !this.thirdPerson;
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
}
