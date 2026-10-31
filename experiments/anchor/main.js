import { ARButton } from "three/addons/webxr/ARButton.js";
import { addLights, createStage, startLoop } from "../../shared/stage.js";

const stage = createStage({ xr: true, alpha: true });
const { THREE, renderer, scene } = stage;
const readout = document.querySelector("#readout");

addLights(scene);

const pegGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.16, 20);
pegGeometry.translate(0, 0.08, 0);
const palette = [0xd6ff4a, 0xf2efe4, 0xe07a3d, 0x7f9a78];
let placed = 0;

const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xd6ff4a }),
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

let hitTestSource = null;
let hitTestSourceRequested = false;

for (const index of [0, 1]) {
  const controller = renderer.xr.getController(index);
  controller.addEventListener("select", placePeg);
  scene.add(controller);
}

document.body.appendChild(
  ARButton.createButton(renderer, { requiredFeatures: ["hit-test"] }),
);

startLoop(stage, (_time, frame) => {
  if (!frame) return;

  const referenceSpace = renderer.xr.getReferenceSpace();
  const session = renderer.xr.getSession();

  if (!hitTestSourceRequested) {
    hitTestSourceRequested = true;
    session.requestReferenceSpace("viewer").then((viewerSpace) => {
      session.requestHitTestSource({ space: viewerSpace }).then((source) => {
        hitTestSource = source;
      });
    });
    session.addEventListener("end", () => {
      hitTestSourceRequested = false;
      hitTestSource = null;
      reticle.visible = false;
    });
  }

  if (!hitTestSource) return;

  const hits = frame.getHitTestResults(hitTestSource);
  if (!hits.length) {
    reticle.visible = false;
    return;
  }

  const pose = hits[0].getPose(referenceSpace);
  if (!pose) {
    reticle.visible = false;
    return;
  }

  reticle.visible = true;
  reticle.matrix.fromArray(pose.transform.matrix);
});

function placePeg() {
  if (!reticle.visible || placed >= 30) return;

  const mesh = new THREE.Mesh(
    pegGeometry,
    new THREE.MeshStandardMaterial({
      color: palette[placed % palette.length],
      roughness: 0.45,
    }),
  );
  reticle.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.scale.set(1, 1, 1);
  scene.add(mesh);
  placed += 1;
  readout.textContent = placed === 1 ? "1 peg placed." : `${placed} pegs placed.`;
}
