import * as THREE from 'three';
import { Terrain } from './terrain.js';
import { Town } from './buildings.js';
import { Player } from './player.js';
import { Tsunami, EVENTS } from './tsunami.js';

const container = document.getElementById('app');
const loadingEl = document.getElementById('loading');
const statusEl = document.getElementById('status');
const clockEl = document.getElementById('clock');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd4e6); // 3/11 は晴れのち雪。淡い冬空
scene.fog = new THREE.Fog(0xbfd4e6, 1200, 6000);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.3, 20000);
camera.position.set(0, 1500, 2500);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x5a5348, 0.9));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.2);
sun.position.set(-1000, 1500, 800);
scene.add(sun);

loadingEl.textContent = '地形データ読込中…';
const terrain = await Terrain.load();
scene.add(terrain.mesh);

loadingEl.textContent = '街並みを生成中…';
const town = await Town.build(terrain);
scene.add(town.group);
console.log(`建物 ${town.count} 棟を生成`);

loadingEl.textContent = '津波データを準備中…';
const tsunami = new Tsunami(terrain);
scene.add(tsunami.mesh);
loadingEl.textContent = '';

const player = new Player(camera, terrain, town, renderer.domElement);
scene.add(player.avatar);

// スタート地点(避難行動の差を体験できるよう浸水域の数カ所)
const START_POINTS = [
  { name: '旧駅前(市街地)', lat: 39.0155, lon: 141.6250, yaw: 180 },
  { name: '市民会館前', lat: 39.0175, lon: 141.6297, yaw: 180 },
  { name: '高田松原(海岸)', lat: 39.0035, lon: 141.6252, yaw: 0 },
  { name: '気仙町今泉', lat: 39.0060, lon: 141.6150, yaw: 90 },
];
let startIndex = 0;
const spDiv = document.getElementById('startPoints');
START_POINTS.forEach((sp, i) => {
  const b = document.createElement('button');
  b.textContent = sp.name;
  b.classList.toggle('selected', i === startIndex);
  b.addEventListener('click', () => {
    startIndex = i;
    spDiv.querySelectorAll('button').forEach((x, j) =>
      x.classList.toggle('selected', j === i));
  });
  spDiv.appendChild(b);
});
player.spawnAtLatLon(START_POINTS[0].lat, START_POINTS[0].lon, START_POINTS[0].yaw);

// ---- シミュレーション時刻(14:46:00 = 地震発生 = t0) ----
const QUAKE_DURATION = 180; // 強い揺れの継続時間(約3分)
let simTime = 0;            // 地震からの経過秒
let timeScale = 1;
let running = false;
let caught = false;         // 波に追いつかれたか

document.querySelectorAll('#timescale button').forEach((btn) => {
  btn.addEventListener('click', () => {
    timeScale = Number(btn.dataset.scale);
    document.querySelectorAll('#timescale button').forEach((b) =>
      b.classList.toggle('active', b === btn));
  });
});

document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('notice').style.display = 'none';
  const sp = START_POINTS[startIndex];
  player.spawnAtLatLon(sp.lat, sp.lon, sp.yaw);
  player.enabled = true;
  running = true;
  renderer.domElement.requestPointerLock();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function formatClock(t) {
  const total = 14 * 3600 + 46 * 60 + Math.floor(t);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function currentEvent(t) {
  let ev = '';
  for (const [time, text] of EVENTS) {
    if (t >= time) ev = text;
    else break;
  }
  return ev;
}

// 波に追いつかれたとき: 静かに白転し、事実のみ表示(PLAN.md 設計思想)
function whiteout(depth) {
  caught = true;
  running = false;
  player.enabled = false;
  document.exitPointerLock();
  const facts = document.getElementById('facts');
  facts.innerHTML =
    `${formatClock(simTime).slice(0, 5)}、この場所に津波が到達しました。<br>` +
    `ここの標高は ${player.pos.y.toFixed(1)}m。浸水の深さは、やがて建物の屋根を越えました。<br><br>` +
    `2011年3月11日、陸前高田市では 1,700人以上が犠牲になりました。<br>` +
    `指定避難場所だった市民会館・市民体育館にも津波が達し、<br>多くの方が亡くなりました。<br><br>` +
    `高台までの数分の差が、生死を分けました。<br><br>` +
    `<button onclick="location.reload()" style="pointer-events:auto;cursor:pointer;` +
    `background:#eee;border:1px solid #999;color:#333;padding:8px 24px;font-size:13px;">` +
    `もう一度、別の行動を試す</button>`;
  document.getElementById('whiteout').classList.add('shown');
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();

  if (running) {
    simTime += dt * timeScale;
    tsunami.update(simTime);

    if (player.enabled) {
      // 浸水による減速(膝下でも歩行は大きく阻害される)
      const depth = tsunami.depthAt(player.pos.x, player.pos.z, simTime);
      player.speedFactor = depth > 0.05 ? Math.max(0.25, 1 - depth * 1.5) : 1;

      // 倍速時も「シミュレーション内の移動速度」が一定になるよう、
      // 加速した時間ぶんを小刻みに分割して更新する
      let step = dt * timeScale;
      while (step > 0) {
        player.update(Math.min(step, 0.05));
        step -= 0.05;
      }

      // 白転は津波の浸水のみで発動(平常の川・海に入っただけでは起きない)
      const wl = tsunami.waterLevelAt(player.pos.x, player.pos.z, simTime);
      if (!caught && depth > 0.3 && wl > 1.0) whiteout(depth);

      // 地震の揺れ(体感の再現。転倒などはフェーズ2)
      if (simTime < QUAKE_DURATION) {
        const amp = 0.25 * (1 - simTime / QUAKE_DURATION);
        camera.position.x += (Math.random() - 0.5) * amp;
        camera.position.y += (Math.random() - 0.5) * amp * 0.6;
        camera.position.z += (Math.random() - 0.5) * amp;
      }
    }
  }

  clockEl.textContent = formatClock(simTime);
  const kmh = (player.speed * 3.6).toFixed(1);
  statusEl.innerHTML =
    `標高 ${player.pos.y.toFixed(1)} m / ${kmh} km/h` +
    (player.thirdPerson ? ' / 三人称' : '') + '<br>' +
    `<span style="color:#ffd9a0">${currentEvent(simTime)}</span>`;

  renderer.render(scene, camera);
});

// 開発用(動作確認のためコンソールから操作できるように)
window.__sim = {
  camera, terrain, town, player, scene, tsunami, renderer,
  get simTime() { return simTime; },
  set simTime(v) { simTime = v; },
  get timeScale() { return timeScale; },
  set timeScale(v) { timeScale = v; },
  get running() { return running; },
  set running(v) { running = v; },
  get caught() { return caught; },
  set caught(v) { caught = v; },
};
