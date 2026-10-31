import { VRButton } from "three/addons/webxr/VRButton.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { addGround, addLights, createStage, startLoop } from "../../shared/stage.js";

const stage = createStage({ xr: true });
const { THREE, renderer, scene } = stage;
const readout = document.querySelector("#readout");

addLights(scene);
addGround(THREE, scene);

const targets = [];
const spots = [
  { position: [-1.2, 0.55, -1.6], size: [0.45, 1.1, 0.45], color: 0xf2efe4 },
  { position: [0.15, 0.4, -2.3], size: [0.7, 0.8, 0.35], color: 0xe07a3d },
  { position: [1.25, 0.7, -1.15], size: [0.4, 1.4, 0.4], color: 0x7f9a78 },
  { position: [-0.35, 0.9, -2.8], size: [0.35, 0.35, 0.35], color: 0xd6ff4a },
];

for (const spot of spots) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...spot.size),
    new THREE.MeshStandardMaterial({ color: spot.color, roughness: 0.55, metalness: 0.04 }),
  );
  mesh.position.set(...spot.position);
  scene.add(mesh);
  targets.push(mesh);
}

const factory = new XRControllerModelFactory();
const raycaster = new THREE.Raycaster();
const hands = [0, 1].map((index) => makeHand(index));

document.body.appendChild(VRButton.createButton(renderer));

startLoop(stage, () => {
  clearLit();
  const notes = [];

  for (const hand of hands) {
    const hit = cast(hand);
    const gamepad = hand.controller.userData.inputSource?.gamepad;
    const trigger = Boolean(gamepad?.buttons[0]?.pressed);
    hand.line.material.color.setHex(trigger ? 0xff4d6a : 0xd6ff4a);

    if (hit) {
      hit.object.material.emissive.setHex(0xd6ff4a);
      hit.object.material.emissiveIntensity = 0.55;
      hand.line.scale.z = hit.distance;
    } else {
      hand.line.scale.z = 4;
    }

    if (gamepad) {
      const squeeze = Boolean(gamepad.buttons[1]?.pressed);
      notes.push(`${hand.name} ${trigger ? "trigger" : "idle"}${squeeze ? " squeeze" : ""}`);
    }
  }

  if (renderer.xr.isPresenting) {
    readout.textContent = notes.length ? notes.join(" · ") : "Controllers not connected yet.";
  }
});

function makeHand(index) {
  const controller = renderer.xr.getController(index);
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xd6ff4a }));
  line.visible = false;
  line.scale.z = 4;
  controller.add(line);

  controller.addEventListener("connected", (event) => {
    controller.userData.inputSource = event.data;
    line.visible = true;
  });
  controller.addEventListener("disconnected", () => {
    controller.userData.inputSource = null;
    line.visible = false;
  });

  scene.add(controller);

  const grip = renderer.xr.getControllerGrip(index);
  grip.add(factory.createControllerModel(grip));
  scene.add(grip);

  return { controller, line, name: index === 0 ? "Left" : "Right" };
}

function cast(hand) {
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const rotation = new THREE.Matrix4();

  hand.controller.getWorldPosition(origin);
  rotation.identity().extractRotation(hand.controller.matrixWorld);
  direction.set(0, 0, -1).applyMatrix4(rotation);
  raycaster.set(origin, direction);
  return raycaster.intersectObjects(targets, false)[0] ?? null;
}

function clearLit() {
  for (const mesh of targets) {
    mesh.material.emissive.setHex(0x000000);
    mesh.material.emissiveIntensity = 1;
  }
}
