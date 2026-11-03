import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const palette = [0x5b8cff, 0xff5d73, 0xd6ff4a, 0xffb45a, 0xc084fc, 0x3dffe8, 0xff7ad9, 0x7f9a78];
const SECONDARY_BUTTON = 5;
const SENSITIVITY = { low: 0.55, medium: 1, high: 1.7 };

const MODEL_CATALOG = [
  { id: "matt", label: "Matt's head", path: "../4-blast/models/matt-head.glb", checkbox: "#model-matt" },
  { id: "duck", label: "Duck", path: "../4-blast/models/duck.glb", checkbox: "#model-duck" },
  { id: "fox", label: "Fox", path: "../4-blast/models/fox.glb", checkbox: "#model-fox" },
  { id: "helmet", label: "Helmet", path: "../4-blast/models/helmet.glb", checkbox: "#model-helmet" },
  { id: "flamingo", label: "Flamingo", path: "../4-blast/models/flamingo.glb", checkbox: "#model-flamingo" },
];

const SHAPE_KINDS = ["box", "sphere", "octa", "icosa", "torus", "cone", "cylinder", "tetra", "ring", "dodeca"];

const QUIRKS = [
  "bassPulse",
  "midPulse",
  "treblePulse",
  "yBar",
  "spin",
  "tumble",
  "hueShift",
  "emissiveFlash",
  "orbit",
  "jitter",
  "squash",
  "wirePulse",
  "beatFlip",
  "beatHop",
  "opacityBreath",
  "rainbow",
  "ringGrow",
  "strobe",
  "lean",
  "mirrorSpin",
];

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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 40);
scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(0.5, 1.8, 0.4);
scene.add(sun);
const beatLight = new THREE.PointLight(0xff7ad9, 0, 6, 2);
beatLight.position.set(0, 1.4, -0.8);
scene.add(beatLight);

const clock = new THREE.Clock();
const planes = new Map();
const dancers = [];
const templates = new Map();
const loader = new GLTFLoader();
let modelsReady = false;
let modelError = false;
let loadPending = MODEL_CATALOG.length;

for (const entry of MODEL_CATALOG) {
  loader.load(
    entry.path,
    (gltf) => {
      try {
        templates.set(entry.id, prepareTemplate(gltf.scene));
      } catch (error) {
        console.warn(entry.id, error);
      }
      finishModelLoad();
    },
    undefined,
    () => {
      console.warn(`Could not load ${entry.path}`);
      finishModelLoad();
    },
  );
}

const tmp = {
  local: new THREE.Vector3(),
  color: new THREE.Color(),
  quat: new THREE.Quaternion(),
  axis: new THREE.Vector3(),
  offset: new THREE.Vector3(),
};

let objectCount = 14;
let mixMode = "both";
let enabledModelIds = MODEL_CATALOG.map((entry) => entry.id);
let audioMode = "mic";
let sensitivity = 1;
let layoutMode = "cloud";
let showPlanes = false;
let scan = true;
let nextColor = 0;
let startedAt = 0;
let scanRequested = false;
let scanning = false;
let ending = false;
let spawned = false;

let audioCtx = null;
let analyser = null;
let freqData = null;
let micStream = null;
let demoNodes = [];
let demoTimer = 0;
let audioReady = false;
let audioLabel = "no audio";
let bassSmooth = 0;
let midSmooth = 0;
let trebleSmooth = 0;
let energySmooth = 0;
let beatPulse = 0;
let beatCooldown = 0;
let bassAvg = 0.08;

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

enter.addEventListener("click", () => {
  applyForm();
  if (mixMode !== "shapes" && !enabledModelIds.length) {
    note.textContent = "Pick at least one model, or switch Mix to Shapes only.";
    return;
  }
  if (mixMode !== "shapes" && !enabledTemplates().length) {
    note.textContent = "Selected models are still loading or failed to load.";
    return;
  }

  // requestSession must start in this click, before any await.
  const sessionPromise = navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["plane-detection", "local-floor"],
    optionalFeatures: ["dom-overlay"],
    domOverlay: { root: overlay },
  });

  beginAudio().catch((error) => {
    console.warn(error);
    audioLabel = "audio failed";
    note.textContent = error?.message || "Could not start audio. Try Demo beat.";
  });

  sessionPromise
    .then((session) => renderer.xr.setSession(session))
    .catch((error) => {
      note.textContent = error?.message || "Could not start AR.";
      stopAudio();
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
  spawned = false;
  clock.start();
  status.textContent = "Looking for room…";
  if (audioCtx?.state === "suspended") audioCtx.resume().catch(() => {});
});

renderer.xr.addEventListener("sessionend", () => {
  overlay.style.display = "none";
  setup.hidden = false;
  clearPlanes();
  clearDancers();
  stopAudio();
  beatLight.intensity = 0;
  note.textContent = "Session ended. Enter AR to look again.";
});

renderer.setAnimationLoop((_time, frame) => {
  const dt = Math.min(0.05, clock.getDelta() || 0.016);
  const levels = sampleAudio(dt);

  if (frame) {
    exitFromControllers(frame);
    syncPlanes(frame);
    if (!spawned && readyToSpawn()) spawnDancers();
    stepDancers(dt, levels);
  }

  beatLight.intensity = levels.beat * 4.5 * sensitivity;
  tmp.color.setHSL((performance.now() * 0.00015) % 1, 0.85, 0.55);
  beatLight.color.copy(tmp.color);

  renderer.render(scene, camera);
});

function finishModelLoad() {
  loadPending -= 1;
  if (loadPending > 0) return;
  modelsReady = templates.size > 0;
  modelError = !modelsReady;
  if (modelError && mixMode === "models") {
    note.textContent = "Could not load any models.";
  }
}

function applyForm() {
  objectCount = Math.min(60, Math.max(1, Number(form.querySelector("#count").value) || 14));
  mixMode = form.querySelector("#mix").value || "both";
  enabledModelIds = MODEL_CATALOG.filter((entry) => form.querySelector(entry.checkbox)?.checked).map(
    (entry) => entry.id,
  );
  audioMode = form.querySelector("#audio").value || "mic";
  sensitivity = SENSITIVITY[form.querySelector("#sensitivity").value] || 1;
  layoutMode = form.querySelector("#layout").value || "cloud";
  showPlanes = form.querySelector("#planes").checked;
  scan = form.querySelector("#scan").checked;
}

function enabledTemplates() {
  return enabledModelIds.filter((id) => templates.has(id));
}

async function beginAudio() {
  stopAudio();
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.72;
  freqData = new Uint8Array(analyser.frequencyBinCount);
  audioReady = false;

  if (audioMode === "demo") {
    wireDemoBeat(audioCtx, analyser);
    audioLabel = "demo beat";
  } else {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      },
      video: false,
    });
    const source = audioCtx.createMediaStreamSource(micStream);
    source.connect(analyser);
    audioLabel = "mic";
  }

  if (audioCtx.state === "suspended") await audioCtx.resume();
  audioReady = true;
}

function wireDemoBeat(ctx, dest) {
  const master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(dest);
  // Also hear the demo lightly so the room has a pulse when testing without music.
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
      // Kick
      boom(ctx, master, t, 55, 0.12, 0.9);
      if (i % 2 === 1) boom(ctx, master, t + bar * 0.5, 48, 0.08, 0.55);
      // Snare-ish noise hit
      if (i === 2 || i === 6) noiseHit(ctx, master, t + bar * 0.5, 0.08, 0.35);
      // Hats
      noiseHit(ctx, master, t + bar * 0.25, 0.03, 0.12);
      noiseHit(ctx, master, t + bar * 0.75, 0.03, 0.1);
      // Mid blip
      if (i % 4 === 0) blip(ctx, master, t + bar * 0.125, 420, 0.06, 0.2);
      if (i % 4 === 2) blip(ctx, master, t + bar * 0.375, 660, 0.05, 0.16);
    }

    demoTimer = window.setTimeout(schedule, bar * 8 * 1000 - 40);
  };

  schedule();
  demoNodes = [master];
}

function boom(ctx, dest, time, freq, dur, gain) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, time);
  osc.frequency.exponentialRampToValueAtTime(32, time + dur);
  g.gain.setValueAtTime(gain, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(time);
  osc.stop(time + dur + 0.02);
}

function blip(ctx, dest, time, freq, dur, gain) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, time);
  g.gain.setValueAtTime(gain, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(time);
  osc.stop(time + dur + 0.02);
}

function noiseHit(ctx, dest, time, dur, gain) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(dest);
  src.start(time);
  src.stop(time + dur + 0.02);
}

function stopAudio() {
  if (demoTimer) {
    clearTimeout(demoTimer);
    demoTimer = 0;
  }
  for (const node of demoNodes) {
    try {
      node.disconnect();
    } catch {
      /* ignore */
    }
  }
  demoNodes = [];
  if (micStream) {
    for (const track of micStream.getTracks()) track.stop();
    micStream = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  analyser = null;
  freqData = null;
  audioReady = false;
  audioLabel = "no audio";
}

function sampleAudio(dt) {
  let bass = 0;
  let mid = 0;
  let treble = 0;
  let energy = 0;

  if (audioReady && analyser && freqData) {
    analyser.getByteFrequencyData(freqData);
    const n = freqData.length;
    const bassEnd = Math.max(2, Math.floor(n * 0.08));
    const midEnd = Math.max(bassEnd + 1, Math.floor(n * 0.35));

    for (let i = 0; i < n; i += 1) {
      const v = freqData[i] / 255;
      energy += v;
      if (i < bassEnd) bass += v;
      else if (i < midEnd) mid += v;
      else treble += v;
    }

    bass /= bassEnd;
    mid /= Math.max(1, midEnd - bassEnd);
    treble /= Math.max(1, n - midEnd);
    energy /= n;
  }

  const gain = sensitivity;
  bass = Math.min(1, bass * gain * 1.35);
  mid = Math.min(1, mid * gain * 1.2);
  treble = Math.min(1, treble * gain * 1.15);
  energy = Math.min(1, energy * gain * 1.25);

  const ease = 1 - Math.pow(0.001, dt);
  bassSmooth += (bass - bassSmooth) * ease;
  midSmooth += (mid - midSmooth) * ease;
  trebleSmooth += (treble - trebleSmooth) * ease;
  energySmooth += (energy - energySmooth) * ease;

  bassAvg += (bassSmooth - bassAvg) * Math.min(1, dt * 0.35);
  beatCooldown = Math.max(0, beatCooldown - dt);
  beatPulse = Math.max(0, beatPulse - dt * 3.2);

  if (bassSmooth > bassAvg * 1.45 + 0.08 && bassSmooth > 0.18 && beatCooldown <= 0) {
    beatPulse = 1;
    beatCooldown = 0.16;
  }

  return {
    bass: bassSmooth,
    mid: midSmooth,
    treble: trebleSmooth,
    energy: energySmooth,
    beat: beatPulse,
  };
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

function prepareTemplate(source) {
  source.updateMatrixWorld(true);

  const box = new THREE.Box3();
  let meshes = 0;
  source.traverse((obj) => {
    if (!obj.isMesh) return;
    meshes += 1;
    box.expandByObject(obj);
  });
  if (!meshes || box.isEmpty()) throw new Error("Model has no mesh.");

  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.02);

  source.matrix.decompose(source.position, source.quaternion, source.scale);
  source.matrixAutoUpdate = true;
  source.position.sub(center);
  source.scale.multiplyScalar(0.5 / radius);

  const wrapper = new THREE.Group();
  wrapper.add(source);
  return wrapper;
}

function readyToSpawn() {
  if (layoutMode === "cloud" || layoutMode === "ring") return true;
  if (!planes.size) return false;
  return [...planes.values()].some((entry) => entry.orientation === "horizontal" || entry.orientation === "vertical");
}

function pickQuirks() {
  const pool = [...QUIRKS];
  const count = 2 + Math.floor(Math.random() * 3);
  const picked = [];
  for (let i = 0; i < count && pool.length; i += 1) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

function createShapeMesh(kind, color) {
  let geometry;
  switch (kind) {
    case "sphere":
      geometry = new THREE.SphereGeometry(0.5, 24, 18);
      break;
    case "octa":
      geometry = new THREE.OctahedronGeometry(0.55, 0);
      break;
    case "icosa":
      geometry = new THREE.IcosahedronGeometry(0.52, 0);
      break;
    case "torus":
      geometry = new THREE.TorusGeometry(0.38, 0.14, 16, 40);
      break;
    case "cone":
      geometry = new THREE.ConeGeometry(0.42, 0.9, 20);
      break;
    case "cylinder":
      geometry = new THREE.CylinderGeometry(0.28, 0.28, 0.9, 20);
      break;
    case "tetra":
      geometry = new THREE.TetrahedronGeometry(0.62, 0);
      break;
    case "ring":
      geometry = new THREE.TorusGeometry(0.45, 0.06, 12, 48);
      break;
    case "dodeca":
      geometry = new THREE.DodecahedronGeometry(0.5, 0);
      break;
    default:
      geometry = new THREE.BoxGeometry(0.85, 0.85, 0.85);
      break;
  }

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.35,
    metalness: 0.15,
    emissive: color,
    emissiveIntensity: 0.15,
    transparent: true,
    opacity: 0.92,
  });
  material.toneMapped = true;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  if (kind === "ring" || kind === "torus" || Math.random() < 0.25) {
    const wire = new THREE.Mesh(
      geometry.clone(),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.35,
      }),
    );
    wire.material.toneMapped = false;
    wire.frustumCulled = false;
    mesh.add(wire);
    mesh.userData.wire = wire;
  }

  return mesh;
}

function createModelMesh(templateId, color) {
  const template = templates.get(templateId);
  const mesh = template.clone(true);
  mesh.traverse((obj) => {
    obj.frustumCulled = false;
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const cloned = mats.map((mat) => {
      const next = mat.clone();
      if ("emissive" in next) {
        next.emissive = new THREE.Color(color);
        next.emissiveIntensity = 0.08;
      }
      return next;
    });
    obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
  });
  return mesh;
}

function spawnPoint(index, total) {
  if (layoutMode === "ring") {
    const angle = (index / total) * Math.PI * 2;
    const radius = 1.1 + (index % 3) * 0.18;
    return new THREE.Vector3(Math.cos(angle) * radius, 1.05 + (index % 4) * 0.12, Math.sin(angle) * radius - 0.15);
  }

  if (layoutMode === "room" && planes.size) {
    const floors = [...planes.values()].filter((entry) => entry.orientation === "horizontal");
    const walls = [...planes.values()].filter((entry) => entry.orientation === "vertical");
    const pool = floors.length ? floors : walls.length ? walls : [...planes.values()];
    const entry = pool[index % pool.length];
    const poly = entry.polygon;
    if (poly?.length) {
      const point = poly[Math.floor(Math.random() * poly.length)];
      tmp.local.set(point.x * 0.7, 0.55 + Math.random() * 1.1, point.z * 0.7);
      return tmp.local.clone().applyMatrix4(entry.group.matrix);
    }
  }

  // Default cloud in front of the user.
  const col = index % 5;
  const row = Math.floor(index / 5);
  return new THREE.Vector3(
    (col - 2) * 0.38 + (Math.random() - 0.5) * 0.12,
    0.85 + row * 0.38 + (Math.random() - 0.5) * 0.1,
    -0.7 - (index % 3) * 0.28 - Math.random() * 0.15,
  );
}

function spawnDancers() {
  spawned = true;
  const wantModels = mixMode !== "shapes" && enabledTemplates().length > 0;
  const wantShapes = mixMode !== "models";

  for (let i = 0; i < objectCount; i += 1) {
    const useModel = wantModels && (!wantShapes || Math.random() < 0.38);
    const color = palette[nextColor % palette.length];
    nextColor += 1;
    const quirks = pickQuirks();
    const baseScale = useModel ? 0.22 + Math.random() * 0.18 : 0.18 + Math.random() * 0.28;
    let mesh;
    let kind;

    if (useModel) {
      const ids = enabledTemplates();
      kind = ids[Math.floor(Math.random() * ids.length)];
      mesh = createModelMesh(kind, color);
    } else {
      kind = SHAPE_KINDS[Math.floor(Math.random() * SHAPE_KINDS.length)];
      mesh = createShapeMesh(kind, color);
    }

    const home = spawnPoint(i, objectCount);
    mesh.position.copy(home);
    mesh.scale.setScalar(baseScale);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    scene.add(mesh);

    dancers.push({
      mesh,
      kind,
      isModel: useModel,
      quirks,
      home: home.clone(),
      baseScale,
      baseColor: new THREE.Color(color),
      phase: Math.random() * Math.PI * 2,
      spinAxis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      spinSpeed: 0.4 + Math.random() * 1.8,
      orbitRadius: 0.08 + Math.random() * 0.22,
      orbitSpeed: 0.6 + Math.random() * 1.4,
      hop: 0,
      flip: 0,
      hue: Math.random(),
      band: i % 3, // 0 bass, 1 mid, 2 treble preference
    });
  }

  status.textContent = `${dancers.length} dancers · ${audioLabel}`;
}

function forEachMaterial(root, fn) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) fn(mat, obj);
  });
}

function stepDancers(dt, levels) {
  if (!dancers.length) return;
  const now = performance.now() * 0.001;

  for (const dancer of dancers) {
    const { mesh, quirks, home, baseScale, phase, band } = dancer;
    const bandLevel = band === 0 ? levels.bass : band === 1 ? levels.mid : levels.treble;

    let scaleX = 1;
    let scaleY = 1;
    let scaleZ = 1;
    let opacity = 0.92;
    let emissive = 0.12 + levels.energy * 0.35;
    let hueShift = 0;
    let wireOpacity = 0.2;

    tmp.offset.set(0, 0, 0);
    tmp.quat.identity();

    for (const quirk of quirks) {
      switch (quirk) {
        case "bassPulse": {
          const p = 1 + levels.bass * 0.85;
          scaleX *= p;
          scaleY *= p;
          scaleZ *= p;
          break;
        }
        case "midPulse": {
          const p = 1 + levels.mid * 0.7;
          scaleX *= p;
          scaleY *= p;
          scaleZ *= p;
          break;
        }
        case "treblePulse": {
          const p = 1 + levels.treble * 0.55;
          scaleX *= p * (1 + levels.treble * 0.2);
          scaleY *= p;
          scaleZ *= p * (1 + levels.treble * 0.2);
          break;
        }
        case "yBar": {
          scaleY *= 0.55 + bandLevel * 2.4;
          scaleX *= 0.75 + (1 - bandLevel) * 0.35;
          scaleZ *= 0.75 + (1 - bandLevel) * 0.35;
          break;
        }
        case "spin": {
          tmp.axis.copy(dancer.spinAxis);
          tmp.quat.setFromAxisAngle(tmp.axis, dancer.spinSpeed * (0.4 + levels.energy * 3.5) * dt);
          mesh.quaternion.premultiply(tmp.quat);
          break;
        }
        case "tumble": {
          mesh.rotation.x += (0.5 + levels.mid * 4) * dt;
          mesh.rotation.z += (0.35 + levels.treble * 5) * dt;
          break;
        }
        case "hueShift": {
          hueShift += levels.mid * 0.35 + levels.beat * 0.2;
          break;
        }
        case "emissiveFlash": {
          emissive += levels.beat * 1.8 + levels.bass * 0.6;
          break;
        }
        case "orbit": {
          const a = now * dancer.orbitSpeed + phase;
          tmp.offset.x += Math.cos(a) * dancer.orbitRadius * (0.5 + levels.energy);
          tmp.offset.z += Math.sin(a) * dancer.orbitRadius * (0.5 + levels.energy);
          tmp.offset.y += Math.sin(a * 1.7) * dancer.orbitRadius * 0.45 * levels.mid;
          break;
        }
        case "jitter": {
          const j = levels.treble * 0.08;
          tmp.offset.x += (Math.random() - 0.5) * j;
          tmp.offset.y += (Math.random() - 0.5) * j;
          tmp.offset.z += (Math.random() - 0.5) * j;
          break;
        }
        case "squash": {
          const s = levels.bass;
          scaleY *= 1 - s * 0.45;
          scaleX *= 1 + s * 0.35;
          scaleZ *= 1 + s * 0.35;
          break;
        }
        case "wirePulse": {
          wireOpacity = 0.15 + levels.treble * 0.7 + levels.beat * 0.4;
          break;
        }
        case "beatFlip": {
          if (levels.beat > 0.85 && dancer.flip <= 0) dancer.flip = Math.PI;
          if (dancer.flip > 0) {
            const step = Math.min(dancer.flip, dt * 10);
            mesh.rotateOnAxis(dancer.spinAxis, step);
            dancer.flip -= step;
          }
          break;
        }
        case "beatHop": {
          if (levels.beat > 0.85 && dancer.hop <= 0) dancer.hop = 1;
          if (dancer.hop > 0) {
            tmp.offset.y += Math.sin(dancer.hop * Math.PI) * 0.28;
            dancer.hop = Math.max(0, dancer.hop - dt * 2.8);
          }
          break;
        }
        case "opacityBreath": {
          opacity = 0.35 + (1 - levels.energy) * 0.55 + levels.beat * 0.3;
          break;
        }
        case "rainbow": {
          dancer.hue = (dancer.hue + dt * (0.05 + levels.energy * 0.55)) % 1;
          hueShift += 1;
          break;
        }
        case "ringGrow": {
          if (dancer.kind === "ring" || dancer.kind === "torus") {
            const g = 1 + levels.bass * 1.4 + levels.beat * 0.6;
            scaleX *= g;
            scaleZ *= g;
            scaleY *= 0.85 + levels.treble * 0.5;
          } else {
            scaleX *= 1 + levels.bass * 0.5;
            scaleZ *= 1 + levels.bass * 0.5;
          }
          break;
        }
        case "strobe": {
          if (levels.beat > 0.5 && Math.sin(now * 40 + phase) > 0.2) {
            emissive += 2.2;
            opacity = 1;
          }
          break;
        }
        case "lean": {
          mesh.rotation.z = Math.sin(now * 2 + phase) * levels.mid * 0.8;
          mesh.rotation.x = Math.cos(now * 1.5 + phase) * levels.bass * 0.5;
          break;
        }
        case "mirrorSpin": {
          mesh.rotation.y += (levels.bass - levels.treble) * 4 * dt;
          break;
        }
        default:
          break;
      }
    }

    // Soft idle bob so the cloud never feels dead in silence.
    tmp.offset.y += Math.sin(now * 1.3 + phase) * 0.03;

    mesh.position.copy(home).add(tmp.offset);
    mesh.scale.set(baseScale * scaleX, baseScale * scaleY, baseScale * scaleZ);

    const useRainbow = quirks.includes("rainbow");
    forEachMaterial(mesh, (mat, obj) => {
      if (obj === mesh.userData.wire || mat.wireframe) {
        mat.opacity = wireOpacity;
        return;
      }
      if (mat.color && (quirks.includes("hueShift") || useRainbow)) {
        const h = useRainbow ? dancer.hue : (dancer.hue + hueShift) % 1;
        mat.color.setHSL(h, 0.75, 0.55);
        if (mat.emissive) mat.emissive.setHSL(h, 0.8, 0.35);
      } else if (mat.emissive && levels.beat > 0.4) {
        mat.emissive.copy(dancer.baseColor);
      }
      if ("emissiveIntensity" in mat) mat.emissiveIntensity = emissive;
      if ("opacity" in mat && mat.transparent) mat.opacity = opacity;
    });

    if (mesh.userData.wire?.material) {
      mesh.userData.wire.material.opacity = wireOpacity;
    }
  }
}

function syncPlanes(frame) {
  const detected = frame.detectedPlanes;
  if (!detected) return;

  const referenceSpace = renderer.xr.getReferenceSpace();
  const seen = new Set();
  let planeCount = 0;

  for (const plane of detected) {
    planeCount += 1;
    seen.add(plane);
    let entry = planes.get(plane);

    if (!entry) {
      entry = createPlane(palette[nextColor % palette.length], plane.orientation);
      nextColor += 1;
      planes.set(plane, entry);
      scene.add(entry.group);
    }

    entry.orientation = plane.orientation;
    entry.polygon = plane.polygon;
    entry.group.visible = showPlanes;

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

  if (!scanning) {
    if (spawned) {
      status.textContent = `${dancers.length} dancers · ${audioLabel} · ${planeCount} planes`;
    } else if (layoutMode === "room" && !planes.size) {
      status.textContent = "Waiting for room scan…";
    } else if (modelError && mixMode === "models") {
      status.textContent = "Could not load models.";
    } else if (mixMode !== "shapes" && !modelsReady) {
      status.textContent = "Loading models…";
    } else {
      status.textContent = "Ready to spawn…";
    }
  }
  maybeScan(frame, detected.size);
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
  session
    .initiateRoomCapture()
    .then(() => {
      scanning = false;
    })
    .catch(() => {
      scanning = false;
      status.textContent = "Room scan was dismissed.";
    });
}

function createPlane(color, orientation) {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.frustumCulled = false;

  const fill = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  fill.material.toneMapped = false;
  const edge = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color }),
  );
  edge.material.toneMapped = false;
  fill.frustumCulled = false;
  edge.frustumCulled = false;
  group.add(fill, edge);
  return { group, stamp: null, orientation, polygon: [] };
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
}

function clearDancers() {
  for (const dancer of dancers) {
    scene.remove(dancer.mesh);
    if (dancer.isModel) continue;
    dancer.mesh.traverse((obj) => {
      if (!obj.isMesh) return;
      // Shape meshes own their geometry; model clones share template buffers.
      if (obj === dancer.mesh) obj.geometry?.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) mat?.dispose?.();
    });
  }
  dancers.length = 0;
}

function disposeEntry(entry) {
  for (const child of entry.group.children) {
    child.geometry.dispose();
    child.material.dispose();
  }
}
