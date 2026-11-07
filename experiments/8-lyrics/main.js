import * as THREE from "three";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

const FONT_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json";
const SECONDARY_BUTTON = 5;
const TRIGGER_BUTTON = 0;
const SQUEEZE_BUTTON = 1;
const TIPS = ["index-finger-tip", "middle-finger-tip", "ring-finger-tip", "pinky-finger-tip"];
const TIP_CURL = 0.105;
const CORE_RADIUS = 0.16;
const PALETTE = [0xd6ff4a, 0xff5d73, 0x9fd4ff, 0xffb45a, 0xc084fc, 0x3dffe8, 0xff7ad9, 0xfff1b8];
const SENSITIVITY = { low: 0.75, medium: 1, high: 1.45 };
const FALLBACK_WORDS = ["LIGHT", "RISE", "PULL", "DOWN", "FIRE"];

const setup = document.querySelector("#setup");
const form = document.querySelector("#settings");
const note = document.querySelector("#note");
const enter = document.querySelector("#enter");
const previewBtn = document.querySelector("#preview");
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
renderer.toneMapping = THREE.NoToneMapping;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(100, window.innerWidth / window.innerHeight, 0.04, 40);
scene.add(new THREE.HemisphereLight(0xffffff, 0x223022, 0.7));

const rig = new THREE.Group();
const core = new THREE.Group();
core.position.set(0, -0.34, -0.36);
rig.add(core);
scene.add(rig);
rig.visible = false;

const ring = new THREE.Mesh(
  new THREE.TorusGeometry(0.13, 0.008, 10, 40),
  new THREE.MeshBasicMaterial({
    color: 0xffe1a8,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }),
);
ring.rotation.x = Math.PI / 2;
ring.frustumCulled = false;
core.add(ring);

const glow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: glowTexture(),
    color: 0xfff6d2,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }),
);
glow.scale.setScalar(0.28);
glow.frustumCulled = false;
core.add(glow);

const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.003, 0.008, 0.7, 8, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0xffd98a,
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  }),
);
beam.position.y = 0.35;
beam.frustumCulled = false;
core.add(beam);

const shellGeo = new THREE.SphereGeometry(0.02, 10, 8);
shellGeo.userData.shared = true;
const orbGeo = new THREE.SphereGeometry(0.016, 14, 10);
orbGeo.userData.shared = true;

const MAX_PARTICLES = 720;
const particles = [];
const particlePositions = new Float32Array(MAX_PARTICLES * 3);
const particleColors = new Float32Array(MAX_PARTICLES * 3);
for (let i = 0; i < MAX_PARTICLES; i += 1) {
  particles.push({
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    color: new THREE.Color(),
    life: 1,
    max: 1,
  });
}
const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
particleGeo.setAttribute("color", new THREE.BufferAttribute(particleColors, 3));
particleGeo.setDrawRange(0, 0);
const particleMat = new THREE.PointsMaterial({
  size: 0.05,
  map: sparkTexture(),
  vertexColors: true,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  sizeAttenuation: true,
  toneMapped: false,
});
const sparks = new THREE.Points(particleGeo, particleMat);
sparks.frustumCulled = false;
rig.add(sparks);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const wordPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.68);
const grabbers = new Map();
const words = [];
const shells = [];
const recentColors = [];
const geoCache = new Map();
const white = new THREE.Color(0xffffff);
const warmColor = new THREE.Color(0xffc56a);
const coreWorld = new THREE.Vector3();
const headPos = new THREE.Vector3(0, 1.58, 0);
const headQuat = new THREE.Quaternion();
const forward = new THREE.Vector3(0, 0, -1);
const smoothForward = new THREE.Vector3(0, 0, -1);
const right = new THREE.Vector3(1, 0, 0);
const up = new THREE.Vector3(0, 1, 0);
const tmp = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  color: new THREE.Color(),
  tip: new THREE.Vector3(),
  palm: new THREE.Vector3(),
};

const pointer = {
  ndc: new THREE.Vector2(),
  down: false,
  downY: 0,
  justDown: false,
  justUp: false,
};

let font = null;
let fontFailed = false;
let mode = "idle";
let lyrics = readLyrics();
let maxWords = 12;
let audioMode = "mic";
let sensitivity = 1;
let lyricIndex = 0;
let fed = 0;
let charge = 0;
let nextColor = 0;
let needsSeed = false;
let headReady = false;
let rigReady = false;
let ending = false;
let elapsed = 0;
let sinceBeat = 0;
let spawnCooldown = 0;
let beatHeld = false;
let statusClock = 0;
let ringKick = 0;
let fountainAcc = 0;
let audioGen = 0;
let audioCtx = null;
let analyser = null;
let freqData = null;
let timeData = null;
let micStream = null;
let audioReady = false;
let audioLabel = "listening";
let demoTimer = 0;
let demoNodes = [];
let bassSmooth = 0;
let bassAvg = 0.08;
let beatCooldown = 0;
let beatPulse = 0;

const previewGrabber = createGrabber(null, "preview");
previewGrabber.orb.scale.setScalar(1.7);
previewGrabber.orb.visible = false;
previewGrabber.tether.visible = false;

new FontLoader().load(
  FONT_URL,
  (loaded) => {
    font = loaded;
    warm(readLyrics());
  },
  undefined,
  () => {
    fontFailed = true;
  },
);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener("pointerdown", (event) => {
  if (mode !== "preview" || isUi(event.target)) return;
  setPointer(event);
  pointer.down = true;
  pointer.downY = pointer.ndc.y;
  framePreviewCamera();
  previewGrabber.closed = true;
  tryGrab(previewGrabber, pickWord());
  placePreviewHold();
});

window.addEventListener("pointermove", (event) => {
  if (mode !== "preview") return;
  setPointer(event);
  if (pointer.down) placePreviewHold();
});

window.addEventListener("pointerup", (event) => {
  if (mode !== "preview" || !pointer.down) return;
  setPointer(event);
  pointer.down = false;
  placePreviewHold();
  previewGrabber.closed = false;
  release(previewGrabber);
});

window.addEventListener("keydown", (event) => {
  if (mode === "preview" && (event.key === "Escape" || event.key === "b" || event.key === "y")) {
    leavePreview();
  }
});

enter.addEventListener("click", () => {
  applyForm();

  let micPromise = null;
  if (audioMode === "mic" && navigator.mediaDevices?.getUserMedia) {
    micPromise = navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }

  const sessionPromise = navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["local-floor"],
    optionalFeatures: ["hand-tracking", "dom-overlay"],
    domOverlay: { root: overlay },
  });

  warm(lyrics);
  beginAudio(micPromise).catch((error) => {
    console.warn(error);
    audioLabel = "no audio";
    note.textContent = error?.message || "Could not start audio. Try Demo beat.";
  });

  sessionPromise
    .then((session) => renderer.xr.setSession(session))
    .catch((error) => {
      note.textContent = error?.message || "Could not start AR.";
      stopAudio();
    });
});

previewBtn.addEventListener("click", () => {
  applyForm();
  let micPromise = null;
  if (audioMode === "mic" && navigator.mediaDevices?.getUserMedia) {
    micPromise = navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }
  warm(lyrics);
  beginAudio(micPromise).catch((error) => {
    console.warn(error);
    audioLabel = "no audio";
  });
  startPreview();
});

exit.addEventListener("click", () => {
  if (mode === "preview") leavePreview();
  else renderer.xr.getSession()?.end();
});

renderer.xr.addEventListener("sessionstart", () => {
  mode = "xr";
  setup.hidden = true;
  overlay.style.display = "block";
  hint.textContent = "Fist grabs · pull down into the ring · B or Y exits";
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.pointerEvents = "";
  clock.getDelta();
  prepareWorld();
  resumeAudioContext();
});

renderer.xr.addEventListener("sessionend", () => {
  mode = "idle";
  overlay.style.display = "none";
  setup.hidden = false;
  rig.visible = false;
  renderer.domElement.style.pointerEvents = "";
  renderer.setClearColor(0x000000, 0);
  clearWorld();
  stopAudio();
  note.textContent = "Session ended. Enter AR to catch the words again.";
});

renderer.setAnimationLoop((_time, frame) => {
  const dt = Math.min(0.05, clock.getDelta() || 0.016);
  if (mode === "idle") {
    renderer.render(scene, camera);
    return;
  }

  elapsed += dt;
  if (mode === "xr" && frame) {
    handleExit(frame);
    if (!ending) {
      readHead(frame);
      updateRig(dt, !rigReady);
      rigReady = headReady;
      syncGrabbers(frame, dt);
    }
  } else if (mode === "preview") {
    framePreviewCamera();
    updateRig(dt, true);
    updatePreviewGrabber();
  }

  trySeed();
  const levels = sampleAudio(dt);
  maybeSpawn(levels, dt);
  stepWords(dt, levels);
  stepFireworks(dt);
  updateCoreVisual();
  updateStatus(dt);

  renderer.render(scene, camera);
});

revealPreviewIfNeeded();

function revealPreviewIfNeeded() {
  const show = () => {
    previewBtn.hidden = false;
  };
  if (!navigator.xr) {
    show();
    return;
  }
  navigator.xr
    .isSessionSupported("immersive-ar")
    .then((ok) => {
      if (!ok) show();
    })
    .catch(show);
}

function applyForm() {
  lyrics = readLyrics();
  maxWords = Math.min(24, Math.max(4, Number(form.querySelector("#count").value) || 12));
  audioMode = form.querySelector("#audio").value || "mic";
  sensitivity = SENSITIVITY[form.querySelector("#sensitivity").value] || 1;
}

function readLyrics() {
  const field = form.querySelector("#words");
  const parsed = tokenize(field?.value || "");
  return parsed.length ? parsed : FALLBACK_WORDS.slice();
}

function tokenize(raw) {
  const found = String(raw || "")
    .toUpperCase()
    .match(/[A-Z0-9]+(?:'[A-Z0-9]+)?/g);
  return found ? found.map((word) => word.slice(0, 16)) : [];
}

function startPreview() {
  mode = "preview";
  setup.hidden = true;
  document.body.classList.add("stage");
  overlay.style.display = "block";
  renderer.domElement.style.pointerEvents = "auto";
  renderer.setClearColor(0x10140f, 1);
  hint.textContent = "Click a word and drag it down into the ring";
  clock.getDelta();
  prepareWorld();
  headPos.set(0, 1.58, 0);
  forward.set(0, 0, -1);
  right.set(1, 0, 0);
  headReady = true;
  rigReady = true;
  updateRig(0.016, true);
  previewGrabber.orb.visible = true;
}

function leavePreview() {
  mode = "idle";
  overlay.style.display = "none";
  setup.hidden = false;
  document.body.classList.remove("stage");
  rig.visible = false;
  renderer.domElement.style.pointerEvents = "";
  renderer.setClearColor(0x000000, 0);
  pointer.down = false;
  clearWorld();
  stopAudio();
  note.textContent = "Preview ended. Enter AR on a Quest, or preview again.";
}

function prepareWorld() {
  clearWorld();
  rig.visible = true;
  needsSeed = true;
  ending = false;
  statusClock = 0;
  status.textContent = font || fontFailed ? "Words incoming…" : "Loading letters…";
}

function clearWorld() {
  for (let i = words.length - 1; i >= 0; i -= 1) removeWord(words[i]);
  for (let i = shells.length - 1; i >= 0; i -= 1) removeShell(shells[i]);
  shells.length = 0;
  for (const particle of particles) particle.life = particle.max;
  particleGeo.setDrawRange(0, 0);
  for (const grabber of grabbers.values()) destroyGrabber(grabber);
  grabbers.clear();
  release(previewGrabber);
  previewGrabber.orb.visible = false;
  previewGrabber.tether.visible = false;
  previewGrabber.closed = false;
  previewGrabber.wasClosed = false;
  recentColors.length = 0;
  fed = 0;
  charge = 0;
  lyricIndex = 0;
  nextColor = 0;
  ringKick = 0;
  fountainAcc = 0;
  sinceBeat = 0;
  spawnCooldown = 0;
  beatHeld = false;
  rigReady = false;
  headReady = false;
  smoothForward.set(0, 0, -1);
}

function trySeed() {
  if (!needsSeed || !headReady) return;
  if (!font && !fontFailed) return;
  needsSeed = false;
  const count = Math.min(5, maxWords, lyrics.length);
  for (let i = 0; i < count; i += 1) spawnWord();
}

function maybeSpawn(levels, dt) {
  spawnCooldown = Math.max(0, spawnCooldown - dt);
  if (mode === "idle" || !headReady) return;
  sinceBeat += dt;
  const hit = levels.beat > 0.8 && !beatHeld;
  if (levels.beat < 0.15) beatHeld = false;
  if (!hit && sinceBeat < 1.7) return;
  if (spawnCooldown > 0) return;
  if (!font && !fontFailed) return;
  if (hit) beatHeld = true;
  sinceBeat = 0;
  spawnCooldown = 0.36;
  if (crowd() >= maxWords) retireOldest();
  if (crowd() >= maxWords) return;
  if (words.length > 36) removeWord(words[0]);
  spawnWord();
}

function crowd() {
  let count = 0;
  for (const word of words) {
    if (word.state === "free" || word.state === "in" || word.state === "held") count += 1;
  }
  return count;
}

function retireOldest() {
  let oldest = null;
  for (const word of words) {
    if (word.state !== "free" && word.state !== "in") continue;
    if (!oldest || word.born < oldest.born) oldest = word;
  }
  if (!oldest) return;
  oldest.state = "out";
  oldest.age = 0;
}

function spawnWord() {
  const label = lyrics[lyricIndex % lyrics.length];
  lyricIndex += 1;
  let built;
  try {
    built = font ? buildTextWord(label) : buildCanvasWord(label);
  } catch (error) {
    console.warn(error);
    built = buildCanvasWord(label);
  }

  const word = {
    group: built.group,
    baseScale: built.baseScale,
    radius: built.radius,
    color: built.color,
    dispose: built.dispose,
    label,
    state: "in",
    age: 0,
    born: performance.now(),
    position: new THREE.Vector3(),
    drift: new THREE.Vector3((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02),
    bob: Math.random() * Math.PI * 2,
    heldBy: null,
    armed: false,
    releaseAge: 10,
  };
  word.group.userData.word = word;
  occupySlot(word);
  scene.add(word.group);
  words.push(word);
  placeWord(word, 0.001);
}

function buildTextWord(label) {
  const geo = textGeo(label);
  const box = geo.boundingBox;
  const width = box.max.x - box.min.x;
  const height = box.max.y - box.min.y;
  const baseScale = Math.min(1, 0.26 / Math.max(width, 0.001), 0.062 / Math.max(height, 0.001));
  const color = new THREE.Color(PALETTE[nextColor % PALETTE.length]);
  nextColor += 1;
  const front = new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide });
  const back = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.32), toneMapped: false, side: THREE.DoubleSide });
  const frontMesh = new THREE.Mesh(geo, front);
  const backMesh = new THREE.Mesh(geo, back);
  backMesh.scale.set(1.05, 1.05, 1);
  backMesh.position.z = -0.01;
  frontMesh.frustumCulled = false;
  backMesh.frustumCulled = false;
  const group = new THREE.Group();
  group.add(backMesh, frontMesh);
  group.frustumCulled = false;
  return {
    group,
    baseScale,
    radius: Math.max(width, height) * baseScale * 0.5,
    color,
    dispose() {
      front.dispose();
      back.dispose();
    },
  };
}

function textGeo(label) {
  const cached = geoCache.get(label);
  if (cached) return cached;
  const geo = new TextGeometry(label, {
    font,
    size: 0.055,
    depth: 0.016,
    curveSegments: 3,
    bevelEnabled: true,
    bevelThickness: 0.0035,
    bevelSize: 0.0025,
    bevelOffset: 0,
    bevelSegments: 1,
  });
  geo.computeBoundingBox();
  geo.center();
  geo.userData.shared = true;
  geoCache.set(label, geo);
  return geo;
}

function buildCanvasWord(label) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const fontPx = 150;
  ctx.font = `700 ${fontPx}px "Avenir Next", "Segoe UI", sans-serif`;
  const measured = Math.ceil(ctx.measureText(label).width);
  canvas.width = Math.min(1024, Math.max(64, measured + 64));
  canvas.height = 220;
  ctx.font = `700 ${fontPx}px "Avenir Next", "Segoe UI", sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 6);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const aspect = canvas.width / canvas.height;
  const height = 0.062;
  const width = height * aspect;
  const baseScale = Math.min(1, 0.26 / width);
  const color = new THREE.Color(PALETTE[nextColor % PALETTE.length]);
  nextColor += 1;
  const slabMat = new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide });
  const faceMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: THREE.DoubleSide });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.02), slabMat);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.96, height * 0.9), faceMat);
  face.position.z = 0.012;
  const group = new THREE.Group();
  group.add(slab, face);
  group.frustumCulled = false;
  return {
    group,
    baseScale,
    radius: Math.max(width, height) * baseScale * 0.5,
    color,
    dispose() {
      slab.geometry.dispose();
      face.geometry.dispose();
      slabMat.dispose();
      faceMat.dispose();
      texture.dispose();
    },
  };
}

function warm(list) {
  if (!font) return;
  for (const label of new Set(list)) {
    try {
      textGeo(label);
    } catch (error) {
      console.warn(label, error);
    }
  }
}

function stepWords(dt, levels) {
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const word = words[i];
    word.bob += dt * (1.3 + levels.bass);
    word.releaseAge += dt;

    if (word.state === "absorb") {
      word.age += dt;
      word.position.lerp(coreWorld, 1 - Math.exp(-dt * 14));
      const t = Math.min(1, word.age / 0.18);
      placeWord(word, 1 - t);
      if (t >= 1) removeWord(word);
      continue;
    }

    if (word.state === "out") {
      word.age += dt;
      const t = Math.min(1, word.age / 0.28);
      word.position.addScaledVector(word.drift, dt);
      placeWord(word, 1 - t);
      if (t >= 1) removeWord(word);
      continue;
    }

    if (word.heldBy) {
      word.position.copy(word.heldBy.position);
      const dist = word.position.distanceTo(coreWorld);
      if (dist < 0.3) {
        const pull = ((0.3 - dist) / 0.3) * 0.35;
        word.position.lerp(coreWorld, pull);
      }
      placeWord(word, 1.08 + levels.bass * 0.08);
      updateTether(word.heldBy, word);
      if (word.position.distanceTo(coreWorld) < CORE_RADIUS) absorb(word);
      continue;
    }

    if (word.state === "held") word.state = "free";
    word.position.addScaledVector(word.drift, dt);
    word.drift.multiplyScalar(Math.pow(0.2, dt));

    let pop = 1;
    if (word.state === "in") {
      word.age += dt;
      const t = Math.min(1, word.age / 0.28);
      pop = t * (1 + Math.sin(t * Math.PI) * 0.16);
      if (t >= 1) word.state = "free";
    }

    placeWord(word, pop * (1 + levels.bass * 0.12));

    if (word.armed && word.releaseAge < 0.45 && word.position.distanceTo(coreWorld) < CORE_RADIUS) {
      absorb(word);
      continue;
    }

    if (word.state === "free" && performance.now() - word.born > 16000) {
      word.state = "out";
      word.age = 0;
    } else if (word.position.distanceTo(headPos) > 2.6) {
      word.state = "out";
      word.age = 0;
    }
  }
}

function placeWord(word, mul) {
  const bob = word.heldBy ? 0 : Math.sin(word.bob) * 0.012;
  word.group.position.copy(word.position);
  word.group.position.y += bob;
  tmp.b.copy(headPos);
  tmp.b.y = word.group.position.y;
  if (tmp.b.distanceToSquared(word.group.position) > 1e-6) {
    word.group.lookAt(tmp.b);
  }
  word.group.scale.setScalar(Math.max(0.001, word.baseScale * mul));
}

function absorb(word) {
  if (word.state === "absorb" || word.state === "out") return;
  const source = word.heldBy?.source || null;
  if (word.heldBy) {
    word.heldBy.held = null;
    word.heldBy.tether.visible = false;
    word.heldBy = null;
  }
  word.state = "absorb";
  word.age = 0;
  fed += 1;
  charge = Math.min(6.5, charge + 1.2);
  ringKick = 0.32;
  recentColors.push(word.color.clone());
  if (recentColors.length > 8) recentColors.shift();
  launchBloom(word.color);
  pulse(source, 0.85, 60);
}

function removeWord(word) {
  if (word.heldBy) {
    word.heldBy.held = null;
    word.heldBy.tether.visible = false;
    word.heldBy = null;
  }
  scene.remove(word.group);
  word.dispose?.();
  const index = words.indexOf(word);
  if (index >= 0) words.splice(index, 1);
}

function launchBloom(color) {
  const shellsToFire = Math.min(4, (fed >= 16 ? 3 : fed >= 6 ? 2 : 1) + (charge > 2.4 ? 1 : 0));
  const rise = 1.7 + Math.min(1.8, fed * 0.09);
  const burst = Math.min(84, 24 + fed * 3);
  const spread = 0.95 + Math.min(1.7, fed * 0.08);
  let fired = 0;
  for (let i = 0; i < shellsToFire; i += 1) {
    if (shells.length >= 8) break;
    const mesh = new THREE.Mesh(
      shellGeo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.frustumCulled = false;
    mesh.position.copy(core.position);
    rig.add(mesh);
    shells.push({
      mesh,
      pos: core.position.clone(),
      vel: new THREE.Vector3((i - (shellsToFire - 1) / 2) * 0.22, rise * (1 - i * 0.07), (Math.random() - 0.5) * 0.16),
      color: color.clone(),
      spread,
      burst,
      trail: 0,
    });
    fired += 1;
  }

  const impact = 12 + Math.min(18, fed);
  for (let i = 0; i < impact; i += 1) {
    tmp.vel.set((Math.random() - 0.5) * 0.9, 0.5 + Math.random() * 1.6, (Math.random() - 0.5) * 0.9);
    emit(core.position, tmp.vel, color, 0.28 + Math.random() * 0.28);
  }
  return fired;
}

function stepFireworks(dt) {
  charge = Math.max(0, charge - dt * 0.28);
  ringKick *= Math.pow(0.04, dt);

  const memory = Math.min(30, fed * 1.7);
  const rate = 3 + memory + charge * 14;
  fountainAcc += rate * dt;
  let guard = 0;
  while (fountainAcc >= 1 && guard < 28) {
    fountainAcc -= 1;
    guard += 1;
    const color = recentColors.length ? recentColors[Math.floor(Math.random() * recentColors.length)] : warmColor;
    tmp.vel.set(
      (Math.random() - 0.5) * (0.28 + Math.min(0.7, fed * 0.03)),
      0.85 + Math.random() * (0.7 + Math.min(2.4, fed * 0.09)),
      (Math.random() - 0.5) * (0.28 + Math.min(0.7, fed * 0.03)),
    );
    emit(core.position, tmp.vel, color, 0.65 + Math.random() * 0.45);
  }

  for (let i = shells.length - 1; i >= 0; i -= 1) {
    const shell = shells[i];
    shell.vel.y -= 2.1 * dt;
    shell.pos.addScaledVector(shell.vel, dt);
    shell.mesh.position.copy(shell.pos);
    shell.trail += dt * 34;
    while (shell.trail >= 1) {
      shell.trail -= 1;
      tmp.vel.set((Math.random() - 0.5) * 0.16, -0.15, (Math.random() - 0.5) * 0.16);
      emit(shell.pos, tmp.vel, shell.color, 0.22);
    }
    if (shell.vel.y <= 0.2) {
      explodeShell(shell);
      removeShell(shell);
      shells.splice(i, 1);
    }
  }

  let write = 0;
  for (const particle of particles) {
    if (particle.life >= particle.max) continue;
    particle.life += dt;
    if (particle.life >= particle.max) continue;
    particle.vel.y -= 1.5 * dt;
    particle.vel.multiplyScalar(Math.pow(0.9, dt * 60));
    particle.pos.addScaledVector(particle.vel, dt);
    const index = write * 3;
    particlePositions[index] = particle.pos.x;
    particlePositions[index + 1] = particle.pos.y;
    particlePositions[index + 2] = particle.pos.z;
    particleColors[index] = particle.color.r;
    particleColors[index + 1] = particle.color.g;
    particleColors[index + 2] = particle.color.b;
    write += 1;
  }
  particleGeo.setDrawRange(0, write);
  particleGeo.attributes.position.needsUpdate = true;
  particleGeo.attributes.color.needsUpdate = true;
}

function explodeShell(shell) {
  for (let i = 0; i < shell.burst; i += 1) {
    randomSphere(tmp.vel).multiplyScalar(shell.spread * (0.4 + Math.random() * 0.75));
    tmp.color.copy(shell.color);
    if (Math.random() < 0.28) tmp.color.lerp(white, 0.78);
    emit(shell.pos, tmp.vel, tmp.color, 0.5 + Math.random() * 0.6);
  }
}

function emit(pos, vel, color, life) {
  const particle = allocParticle();
  particle.pos.copy(pos);
  particle.vel.copy(vel);
  particle.color.copy(color);
  particle.life = 0;
  particle.max = life;
}

function allocParticle() {
  for (const particle of particles) {
    if (particle.life >= particle.max) return particle;
  }
  let oldest = particles[0];
  for (const particle of particles) {
    if (particle.life > oldest.life) oldest = particle;
  }
  return oldest;
}

function removeShell(shell) {
  rig.remove(shell.mesh);
  shell.mesh.material.dispose();
}

function randomSphere(target) {
  const z = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return target.set(r * Math.cos(t), z, r * Math.sin(t));
}

function updateCoreVisual() {
  const grow = 1 + Math.min(0.75, fed * 0.03);
  ring.scale.setScalar(grow * (1 + Math.sin(elapsed * 3.2) * 0.035 + ringKick));
  const tint = recentColors.length ? recentColors[recentColors.length - 1] : warmColor;
  ring.material.color.lerp(tint, 0.08);
  beam.material.color.lerp(tint, 0.08);
  glow.material.color.lerp(tint, 0.08);
  const column = 1 + Math.min(1.1, fed * 0.04);
  beam.scale.set(1, column, 1);
  beam.position.y = 0.35 * beam.scale.y;
  beam.material.opacity = 0.16 + Math.min(0.5, charge * 0.07 + fed * 0.012);
  const glowScale = 0.26 + Math.min(0.55, fed * 0.025) + charge * 0.04 + ringKick;
  glow.scale.setScalar(glowScale);
  glow.material.opacity = 0.45 + Math.min(0.45, charge * 0.08);
}

function updateRig(dt, snap) {
  const k = snap ? 1 : 1 - Math.exp(-dt * 10);
  rig.position.lerp(headPos, k);
  smoothForward.lerp(forward, k);
  if (smoothForward.lengthSq() < 1e-8) smoothForward.set(0, 0, -1);
  else smoothForward.normalize();
  rig.rotation.y = Math.atan2(-smoothForward.x, -smoothForward.z);
  rig.updateMatrixWorld(true);
  core.getWorldPosition(coreWorld);
}

function readHead(frame) {
  const reference = renderer.xr.getReferenceSpace();
  const pose = frame.getViewerPose(reference);
  if (!pose) return false;
  const position = pose.transform.position;
  const orientation = pose.transform.orientation;
  headPos.set(position.x, position.y, position.z);
  headQuat.set(orientation.x, orientation.y, orientation.z, orientation.w);
  forward.set(0, 0, -1).applyQuaternion(headQuat);
  forward.y = 0;
  if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
  else forward.normalize();
  right.set(1, 0, 0).applyQuaternion(headQuat);
  right.y = 0;
  if (right.lengthSq() < 1e-8) right.crossVectors(forward, up).normalize();
  else right.normalize();
  headReady = true;
  return true;
}

function syncGrabbers(frame, dt) {
  const reference = renderer.xr.getReferenceSpace();
  const seen = new Set();
  for (const source of frame.session.inputSources) {
    seen.add(source);
    let grabber = grabbers.get(source);
    if (!grabber) {
      grabber = createGrabber(source, source.hand ? "hand" : "controller");
      grabbers.set(source, grabber);
    }
    grabber.previous.copy(grabber.position);
    const posed = source.hand ? updateHand(grabber, frame, source, reference) : updateController(grabber, frame, source, reference);
    if (!posed) {
      grabber.missing += dt;
      grabber.orb.visible = false;
      if (grabber.missing > 0.3) release(grabber);
      continue;
    }
    grabber.missing = 0;
    if (dt > 0) grabber.velocity.copy(grabber.position).sub(grabber.previous).divideScalar(dt);
    stepGrabber(grabber, null);
    grabber.orb.position.copy(grabber.position);
    grabber.orb.visible = grabber.closed || Boolean(grabber.held);
    tintOrb(grabber);
  }
  for (const [source, grabber] of grabbers) {
    if (seen.has(source)) continue;
    release(grabber);
    destroyGrabber(grabber);
    grabbers.delete(source);
  }
}

function updateHand(grabber, frame, source, reference) {
  const palmName = source.hand.get("middle-finger-phalanx-proximal") ? "middle-finger-phalanx-proximal" : "wrist";
  if (!readJoint(frame, source.hand, palmName, reference, grabber.position)) return false;
  let seen = 0;
  let curled = 0;
  if (!readJoint(frame, source.hand, "wrist", reference, tmp.palm)) tmp.palm.copy(grabber.position);
  for (const name of TIPS) {
    if (!readJoint(frame, source.hand, name, reference, tmp.tip)) continue;
    seen += 1;
    if (tmp.tip.distanceTo(tmp.palm) < TIP_CURL) curled += 1;
  }
  if (seen >= 3) {
    if (!grabber.closed && curled >= 3) grabber.closed = true;
    if (grabber.closed && curled <= 1) grabber.closed = false;
  }
  return true;
}

function updateController(grabber, frame, source, reference) {
  const space = source.gripSpace || source.targetRaySpace;
  if (!space) return false;
  const pose = frame.getPose(space, reference);
  if (!pose) return false;
  const position = pose.transform.position;
  grabber.position.set(position.x, position.y, position.z);
  const down = pressed(source.gamepad, SQUEEZE_BUTTON) || pressed(source.gamepad, TRIGGER_BUTTON);
  if (!grabber.closed && down) grabber.closed = true;
  if (grabber.closed && !down) grabber.closed = false;
  return true;
}

function framePreviewCamera() {
  camera.position.copy(headPos);
  camera.rotation.set(-0.08, 0, 0);
  camera.updateMatrixWorld();
}

function updatePreviewGrabber() {
  const grabber = previewGrabber;
  if (pointer.down && grabber.held) {
    placePreviewHold();
    return;
  }
  raycaster.setFromCamera(pointer.ndc, camera);
  if (raycaster.ray.intersectPlane(wordPlane, tmp.a)) grabber.position.copy(tmp.a);
  grabber.orb.visible = true;
  grabber.orb.position.copy(grabber.position);
  tintOrb(grabber);
}

function placePreviewHold() {
  const grabber = previewGrabber;
  const word = grabber.held;
  if (!word || word.state === "absorb") return;
  framePreviewCamera();
  const pull = THREE.MathUtils.clamp((pointer.downY - pointer.ndc.y) / 0.34, 0, 1);
  grabber.position.copy(grabber.grabPoint).lerp(coreWorld, pull);
  word.position.copy(grabber.position);
  placeWord(word, 1.08);
  updateTether(grabber, word);
  grabber.orb.visible = true;
  grabber.orb.position.copy(grabber.position);
  tintOrb(grabber);
  if (pull > 0.82 || word.position.distanceTo(coreWorld) < CORE_RADIUS + 0.04 || previewOverRing()) {
    absorb(word);
  }
}

function previewOverRing() {
  tmp.b.copy(coreWorld).project(camera);
  if (tmp.b.z > 1) return false;
  return Math.hypot(tmp.b.x - pointer.ndc.x, tmp.b.y - pointer.ndc.y) < 0.18;
}

function stepGrabber(grabber, picked) {
  if (grabber.closed && !grabber.wasClosed) tryGrab(grabber, picked);
  if (!grabber.closed && grabber.wasClosed) release(grabber);
  grabber.wasClosed = grabber.closed;
  if (!grabber.held) grabber.tether.visible = false;
}

function tryGrab(grabber, picked) {
  if (grabber.held) return;
  const word = picked && !picked.heldBy ? picked : nearestWord(grabber.position);
  if (!word || word.heldBy) return;
  if (word.state !== "free" && word.state !== "in") return;
  grabber.held = word;
  word.heldBy = grabber;
  word.state = "held";
  word.armed = true;
  word.releaseAge = 0;
  word.drift.set(0, 0, 0);
  grabber.grabPoint.copy(word.position);
  pulse(grabber.source, 0.4, 28);
}

function nearestWord(point) {
  let best = null;
  let bestDistance = Infinity;
  for (const word of words) {
    if (word.heldBy) continue;
    if (word.state !== "free" && word.state !== "in") continue;
    const reach = Math.max(0.12, word.radius + 0.05);
    const distance = point.distanceTo(word.position);
    if (distance <= reach && distance < bestDistance) {
      best = word;
      bestDistance = distance;
    }
  }
  return best;
}

function pickWord() {
  for (const word of words) word.group.updateWorldMatrix(true, true);
  raycaster.setFromCamera(pointer.ndc, camera);
  const hits = raycaster.intersectObjects(
    words.map((word) => word.group),
    true,
  );
  for (const hit of hits) {
    let node = hit.object;
    while (node) {
      if (node.userData?.word) {
        const word = node.userData.word;
        if (!word.heldBy && (word.state === "free" || word.state === "in")) return word;
        break;
      }
      node = node.parent;
    }
  }

  let best = null;
  let bestDistance = 0.24;
  for (const word of words) {
    if (word.heldBy || (word.state !== "free" && word.state !== "in")) continue;
    tmp.a.copy(word.group.position).project(camera);
    if (tmp.a.z > 1) continue;
    const distance = Math.hypot(tmp.a.x - pointer.ndc.x, tmp.a.y - pointer.ndc.y);
    if (distance < bestDistance) {
      best = word;
      bestDistance = distance;
    }
  }
  return best;
}

function release(grabber) {
  const word = grabber.held;
  if (!word) return;
  word.heldBy = null;
  word.state = word.state === "absorb" ? word.state : "free";
  word.releaseAge = 0;
  word.drift.copy(grabber.velocity).clampLength(0, 1.6).multiplyScalar(0.35);
  grabber.held = null;
  grabber.tether.visible = false;
}

function updateTether(grabber, word) {
  const positions = grabber.tether.geometry.attributes.position;
  positions.setXYZ(0, word.position.x, word.position.y, word.position.z);
  positions.setXYZ(1, coreWorld.x, coreWorld.y, coreWorld.z);
  positions.needsUpdate = true;
  grabber.tether.geometry.computeBoundingSphere();
  grabber.tether.material.color.copy(word.color);
  grabber.tether.visible = true;
}

function tintOrb(grabber) {
  if (grabber.held) grabber.orb.material.color.copy(grabber.held.color);
  else if (grabber.closed) grabber.orb.material.color.setHex(0xd6ff4a);
  else grabber.orb.material.color.setHex(0xfff6d8);
}

function createGrabber(source, kind) {
  const material = new THREE.MeshBasicMaterial({
    color: 0xfff6d8,
    transparent: true,
    opacity: 0.9,
    toneMapped: false,
  });
  const orb = new THREE.Mesh(orbGeo, material);
  orb.frustumCulled = false;
  orb.visible = false;
  scene.add(orb);
  const tetherGeo = new THREE.BufferGeometry();
  tetherGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  const tether = new THREE.Line(
    tetherGeo,
    new THREE.LineBasicMaterial({ color: 0xfff1c2, transparent: true, opacity: 0.8, toneMapped: false }),
  );
  tether.frustumCulled = false;
  tether.visible = false;
  scene.add(tether);
  return {
    source,
    kind,
    orb,
    tether,
    position: new THREE.Vector3(),
    previous: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    grabPoint: new THREE.Vector3(),
    held: null,
    closed: false,
    wasClosed: false,
    missing: 0,
  };
}

function destroyGrabber(grabber) {
  release(grabber);
  scene.remove(grabber.orb);
  scene.remove(grabber.tether);
  grabber.orb.material.dispose();
  grabber.tether.geometry.dispose();
  grabber.tether.material.dispose();
}

function readJoint(frame, hand, name, reference, target) {
  const joint = hand.get(name);
  if (!joint) return false;
  let pose = null;
  try {
    pose = frame.getJointPose(joint, reference);
  } catch {
    pose = null;
  }
  if (!pose) return false;
  const position = pose.transform.position;
  target.set(position.x, position.y, position.z);
  return true;
}

function pressed(gamepad, index) {
  const button = gamepad?.buttons?.[index];
  return Boolean(button && (button.pressed || button.value > 0.75));
}

function handleExit(frame) {
  if (ending) return;
  for (const source of frame.session.inputSources) {
    if (!pressed(source.gamepad, SECONDARY_BUTTON)) continue;
    ending = true;
    frame.session.end();
    return;
  }
}

function pulse(source, strength, duration) {
  const actuator = source?.gamepad?.hapticActuators?.[0];
  try {
    actuator?.pulse?.(strength, duration);
  } catch {
    // Some runtimes expose haptics only after the session has input.
  }
}

function updateStatus(dt) {
  statusClock -= dt;
  if (statusClock > 0) return;
  statusClock = 0.2;
  if (!font && !fontFailed) {
    status.textContent = "Loading letters…";
    return;
  }
  const phase =
    fed < 1 ? "the ring is waiting" : fed < 5 ? "the firework is waking" : fed < 12 ? "the firework is climbing" : "the firework is wide open";
  status.textContent = `Pulled ${fed} · ${phase} · ${audioLabel}`;
}

function sampleAudio(dt) {
  if (audioCtx?.state === "suspended") resumeAudioContext();

  let bass = 0;
  let energy = 0;
  if (audioReady && analyser && freqData) {
    analyser.getByteFrequencyData(freqData);
    const n = freqData.length;
    const bassEnd = Math.max(2, Math.floor(n * 0.08));
    for (let i = 0; i < n; i += 1) {
      const value = freqData[i] / 255;
      energy += value;
      if (i < bassEnd) bass += value;
    }
    bass /= bassEnd;
    energy /= n;
    if (timeData) {
      analyser.getByteTimeDomainData(timeData);
      let sumSq = 0;
      for (let i = 0; i < timeData.length; i += 1) {
        const value = (timeData[i] - 128) / 128;
        sumSq += value * value;
      }
      const rms = Math.sqrt(sumSq / timeData.length);
      energy = Math.max(energy, rms * 2.4);
      bass = Math.max(bass, rms * 2.1);
    }
  }

  const gain = sensitivity;
  bass = Math.min(1, bass * gain * 1.5);
  const ease = 1 - Math.pow(0.001, dt);
  bassSmooth += (bass - bassSmooth) * ease;
  bassAvg += (bassSmooth - bassAvg) * Math.min(1, dt * 0.35);
  beatCooldown = Math.max(0, beatCooldown - dt);
  beatPulse = Math.max(0, beatPulse - dt * 3.2);
  if (bassSmooth > bassAvg * 1.35 + 0.05 && bassSmooth > 0.12 && beatCooldown <= 0) {
    beatPulse = 1;
    beatCooldown = 0.14;
  }
  return { bass: bassSmooth, energy, beat: beatPulse };
}

async function beginAudio(micPromise) {
  const gen = ++audioGen;
  releaseAudio();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  audioCtx = ctx;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.55;
  freqData = new Uint8Array(analyser.frequencyBinCount);
  timeData = new Uint8Array(analyser.fftSize);
  audioReady = false;

  if (audioMode === "demo") {
    wireDemoBeat(ctx, analyser);
    audioLabel = "demo beat";
  } else {
    if (!micPromise && navigator.mediaDevices?.getUserMedia) {
      micPromise = navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    micStream = await micPromise;
    if (gen !== audioGen) return;
    if (!micStream?.getAudioTracks?.().some((track) => track.readyState === "live")) {
      throw new Error("Microphone permission was denied or no live audio track.");
    }
    const source = ctx.createMediaStreamSource(micStream);
    const micGain = ctx.createGain();
    micGain.gain.value = 3.2;
    source.connect(micGain);
    micGain.connect(analyser);
    audioLabel = "mic";
  }

  if (gen !== audioGen) return;
  await resumeAudioContext();
  if (gen !== audioGen) return;
  audioReady = true;
}

async function resumeAudioContext() {
  if (!audioCtx || audioCtx.state !== "suspended") return;
  try {
    await audioCtx.resume();
  } catch (error) {
    console.warn(error);
  }
}

function wireDemoBeat(ctx, dest) {
  const master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(dest);
  const hear = ctx.createGain();
  hear.gain.value = 0.08;
  master.connect(hear);
  hear.connect(ctx.destination);

  const schedule = () => {
    if (!audioCtx || audioCtx !== ctx) return;
    const t0 = ctx.currentTime + 0.02;
    const bar = 0.48;
    for (let i = 0; i < 8; i += 1) {
      const t = t0 + i * bar;
      tone(ctx, master, t, 55, 0.12, 0.9, "sine", 32);
      if (i % 2 === 1) tone(ctx, master, t + bar * 0.5, 48, 0.08, 0.55, "sine", 32);
      if (i === 2 || i === 6) noise(ctx, master, t + bar * 0.5, 0.08, 0.35);
      noise(ctx, master, t + bar * 0.25, 0.03, 0.12);
      noise(ctx, master, t + bar * 0.75, 0.03, 0.1);
      if (i % 4 === 0) tone(ctx, master, t + bar * 0.125, 420, 0.06, 0.2, "triangle");
      if (i % 4 === 2) tone(ctx, master, t + bar * 0.375, 660, 0.05, 0.16, "triangle");
    }
    demoTimer = window.setTimeout(schedule, bar * 8 * 1000 - 40);
  };

  schedule();
  demoNodes = [master];
}

function tone(ctx, dest, time, freq, dur, gain, type, dropTo) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);
  if (dropTo) osc.frequency.exponentialRampToValueAtTime(dropTo, time + dur);
  amp.gain.setValueAtTime(gain, time);
  amp.gain.exponentialRampToValueAtTime(0.001, time + dur);
  osc.connect(amp);
  amp.connect(dest);
  osc.start(time);
  osc.stop(time + dur + 0.02);
}

function noise(ctx, dest, time, dur, gain) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1800;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gain, time);
  amp.gain.exponentialRampToValueAtTime(0.001, time + dur);
  src.connect(filter);
  filter.connect(amp);
  amp.connect(dest);
  src.start(time);
  src.stop(time + dur + 0.02);
}

function stopAudio() {
  audioGen += 1;
  releaseAudio();
  audioLabel = "listening";
}

function releaseAudio() {
  if (demoTimer) clearTimeout(demoTimer);
  demoTimer = 0;
  for (const node of demoNodes) {
    try {
      node.disconnect();
    } catch {
      // Already disconnected when the context closed.
    }
  }
  demoNodes = [];
  micStream?.getTracks?.().forEach((track) => track.stop());
  micStream = null;
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  analyser = null;
  freqData = null;
  timeData = null;
  audioReady = false;
  bassSmooth = 0;
  bassAvg = 0.08;
  beatPulse = 0;
}

const WORD_SLOTS = [
  { side: -0.42, lift: 0.02, distance: 0.64 },
  { side: -0.24, lift: 0.12, distance: 0.74 },
  { side: -0.08, lift: -0.05, distance: 0.6 },
  { side: 0.1, lift: 0.08, distance: 0.78 },
  { side: 0.26, lift: -0.02, distance: 0.66 },
  { side: 0.42, lift: 0.1, distance: 0.72 },
  { side: -0.34, lift: -0.08, distance: 0.8 },
  { side: 0.02, lift: 0.16, distance: 0.7 },
  { side: 0.34, lift: 0.14, distance: 0.62 },
  { side: -0.16, lift: 0.04, distance: 0.84 },
];

function occupySlot(word) {
  let best = WORD_SLOTS[0];
  let bestGap = -1;
  for (const slot of WORD_SLOTS) {
    tmp.a.copy(headPos).addScaledVector(forward, slot.distance).addScaledVector(right, slot.side);
    tmp.a.y = headPos.y + slot.lift;
    let gap = 4;
    for (const other of words) gap = Math.min(gap, other.position.distanceTo(tmp.a));
    if (gap > bestGap) {
      bestGap = gap;
      best = slot;
    }
  }
  word.position.copy(headPos).addScaledVector(forward, best.distance).addScaledVector(right, best.side);
  word.position.y = headPos.y + best.lift;
}

function sparkTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.85)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.28, "rgba(255,214,140,0.45)");
  gradient.addColorStop(1, "rgba(255,180,80,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function setPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function isUi(target) {
  return target instanceof Element && Boolean(target.closest("button, a, input, textarea, select, label"));
}
