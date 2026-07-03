import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Terrain, createSea } from './terrain.js';
import { Town } from './buildings.js';

const container = document.getElementById('app');
const loadingEl = document.getElementById('loading');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd4e6); // 3/11 は晴れのち雪。淡い冬空
scene.fog = new THREE.Fog(0xbfd4e6, 1500, 7000);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 20000);
camera.position.set(0, 1500, 2500);

scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x5a5348, 0.9));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.2);
sun.position.set(-1000, 1500, 800);
scene.add(sun);

// 工程2の確認用: 俯瞰カメラ(工程4でプレイヤー操作に置き換え)
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);

loadingEl.textContent = '地形データ読込中…';
const terrain = await Terrain.load();
scene.add(terrain.mesh);
scene.add(createSea(terrain.worldW));

loadingEl.textContent = '街並みを生成中…';
const town = await Town.build(terrain);
scene.add(town.group);
console.log(`建物 ${town.count} 棟を生成`);
loadingEl.textContent = '';

// 開発用(動作確認のためコンソールから操作できるように)
window.__sim = { camera, controls, terrain, town };

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('notice').style.display = 'none';
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
