import { VRButton } from "three/addons/webxr/VRButton.js";
import { addGround, addLights, createStage, startLoop } from "../../shared/stage.js";

const stage = createStage({ xr: true });
const { THREE, renderer, scene, camera, controls } = stage;

camera.position.set(1.15, 1.55, 4.6);
controls.target.set(0, 1.15, 0);
controls.update();

addLights(scene);
addGround(THREE, scene);

const columnMaterial = new THREE.MeshStandardMaterial({ color: 0xe7e1d4, roughness: 0.62 });

for (let i = 0; i < 8; i += 1) {
  const angle = (i / 8) * Math.PI * 2;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.4, 12), columnMaterial);
  column.position.set(Math.cos(angle) * 2.2, 1.2, Math.sin(angle) * 2.2);
  scene.add(column);
}

const gem = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.28, 0),
  new THREE.MeshStandardMaterial({
    color: 0xd6ff4a,
    roughness: 0.25,
    metalness: 0.08,
    emissive: 0x334400,
    emissiveIntensity: 0.45,
  }),
);
gem.position.y = 1.3;
scene.add(gem);

const glow = new THREE.PointLight(0xd6ff4a, 6, 6);
glow.position.y = 1.3;
scene.add(glow);

document.body.appendChild(VRButton.createButton(renderer));

startLoop(stage, (time) => {
  gem.rotation.y = time * 0.0006;
  gem.rotation.x = Math.sin(time * 0.0004) * 0.25;
});
