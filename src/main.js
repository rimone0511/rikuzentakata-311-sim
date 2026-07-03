import * as THREE from 'three';
import { Terrain, createSea } from './terrain.js';
import { Town } from './buildings.js';
import { Player } from './player.js';

const container = document.getElementById('app');
const loadingEl = document.getElementById('loading');
const statusEl = document.getElementById('status');

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
scene.add(createSea(terrain.worldW));

loadingEl.textContent = '街並みを生成中…';
const town = await Town.build(terrain);
scene.add(town.group);
console.log(`建物 ${town.count} 棟を生成`);
loadingEl.textContent = '';

const player = new Player(camera, terrain, town, renderer.domElement);
scene.add(player.avatar);
// 初期スタート地点: 旧駅前(市街地の中心部)から北向き
player.spawnAtLatLon(39.0155, 141.6250, 180);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('notice').style.display = 'none';
  player.enabled = true;
  renderer.domElement.requestPointerLock();
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (player.enabled) player.update(dt);

  const kmh = (player.speed * 3.6).toFixed(1);
  statusEl.innerHTML =
    `標高 ${player.pos.y.toFixed(1)} m / ${kmh} km/h` +
    (player.thirdPerson ? ' / 三人称' : '');

  renderer.render(scene, camera);
});

// 開発用(動作確認のためコンソールから操作できるように)
window.__sim = { camera, terrain, town, player, scene };
