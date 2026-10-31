import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createStage({ xr = false, alpha = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = xr;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  if (!alpha) {
    scene.background = new THREE.Color(0x121612);
    scene.fog = new THREE.Fog(0x121612, 7, 18);
  }

  const camera = new THREE.PerspectiveCamera(
    65,
    window.innerWidth / window.innerHeight,
    0.01,
    80,
  );
  camera.position.set(0, 1.6, 2.8);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.15, 0);
  controls.enableDamping = true;
  controls.maxDistance = 12;
  controls.minDistance = 0.4;

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { THREE, renderer, scene, camera, controls };
}

export function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xf2f6e8, 0x2a2418, 1.15));
  const key = new THREE.DirectionalLight(0xfff4e0, 2.2);
  key.position.set(3.5, 6, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8fd0ff, 0.55);
  fill.position.set(-4, 2, -2);
  scene.add(fill);
}

export function addGround(THREE, scene, { grid = true } = {}) {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(5, 72),
    new THREE.MeshStandardMaterial({ color: 0x1c241c, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  if (grid) {
    const helper = new THREE.GridHelper(8, 16, 0xd6ff4a, 0x2c382c);
    helper.position.y = 0.002;
    scene.add(helper);
  }

  return floor;
}

export function startLoop(stage, tick = () => {}) {
  const { renderer, scene, camera, controls } = stage;
  renderer.setAnimationLoop((time, frame) => {
    if (!renderer.xr.isPresenting) controls.update();
    tick(time, frame);
    renderer.render(scene, camera);
  });
}
