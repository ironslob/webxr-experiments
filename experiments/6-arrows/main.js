import * as THREE from "three";

const palette = [0x5b8cff, 0xff5d73, 0xd6ff4a, 0xffb45a, 0xc084fc, 0x3dffe8, 0xff7ad9, 0x7f9a78];
const SECONDARY_BUTTON = 5;
const SENSITIVITY = { low: 0.55, medium: 1, high: 1.7 };
const SPEED = { slow: 0.35, medium: 0.7, fast: 1.35 };
const SCATTER = { low: 1.6, medium: 1.05, high: 0.65 };
const WANDER = { rare: [4.5, 9], medium: [2.2, 5], often: [0.8, 2.2] };
const SURFACE_OFFSET = 0.018;
const EDGE_REACH = 0.08;
const PLANE_SNAP = 0.12;

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
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 40);
scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.05));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(0.4, 1.6, 0.3);
scene.add(sun);

const clock = new THREE.Clock();
const planes = new Map();
const arrows = [];
const tmp = {
  local: new THREE.Vector3(),
  world: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  next: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  other: new THREE.Vector3(),
  axis: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  xAxis: new THREE.Vector3(),
  zAxis: new THREE.Vector3(),
  inverse: new THREE.Matrix4(),
  quat: new THREE.Quaternion(),
  hot: new THREE.Color(),
  head: new THREE.Vector3(),
};

let arrowCount = 24;
let travelSpeed = SPEED.medium;
let audioMode = "mic";
let sensitivity = 1;
let scatterThreshold = SCATTER.medium;
let wanderRange = WANDER.medium;
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
let energySmooth = 0;
let beatPulse = 0;
let beatCooldown = 0;
let bassAvg = 0.08;

let headReady = false;
let headPrevious = new THREE.Vector3();
let headVelocity = 0;
let scatterCooldown = 0;

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

enter.addEventListener("click", () => {
  applyForm();

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
  headReady = false;
  scatterCooldown = 0;
  clock.start();
  status.textContent = "Looking for room…";
  if (audioCtx?.state === "suspended") audioCtx.resume().catch(() => {});
});

renderer.xr.addEventListener("sessionend", () => {
  overlay.style.display = "none";
  setup.hidden = false;
  clearPlanes();
  clearArrows();
  stopAudio();
  note.textContent = "Session ended. Enter AR to look again.";
});

renderer.setAnimationLoop((_time, frame) => {
  const dt = Math.min(0.05, clock.getDelta() || 0.016);
  const levels = sampleAudio(dt);

  if (frame) {
    exitFromControllers(frame);
    syncPlanes(frame);
    updateHeadMotion(frame, dt);
    if (!spawned && readyToSpawn()) spawnArrows();
    stepArrows(dt, levels);
  }

  renderer.render(scene, camera);
});

function applyForm() {
  arrowCount = Math.min(80, Math.max(1, Number(form.querySelector("#count").value) || 24));
  travelSpeed = SPEED[form.querySelector("#speed").value] || SPEED.medium;
  audioMode = form.querySelector("#audio").value || "mic";
  sensitivity = SENSITIVITY[form.querySelector("#sensitivity").value] || 1;
  scatterThreshold = SCATTER[form.querySelector("#scatter").value] || SCATTER.medium;
  wanderRange = WANDER[form.querySelector("#wander").value] || WANDER.medium;
  showPlanes = form.querySelector("#planes").checked;
  scan = form.querySelector("#scan").checked;
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
      boom(ctx, master, t, 55, 0.12, 0.9);
      if (i % 2 === 1) boom(ctx, master, t + bar * 0.5, 48, 0.08, 0.55);
      if (i === 2 || i === 6) noiseHit(ctx, master, t + bar * 0.5, 0.08, 0.35);
      noiseHit(ctx, master, t + bar * 0.25, 0.03, 0.12);
      noiseHit(ctx, master, t + bar * 0.75, 0.03, 0.1);
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
    }

    bass /= bassEnd;
    mid /= Math.max(1, midEnd - bassEnd);
    energy /= n;
  }

  const gain = sensitivity;
  bass = Math.min(1, bass * gain * 1.35);
  mid = Math.min(1, mid * gain * 1.2);
  energy = Math.min(1, energy * gain * 1.25);

  const ease = 1 - Math.pow(0.001, dt);
  bassSmooth += (bass - bassSmooth) * ease;
  midSmooth += (mid - midSmooth) * ease;
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

function updateHeadMotion(frame, dt) {
  const referenceSpace = renderer.xr.getReferenceSpace();
  const pose = frame.getViewerPose(referenceSpace);
  scatterCooldown = Math.max(0, scatterCooldown - dt);
  if (!pose) return;

  tmp.head.set(
    pose.transform.position.x,
    pose.transform.position.y,
    pose.transform.position.z,
  );

  if (!headReady) {
    headPrevious.copy(tmp.head);
    headReady = true;
    headVelocity = 0;
    return;
  }

  if (dt > 0) {
    headVelocity = tmp.head.distanceTo(headPrevious) / dt;
  }
  headPrevious.copy(tmp.head);

  if (scatterCooldown > 0 || headVelocity < scatterThreshold || !arrows.length) return;
  scatterArrows();
  scatterCooldown = 0.45;
}

function scatterArrows() {
  for (const arrow of arrows) {
    if (!arrow.plane) continue;
    randomizeDirection(arrow);
    arrow.turnTimer = nextWanderDelay() * (0.4 + Math.random() * 0.4);
  }
}

function readyToSpawn() {
  return [...planes.values()].some((entry) => entry.polygon?.length >= 3);
}

function spawnArrows() {
  spawned = true;
  const surfaces = [...planes.values()].filter((entry) => entry.polygon?.length >= 3);
  if (!surfaces.length) {
    spawned = false;
    return;
  }

  for (let i = 0; i < arrowCount; i += 1) {
    const color = palette[i % palette.length];
    const plane = surfaces[i % surfaces.length];
    const point = randomPointInPolygon(plane.polygon);
    if (!point) continue;

    const mesh = createArrowMesh(color);
    scene.add(mesh);

    const arrow = {
      mesh,
      plane,
      localX: point.x,
      localZ: point.z,
      dirX: 0,
      dirZ: 0,
      baseColor: new THREE.Color(color),
      materials: collectMaterials(mesh),
      turnTimer: nextWanderDelay() * Math.random(),
      pulse: 0,
    };
    randomizeDirection(arrow);
    placeArrow(arrow);
    arrows.push(arrow);
  }

  status.textContent = `${arrows.length} arrows · ${surfaces.length} surfaces · ${audioLabel}`;
}

function createArrowMesh(color) {
  const group = new THREE.Group();
  group.frustumCulled = false;
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.22,
    roughness: 0.38,
    metalness: 0.08,
  });

  // Tip points along -Z so Object3D.lookAt aims the arrow in the travel direction.
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.11, 8), mat);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 0.015;
  shaft.frustumCulled = false;

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.055, 10), mat.clone());
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.055;
  tip.frustumCulled = false;

  group.add(shaft, tip);
  return group;
}

function collectMaterials(root) {
  const list = [];
  root.traverse((child) => {
    if (child.isMesh && child.material) list.push(child.material);
  });
  return list;
}

function stepArrows(dt, levels) {
  if (!arrows.length) return;

  const energy = levels.energy;
  const beat = levels.beat;
  const pulseStrength = Math.min(1, energy * 1.15 + beat * 0.85);

  for (const arrow of arrows) {
    if (!arrow.plane || !planesHas(arrow.plane)) {
      rehomeArrow(arrow);
      if (!arrow.plane) continue;
    }

    arrow.turnTimer -= dt;
    if (arrow.turnTimer <= 0) {
      randomizeDirection(arrow);
      arrow.turnTimer = nextWanderDelay();
    }

    const speedBoost = 1 + energy * 0.55 + beat * 0.7;
    const step = travelSpeed * speedBoost * dt;
    const nextX = arrow.localX + arrow.dirX * step;
    const nextZ = arrow.localZ + arrow.dirZ * step;

    if (pointInPolygon(nextX, nextZ, arrow.plane.polygon)) {
      arrow.localX = nextX;
      arrow.localZ = nextZ;
    } else if (!tryTransfer(arrow, nextX, nextZ)) {
      recoverOnEdge(arrow, nextX, nextZ);
    }

    arrow.pulse += (pulseStrength - arrow.pulse) * Math.min(1, dt * 10);
    styleArrow(arrow, levels);
    placeArrow(arrow);
  }
}

function planesHas(entry) {
  for (const value of planes.values()) {
    if (value === entry) return true;
  }
  return false;
}

function tryTransfer(arrow, nextX, nextZ) {
  const from = arrow.plane;
  planeLocalToWorld(from, nextX, nextZ, tmp.world);
  planeLocalDirToWorld(from, arrow.dirX, arrow.dirZ, tmp.dir);
  planeNormal(from, tmp.normal);

  let best = null;
  let bestScore = Infinity;

  for (const entry of planes.values()) {
    if (entry === from || !entry.polygon || entry.polygon.length < 3) continue;

    tmp.inverse.copy(entry.group.matrix).invert();
    tmp.local.copy(tmp.world).applyMatrix4(tmp.inverse);
    const height = Math.abs(tmp.local.y);
    if (height > PLANE_SNAP) continue;

    const inside = pointInPolygon(tmp.local.x, tmp.local.z, entry.polygon);
    const edgeDist = distanceToPolygonEdge(tmp.local.x, tmp.local.z, entry.polygon);
    if (!inside && edgeDist > EDGE_REACH) continue;

    const score = height * 4 + (inside ? 0 : edgeDist);
    if (score < bestScore) {
      bestScore = score;
      best = entry;
      tmp.other.set(tmp.local.x, 0, tmp.local.z);
    }
  }

  if (!best) return false;

  // Rotate travel direction with the normals so floor→wall climbs, wall→floor continues.
  planeNormal(from, tmp.normal);
  planeNormal(best, tmp.axis);
  const nDot = THREE.MathUtils.clamp(tmp.normal.dot(tmp.axis), -1, 1);
  tmp.tangent.crossVectors(tmp.normal, tmp.axis);
  if (tmp.tangent.lengthSq() > 1e-8) {
    const angle = Math.acos(nDot);
    tmp.quat.setFromAxisAngle(tmp.tangent.normalize(), angle);
    tmp.dir.applyQuaternion(tmp.quat);
  }

  // Keep only the component tangent to the new plane.
  planeNormal(best, tmp.normal);
  tmp.dir.addScaledVector(tmp.normal, -tmp.dir.dot(tmp.normal));
  if (tmp.dir.lengthSq() < 1e-6) {
    // Head-on into a surface: climb/descend along the new plane away from the old one.
    planeNormal(from, tmp.tangent);
    tmp.dir.copy(tmp.tangent).addScaledVector(tmp.normal, -tmp.tangent.dot(tmp.normal));
  }
  if (tmp.dir.lengthSq() < 1e-6) {
    randomTangentOnPlane(best, tmp.dir);
  } else {
    tmp.dir.normalize();
  }

  let lx = tmp.other.x;
  let lz = tmp.other.z;
  if (!pointInPolygon(lx, lz, best.polygon)) {
    const clamped = clampToPolygon(lx, lz, best.polygon);
    lx = clamped.x;
    lz = clamped.z;
  }

  arrow.plane = best;
  arrow.localX = lx;
  arrow.localZ = lz;
  worldDirToPlaneLocal(best, tmp.dir, arrow);
  return true;
}

function recoverOnEdge(arrow, _nextX, _nextZ) {
  // Bounce: nudge back inside, reverse travel, jitter so edges don't ping-pong.
  const poly = arrow.plane.polygon;
  const clamped = clampToPolygon(arrow.localX, arrow.localZ, poly);
  arrow.localX = clamped.x;
  arrow.localZ = clamped.z;
  arrow.dirX = -arrow.dirX;
  arrow.dirZ = -arrow.dirZ;
  normalizeArrowDir(arrow);

  const side = (Math.random() - 0.5) * 0.6;
  const nx = -arrow.dirZ;
  const nz = arrow.dirX;
  arrow.dirX += nx * side;
  arrow.dirZ += nz * side;
  normalizeArrowDir(arrow);

  if (!pointInPolygon(arrow.localX + arrow.dirX * 0.02, arrow.localZ + arrow.dirZ * 0.02, poly)) {
    randomizeDirection(arrow);
  }
}

function rehomeArrow(arrow) {
  const surfaces = [...planes.values()].filter((entry) => entry.polygon?.length >= 3);
  if (!surfaces.length) {
    arrow.plane = null;
    arrow.mesh.visible = false;
    return;
  }

  const plane = surfaces[Math.floor(Math.random() * surfaces.length)];
  const point = randomPointInPolygon(plane.polygon);
  if (!point) {
    arrow.plane = null;
    arrow.mesh.visible = false;
    return;
  }

  arrow.plane = plane;
  arrow.localX = point.x;
  arrow.localZ = point.z;
  randomizeDirection(arrow);
  arrow.mesh.visible = true;
}

function styleArrow(arrow, levels) {
  const pulse = arrow.pulse;
  const scale = 1 + pulse * 0.55 + levels.beat * 0.35;
  arrow.mesh.scale.setScalar(scale);

  tmp.hot.setHSL((0.08 + levels.mid * 0.2 + levels.bass * 0.12) % 1, 0.9, 0.55);
  for (const mat of arrow.materials) {
    mat.color.copy(arrow.baseColor).lerp(tmp.hot, Math.min(1, pulse * 0.95));
    mat.emissive.copy(mat.color);
    mat.emissiveIntensity = 0.18 + pulse * 1.4 + levels.beat * 0.8;
  }
}

function placeArrow(arrow) {
  const plane = arrow.plane;
  if (!plane) return;

  planeLocalToWorld(plane, arrow.localX, arrow.localZ, tmp.world);
  planeNormal(plane, tmp.normal);
  planeLocalDirToWorld(plane, arrow.dirX, arrow.dirZ, tmp.dir);

  tmp.world.addScaledVector(tmp.normal, SURFACE_OFFSET);
  arrow.mesh.position.copy(tmp.world);

  if (tmp.dir.lengthSq() < 1e-8) return;
  tmp.next.copy(tmp.world).add(tmp.dir);
  arrow.mesh.up.copy(tmp.normal);
  arrow.mesh.lookAt(tmp.next);
}

function planeLocalToWorld(entry, x, z, out) {
  out.set(x, 0, z).applyMatrix4(entry.group.matrix);
  return out;
}

function planeLocalDirToWorld(entry, dx, dz, out) {
  // Direction transform: ignore translation.
  out.set(dx, 0, dz).transformDirection(entry.group.matrix).normalize();
  return out;
}

function worldDirToPlaneLocal(entry, worldDir, arrow) {
  extractPlaneAxes(entry, tmp.xAxis, tmp.zAxis);
  arrow.dirX = worldDir.dot(tmp.xAxis);
  arrow.dirZ = worldDir.dot(tmp.zAxis);
  normalizeArrowDir(arrow);
}

function planeNormal(entry, out) {
  out.set(0, 1, 0).transformDirection(entry.group.matrix).normalize();
  return out;
}

function extractPlaneAxes(entry, xOut, zOut) {
  xOut.set(1, 0, 0).transformDirection(entry.group.matrix).normalize();
  zOut.set(0, 0, 1).transformDirection(entry.group.matrix).normalize();
}

function randomTangentOnPlane(entry, out) {
  const angle = Math.random() * Math.PI * 2;
  planeLocalDirToWorld(entry, Math.cos(angle), Math.sin(angle), out);
}

function randomizeDirection(arrow) {
  const angle = Math.random() * Math.PI * 2;
  arrow.dirX = Math.cos(angle);
  arrow.dirZ = Math.sin(angle);
}

function normalizeArrowDir(arrow) {
  const len = Math.hypot(arrow.dirX, arrow.dirZ);
  if (len < 1e-8) {
    randomizeDirection(arrow);
    return;
  }
  arrow.dirX /= len;
  arrow.dirZ /= len;
}

function nextWanderDelay() {
  const [min, max] = wanderRange;
  return min + Math.random() * (max - min);
}

function syncPlanes(frame) {
  const detected = frame.detectedPlanes;
  if (!detected) return;

  const referenceSpace = renderer.xr.getReferenceSpace();
  const seen = new Set();

  for (const plane of detected) {
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
      status.textContent = `${arrows.length} arrows · ${planes.size} surfaces · ${audioLabel}`;
    } else {
      status.textContent = `${planeStatus(planes.size, detected.size)} · ${audioLabel}`;
    }
  }
  maybeScan(frame, detected.size);
}

function planeStatus(shown, total) {
  if (shown) return `${shown} crawl surfaces`;
  if (total) return `No crawl surfaces yet. ${total} other planes in the scan.`;
  return "No room scan yet.";
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
  const edge = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color }),
  );
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

function pointInPolygon(x, z, polygon) {
  if (!polygon || polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;
    const xj = polygon[j].x;
    const zj = polygon[j].z;
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToPolygonEdge(x, z, polygon) {
  if (!polygon || polygon.length < 2) return Infinity;
  let best = Infinity;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const ax = polygon[j].x;
    const az = polygon[j].z;
    const bx = polygon[i].x;
    const bz = polygon[i].z;
    const abx = bx - ax;
    const abz = bz - az;
    const lenSq = abx * abx + abz * abz;
    let t = 0;
    if (lenSq > 1e-10) t = THREE.MathUtils.clamp(((x - ax) * abx + (z - az) * abz) / lenSq, 0, 1);
    const px = ax + abx * t - x;
    const pz = az + abz * t - z;
    best = Math.min(best, Math.hypot(px, pz));
  }

  return best;
}

function clampToPolygon(x, z, polygon) {
  if (pointInPolygon(x, z, polygon)) return { x, z };

  let bestX = x;
  let bestZ = z;
  let best = Infinity;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const ax = polygon[j].x;
    const az = polygon[j].z;
    const bx = polygon[i].x;
    const bz = polygon[i].z;
    const abx = bx - ax;
    const abz = bz - az;
    const lenSq = abx * abx + abz * abz;
    let t = 0;
    if (lenSq > 1e-10) t = THREE.MathUtils.clamp(((x - ax) * abx + (z - az) * abz) / lenSq, 0, 1);
    const px = ax + abx * t;
    const pz = az + abz * t;
    const dist = Math.hypot(px - x, pz - z);
    if (dist < best) {
      best = dist;
      bestX = px;
      bestZ = pz;
    }
  }

  // Pull slightly inward toward polygon centroid so we don't sit exactly on the edge.
  let cx = 0;
  let cz = 0;
  for (const p of polygon) {
    cx += p.x;
    cz += p.z;
  }
  cx /= polygon.length;
  cz /= polygon.length;
  bestX += (cx - bestX) * 0.04;
  bestZ += (cz - bestZ) * 0.04;
  return { x: bestX, z: bestZ };
}

function randomPointInPolygon(polygon) {
  if (!polygon || polygon.length < 3) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const x = minX + Math.random() * (maxX - minX);
    const z = minZ + Math.random() * (maxZ - minZ);
    if (pointInPolygon(x, z, polygon)) return { x, z };
  }

  // Fallback: centroid.
  let cx = 0;
  let cz = 0;
  for (const p of polygon) {
    cx += p.x;
    cz += p.z;
  }
  return { x: cx / polygon.length, z: cz / polygon.length };
}

function clearPlanes() {
  for (const entry of planes.values()) {
    scene.remove(entry.group);
    disposeEntry(entry);
  }
  planes.clear();
  nextColor = 0;
}

function clearArrows() {
  for (const arrow of arrows) {
    scene.remove(arrow.mesh);
    arrow.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
  arrows.length = 0;
}

function disposeEntry(entry) {
  for (const child of entry.group.children) {
    child.geometry.dispose();
    child.material.dispose();
  }
}
