import * as THREE from "three";

const palette = [0x5b8cff, 0xff5d73, 0xd6ff4a, 0xffb45a, 0xc084fc, 0x3dffe8, 0xff7ad9, 0x7f9a78];
const SECONDARY_BUTTON = 5;

const setup = document.querySelector("#setup");
const form = document.querySelector("#settings");
const note = document.querySelector("#note");
const enter = document.querySelector("#enter");
const exit = document.querySelector("#exit");
const overlay = document.querySelector("#overlay");
const status = document.querySelector("#status");

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.domElement.classList.add("xr-view");
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);

const planes = new Map();
let wallsOnly = true;
let opacity = 0.45;
let scan = true;
let nextColor = 0;
let startedAt = 0;
let scanRequested = false;
let scanning = false;
let ending = false;

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

enter.addEventListener("click", () => {
  applyForm();
  navigator.xr
    .requestSession("immersive-ar", {
      requiredFeatures: ["plane-detection", "local-floor"],
      optionalFeatures: ["dom-overlay"],
      domOverlay: { root: overlay },
    })
    .then((session) => renderer.xr.setSession(session))
    .catch((error) => {
      note.textContent = error?.message || "Could not start AR.";
    });
});

exit.addEventListener("click", () => {
  renderer.xr.getSession()?.end();
});

renderer.xr.addEventListener("sessionstart", () => {
  setup.hidden = true;
  overlay.style.display = "block";
  startedAt = performance.now();
  scanRequested = false;
  scanning = false;
  ending = false;
  status.textContent = "Looking for walls…";
});

renderer.xr.addEventListener("sessionend", () => {
  overlay.style.display = "none";
  setup.hidden = false;
  clearPlanes();
  note.textContent = "Session ended. Enter AR to look again.";
});

prepare();
renderer.setAnimationLoop((_time, frame) => {
  if (frame) {
    exitFromControllers(frame);
    syncPlanes(frame);
  }
  renderer.render(scene, camera);
});

function applyForm() {
  const data = new FormData(form);
  wallsOnly = data.get("surfaces") !== "all";
  opacity = Math.min(0.8, Math.max(0.15, Number(data.get("opacity")) || 0.45));
  scan = form.querySelector("#scan").checked;
}

async function prepare() {
  const supported = navigator.xr && (await navigator.xr.isSessionSupported("immersive-ar").catch(() => false));
  if (!supported) {
    note.textContent = "This browser cannot start immersive AR. Open the page in the Quest 3 browser.";
    enter.textContent = "AR not available";
    return;
  }

  note.textContent = "The controls above are the ones inside the headset.";
  enter.disabled = false;
}

function exitFromControllers(frame) {
  if (ending) return;
  for (const source of frame.session.inputSources) {
    if (!source.gamepad?.buttons[SECONDARY_BUTTON]?.pressed) continue;
    ending = true;
    frame.session.end();
    return;
  }
}

function syncPlanes(frame) {
  const detected = frame.detectedPlanes;
  if (!detected) return;

  const referenceSpace = renderer.xr.getReferenceSpace();
  const seen = new Set();
  let shown = 0;

  for (const plane of detected) {
    if (wallsOnly && plane.orientation !== "vertical") continue;

    seen.add(plane);
    shown += 1;
    let entry = planes.get(plane);

    if (!entry) {
      entry = createPlane(palette[nextColor % palette.length]);
      nextColor += 1;
      planes.set(plane, entry);
      scene.add(entry.group);
    }

    const pose = frame.getPose(plane.planeSpace, referenceSpace);
    if (pose) entry.group.matrix.fromArray(pose.transform.matrix);

    if (entry.stamp !== plane.lastChangedTime) {
      setPolygon(entry, plane.polygon);
      entry.stamp = plane.lastChangedTime;
    }
  }

  for (const [plane, entry] of planes) {
    if (seen.has(plane)) continue;
    scene.remove(entry.group);
    disposeEntry(entry);
    planes.delete(plane);
  }

  if (!scanning) status.textContent = planeStatus(shown, detected.size);
  maybeScan(frame, detected.size);
}

function planeStatus(shown, total) {
  if (shown) {
    const noun = wallsOnly ? (shown === 1 ? "wall" : "walls") : shown === 1 ? "plane" : "planes";
    return `${shown} ${noun}`;
  }
  if (total) return `No walls. ${total} other planes in the scan.`;
  return "No walls in the scan yet.";
}

function maybeScan(frame, total) {
  if (!scan || scanRequested || total > 0) return;
  if (performance.now() - startedAt < 4000) return;

  const session = frame.session;
  scanRequested = true;
  if (typeof session.initiateRoomCapture !== "function") {
    status.textContent = "No room scan on this headset.";
    return;
  }

  scanning = true;
  status.textContent = "Starting room scan…";
  session.initiateRoomCapture().then(() => {
    scanning = false;
  }).catch(() => {
    scanning = false;
    status.textContent = "Room scan was dismissed.";
  });
}

function createPlane(color) {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.frustumCulled = false;

  const fill = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const edge = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color }),
  );
  fill.frustumCulled = false;
  edge.frustumCulled = false;
  group.add(fill, edge);
  return { group, stamp: null };
}

function setPolygon(entry, polygon) {
  if (polygon.length < 3) return;

  const shape = new THREE.Shape();
  const edgePositions = [];

  polygon.forEach((point, index) => {
    const x = point.x;
    const y = -point.z;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
    edgePositions.push(point.x, 0, point.z);
  });

  const [fill, edge] = entry.group.children;
  fill.geometry.dispose();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  fill.geometry = geometry;

  edge.geometry.dispose();
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
  edge.geometry = edgeGeometry;
}

function clearPlanes() {
  for (const entry of planes.values()) {
    scene.remove(entry.group);
    disposeEntry(entry);
  }
  planes.clear();
  nextColor = 0;
}

function disposeEntry(entry) {
  for (const child of entry.group.children) {
    child.geometry.dispose();
    child.material.dispose();
  }
}
