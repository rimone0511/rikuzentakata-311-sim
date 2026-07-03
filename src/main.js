import * as THREE from 'three';

// 工程1の骨格: Three.js が動くことの確認用プレースホルダーシーン。
// 以降の工程で地形・建物・プレイヤー・津波の各モジュールに置き換えていく。

const container = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd4e6); // 3/11 は晴れのち雪。淡い冬空
scene.fog = new THREE.Fog(0xbfd4e6, 500, 4000);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10000);
camera.position.set(0, 30, 80);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x5a5348, 0.9));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.2);
sun.position.set(-300, 400, 200);
scene.add(sun);

// 仮の地面と目印
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000),
  new THREE.MeshLambertMaterial({ color: 0x7a8f6a })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const box = new THREE.Mesh(
  new THREE.BoxGeometry(10, 10, 10),
  new THREE.MeshLambertMaterial({ color: 0xcc6644 })
);
box.position.y = 5;
scene.add(box);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('notice').style.display = 'none';
});

renderer.setAnimationLoop(() => {
  box.rotation.y += 0.01;
  renderer.render(scene, camera);
});
