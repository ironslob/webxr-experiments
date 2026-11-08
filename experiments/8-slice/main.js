import * as THREE from "three";
import {
  COMBO_WINDOW,
  MIN_SLICE_SPEED,
  advanceCombo,
  bladeHit,
  bladeSection,
  canSliceAgain,
  chooseTarget,
  compareScores,
  formatClock,
  loadTables,
  pointsForSlice,
  recordTableScore,
  saveTables,
  swingSegments,
} from "./logic.js";

const SECONDARY_BUTTON = 5;
const BLADE_ROOT = 0.25;
const GRAVITY = 5.1;
const BLADE_LENGTHS = { short: 0.48, standard: 0.68, long: 0.88 };
const PACE = {
  calm: { gap: 1.25, roll: () => 1 },
  busy: { gap: 0.8, roll: () => (Math.random() < 0.5 ? 2 : 1) },
  frenzy: { gap: 0.5, roll: () => 1 + Math.floor(Math.random() * 3) },
};

const stitchTexture = canvasTexture(256, 256, (ctx) => {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "#5c4038";
  ctx.lineWidth = 5;
  ctx.setLineDash([12, 9]);
  ctx.beginPath();
  ctx.arc(128, 128, 78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(36, 128);
  ctx.lineTo(220, 128);
  ctx.stroke();
});

const rindTexture = canvasTexture(128, 64, (ctx) => {
  ctx.fillStyle = "#1e7a38";
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = "#0e3d1c";
  ctx.lineWidth = 7;
  for (let x = -12; x < 150; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 10, 18, x - 8, 40, x + 6, 64);
    ctx.stroke();
  }
  ctx.strokeStyle = "#dfffd4";
  ctx.lineWidth = 2;
  for (let x = -4; x < 150; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 10, 18, x - 8, 40, x + 6, 64);
    ctx.stroke();
  }
});

const melonCapTexture = canvasTexture(256, 256, (ctx) => {
  ctx.fillStyle = "#ff3358";
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "#ffe1e6";
  ctx.beginPath();
  ctx.arc(128, 128, 108, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff3358";
  ctx.beginPath();
  ctx.arc(128, 128, 92, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2a120f";
  for (let i = 0; i < 9; i += 1) {
    const angle = (i / 9) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(128 + Math.cos(angle) * 48, 128 + Math.sin(angle) * 48, 5, 8, angle, 0, Math.PI * 2);
    ctx.fill();
  }
});

const planetTexture = canvasTexture(256, 128, (ctx) => {
  ctx.fillStyle = "#2c74c8";
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = "#3e9a4a";
  const blobs = [
    [42, 48, 30, 20],
    [96, 36, 18, 14],
    [150, 70, 36, 22],
    [206, 44, 20, 16],
    [70, 96, 16, 12],
    [188, 96, 14, 10],
  ];
  for (const [x, y, rx, ry] of blobs) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#d8efe0";
  ctx.fillRect(0, 108, 256, 10);
});

const MODE_LIST = [
  {
    id: "fruit",
    label: "Fruit",
    hazardChance: 0.16,
    pieces: [
      { id: "apple", name: "Apple", points: 10, radius: 0.12, weight: 3, inside: 0xfff1c4, build: buildApple },
      { id: "orange", name: "Orange", points: 10, radius: 0.11, weight: 3, inside: 0xffc56b, build: buildOrange },
      { id: "banana", name: "Banana", points: 15, radius: 0.14, weight: 2, inside: 0xfff6d4, build: buildBanana },
      { id: "berry", name: "Strawberry", points: 15, radius: 0.11, weight: 2, inside: 0xff6d86, build: buildBerry },
      { id: "pineapple", name: "Pineapple", points: 20, radius: 0.14, weight: 2, inside: 0xffd15c, build: buildPineapple },
      {
        id: "melon",
        name: "Watermelon",
        points: 20,
        radius: 0.16,
        weight: 1,
        inside: 0xff3358,
        capMap: melonCapTexture,
        build: buildMelon,
      },
    ],
    hazard: {
      id: "bomb",
      name: "Bomb",
      points: 50,
      radius: 0.11,
      hazard: true,
      inside: 0xff6a2a,
      burst: 0xff7a32,
      build: buildBomb,
    },
  },
  {
    id: "animals",
    label: "Animals",
    hazardChance: 0.14,
    pieces: [
      { id: "sheep", name: "Sheep", points: 25, radius: 0.17, weight: 8, inside: 0xf6c7be, stitch: true, build: buildSheep },
      { id: "chicken", name: "Chicken", points: 10, radius: 0.13, weight: 3, inside: 0xfff1d2, stitch: true, build: buildChicken },
      { id: "pig", name: "Pig", points: 20, radius: 0.15, weight: 2, inside: 0xf7b4c2, stitch: true, build: buildPig },
      { id: "rabbit", name: "Rabbit", points: 15, radius: 0.14, weight: 2, inside: 0xf0d2c0, stitch: true, build: buildRabbit },
      { id: "duck", name: "Duck", points: 15, radius: 0.13, weight: 2, inside: 0xfff4cf, stitch: true, build: buildDuck },
      { id: "penguin", name: "Penguin", points: 20, radius: 0.14, weight: 2, inside: 0xd7dee8, stitch: true, build: buildPenguin },
    ],
    hazard: {
      id: "skunk",
      name: "Skunk",
      points: 50,
      radius: 0.16,
      hazard: true,
      inside: 0xc6e86a,
      burst: 0xb6e35a,
      stitch: true,
      build: buildSkunk,
    },
  },
  {
    id: "cosmos",
    label: "Cosmos",
    hazardChance: 0.14,
    pieces: [
      { id: "asteroid", name: "Asteroid", points: 10, radius: 0.12, weight: 3, inside: 0x8a7568, build: buildAsteroid },
      { id: "moon", name: "Moon", points: 15, radius: 0.12, weight: 3, inside: 0xc8c2b8, build: buildMoon },
      { id: "planet", name: "Planet", points: 25, radius: 0.15, weight: 2, inside: 0xff7a3c, capEmissive: 0xff5a1f, build: buildPlanet },
      { id: "star", name: "Star", points: 20, radius: 0.15, weight: 2, inside: 0xfff1b0, capEmissive: 0xffc44a, build: buildStar },
      { id: "comet", name: "Comet", points: 30, radius: 0.12, weight: 1, inside: 0xd8fbff, capEmissive: 0x9ae7ff, build: buildComet },
    ],
    hazard: {
      id: "hole",
      name: "Black hole",
      points: 80,
      radius: 0.14,
      hazard: true,
      inside: 0xc45bff,
      burst: 0xb44bff,
      build: buildHole,
    },
  },
];

const setup = document.querySelector("#setup");
const form = document.querySelector("#settings");
const note = document.querySelector("#note");
const enter = document.querySelector("#enter");
const practiceButton = document.querySelector("#practice");
const exit = document.querySelector("#exit");
const overlay = document.querySelector("#overlay");
const status = document.querySelector("#status");
const hint = document.querySelector("#hint");

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.domElement.classList.add("xr-view");
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 40);
const hemi = new THREE.HemisphereLight(0xfff8ee, 0x667055, 1.05);
const sun = new THREE.DirectionalLight(0xfff4e0, 1.55);
sun.position.set(0.7, 2.4, 0.9);
const fill = new THREE.DirectionalLight(0xc9d8ff, 0.55);
fill.position.set(-1.1, 1.4, -0.4);
scene.add(hemi, sun, fill);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const templates = new Map();
const controllers = [];
const targets = [];
const halves = [];
const particles = [];
const popups = [];
const chipGeometry = new THREE.BoxGeometry(0.022, 0.022, 0.022);

const tmp = {
  up: new THREE.Vector3(0, 1, 0),
  forward: new THREE.Vector3(0, 0, -1),
  motion: new THREE.Vector3(),
  side: new THREE.Vector3(),
  swing: new THREE.Vector3(),
  cut: new THREE.Vector3(),
  blade: new THREE.Vector3(),
  anchor: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  hand: new THREE.Vector3(),
  hit: new THREE.Vector3(),
  tipPoint: new THREE.Vector3(),
  inverse: new THREE.Matrix4(),
  basis: new THREE.Matrix4(),
  xAxis: new THREE.Vector3(),
  yAxis: new THREE.Vector3(),
  zAxis: new THREE.Vector3(),
  localNormal: new THREE.Vector3(),
  localPoint: new THREE.Vector3(),
  color: new THREE.Color(),
  plane: new THREE.Plane(),
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
};

const play = {
  head: new THREE.Vector3(),
  forward: new THREE.Vector3(0, 0, -1),
  right: new THREE.Vector3(1, 0, 0),
  good: false,
};

const pointer = new THREE.Vector2();
let pointerHas = false;

let modeId = "fruit";
let swordMode = "both";
let bladeLength = BLADE_LENGTHS.standard;
let paceId = "busy";
let roundSeconds = 60;
let hazardsOn = true;
let scan = true;

let running = false;
let practicing = false;
let accepting = false;
let locked = false;
let committed = false;
let ending = false;
let boardsPlaced = false;
let scanning = false;
let scanRequested = false;
let startedAt = 0;
let armIn = 0.6;
let spawnIn = 0.4;
let elapsed = 0;
let remaining = 60;
let score = 0;
let combo = 0;
let bestCombo = 0;
let best = 0;
let lastSliceAt = 0;
let highlightAt = 0;
let boardStamp = "";
let lastDt = 1 / 72;
let storageFailed = false;
let floor = null;
let practiceShell = null;

const scoreboard = createBoard();
const highBoard = createBoard();

for (const handedness of ["left", "right"]) {
  const grip = new THREE.Group();
  grip.matrixAutoUpdate = false;
  grip.visible = false;
  scene.add(grip);
  controllers.push({
    grip,
    sword: null,
    handedness,
    trail: createTrail(handedness === "left" ? 0xd6ff4a : 0xfff1cc),
    localBase: new THREE.Vector3(0, 0, -BLADE_ROOT),
    localTip: new THREE.Vector3(),
    base: new THREE.Vector3(),
    tip: new THREE.Vector3(),
    prevBase: new THREE.Vector3(),
    prevTip: new THREE.Vector3(),
    ready: false,
    canSlice: false,
  });
}

buildControllerSwords();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

form.addEventListener("submit", (event) => event.preventDefault());

enter.addEventListener("click", () => {
  if (running) return;
  applyForm();
  startAudio();

  // requestSession has to begin in this click, before any await.
  const sessionPromise = navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["plane-detection", "local-floor"],
    optionalFeatures: ["dom-overlay"],
    domOverlay: { root: overlay },
  });

  sessionPromise
    .then((session) => renderer.xr.setSession(session))
    .catch((error) => {
      note.textContent = error?.message || "Could not start AR.";
    });
});

practiceButton.addEventListener("click", () => {
  if (running) return;
  applyForm();
  startAudio();
  startPractice();
});

exit.addEventListener("click", () => {
  if (practicing) {
    leaveToSetup();
    return;
  }
  renderer.xr.getSession()?.end();
});

window.addEventListener("keydown", (event) => {
  if (!practicing) return;
  if (event.key === "Escape") leaveToSetup();
});

renderer.domElement.addEventListener("pointerdown", trackPointer);
renderer.domElement.addEventListener("pointermove", trackPointer);

renderer.xr.addEventListener("sessionstart", () => {
  practicing = false;
  running = true;
  ending = false;
  scanRequested = false;
  scanning = false;
  startedAt = performance.now();
  setup.hidden = true;
  overlay.style.display = "block";
  hint.textContent = "Swing · B or Y exits";
  for (const controller of controllers) controller.grip.matrixAutoUpdate = false;
  beginRound();
  clock.getDelta();
});

renderer.xr.addEventListener("sessionend", () => {
  if (!running) {
    overlay.style.display = "none";
    setup.hidden = false;
    return;
  }
  leaveToSetup();
});

renderer.setAnimationLoop((_time, frame) => {
  const dt = Math.min(0.05, clock.getDelta() || 0.016);
  lastDt = Math.max(0.008, dt);

  if (frame && running && !practicing) {
    exitFromControllers(frame);
    watchRoom(frame);
    updateXrControllers(frame);
  } else if (practicing) {
    updatePracticeSwords();
  }

  if (running) stepGame(dt);
  renderer.render(scene, camera);
});

applyQuery();
renderTables(0);
if (new URLSearchParams(location.search).has("practice")) startPractice();

function applyForm() {
  const modeValue = form.querySelector("#mode").value;
  modeId = MODE_LIST.some((mode) => mode.id === modeValue) ? modeValue : "fruit";
  const swords = form.querySelector("#swords").value;
  swordMode = swords === "left" || swords === "right" ? swords : "both";
  bladeLength = BLADE_LENGTHS[form.querySelector("#blade").value] || BLADE_LENGTHS.standard;
  const pace = form.querySelector("#pace").value;
  paceId = PACE[pace] ? pace : "busy";
  const round = form.querySelector("#round").value;
  roundSeconds = round === "endless" ? 0 : Math.max(0, Number(round) || 60);
  hazardsOn = form.querySelector("#hazards").checked;
  scan = form.querySelector("#scan").checked;
  buildControllerSwords();
}

function applyQuery() {
  const params = new URLSearchParams(location.search);
  for (const field of ["mode", "swords", "blade", "pace", "round"]) {
    const value = params.get(field);
    const select = form.querySelector(`#${field}`);
    if (!value || !select) continue;
    if ([...select.options].some((option) => option.value === value)) select.value = value;
  }
  if (params.get("hazards") === "0") form.querySelector("#hazards").checked = false;
}

function currentMode() {
  return MODE_LIST.find((mode) => mode.id === modeId) || MODE_LIST[0];
}

function handEnabled(handedness) {
  if (swordMode === "both") return true;
  return swordMode === handedness;
}

function practiceHand() {
  return swordMode === "left" ? "left" : "right";
}

function bladeReach() {
  return BLADE_ROOT + bladeLength;
}

function startPractice() {
  if (running) return;
  applyForm();
  practicing = true;
  running = true;
  setup.hidden = true;
  overlay.style.display = "block";
  document.body.classList.add("stage");
  renderer.domElement.classList.add("practice-view");
  renderer.setClearColor(0x101410, 1);
  hemi.intensity = 1.35;
  sun.intensity = 2.15;
  hint.textContent = "Drag to swing · Escape exits";
  camera.position.set(0, 1.62, 2.35);
  camera.lookAt(0, 1.18, 0.75);
  addPracticeSet();
  for (const controller of controllers) controller.grip.matrixAutoUpdate = true;
  beginRound();
  pointerHas = false;
  clock.getDelta();
}

function beginRound() {
  clearActors();
  score = 0;
  combo = 0;
  bestCombo = 0;
  lastSliceAt = 0;
  committed = false;
  locked = false;
  accepting = false;
  boardsPlaced = false;
  boardStamp = "";
  highlightAt = 0;
  elapsed = 0;
  remaining = roundSeconds;
  spawnIn = 0.3;
  armIn = 0.45;
  best = loadTables(localStorage)[modeId][0]?.score || 0;
  for (const controller of controllers) {
    controller.ready = false;
    controller.canSlice = false;
  }
  status.textContent = "Hold the swords out…";
}

function leaveToSetup() {
  commitScore();
  running = false;
  practicing = false;
  accepting = false;
  clearActors();
  hideSwords();
  overlay.style.display = "none";
  setup.hidden = false;
  document.body.classList.remove("stage");
  renderer.domElement.classList.remove("practice-view");
  renderer.setClearColor(0x000000, 0);
  hemi.intensity = 1.05;
  sun.intensity = 1.55;
  removePracticeSet();
  hint.textContent = "Swing · B or Y exits";
  note.textContent = resultNote();
  renderTables(highlightAt);
}

function resultNote() {
  const label = currentMode().label;
  if (storageFailed) return `${label} score ${score} could not be saved in this browser.`;
  if (highlightAt) return `${label} score ${score} is on the high score table.`;
  if (score > 0) return `${label} score ${score} did not make this mode’s table.`;
  return "Session ended. Enter AR to play again.";
}

function stepGame(dt) {
  capturePlay();
  if (armIn > 0) {
    armIn -= dt;
    if (armIn <= 0) {
      if (play.good) {
        placeBoards();
        accepting = true;
      } else {
        armIn = 0.2;
      }
    }
  }

  if (accepting && !locked) {
    elapsed += dt;
    if (roundSeconds > 0) {
      remaining -= dt;
      if (remaining <= 0) {
        remaining = 0;
        lockRound();
      }
    }
  }

  if (combo > 0 && lastSliceAt && (performance.now() - lastSliceAt) / 1000 > COMBO_WINDOW) combo = 0;

  updateTargets(dt);
  if (accepting && !locked) {
    maybeSpawn(dt);
    sliceAll();
  }
  rememberBlades();
  updateHalves(dt);
  updateParticles(dt);
  updatePopups(dt);
  updateTrails();
  updateBoards();
}

function lockRound() {
  if (locked) return;
  locked = true;
  accepting = false;
  commitScore();
  status.textContent = `Round over · ${score}`;
  const position = play.head.clone();
  position.y = Math.max(1.15, play.head.y - 0.1);
  position.addScaledVector(play.forward, practicing ? 0.85 : 0.7);
  spawnPopup(position, ["ROUND OVER", String(score)], "#d6ff4a", 1.7);
  playTone(523, 0, 0.12, "triangle", 0.05);
  playTone(784, 0.1, 0.18, "triangle", 0.05);
  boardStamp = "";
}

function commitScore() {
  if (committed) return;
  committed = true;
  highlightAt = 0;
  if (score <= 0) return;
  const at = Date.now();
  const tables = recordTableScore(loadTables(localStorage), modeId, {
    score,
    combo: bestCombo,
    at,
  });
  try {
    saveTables(localStorage, tables);
    storageFailed = false;
  } catch (error) {
    console.warn(error);
    storageFailed = true;
    return;
  }
  if (tables[modeId].some((entry) => entry.at === at)) highlightAt = at;
  renderTables(highlightAt);
}

function capturePlay() {
  if (practicing) {
    play.head.copy(camera.position);
    camera.getWorldDirection(play.forward);
  } else if (renderer.xr.isPresenting) {
    const xrCamera = renderer.xr.getCamera();
    xrCamera.getWorldPosition(play.head);
    xrCamera.getWorldDirection(play.forward);
  }
  play.forward.y = 0;
  if (play.forward.lengthSq() < 1e-4) play.forward.set(0, 0, -1);
  else play.forward.normalize();
  play.right.crossVectors(play.forward, tmp.up);
  if (play.right.lengthSq() < 1e-4) play.right.set(1, 0, 0);
  else play.right.normalize();
  play.good = practicing || play.head.y > 0.45;
}

function maybeSpawn(dt) {
  if (!play.good) return;
  spawnIn -= dt;
  if (spawnIn > 0) return;
  const pace = PACE[paceId];
  spawnIn = pace.gap * (0.85 + Math.random() * 0.3);
  const room = 16 - targets.length;
  if (room <= 0) return;
  const count = Math.min(pace.roll(), room);
  const mode = currentMode();
  for (const spread of spreadsFor(count)) {
    const hazard = hazardsOn ? mode.hazard : null;
    const def = chooseTarget(mode.pieces, hazard, hazardsOn ? mode.hazardChance : 0);
    if (def) spawnOne(def, spread);
  }
}

function spreadsFor(count) {
  if (count <= 1) {
    const side = Math.random() < 0.5 ? -1 : 1;
    return [side * (0.18 + Math.random() * 0.42)];
  }
  const spreads = [];
  for (let i = 0; i < count; i += 1) {
    const centered = i - (count - 1) / 2;
    spreads.push(centered * 0.46 + (Math.random() - 0.5) * 0.06);
  }
  return spreads;
}

function spawnDistance() {
  if (!practicing) return 1.02 + Math.random() * 0.3;
  const denom = play.forward.z || -1;
  if (Math.abs(denom) < 0.2) return 1.2;
  return (practicePlaneZ() - play.head.z) / denom;
}

function spawnOne(def, spread) {
  const group = instantiate(def);
  const distance = spawnDistance();
  group.position.copy(play.head);
  group.position.y = 0;
  group.position.addScaledVector(play.forward, distance);
  group.position.addScaledVector(play.right, spread);
  group.position.y = 0.3 + Math.random() * 0.18;
  group.rotation.y = Math.random() * Math.PI * 2;

  const velocity = new THREE.Vector3();
  const toward = Math.abs(spread) < 0.05
    ? (Math.random() - 0.5) * 0.45
    : -Math.sign(spread) * (0.22 + Math.random() * 0.5);
  velocity.addScaledVector(play.right, toward);
  velocity.y = 2.7 + Math.random() * 1.05;
  if (!practicing) velocity.addScaledVector(play.forward, (Math.random() - 0.5) * 0.32);

  scene.add(group);
  targets.push({
    id: def.id,
    name: def.name,
    group,
    velocity,
    spin: new THREE.Vector3(
      (Math.random() - 0.5) * 2.4,
      (Math.random() - 0.5) * 1.6,
      (Math.random() - 0.5) * 2.4,
    ),
    radius: def.radius,
    points: def.points,
    inside: def.inside,
    hazard: Boolean(def.hazard),
    stitch: Boolean(def.stitch),
    capMap: def.capMap || null,
    capEmissive: def.capEmissive || 0,
    burst: def.burst || def.inside,
    cuts: 0,
    age: 0,
    sliced: false,
    dead: false,
  });
}

function updateTargets(dt) {
  for (const target of targets) {
    if (target.sliced) continue;
    target.velocity.y -= GRAVITY * dt;
    target.group.position.addScaledVector(target.velocity, dt);
    target.group.rotation.x += target.spin.x * dt;
    target.group.rotation.y += target.spin.y * dt;
    target.group.rotation.z += target.spin.z * dt;
    target.age += dt;
    if (target.group.position.y < -0.45 || target.age > 6) target.dead = true;
  }
}

function sliceAll() {
  for (const controller of controllers) {
    if (!controller.canSlice) continue;
    const segments = swingSegments(controller.prevBase, controller.prevTip, controller.base, controller.tip);
    const hits = [];
    for (const target of targets) considerSlice(hits, target, segments, controller);
    for (const half of halves) considerSlice(hits, half, segments, controller);
    hits.sort((a, b) => a.along - b.along);
    for (const entry of hits) {
      if (entry.target.sliced) continue;
      entry.target.sliced = true;
      resolveSlice(entry.target, controller, entry.hit);
    }
  }

  for (let i = targets.length - 1; i >= 0; i -= 1) {
    const target = targets[i];
    if (!target.sliced && !target.dead) continue;
    if (!target.sliced) scene.remove(target.group);
    targets.splice(i, 1);
  }

  for (let i = halves.length - 1; i >= 0; i -= 1) {
    if (!halves[i].sliced) continue;
    disposeHalf(halves[i]);
    halves.splice(i, 1);
  }
}

function considerSlice(hits, target, segments, controller) {
  if (!canCut(target)) return;
  const center = pieceCenter(target, tmp.hit);
  const hit = bladeHit(segments, center, target.radius);
  if (!hit) return;
  hits.push({
    target,
    hit,
    along: center.distanceToSquared(controller.prevTip),
  });
}

function canCut(piece) {
  if (piece.sliced || piece.dead) return false;
  if (piece.ripe && performance.now() < piece.ripe) return false;
  if (piece.hazard) return true;
  return canSliceAgain(piece.cuts || 0);
}

function pieceCenter(piece, out) {
  if (!piece.hitLocal) return out.copy(piece.group.position);
  return piece.group.localToWorld(out.copy(piece.hitLocal));
}

function resolveSlice(target, controller, hit) {
  const now = performance.now();
  const gap = lastSliceAt ? (now - lastSliceAt) / 1000 : 10;
  combo = advanceCombo(combo, gap, target.hazard);
  if (combo > bestCombo) bestCombo = combo;
  lastSliceAt = now;
  const points = pointsForSlice({
    base: target.points,
    combo,
    clean: hit.clean,
    hazard: target.hazard,
    cuts: target.cuts || 0,
  });
  score = Math.max(0, score + points);
  const at = pieceCenter(target, tmp.hit).clone();
  spawnPopup(
    at,
    popupLines(points, combo, hit.clean, target.hazard),
    popupColor(points, hit.clean, target.hazard),
  );

  if (target.hazard) {
    burst(at, target.burst, target.id === "hole");
    scene.remove(target.group);
    playHazard();
    return;
  }

  cutNormal(controller, tmp.cut);
  splitTarget(target, tmp.cut, controller);
  burst(at, target.inside, false);
  playSlice(hit.clean, combo);
}

function cutNormal(controller, out) {
  tmp.blade.copy(controller.tip).sub(controller.base);
  tmp.swing.copy(controller.tip).sub(controller.prevTip);
  out.crossVectors(tmp.blade, tmp.swing);
  if (out.lengthSq() < 1e-8) out.crossVectors(tmp.blade, tmp.up);
  if (out.lengthSq() < 1e-8) out.set(0, 1, 0);
  return out.normalize();
}

function splitTarget(target, normal, controller) {
  target.group.updateWorldMatrix(true, true);
  tmp.inverse.copy(target.group.matrixWorld).invert();
  tmp.localNormal.copy(normal).transformDirection(tmp.inverse);
  if (tmp.localNormal.lengthSq() < 1e-8) tmp.localNormal.set(0, 1, 0);
  else tmp.localNormal.normalize();
  pieceCenter(target, tmp.a);
  tmp.localPoint.copy(tmp.a).applyMatrix4(tmp.inverse);

  const swing = controller.tip.clone().sub(controller.prevTip);
  if (swing.lengthSq() > 1e-8) swing.normalize();
  else swing.set(0, 0, 0);

  const positive = tmp.localNormal.clone();
  const point = tmp.localPoint.clone();
  halves.push(makeHalf(target, positive, point, swing));
  halves.push(makeHalf(target, positive.clone().negate(), point.clone(), swing));
  scene.remove(target.group);
  while (halves.length > 42) disposeHalf(halves.shift());
}

function makeHalf(target, localNormal, localPoint, swing) {
  const group = target.group.clone(true);
  group.traverse((obj) => {
    if (obj.userData.ownGeometry && obj.geometry) obj.geometry = obj.geometry.clone();
  });
  const facing = localNormal.clone();
  if (facing.lengthSq() < 1e-8) facing.set(0, 1, 0);
  else facing.normalize();

  const localPlanes = (target.localPlanes || []).map((plane) => plane.clone());
  localPlanes.push(new THREE.Plane().setFromNormalAndCoplanarPoint(facing, localPoint));
  const worldPlanes = localPlanes.map(() => new THREE.Plane());
  assignClipPlanes(group, worldPlanes);

  const capMat = new THREE.MeshStandardMaterial({
    color: target.capMap ? 0xffffff : target.inside,
    roughness: 0.58,
    metalness: 0.02,
    side: THREE.DoubleSide,
    clippingPlanes: worldPlanes,
    clipShadows: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  if (target.capMap) capMat.map = target.capMap;
  else if (target.stitch) {
    capMat.map = stitchTexture;
    capMat.color.setHex(target.inside);
  }
  if (target.capEmissive) {
    capMat.emissive.setHex(target.capEmissive);
    capMat.emissiveIntensity = 0.55;
  }
  const cap = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.04, target.radius * 0.9), 18), capMat);
  cap.userData.ownGeometry = true;
  cap.frustumCulled = false;
  cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing);
  cap.position.copy(localPoint).addScaledVector(facing, 0.005);
  group.add(cap);

  const hitLocal = target.hitLocal ? target.hitLocal.clone() : new THREE.Vector3();
  hitLocal.addScaledVector(facing, target.radius * 0.4);

  scene.add(group);
  const half = {
    id: target.id,
    name: target.name,
    group,
    velocity: target.velocity.clone(),
    radius: Math.max(0.05, target.radius * 0.67),
    points: target.points,
    cuts: (target.cuts || 0) + 1,
    inside: target.inside,
    hazard: false,
    stitch: Boolean(target.stitch),
    capMap: target.capMap || null,
    capEmissive: target.capEmissive || 0,
    burst: target.burst || target.inside,
    hitLocal,
    localPlanes,
    worldPlanes,
    sliced: false,
    dead: false,
    ripe: performance.now() + 150,
    axis: new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(),
    spin: 2.4 + Math.random() * 2.2,
    age: 0,
  };
  const push = facing.clone().transformDirection(group.matrixWorld);
  if (push.lengthSq() > 1e-8) half.velocity.addScaledVector(push.normalize(), 0.9);
  if (swing.lengthSq() > 0) half.velocity.addScaledVector(swing, 0.45);
  half.velocity.y += 0.2;
  updateHalfPlanes(half);
  return half;
}

function assignClipPlanes(group, worldPlanes) {
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    const source = Array.isArray(obj.material) ? obj.material : [obj.material];
    const cloned = source.map((material) => {
      const next = material.clone();
      next.clippingPlanes = worldPlanes;
      next.clipShadows = true;
      next.side = THREE.DoubleSide;
      next.needsUpdate = true;
      return next;
    });
    obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
  });
}

function updateHalfPlanes(half) {
  half.group.updateWorldMatrix(true, true);
  for (let i = 0; i < half.localPlanes.length; i += 1) {
    half.worldPlanes[i].copy(half.localPlanes[i]).applyMatrix4(half.group.matrixWorld);
  }
}

function updateHalves(dt) {
  for (let i = halves.length - 1; i >= 0; i -= 1) {
    const half = halves[i];
    half.age += dt;
    half.velocity.y -= GRAVITY * dt;
    half.group.position.addScaledVector(half.velocity, dt);
    half.group.rotateOnWorldAxis(half.axis, half.spin * dt);
    // Clip planes are local, so they have to be rewritten into world space as the piece tumbles.
    updateHalfPlanes(half);
    if (half.age > 2.6 || half.group.position.y < -0.6) {
      disposeHalf(half);
      halves.splice(i, 1);
    }
  }
}

function burst(position, color, inward) {
  const count = inward ? 14 : 8;
  for (let i = 0; i < count; i += 1) {
    if (particles.length > 90) return;
    const material = new THREE.MeshBasicMaterial({ color, transparent: true });
    const mesh = new THREE.Mesh(chipGeometry, material);
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize();
    mesh.position.copy(position).addScaledVector(dir, inward ? 0.2 : 0.03);
    const velocity = dir.clone().multiplyScalar(inward ? -0.85 : 1.2 + Math.random() * 0.8);
    velocity.y += inward ? 0.05 : 0.7;
    scene.add(mesh);
    particles.push({ mesh, velocity, age: 0, life: inward ? 0.55 : 0.42 });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.age += dt;
    particle.velocity.y -= GRAVITY * dt;
    particle.mesh.position.addScaledVector(particle.velocity, dt);
    const fade = 1 - particle.age / particle.life;
    particle.mesh.material.opacity = Math.max(0, fade);
    particle.mesh.scale.setScalar(Math.max(0.2, fade));
    if (particle.age >= particle.life) {
      scene.remove(particle.mesh);
      particle.mesh.material.dispose();
      particles.splice(i, 1);
    }
  }
}

function popupLines(points, chain, clean, hazard) {
  const text = `${points > 0 ? "+" : ""}${points}`;
  if (hazard) return [text, "watch it"];
  if (clean && chain > 1) return [text, `clean x${chain}`];
  if (clean) return [text, "clean"];
  if (chain > 1) return [text, `x${chain}`];
  return [text];
}

function popupColor(points, clean, hazard) {
  if (hazard || points < 0) return "#ff5d73";
  if (clean) return "#ffb45a";
  if (points >= 40) return "#d6ff4a";
  return "#f4f7ef";
}

function spawnPopup(position, lines, color, life = 0.9) {
  while (popups.length > 14) disposePopup(popups.shift());
  const sprite = makePopup(lines, color);
  sprite.position.copy(position);
  sprite.position.y += 0.14;
  scene.add(sprite);
  popups.push({
    sprite,
    age: 0,
    life,
    y0: sprite.position.y,
    baseX: sprite.scale.x,
    baseY: sprite.scale.y,
  });
}

function updatePopups(dt) {
  for (let i = popups.length - 1; i >= 0; i -= 1) {
    const popup = popups[i];
    popup.age += dt;
    const t = popup.age / popup.life;
    const pop = 0.72 + 0.28 * Math.min(1, popup.age / 0.12);
    popup.sprite.position.y = popup.y0 + Math.min(1, t) * 0.42;
    popup.sprite.scale.set(popup.baseX * pop, popup.baseY * pop, 1);
    popup.sprite.material.opacity = t < 0.62 ? 1 : Math.max(0, 1 - (t - 0.62) / 0.38);
    if (popup.age >= popup.life) {
      disposePopup(popup);
      popups.splice(i, 1);
    }
  }
}

function makePopup(lines, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.fillStyle = color;
  ctx.lineWidth = 14;
  ctx.font = "700 112px Georgia, serif";
  ctx.strokeText(lines[0], 256, 118);
  ctx.fillText(lines[0], 256, 118);
  if (lines[1]) {
    ctx.lineWidth = 8;
    ctx.font = "700 52px ui-monospace, monospace";
    ctx.strokeText(lines[1], 256, 190);
    ctx.fillText(lines[1], 256, 190);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const width = lines[1] ? 0.5 : 0.4;
  sprite.scale.set(width, width * 0.5, 1);
  sprite.renderOrder = 3;
  return sprite;
}

function placeBoards() {
  const distance = practicing ? 1.0 : 1.85;
  const lateral = practicing ? 0.52 : 1.16;
  const y = practicing ? 1.58 : 1.5;
  const scale = practicing ? 0.55 : 1;
  placeOneBoard(scoreboard, -1, distance, lateral, y, scale);
  placeOneBoard(highBoard, 1, distance, lateral, y, scale);
  boardsPlaced = true;
  boardStamp = "";
}

function placeOneBoard(board, side, distance, lateral, y, scale) {
  board.mesh.position.copy(play.head);
  board.mesh.position.y = 0;
  board.mesh.position.addScaledVector(play.forward, distance);
  board.mesh.position.addScaledVector(play.right, side * lateral);
  board.mesh.position.y = y;
  board.mesh.scale.setScalar(scale);
  aimBoard(board.mesh, play.head);
  board.mesh.visible = true;
}

function aimBoard(mesh, head) {
  tmp.zAxis.set(head.x - mesh.position.x, 0, head.z - mesh.position.z);
  if (tmp.zAxis.lengthSq() < 1e-6) tmp.zAxis.set(0, 0, 1);
  tmp.zAxis.normalize();
  tmp.xAxis.crossVectors(tmp.up, tmp.zAxis).normalize();
  tmp.yAxis.crossVectors(tmp.zAxis, tmp.xAxis).normalize();
  mesh.quaternion.setFromRotationMatrix(tmp.basis.makeBasis(tmp.xAxis, tmp.yAxis, tmp.zAxis));
}

function updateBoards() {
  if (!boardsPlaced) return;
  const second = roundSeconds > 0 ? Math.ceil(Math.max(0, remaining)) : Math.floor(elapsed);
  const stamp = `${score}|${combo}|${bestCombo}|${second}|${locked}|${highlightAt}|${best}`;
  if (stamp === boardStamp) return;
  boardStamp = stamp;
  drawScoreboard(scoreboard.ctx);
  drawHighScores(highBoard.ctx);
  scoreboard.texture.needsUpdate = true;
  highBoard.texture.needsUpdate = true;
  if (!locked && !scanning) {
    const clockLabel = roundSeconds > 0 ? formatClock(remaining) : formatClock(elapsed);
    status.textContent = `${currentMode().label} · ${clockLabel} · ${score}`;
  }
}

function drawScoreboard(ctx) {
  const mode = currentMode();
  paintPanel(ctx);
  ctx.fillStyle = "#d6ff4a";
  ctx.font = "600 40px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillText(mode.label.toUpperCase(), 56, 92);
  ctx.textAlign = "right";
  ctx.fillStyle = "#93a08b";
  ctx.font = "500 32px ui-monospace, monospace";
  ctx.fillText(swordLabel(), 968, 92);

  ctx.textAlign = "left";
  ctx.fillStyle = "#f4f7ef";
  drawBigNumber(ctx, String(score), 56, 268, 900);

  ctx.font = "500 36px ui-monospace, monospace";
  ctx.fillStyle = combo > 1 ? "#d6ff4a" : "#93a08b";
  const chain = combo > 1 ? `combo x${combo}` : "combo —";
  const timeLabel = roundSeconds > 0 ? `${formatClock(remaining)} left` : `${formatClock(elapsed)} played`;
  ctx.fillText(`${chain}    ${timeLabel}`, 56, 348);

  const ahead = score > best && score > 0;
  ctx.fillStyle = ahead || (locked && highlightAt) ? "#ffb45a" : "#93a08b";
  let bestLine = "best —";
  if (ahead && best > 0) bestLine = `best ${best}   ·   new best`;
  else if (ahead) bestLine = "new best";
  else if (best > 0) bestLine = `best ${best}`;
  if (locked && highlightAt) bestLine += "   ·   saved";
  else if (locked && score > 0) bestLine += "   ·   off the table";
  const chainBest = bestCombo > 1 ? `    best chain x${bestCombo}` : "";
  ctx.fillText(`${bestLine}${chainBest}`, 56, 430);
}

function drawHighScores(ctx) {
  paintPanel(ctx);
  ctx.textAlign = "left";
  ctx.fillStyle = "#d6ff4a";
  ctx.font = "600 36px ui-monospace, monospace";
  ctx.fillText("HIGH SCORES", 56, 86);
  ctx.fillStyle = "#93a08b";
  ctx.font = "500 28px ui-monospace, monospace";
  ctx.fillText(currentMode().label, 56, 128);

  const rows = rowsForBoard();
  ctx.font = "600 40px ui-monospace, monospace";
  for (let i = 0; i < 5; i += 1) {
    const row = rows[i];
    const y = 196 + i * 48;
    ctx.fillStyle = row?.pending || row?.fresh ? "#d6ff4a" : "#e8f0df";
    const rank = row?.pending ? "now" : String(i + 1);
    ctx.fillText(rank, 56, y);
    ctx.fillText(row ? String(row.score) : "—", 220, y);
    ctx.fillStyle = "#93a08b";
    ctx.fillText(row && row.combo > 1 ? `x${row.combo}` : "", 520, y);
  }

  ctx.font = "500 30px ui-monospace, monospace";
  ctx.fillStyle = "#93a08b";
  ctx.fillText(`this round   ${score}`, 56, 460);
}

function rowsForBoard() {
  let stored = [];
  try {
    stored = loadTables(localStorage)[modeId].slice(0, 5);
  } catch {
    stored = [];
  }
  if (committed || score <= 0) {
    return stored.map((entry) => ({ ...entry, fresh: entry.at === highlightAt }));
  }
  const pending = { score, combo: bestCombo, at: Number.MAX_SAFE_INTEGER, pending: true };
  return stored
    .concat(pending)
    .sort(compareScores)
    .slice(0, 5);
}

function paintPanel(ctx) {
  ctx.clearRect(0, 0, 1024, 512);
  roundRect(ctx, 20, 20, 984, 472, 42);
  ctx.fillStyle = "rgba(12, 16, 12, 0.9)";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(214, 255, 74, 0.9)";
  ctx.stroke();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawBigNumber(ctx, text, x, y, maxWidth) {
  let size = 168;
  ctx.font = `600 ${size}px Georgia, serif`;
  while (size > 72 && ctx.measureText(text).width > maxWidth) {
    size -= 8;
    ctx.font = `600 ${size}px Georgia, serif`;
  }
  ctx.fillText(text, x, y);
}

function swordLabel() {
  if (swordMode === "both") return "two swords";
  if (swordMode === "left") return "left hand";
  return "right hand";
}

function renderTables(freshAt) {
  const root = document.querySelector("#scores");
  root.replaceChildren();
  let tables;
  try {
    tables = loadTables(localStorage);
  } catch {
    tables = { fruit: [], animals: [], cosmos: [] };
  }

  for (const mode of MODE_LIST) {
    const section = document.createElement("section");
    section.className = "score-mode";
    const title = document.createElement("h3");
    title.textContent = mode.label;
    section.append(title);
    const list = tables[mode.id] || [];
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "score-empty";
      empty.textContent = "No scores yet.";
      section.append(empty);
    } else {
      const table = document.createElement("table");
      const head = document.createElement("tr");
      for (const label of ["#", "Score", "Chain", "When"]) {
        const cell = document.createElement("th");
        cell.textContent = label;
        head.append(cell);
      }
      table.append(head);
      list.forEach((entry, index) => {
        const row = document.createElement("tr");
        if (entry.at && entry.at === freshAt) row.className = "fresh";
        row.append(
          cell(String(index + 1), false),
          cell(String(entry.score), true),
          cell(entry.combo > 1 ? `x${entry.combo}` : "—", false),
          cell(formatWhen(entry.at), false),
        );
        table.append(row);
      });
      section.append(table);
    }
    root.append(section);
  }
}

function cell(text, points) {
  const node = document.createElement("td");
  if (points) node.className = "pts";
  node.textContent = text;
  return node;
}

function formatWhen(at) {
  if (!at) return "";
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
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

function watchRoom(frame) {
  const detected = frame.detectedPlanes;
  const total = detected ? detected.size : 0;
  if (!scan || scanRequested || total > 0 || scanning) return;
  if (performance.now() - startedAt < 4000) return;
  scanRequested = true;
  const session = frame.session;
  if (typeof session.initiateRoomCapture !== "function") return;
  scanning = true;
  status.textContent = "Starting room scan…";
  session.initiateRoomCapture().then(() => {
    scanning = false;
  }).catch(() => {
    scanning = false;
    status.textContent = "Room scan was dismissed.";
  });
}

function updateXrControllers(frame) {
  const referenceSpace = renderer.xr.getReferenceSpace();
  for (const controller of controllers) {
    const source = [...frame.session.inputSources].find((entry) => entry.handedness === controller.handedness);
    const space = source?.gripSpace || source?.targetRaySpace;
    const pose = space && referenceSpace ? frame.getPose(space, referenceSpace) : null;
    const enabled = handEnabled(controller.handedness);
    if (!pose || !enabled) {
      controller.grip.visible = false;
      if (controller.sword) controller.sword.visible = false;
      refreshBlade(controller, false);
      continue;
    }
    controller.grip.visible = true;
    controller.sword.visible = true;
    controller.grip.matrixAutoUpdate = false;
    controller.grip.matrix.fromArray(pose.transform.matrix);
    controller.grip.updateMatrixWorld(true);
    refreshBlade(controller, true);
  }
}

function updatePracticeSwords() {
  const planeZ = practicePlaneZ();
  tmp.plane.set(new THREE.Vector3(0, 0, 1), -planeZ);
  let tipPoint = tmp.tipPoint.set(practiceHand() === "left" ? -0.05 : 0.05, 1.16, planeZ);
  if (pointerHas) {
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.ray.intersectPlane(tmp.plane, tmp.hit);
    if (hit) tipPoint = hit;
  }

  for (const controller of controllers) {
    const enabled = handEnabled(controller.handedness);
    if (!enabled) {
      controller.grip.visible = false;
      controller.sword.visible = false;
      refreshBlade(controller, false);
      continue;
    }
    controller.grip.visible = true;
    controller.sword.visible = true;
    const active = controller.handedness === practiceHand();
    const side = controller.handedness === "left" ? -1 : 1;
    const aim = active
      ? tipPoint
      : tmp.a.set(side * 0.58, 0.78, planeZ + 0.08);
    holdSword(controller, aim);
  }
}

function holdSword(controller, tipPoint) {
  const side = controller.handedness === "left" ? -1 : 1;
  tmp.anchor.set(side * 0.22, 1.02, tipPoint.z + 0.48);
  tmp.dir.copy(tipPoint).sub(tmp.anchor);
  if (tmp.dir.lengthSq() < 1e-6) tmp.dir.set(0, 0, -1);
  tmp.dir.normalize();
  controller.grip.matrixAutoUpdate = true;
  controller.grip.position.copy(tipPoint).addScaledVector(tmp.dir, -bladeReach());
  // lookAt points an object's +Z at the target. The blade runs along -Z, so aim +Z back up the handle.
  tmp.b.copy(controller.grip.position).addScaledVector(tmp.dir, -1);
  controller.grip.up.set(0, 1, 0);
  controller.grip.lookAt(tmp.b);
  controller.grip.updateMatrixWorld(true);
  refreshBlade(controller, true);
}

function practicePlaneZ() {
  return 0.86;
}

function refreshBlade(controller, enabled) {
  if (!enabled || !controller.grip.visible || !controller.sword) {
    controller.canSlice = false;
    controller.ready = false;
    controller.tipSpeed = 0;
    return;
  }
  updateBladePoints(controller);
  if (!controller.ready) {
    controller.prevTip.copy(controller.tip);
    controller.prevBase.copy(controller.base);
    controller.ready = true;
    controller.canSlice = false;
    controller.tipSpeed = 0;
    return;
  }
  const moved = controller.tip.distanceTo(controller.prevTip);
  controller.tipSpeed = moved / lastDt;
  controller.canSlice = moved >= 0.012 && controller.tipSpeed >= MIN_SLICE_SPEED;
}

function updateBladePoints(controller) {
  tmp.a.copy(controller.localBase);
  controller.sword.localToWorld(tmp.a);
  controller.base.copy(tmp.a);
  tmp.b.copy(controller.localTip);
  controller.sword.localToWorld(tmp.b);
  controller.tip.copy(tmp.b);
}

function rememberBlades() {
  for (const controller of controllers) {
    if (!controller.ready) continue;
    controller.prevTip.copy(controller.tip);
    controller.prevBase.copy(controller.base);
  }
}

function updateTrails() {
  for (const controller of controllers) {
    const trail = controller.trail;
    const live = running && controller.grip.visible && controller.sword?.visible && handEnabled(controller.handedness);
    if (!live) {
      clearTrail(trail);
      continue;
    }
    const last = trail.samples[trail.samples.length - 1];
    const moving = !last || last.point.distanceTo(controller.tip) > 0.008;
    if (moving && (controller.tipSpeed > 0.35 || trail.samples.length > 0)) pushSample(trail, controller.tip);
    else decayTrail(trail);
    rebuildTrail(trail);
  }
}

function trackPointer(event) {
  if (!practicing) return;
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  pointerHas = true;
  if (!audioCtx) startAudio();
}

function hideSwords() {
  for (const controller of controllers) {
    controller.grip.visible = false;
    if (controller.sword) controller.sword.visible = false;
    controller.ready = false;
    controller.canSlice = false;
    clearTrail(controller.trail);
  }
}

function clearActors() {
  for (const target of targets) scene.remove(target.group);
  targets.length = 0;
  while (halves.length) disposeHalf(halves.pop());
  while (particles.length) {
    const particle = particles.pop();
    scene.remove(particle.mesh);
    particle.mesh.material.dispose();
  }
  while (popups.length) disposePopup(popups.pop());
  for (const controller of controllers) clearTrail(controller.trail);
  scoreboard.mesh.visible = false;
  highBoard.mesh.visible = false;
  boardsPlaced = false;
  boardStamp = "";
}

function disposeHalf(half) {
  scene.remove(half.group);
  const materials = new Set();
  half.group.traverse((obj) => {
    if (!obj.isMesh) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of list) if (material) materials.add(material);
    if (obj.userData.ownGeometry) obj.geometry.dispose();
  });
  for (const material of materials) material.dispose();
}

function disposePopup(popup) {
  scene.remove(popup.sprite);
  popup.sprite.material.map?.dispose();
  popup.sprite.material.dispose();
}

function disposeObject3D(root) {
  const geos = new Set();
  const materials = new Set();
  root.traverse((obj) => {
    if (obj.geometry) geos.add(obj.geometry);
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of list) if (material) materials.add(material);
  });
  for (const geometry of geos) geometry.dispose();
  for (const material of materials) material.dispose();
}

function addPracticeSet() {
  removePracticeSet();
  practiceShell = new THREE.Mesh(
    new THREE.SphereGeometry(16, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x141a16, side: THREE.BackSide }),
  );
  floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 48),
    new THREE.MeshStandardMaterial({ color: 0x1c261e, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(practiceShell, floor);
}

function removePracticeSet() {
  if (practiceShell) {
    scene.remove(practiceShell);
    practiceShell.geometry.dispose();
    practiceShell.material.dispose();
    practiceShell = null;
  }
  if (floor) {
    scene.remove(floor);
    floor.geometry.dispose();
    floor.material.dispose();
    floor = null;
  }
}

let audioCtx = null;
let noiseBuffer = null;

function startAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (!noiseBuffer) {
      noiseBuffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.2), audioCtx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
  } catch (error) {
    console.warn(error);
    audioCtx = null;
  }
}

function playSlice(clean, chain) {
  if (!audioCtx || !noiseBuffer) return;
  const now = audioCtx.currentTime;
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = clean ? 1900 : 980;
  filter.Q.value = 0.7;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.16, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
  src.connect(filter).connect(gain).connect(audioCtx.destination);
  src.start(now);
  src.stop(now + 0.14);
  playTone(380 + Math.min(chain, 8) * 55, 0, 0.09, "triangle", 0.045);
}

function playHazard() {
  playTone(110, 0, 0.22, "sawtooth", 0.06);
  playTone(70, 0.05, 0.28, "triangle", 0.05);
}

function playTone(freq, delay, dur, type, gainValue) {
  if (!audioCtx || gainValue <= 0) return;
  const now = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(gainValue, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

function createBoard() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.46), material);
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);
  return { mesh, canvas, texture, ctx: canvas.getContext("2d") };
}

function createTrail(color) {
  const max = 16;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(max * 2 * 3);
  const colors = new Float32Array(max * 2 * 3);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const indices = [];
  for (let i = 0; i < max - 1; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(indices);
  geometry.setDrawRange(0, 0);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 2;
  scene.add(mesh);
  return { mesh, max, samples: [], pool: [], color, positions, colors };
}

function pushSample(trail, point) {
  const vector = trail.pool.pop() || new THREE.Vector3();
  vector.copy(point);
  trail.samples.push({ point: vector, born: performance.now() });
  trimTrail(trail);
}

function decayTrail(trail) {
  const cutoff = performance.now() - 90;
  while (trail.samples.length && trail.samples[0].born < cutoff) {
    trail.pool.push(trail.samples.shift().point);
  }
}

function trimTrail(trail) {
  const cutoff = performance.now() - 200;
  while (trail.samples.length && trail.samples[0].born < cutoff) {
    trail.pool.push(trail.samples.shift().point);
  }
  while (trail.samples.length > trail.max) trail.pool.push(trail.samples.shift().point);
}

function clearTrail(trail) {
  while (trail.samples.length) trail.pool.push(trail.samples.pop().point);
  trail.mesh.visible = false;
  trail.mesh.geometry.setDrawRange(0, 0);
}

function rebuildTrail(trail) {
  const { samples, positions, colors, mesh } = trail;
  if (samples.length < 2) {
    mesh.visible = false;
    mesh.geometry.setDrawRange(0, 0);
    return;
  }
  mesh.visible = true;
  const now = performance.now();
  const color = tmp.color.setHex(trail.color);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const prev = samples[Math.max(0, i - 1)].point;
    const next = samples[Math.min(samples.length - 1, i + 1)].point;
    tmp.motion.copy(next).sub(prev);
    if (tmp.motion.lengthSq() < 1e-8) tmp.motion.set(0, 1, 0);
    tmp.side.crossVectors(tmp.motion, tmp.up);
    if (tmp.side.lengthSq() < 1e-6) tmp.side.crossVectors(tmp.motion, tmp.forward);
    tmp.side.normalize().multiplyScalar(0.02);
    const fade = Math.max(0, 1 - (now - sample.born) / 200);
    const offset = i * 6;
    positions[offset] = sample.point.x + tmp.side.x;
    positions[offset + 1] = sample.point.y + tmp.side.y;
    positions[offset + 2] = sample.point.z + tmp.side.z;
    positions[offset + 3] = sample.point.x - tmp.side.x;
    positions[offset + 4] = sample.point.y - tmp.side.y;
    positions[offset + 5] = sample.point.z - tmp.side.z;
    colors[offset] = color.r * fade;
    colors[offset + 1] = color.g * fade;
    colors[offset + 2] = color.b * fade;
    colors[offset + 3] = color.r * fade;
    colors[offset + 4] = color.g * fade;
    colors[offset + 5] = color.b * fade;
  }
  mesh.geometry.getAttribute("position").needsUpdate = true;
  mesh.geometry.getAttribute("color").needsUpdate = true;
  mesh.geometry.setDrawRange(0, (samples.length - 1) * 6);
}

function buildControllerSwords() {
  for (const controller of controllers) {
    if (controller.sword) {
      controller.grip.remove(controller.sword);
      disposeObject3D(controller.sword);
    }
    controller.sword = createSword(bladeLength);
    // Grip spaces are mirrored. Mirroring X turns the right-hand edge onto the left palm.
    if (controller.handedness === "left") controller.sword.scale.x = -1;
    controller.localBase.set(0, 0, -BLADE_ROOT);
    controller.localTip.set(0, 0, -(BLADE_ROOT + bladeLength));
    controller.grip.add(controller.sword);
    controller.sword.visible = false;
    controller.ready = false;
  }
}

function createSword(length) {
  const group = new THREE.Group();
  const wrap = standardMat(0xf0e2cc, { roughness: 0.78 });
  const ito = standardMat(0x231812, { roughness: 0.72 });
  const brass = standardMat(0xc6a15b, { roughness: 0.32, metalness: 0.78 });
  const steel = standardMat(0xe7eef5, {
    roughness: 0.16,
    metalness: 0.92,
    side: THREE.DoubleSide,
  });

  addMesh(group, new THREE.CylinderGeometry(0.016, 0.018, 0.2, 12), wrap, 0, 0, -0.11, 1, 1, 1, -Math.PI / 2);
  for (let i = 0; i < 8; i += 1) {
    addMesh(
      group,
      new THREE.TorusGeometry(0.019, 0.0032, 6, 12),
      i % 2 ? ito : brass,
      0,
      0,
      -0.028 - i * 0.022,
    );
  }
  const pommel = addMesh(group, new THREE.SphereGeometry(0.02, 12, 10), brass, 0, 0, 0.012);
  pommel.scale.z = 0.7;
  addMesh(group, new THREE.CylinderGeometry(0.048, 0.048, 0.008, 8), brass, 0, 0, -0.228, 1, 1, 1, -Math.PI / 2);
  addMesh(group, new THREE.CylinderGeometry(0.02, 0.018, 0.028, 10), brass, 0, 0, -0.246, 1, 1, 1, -Math.PI / 2);

  const blade = new THREE.Mesh(createBladeGeometry(length), steel);
  blade.position.z = -BLADE_ROOT;
  group.add(blade);
  group.traverse((obj) => {
    obj.frustumCulled = false;
  });
  return group;
}

function createBladeGeometry(length) {
  const segments = 18;
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const section = bladeSection(i / segments, length);
    positions.push(...section.edge, ...section.spineA, ...section.spineB);
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * 3;
    const b = (i + 1) * 3;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
    indices.push(a, a + 2, b, b, a + 2, b + 2);
    indices.push(a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function instantiate(def) {
  let template = templates.get(def.id);
  if (!template) {
    template = def.build();
    template.traverse((obj) => {
      obj.frustumCulled = false;
    });
    templates.set(def.id, template);
  }
  const group = template.clone(true);
  group.name = def.id;
  group.traverse((obj) => {
    obj.frustumCulled = false;
  });
  return group;
}

function standardMat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: extra.roughness ?? 0.45,
    metalness: extra.metalness ?? 0.04,
    ...extra,
  });
}

function addMesh(group, geometry, material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.set(rx, ry, rz);
  group.add(mesh);
  return mesh;
}

function addEyes(group, x, y, z, apart) {
  const white = standardMat(0xf7f4ea, { roughness: 0.3 });
  const pupil = standardMat(0x161616, { roughness: 0.4 });
  addMesh(group, new THREE.SphereGeometry(0.014, 8, 6), white, x - apart, y, z);
  addMesh(group, new THREE.SphereGeometry(0.014, 8, 6), white, x + apart, y, z);
  addMesh(group, new THREE.SphereGeometry(0.006, 6, 6), pupil, x - apart, y, z + 0.01);
  addMesh(group, new THREE.SphereGeometry(0.006, 6, 6), pupil, x + apart, y, z + 0.01);
}

function buildApple() {
  const group = new THREE.Group();
  const skin = standardMat(0xd23b3b, { roughness: 0.32, emissive: 0x4a1010, emissiveIntensity: 0.25 });
  addMesh(group, new THREE.SphereGeometry(0.11, 20, 16), skin, 0, 0, 0, 1, 0.94, 1);
  addMesh(group, new THREE.CylinderGeometry(0.008, 0.01, 0.07, 6), standardMat(0x6b4226, { roughness: 0.8 }), 0, 0.12, 0);
  addMesh(group, new THREE.SphereGeometry(0.035, 8, 6), standardMat(0x3f8f45), 0.03, 0.13, 0.01, 1.4, 0.28, 0.8);
  return group;
}

function buildOrange() {
  const group = new THREE.Group();
  addMesh(group, new THREE.SphereGeometry(0.105, 18, 14), standardMat(0xf08a24, { roughness: 0.55, emissive: 0x6a2e08, emissiveIntensity: 0.18 }), 0, 0, 0);
  addMesh(group, new THREE.SphereGeometry(0.03, 8, 6), standardMat(0x3f8f45), 0.02, 0.1, 0, 1.2, 0.3, 0.7);
  return group;
}

function buildBanana() {
  const group = new THREE.Group();
  const skin = standardMat(0xffe14a, { roughness: 0.4, emissive: 0x6a5a10, emissiveIntensity: 0.15 });
  const tip = standardMat(0x6a4a22, { roughness: 0.7 });
  for (let i = 0; i < 5; i += 1) {
    const t = i / 4;
    const angle = -0.65 + t * 1.45;
    const radius = 0.03 + Math.sin(t * Math.PI) * 0.022;
    addMesh(
      group,
      new THREE.SphereGeometry(radius, 10, 8),
      i === 0 || i === 4 ? tip : skin,
      Math.sin(angle) * 0.1,
      (t - 0.45) * 0.16,
      (t - 0.5) * 0.16,
    );
  }
  return group;
}

function buildBerry() {
  const group = new THREE.Group();
  const skin = standardMat(0xe23b4a, { roughness: 0.4, emissive: 0x5a1020, emissiveIntensity: 0.2 });
  addMesh(group, new THREE.SphereGeometry(0.09, 16, 12), skin, 0, -0.01, 0, 0.86, 1.15, 0.86);
  const leaf = standardMat(0x2f8a3c);
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    addMesh(group, new THREE.ConeGeometry(0.02, 0.05, 5), leaf, Math.cos(angle) * 0.035, 0.09, Math.sin(angle) * 0.035);
  }
  const seed = standardMat(0xffe7a8, { roughness: 0.5 });
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    addMesh(group, new THREE.SphereGeometry(0.008, 6, 5), seed, Math.cos(angle) * 0.06, -0.01 + (i % 3) * 0.02, Math.sin(angle) * 0.06);
  }
  return group;
}

function buildPineapple() {
  const group = new THREE.Group();
  const body = standardMat(0xe0a03a, { roughness: 0.62, emissive: 0x5a3a08, emissiveIntensity: 0.15 });
  addMesh(group, new THREE.CylinderGeometry(0.07, 0.075, 0.16, 10), body, 0, 0, 0);
  addMesh(group, new THREE.SphereGeometry(0.07, 12, 10), body, 0, 0.07, 0);
  const leaf = standardMat(0x2f8a3c);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const crown = addMesh(group, new THREE.ConeGeometry(0.02, 0.1, 5), leaf, Math.cos(angle) * 0.03, 0.16, Math.sin(angle) * 0.03);
    const aim = new THREE.Vector3(Math.cos(angle), 1.6, Math.sin(angle)).normalize();
    crown.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), aim);
  }
  return group;
}

function buildMelon() {
  const group = new THREE.Group();
  const skin = standardMat(0xffffff, { map: rindTexture, roughness: 0.55 });
  addMesh(group, new THREE.SphereGeometry(0.15, 22, 16), skin);
  return group;
}

function buildBomb() {
  const group = new THREE.Group();
  addMesh(group, new THREE.SphereGeometry(0.09, 16, 12), standardMat(0x2a2a2a, { roughness: 0.4, metalness: 0.45 }));
  const fuse = addMesh(group, new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6), standardMat(0xc4a574, { roughness: 0.7 }), 0.02, 0.1, 0);
  fuse.rotation.z = -0.5;
  addMesh(group, new THREE.SphereGeometry(0.018, 8, 6), standardMat(0xfff1c2, { emissive: 0xff8a2a, emissiveIntensity: 1 }), 0.045, 0.128, 0);
  const band = addMesh(group, new THREE.TorusGeometry(0.094, 0.008, 6, 18), standardMat(0xff4d4d, { emissive: 0xff2222, emissiveIntensity: 0.35 }));
  band.rotation.x = Math.PI / 2;
  return group;
}

function buildSheep() {
  const group = new THREE.Group();
  const wool = standardMat(0xf7f4ee, { roughness: 0.95 });
  const face = standardMat(0x2b2926, { roughness: 0.6 });
  addMesh(group, new THREE.SphereGeometry(0.12, 16, 12), wool, 0, 0.02, 0, 1.28, 1, 1.08);
  const puffs = [[0.09, 0.08, 0.03], [-0.08, 0.07, 0], [0.02, 0.1, -0.04], [-0.03, 0.01, 0.09], [0.04, 0.02, -0.09]];
  for (const [x, y, z] of puffs) addMesh(group, new THREE.SphereGeometry(0.055, 8, 6), wool, x, y, z);
  addMesh(group, new THREE.SphereGeometry(0.055, 12, 10), face, 0, 0.03, 0.14);
  addMesh(group, new THREE.SphereGeometry(0.026, 8, 6), face, 0.05, 0.055, 0.13, 1.3, 0.45, 0.7);
  addMesh(group, new THREE.SphereGeometry(0.026, 8, 6), face, -0.05, 0.055, 0.13, 1.3, 0.45, 0.7);
  addEyes(group, 0, 0.04, 0.185, 0.022);
  const hoof = standardMat(0x1a1a1a, { roughness: 0.7 });
  for (const x of [-0.07, 0.07]) {
    for (const z of [-0.05, 0.06]) addMesh(group, new THREE.CylinderGeometry(0.016, 0.017, 0.09, 6), hoof, x, -0.12, z);
  }
  return group;
}

function buildChicken() {
  const group = new THREE.Group();
  const body = standardMat(0xfff4df, { roughness: 0.55 });
  const red = standardMat(0xe23a3a, { roughness: 0.45 });
  addMesh(group, new THREE.SphereGeometry(0.09, 14, 12), body, 0, 0, 0, 1.15, 0.95, 1.25);
  addMesh(group, new THREE.SphereGeometry(0.05, 12, 10), body, 0, 0.07, 0.1);
  addMesh(group, new THREE.ConeGeometry(0.018, 0.05, 5), red, 0, 0.13, 0.1);
  addMesh(group, new THREE.SphereGeometry(0.016, 6, 6), red, 0, 0.05, 0.145);
  addMesh(group, new THREE.ConeGeometry(0.018, 0.05, 5), standardMat(0xf0b429), 0, 0.065, 0.15, 1, 1, 1, Math.PI / 2);
  addEyes(group, 0, 0.08, 0.145, 0.02);
  const leg = standardMat(0xe0a030, { roughness: 0.6 });
  addMesh(group, new THREE.CylinderGeometry(0.008, 0.008, 0.08, 5), leg, -0.03, -0.1, 0);
  addMesh(group, new THREE.CylinderGeometry(0.008, 0.008, 0.08, 5), leg, 0.03, -0.1, 0);
  return group;
}

function buildPig() {
  const group = new THREE.Group();
  const skin = standardMat(0xf3a0b2, { roughness: 0.5, emissive: 0x5a2030, emissiveIntensity: 0.08 });
  addMesh(group, new THREE.SphereGeometry(0.11, 16, 12), skin, 0, 0, 0, 1.25, 0.95, 1);
  addMesh(group, new THREE.SphereGeometry(0.055, 12, 10), skin, 0, 0.02, 0.12);
  addMesh(group, new THREE.CylinderGeometry(0.028, 0.03, 0.04, 8), skin, 0, 0.01, 0.16, 1, 1, 1, Math.PI / 2);
  const nostril = standardMat(0xc46b80, { roughness: 0.6 });
  addMesh(group, new THREE.SphereGeometry(0.008, 6, 6), nostril, -0.012, 0.012, 0.182);
  addMesh(group, new THREE.SphereGeometry(0.008, 6, 6), nostril, 0.012, 0.012, 0.182);
  addMesh(group, new THREE.SphereGeometry(0.028, 8, 6), skin, 0.07, 0.07, 0.08, 0.5, 1, 0.8);
  addMesh(group, new THREE.SphereGeometry(0.028, 8, 6), skin, -0.07, 0.07, 0.08, 0.5, 1, 0.8);
  addEyes(group, 0, 0.04, 0.16, 0.03);
  const hoof = standardMat(0x8a4a58, { roughness: 0.7 });
  for (const x of [-0.06, 0.06]) {
    for (const z of [-0.04, 0.05]) addMesh(group, new THREE.CylinderGeometry(0.016, 0.016, 0.07, 6), hoof, x, -0.11, z);
  }
  return group;
}

function buildRabbit() {
  const group = new THREE.Group();
  const fur = standardMat(0xe7c7a4, { roughness: 0.7 });
  const inner = standardMat(0xf2b7c0, { roughness: 0.55 });
  addMesh(group, new THREE.SphereGeometry(0.09, 14, 12), fur, 0, 0, 0, 1.05, 0.95, 1.2);
  addMesh(group, new THREE.SphereGeometry(0.05, 12, 10), fur, 0, 0.05, 0.1);
  addMesh(group, new THREE.SphereGeometry(0.018, 8, 6), fur, 0.05, 0.1, 0.11, 0.45, 1.7, 0.7);
  addMesh(group, new THREE.SphereGeometry(0.018, 8, 6), fur, -0.05, 0.1, 0.11, 0.45, 1.7, 0.7);
  addMesh(group, new THREE.SphereGeometry(0.012, 6, 6), inner, 0.05, 0.1, 0.12, 0.25, 1.3, 0.4);
  addMesh(group, new THREE.SphereGeometry(0.012, 6, 6), inner, -0.05, 0.1, 0.12, 0.25, 1.3, 0.4);
  addMesh(group, new THREE.SphereGeometry(0.028, 8, 6), standardMat(0xfff7f2), 0, 0.02, -0.1);
  addEyes(group, 0, 0.06, 0.145, 0.02);
  return group;
}

function buildDuck() {
  const group = new THREE.Group();
  const body = standardMat(0xfff3c4, { roughness: 0.48, emissive: 0x6a5a20, emissiveIntensity: 0.08 });
  const bill = standardMat(0xf08a24, { roughness: 0.45 });
  addMesh(group, new THREE.SphereGeometry(0.09, 14, 12), body, 0, 0, 0, 1.2, 0.85, 1.15);
  addMesh(group, new THREE.SphereGeometry(0.05, 12, 10), body, 0, 0.06, 0.1);
  addMesh(group, new THREE.SphereGeometry(0.028, 8, 6), bill, 0, 0.05, 0.15, 1.1, 0.35, 1.4);
  addEyes(group, 0, 0.075, 0.14, 0.02);
  return group;
}

function buildPenguin() {
  const group = new THREE.Group();
  const black = standardMat(0x1c1f24, { roughness: 0.45 });
  const belly = standardMat(0xf4f7fb, { roughness: 0.4 });
  const beak = standardMat(0xf0a030, { roughness: 0.45 });
  addMesh(group, new THREE.SphereGeometry(0.1, 16, 12), black, 0, 0, 0, 0.9, 1.2, 0.85);
  addMesh(group, new THREE.SphereGeometry(0.07, 12, 10), belly, 0, -0.02, 0.045, 0.7, 1, 0.45);
  addMesh(group, new THREE.SphereGeometry(0.045, 12, 10), black, 0, 0.12, 0.02);
  addMesh(group, new THREE.SphereGeometry(0.028, 8, 6), belly, 0, 0.11, 0.05, 0.8, 0.7, 0.4);
  addMesh(group, new THREE.ConeGeometry(0.016, 0.05, 5), beak, 0, 0.11, 0.07, 1, 1, 1, Math.PI / 2);
  addEyes(group, 0, 0.125, 0.055, 0.016);
  addMesh(group, new THREE.SphereGeometry(0.02, 8, 6), beak, -0.05, -0.12, 0.03, 1.4, 0.35, 1);
  addMesh(group, new THREE.SphereGeometry(0.02, 8, 6), beak, 0.05, -0.12, 0.03, 1.4, 0.35, 1);
  return group;
}

function buildSkunk() {
  const group = new THREE.Group();
  const fur = standardMat(0x1a1a1a, { roughness: 0.6 });
  const stripe = standardMat(0xf7f7f4, { roughness: 0.45 });
  addMesh(group, new THREE.SphereGeometry(0.1, 14, 12), fur, 0, 0, 0, 1.3, 0.8, 1);
  addMesh(group, new THREE.SphereGeometry(0.05, 12, 10), fur, 0, 0.03, 0.12);
  addMesh(group, new THREE.BoxGeometry(0.03, 0.02, 0.2), stripe, 0, 0.08, -0.01);
  addMesh(group, new THREE.SphereGeometry(0.055, 10, 8), fur, 0, 0.04, -0.14);
  addMesh(group, new THREE.SphereGeometry(0.035, 8, 6), stripe, 0, 0.07, -0.16);
  addEyes(group, 0, 0.045, 0.165, 0.02);
  return group;
}

function buildAsteroid() {
  const group = new THREE.Group();
  const rock = standardMat(0x8d7b6e, { roughness: 0.95, flatShading: true });
  addMesh(group, new THREE.DodecahedronGeometry(0.1, 0), rock);
  addMesh(group, new THREE.DodecahedronGeometry(0.045, 0), rock, 0.07, 0.03, 0.02);
  return group;
}

function buildMoon() {
  const group = new THREE.Group();
  const dust = standardMat(0xc8c2b8, { roughness: 0.9 });
  const crater = standardMat(0x8e8982, { roughness: 1 });
  addMesh(group, new THREE.SphereGeometry(0.11, 18, 14), dust);
  const craters = [[0.04, 0.05, 0.08], [-0.05, 0.02, 0.08], [0.02, -0.04, 0.09], [-0.02, 0.07, 0.06]];
  for (const [x, y, z] of craters) addMesh(group, new THREE.SphereGeometry(0.02, 8, 6), crater, x, y, z);
  return group;
}

function buildPlanet() {
  const group = new THREE.Group();
  const surface = standardMat(0xffffff, { map: planetTexture, roughness: 0.42, metalness: 0.08 });
  addMesh(group, new THREE.SphereGeometry(0.12, 20, 16), surface);
  const ring = addMesh(
    group,
    new THREE.TorusGeometry(0.18, 0.012, 8, 28),
    standardMat(0xe6d2a2, { roughness: 0.4, metalness: 0.35, side: THREE.DoubleSide }),
  );
  ring.rotation.x = Math.PI / 2.4;
  ring.rotation.y = 0.4;
  return group;
}

function buildStar() {
  const group = new THREE.Group();
  const glow = standardMat(0xffd76a, { roughness: 0.32, metalness: 0.15, emissive: 0xffb703, emissiveIntensity: 0.7 });
  addMesh(group, new THREE.OctahedronGeometry(0.06, 0), glow);
  const spike = new THREE.ConeGeometry(0.028, 0.12, 4);
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const direction of directions) {
    const mesh = new THREE.Mesh(spike, glow);
    const vector = new THREE.Vector3(...direction).normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector);
    mesh.position.copy(vector).multiplyScalar(0.09);
    group.add(mesh);
  }
  return group;
}

function buildComet() {
  const group = new THREE.Group();
  const ice = standardMat(0xd7fbff, { roughness: 0.25, emissive: 0x8fdfff, emissiveIntensity: 0.45 });
  addMesh(group, new THREE.SphereGeometry(0.07, 16, 12), ice);
  const tail = addMesh(
    group,
    new THREE.ConeGeometry(0.05, 0.22, 10),
    new THREE.MeshStandardMaterial({
      color: 0xb9f3ff,
      emissive: 0x7ad7ff,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.65,
      roughness: 0.4,
      side: THREE.DoubleSide,
    }),
    0,
    0,
    -0.14,
    1,
    1,
    1,
    Math.PI / 2,
  );
  tail.material.depthWrite = false;
  return group;
}

function buildHole() {
  const group = new THREE.Group();
  addMesh(group, new THREE.SphereGeometry(0.08, 16, 12), standardMat(0x07060a, { roughness: 0.25, metalness: 0.7, emissive: 0x1a0520, emissiveIntensity: 0.4 }));
  const disc = addMesh(
    group,
    new THREE.TorusGeometry(0.13, 0.012, 8, 28),
    standardMat(0xd07bff, { emissive: 0xb44bff, emissiveIntensity: 0.85, roughness: 0.28, metalness: 0.3, side: THREE.DoubleSide }),
  );
  disc.rotation.x = Math.PI / 2.6;
  const outer = addMesh(
    group,
    new THREE.TorusGeometry(0.17, 0.006, 6, 24),
    standardMat(0x7a4cff, { emissive: 0x6a3cff, emissiveIntensity: 0.5, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
  );
  outer.rotation.x = Math.PI / 2.6;
  return group;
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d"));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
