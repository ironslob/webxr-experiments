import { addGround, addLights, createStage, startLoop } from "../../shared/stage.js";

const stage = createStage();
const { THREE, scene } = stage;

addLights(scene);
addGround(THREE, scene);

const palette = [0xd6ff4a, 0xf2efe4, 0xe07a3d, 0x7f9a78];
const geometries = [
  new THREE.BoxGeometry(0.28, 0.28, 0.28),
  new THREE.SphereGeometry(0.16, 24, 16),
  new THREE.ConeGeometry(0.14, 0.32, 5),
  new THREE.TorusGeometry(0.14, 0.05, 12, 24),
];

const rings = [];

for (let r = 0; r < 3; r += 1) {
  const ring = new THREE.Group();
  ring.position.y = 0.75 + r * 0.55;
  const count = 5 + r;
  const radius = 0.55 + r * 0.38;

  for (let i = 0; i < count; i += 1) {
    const mesh = new THREE.Mesh(
      geometries[(i + r) % geometries.length],
      new THREE.MeshStandardMaterial({
        color: palette[(i + r) % palette.length],
        roughness: 0.45,
        metalness: 0.05,
      }),
    );
    const angle = (i / count) * Math.PI * 2;
    mesh.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    mesh.lookAt(0, ring.position.y, 0);
    ring.add(mesh);
  }

  const hoop = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.008, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0xd6ff4a, roughness: 0.4, metalness: 0.2 }),
  );
  hoop.rotation.x = Math.PI / 2;
  ring.add(hoop);
  scene.add(ring);
  rings.push(ring);
}

const pole = new THREE.Mesh(
  new THREE.CylinderGeometry(0.03, 0.03, 2.2, 16),
  new THREE.MeshStandardMaterial({ color: 0xf2efe4, roughness: 0.35, metalness: 0.4 }),
);
pole.position.y = 1.1;
scene.add(pole);

startLoop(stage, (time) => {
  const seconds = time * 0.001;
  rings.forEach((ring, index) => {
    ring.rotation.y = seconds * (index % 2 === 0 ? 0.35 : -0.22);
  });
});
