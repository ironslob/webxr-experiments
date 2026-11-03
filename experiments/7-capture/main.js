import * as THREE from "three";

const SECONDARY_BUTTON = 5;
const TRIGGER_BUTTON = 0;
const SQUEEZE_BUTTON = 1;
const PRIMARY_BUTTON = 4; // A / X

const QUALITY = {
  balanced: { maxEdge: 0.12, maxVerts: 120000, keyRes: 512, maxKeys: 24, settleMs: 280, minKeyGapMs: 450 },
  high: { maxEdge: 0.08, maxVerts: 220000, keyRes: 768, maxKeys: 36, settleMs: 220, minKeyGapMs: 350 },
  max: { maxEdge: 0.055, maxVerts: 350000, keyRes: 960, maxKeys: 48, settleMs: 180, minKeyGapMs: 280 },
};

const setup = document.querySelector("#setup");
const form = document.querySelector("#settings");
const note = document.querySelector("#note");
const enter = document.querySelector("#enter");
const exit = document.querySelector("#exit");
const finishBtn = document.querySelector("#finish");
const overlay = document.querySelector("#overlay");
const status = document.querySelector("#status");
const hint = document.querySelector("#hint");

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
const hemi = new THREE.HemisphereLight(0xffffff, 0x606060, 0.55);
const sun = new THREE.DirectionalLight(0xffffff, 0.35);
sun.position.set(0.4, 1.5, 0.2);
scene.add(hemi, sun);

const meshEntries = new Map();
const keyframes = [];

let settings = {
  quality: "balanced",
  stereo: true,
  depthGate: true,
  preview: "paint",
  scan: true,
};

let phase = "load"; // load | paint | review
let startedAt = 0;
let scanRequested = false;
let scanning = false;
let ending = false;
let finishArmed = false;
let squeezeLatched = false;
let triggerLatched = false;
let depthUsage = null;
let cameraRigs = [];
let lastKeyAt = 0;
let settleStarted = 0;
let lastHeadPos = new THREE.Vector3();
let lastHeadQuat = new THREE.Quaternion();
let headSampleReady = false;
let paintedVerts = 0;
let totalVerts = 0;
let lastStatusAt = 0;
let lastPreviewAt = 0;
let glBinding = null;

const scratch = {
  mat4: new THREE.Matrix4(),
  mat4b: new THREE.Matrix4(),
  inv: new THREE.Matrix4(),
  pos: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  viewPos: new THREE.Vector3(),
  ndc: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  color: new THREE.Color(),
  projView: new THREE.Matrix4(),
};

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

enter.addEventListener("click", () => {
  applyForm();
  const sessionPromise = navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["mesh-detection", "local-floor"],
    optionalFeatures: ["depth-sensing", "dom-overlay"],
    domOverlay: { root: overlay },
    depthSensing: {
      usagePreference: ["cpu-optimized", "gpu-optimized"],
      dataFormatPreference: ["luminance-alpha", "float32", "unsigned-short"],
    },
  });

  sessionPromise
    .then((session) => {
      depthUsage = session.depthUsage || null;
      try {
        glBinding = new XRWebGLBinding(session, renderer.getContext());
      } catch {
        glBinding = null;
      }
      return renderer.xr.setSession(session);
    })
    .catch((error) => {
      // Retry without depth if the browser rejected the depthSensing block.
      return navigator.xr
        .requestSession("immersive-ar", {
          requiredFeatures: ["mesh-detection", "local-floor"],
          optionalFeatures: ["dom-overlay"],
          domOverlay: { root: overlay },
        })
        .then((session) => {
          depthUsage = null;
          note.textContent = `${error?.message || "Depth unavailable."} Continuing with mesh + cameras only.`;
          return renderer.xr.setSession(session);
        })
        .catch((err2) => {
          note.textContent = err2?.message || error?.message || "Could not start AR.";
        });
    });
});

exit.addEventListener("click", () => {
  renderer.xr.getSession()?.end();
});

finishBtn.addEventListener("click", () => {
  if (phase === "paint") finalizeCapture();
});

renderer.xr.addEventListener("sessionstart", () => {
  setup.hidden = true;
  overlay.style.display = "block";
  finishBtn.hidden = false;
  startedAt = performance.now();
  scanRequested = false;
  scanning = false;
  ending = false;
  finishArmed = false;
  phase = "load";
  paintedVerts = 0;
  totalVerts = 0;
  keyframes.length = 0;
  headSampleReady = false;
  renderer.setClearColor(0x000000, 0);
  hemi.intensity = 0.55;
  sun.intensity = 0.35;
  status.textContent = "Loading room mesh…";
  hint.textContent = "Look around · Squeeze keyframe · Trigger finishes";
  openCameras().catch((err) => {
    status.textContent = `Mesh only — camera error: ${err?.message || err}`;
  });
});

renderer.xr.addEventListener("sessionend", () => {
  overlay.style.display = "none";
  finishBtn.hidden = true;
  setup.hidden = false;
  stopCameras();
  clearMeshes();
  keyframes.length = 0;
  phase = "load";
  note.textContent = "Session ended. Enter AR to capture again.";
});

renderer.setAnimationLoop((_time, frame) => {
  if (frame) {
    handleInput(frame);
    syncMeshes(frame);
    if (phase === "paint") {
      paintFrame(frame);
    }
    maybeScan(frame);
  }
  renderer.render(scene, camera);
});

function applyForm() {
  settings.quality = form.querySelector("#quality").value;
  settings.stereo = form.querySelector("#cameras").value === "stereo";
  settings.depthGate = form.querySelector("#depth").value === "on";
  settings.preview = form.querySelector("#preview").value;
  settings.scan = form.querySelector("#scan").checked;
}

function quality() {
  return QUALITY[settings.quality] || QUALITY.balanced;
}

function handleInput(frame) {
  if (ending) return;
  let squeeze = false;
  let trigger = false;
  let secondary = false;

  for (const source of frame.session.inputSources) {
    const pad = source.gamepad;
    if (!pad?.buttons) continue;
    if (pad.buttons[SQUEEZE_BUTTON]?.pressed || (pad.buttons[SQUEEZE_BUTTON]?.value || 0) > 0.85) {
      squeeze = true;
    }
    if (pad.buttons[TRIGGER_BUTTON]?.pressed || (pad.buttons[TRIGGER_BUTTON]?.value || 0) > 0.85) {
      trigger = true;
    }
    if (pad.buttons[PRIMARY_BUTTON]?.pressed) trigger = true;
    if (pad.buttons[SECONDARY_BUTTON]?.pressed) secondary = true;
  }

  if (secondary) {
    ending = true;
    frame.session.end();
    return;
  }

  if (phase === "paint") {
    if (squeeze && !squeezeLatched) captureKeyframe(frame, true);
    if (trigger && !triggerLatched && finishArmed) finalizeCapture();
    if (!trigger) finishArmed = true;
  }

  squeezeLatched = squeeze;
  triggerLatched = trigger;
}

async function openCameras() {
  stopCameras();
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("getUserMedia missing");
  }

  // Unlock labels.
  const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  probe.getTracks().forEach((t) => t.stop());

  const devices = await navigator.mediaDevices.enumerateDevices();
  const videos = devices.filter((d) => d.kind === "videoinput");
  const back = videos
    .filter((d) => /back|environment|camera 2 [12]/i.test(d.label))
    .sort((a, b) => a.label.localeCompare(b.label));
  const preferred = (back.length ? back : videos).slice(0, settings.stereo ? 2 : 1);

  if (!preferred.length) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    cameraRigs.push(makeRig(stream, "mono"));
    return;
  }

  for (let i = 0; i < preferred.length; i += 1) {
    const device = preferred[i];
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: device.deviceId },
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
      audio: false,
    });
    let eye = "mono";
    if (preferred.length > 1) {
      if (/camera 2 2|right/i.test(device.label)) eye = "right";
      else if (/camera 2 1|left/i.test(device.label)) eye = "left";
      else eye = i === 0 ? "left" : "right";
    }
    cameraRigs.push(makeRig(stream, eye, device.label));
  }
}

function makeRig(stream, eye, label = "") {
  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.srcObject = stream;
  video.play().catch(() => {});

  const canvas = document.createElement("canvas");
  const q = quality();
  canvas.width = q.keyRes;
  canvas.height = Math.round(q.keyRes * 0.75);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  return { stream, video, canvas, ctx, eye, label, ready: false };
}

function stopCameras() {
  for (const rig of cameraRigs) {
    rig.stream?.getTracks?.().forEach((t) => t.stop());
    rig.video.srcObject = null;
  }
  cameraRigs = [];
}

function ensureRigFrames() {
  for (const rig of cameraRigs) {
    if (rig.video.readyState >= 2) {
      rig.ctx.drawImage(rig.video, 0, 0, rig.canvas.width, rig.canvas.height);
      rig.ready = true;
    }
  }
}

function syncMeshes(frame) {
  const detected = frame.detectedMeshes;
  if (!detected) return;

  const referenceSpace = renderer.xr.getReferenceSpace();
  const seen = new Set();
  let verts = 0;

  for (const xrMesh of detected) {
    seen.add(xrMesh);
    let entry = meshEntries.get(xrMesh);
    if (!entry) {
      entry = createMeshEntry(xrMesh.semanticLabel);
      meshEntries.set(xrMesh, entry);
      scene.add(entry.mesh);
    }

    const pose = frame.getPose(xrMesh.meshSpace, referenceSpace);
    if (pose) {
      entry.mesh.matrix.fromArray(pose.transform.matrix);
      entry.worldMatrix.copy(entry.mesh.matrix);
    }

    if (entry.stamp !== xrMesh.lastChangedTime || !entry.baseReady) {
      rebuildMeshGeometry(entry, xrMesh);
      entry.stamp = xrMesh.lastChangedTime;
    }

    verts += entry.vertexCount;
  }

  for (const [xrMesh, entry] of meshEntries) {
    if (seen.has(xrMesh)) continue;
    scene.remove(entry.mesh);
    disposeMeshEntry(entry);
    meshEntries.delete(xrMesh);
  }

  totalVerts = verts;
  if (phase === "load" && meshEntries.size) {
    phase = "paint";
    status.textContent = depthUsage
      ? `Paint · ${meshEntries.size} meshes · depth ${depthUsage}`
      : `Paint · ${meshEntries.size} meshes · no depth`;
  } else if (phase === "load" && !scanning) {
    status.textContent = "Waiting for Space Setup mesh…";
  }
}

function createMeshEntry(label) {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.02,
    vertexColors: true,
    side: THREE.DoubleSide,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  return {
    mesh,
    label: label || "",
    stamp: -1,
    baseReady: false,
    vertexCount: 0,
    worldMatrix: new THREE.Matrix4(),
    // Per-vertex accumulators in mesh-local space after subdivision
    accum: null, // Float32Array [r,g,b,w] * n
    painted: null, // Uint8Array
  };
}

function rebuildMeshGeometry(entry, xrMesh) {
  const rawPositions = flattenVertices(xrMesh.vertices);
  const rawIndices = xrMesh.indices ? Uint32Array.from(xrMesh.indices) : null;
  if (!rawPositions.length || !rawIndices?.length) return;

  const q = quality();
  const { positions, indices } = subdivideMesh(rawPositions, rawIndices, q.maxEdge, q.maxVerts);
  const normals = computeNormals(positions, indices);
  const colors = new Float32Array(positions.length);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = 0.55;
    colors[i + 1] = 0.58;
    colors[i + 2] = 0.62;
  }

  const geometry = entry.mesh.geometry;
  geometry.dispose();
  entry.mesh.geometry = new THREE.BufferGeometry();
  entry.mesh.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  entry.mesh.geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  entry.mesh.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  entry.mesh.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  const n = positions.length / 3;
  entry.vertexCount = n;
  entry.accum = new Float32Array(n * 4);
  entry.painted = new Uint8Array(n);
  entry.baseReady = true;
}

function flattenVertices(vertices) {
  if (!vertices?.length) return new Float32Array(0);
  if (vertices[0] instanceof Float32Array || Array.isArray(vertices[0])) {
    const out = new Float32Array(vertices.length * 3);
    for (let i = 0; i < vertices.length; i += 1) {
      const v = vertices[i];
      out[i * 3] = v[0];
      out[i * 3 + 1] = v[1];
      out[i * 3 + 2] = v[2];
    }
    return out;
  }
  return Float32Array.from(vertices);
}

function subdivideMesh(positions, indices, maxEdge, maxVerts) {
  let pos = Array.from(positions);
  let idx = Array.from(indices);
  const edgeCache = new Map();

  function midpoint(a, b) {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (edgeCache.has(key)) return edgeCache.get(key);
    const ai = a * 3;
    const bi = b * 3;
    const n = pos.length / 3;
    pos.push(
      (pos[ai] + pos[bi]) * 0.5,
      (pos[ai + 1] + pos[bi + 1]) * 0.5,
      (pos[ai + 2] + pos[bi + 2]) * 0.5,
    );
    edgeCache.set(key, n);
    return n;
  }

  function edgeLen(a, b) {
    const ai = a * 3;
    const bi = b * 3;
    const dx = pos[ai] - pos[bi];
    const dy = pos[ai + 1] - pos[bi + 1];
    const dz = pos[ai + 2] - pos[bi + 2];
    return Math.hypot(dx, dy, dz);
  }

  for (let pass = 0; pass < 8; pass += 1) {
    if (pos.length / 3 >= maxVerts) break;
    edgeCache.clear();
    const next = [];
    let split = false;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t];
      const b = idx[t + 1];
      const c = idx[t + 2];
      const ab = edgeLen(a, b) > maxEdge;
      const bc = edgeLen(b, c) > maxEdge;
      const ca = edgeLen(c, a) > maxEdge;
      const count = (ab ? 1 : 0) + (bc ? 1 : 0) + (ca ? 1 : 0);
      if (!count || pos.length / 3 >= maxVerts - 3) {
        next.push(a, b, c);
        continue;
      }
      split = true;
      if (count === 3) {
        const abm = midpoint(a, b);
        const bcm = midpoint(b, c);
        const cam = midpoint(c, a);
        next.push(a, abm, cam, abm, b, bcm, cam, bcm, c, abm, bcm, cam);
      } else if (count === 2) {
        if (!ab) {
          const bcm = midpoint(b, c);
          const cam = midpoint(c, a);
          next.push(a, b, bcm, a, bcm, cam, cam, bcm, c);
        } else if (!bc) {
          const abm = midpoint(a, b);
          const cam = midpoint(c, a);
          next.push(a, abm, cam, abm, b, c, abm, c, cam);
        } else {
          const abm = midpoint(a, b);
          const bcm = midpoint(b, c);
          next.push(a, abm, c, abm, b, bcm, abm, bcm, c);
        }
      } else if (ab) {
        const m = midpoint(a, b);
        next.push(a, m, c, m, b, c);
      } else if (bc) {
        const m = midpoint(b, c);
        next.push(a, b, m, a, m, c);
      } else {
        const m = midpoint(c, a);
        next.push(a, b, m, m, b, c);
      }
    }
    idx = next;
    if (!split) break;
  }

  return {
    positions: Float32Array.from(pos),
    indices: Uint32Array.from(idx),
  };
}

function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const ax = positions[a];
    const ay = positions[a + 1];
    const az = positions[a + 2];
    const bx = positions[b];
    const by = positions[b + 1];
    const bz = positions[b + 2];
    const cx = positions[c];
    const cy = positions[c + 1];
    const cz = positions[c + 2];
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    normals[a] += nx;
    normals[a + 1] += ny;
    normals[a + 2] += nz;
    normals[b] += nx;
    normals[b + 1] += ny;
    normals[b + 2] += nz;
    normals[c] += nx;
    normals[c + 1] += ny;
    normals[c + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
  return normals;
}

function paintFrame(frame) {
  if (!meshEntries.size || !cameraRigs.length) return;
  ensureRigFrames();
  if (!cameraRigs.some((r) => r.ready)) return;

  const referenceSpace = renderer.xr.getReferenceSpace();
  const pose = frame.getViewerPose(referenceSpace);
  if (!pose?.views?.length) return;

  const now = performance.now();
  updateHeadMotion(pose, now);

  const q = quality();
  const settled = headSampleReady && now - settleStarted >= q.settleMs;
  if (settled && now - lastKeyAt >= q.minKeyGapMs) {
    captureKeyframe(frame, false);
  }

  // Live preview is stride-sampled so keyframe bakes stay the high-quality path.
  if (now - lastPreviewAt > 120) {
    lastPreviewAt = now;
    for (const view of pose.views) {
      const rig = pickRigForView(view);
      if (!rig?.ready) continue;
      const depthInfo = settings.depthGate ? readDepth(frame, view) : null;
      projectRigOntoMeshes(rig, view, depthInfo, 0.28, true, 3);
      if (!settings.stereo) break;
    }
  }

  if (now - lastStatusAt > 400) {
    lastStatusAt = now;
    updatePaintStatus();
  }
}

function updateHeadMotion(pose, now) {
  const transform = pose.transform;
  scratch.pos.set(transform.position.x, transform.position.y, transform.position.z);
  scratch.quat.set(
    transform.orientation.x,
    transform.orientation.y,
    transform.orientation.z,
    transform.orientation.w,
  );

  if (!headSampleReady) {
    lastHeadPos.copy(scratch.pos);
    lastHeadQuat.copy(scratch.quat);
    headSampleReady = true;
    settleStarted = now;
    return;
  }

  const move = lastHeadPos.distanceTo(scratch.pos);
  const ang = lastHeadQuat.angleTo(scratch.quat);
  lastHeadPos.copy(scratch.pos);
  lastHeadQuat.copy(scratch.quat);

  if (move > 0.012 || ang > 0.04) {
    settleStarted = now;
  }
}

function pickRigForView(view) {
  if (cameraRigs.length === 1) return cameraRigs[0];
  const eye = view.eye;
  const match = cameraRigs.find((r) => r.eye === eye);
  if (match) return match;
  // Quest labels are unordered; alternate by eye index.
  if (eye === "right" && cameraRigs[1]) return cameraRigs[1];
  return cameraRigs[0];
}

function readDepth(frame, view) {
  if (!settings.depthGate) return null;
  if (depthUsage === "cpu-optimized") {
    try {
      return frame.getDepthInformation?.(view) || null;
    } catch {
      return null;
    }
  }
  // GPU depth cannot be sampled per-vertex on CPU cheaply; skip gating.
  return null;
}

function captureKeyframe(frame, forced) {
  const referenceSpace = renderer.xr.getReferenceSpace();
  const pose = frame.getViewerPose(referenceSpace);
  if (!pose?.views?.length) return;

  ensureRigFrames();
  const q = quality();
  if (!forced && keyframes.length >= q.maxKeys) return;

  let added = 0;
  for (const view of pose.views) {
    const rig = pickRigForView(view);
    if (!rig?.ready) continue;

    const depthInfo = settings.depthGate ? readDepth(frame, view) : null;
    const image = rig.ctx.getImageData(0, 0, rig.canvas.width, rig.canvas.height);
    const proj = new THREE.Matrix4().fromArray(view.projectionMatrix);
    const viewMatrix = new THREE.Matrix4().fromArray(view.transform.inverse.matrix);
    const depthCopy = copyDepthCpu(depthInfo);

    const key = {
      eye: view.eye,
      width: image.width,
      height: image.height,
      data: image.data,
      proj,
      viewMatrix,
      depth: depthCopy,
      capturedAt: performance.now(),
    };
    keyframes.push(key);
    added += 1;

    // Strong bake contribution from this keyframe.
    projectImageOntoMeshes(key, 1.0, false);

    if (!settings.stereo) break;
  }

  if (added) {
    lastKeyAt = performance.now();
    settleStarted = lastKeyAt;
    if (keyframes.length > q.maxKeys) {
      keyframes.splice(0, keyframes.length - q.maxKeys);
    }
    updatePaintStatus();
  }
}

function copyDepthCpu(depthInfo) {
  if (!depthInfo || typeof depthInfo.getDepthInMeters !== "function") return null;
  const width = Math.min(96, depthInfo.width || 96);
  const height = Math.min(96, depthInfo.height || 96);
  const samples = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      let meters = 0;
      try {
        meters = depthInfo.getDepthInMeters(u, v);
      } catch {
        meters = 0;
      }
      samples[y * width + x] = meters || 0;
    }
  }
  return {
    width,
    height,
    samples,
    getDepthInMeters(u, v) {
      const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
      const y = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
      return samples[y * width + x] || 0;
    },
  };
}

function projectRigOntoMeshes(rig, view, depthInfo, strength, previewOnly, stride = 1) {
  const key = {
    width: rig.canvas.width,
    height: rig.canvas.height,
    data: rig.ctx.getImageData(0, 0, rig.canvas.width, rig.canvas.height).data,
    proj: new THREE.Matrix4().fromArray(view.projectionMatrix),
    viewMatrix: new THREE.Matrix4().fromArray(view.transform.inverse.matrix),
    depth: depthInfo && typeof depthInfo.getDepthInMeters === "function" ? depthInfo : null,
  };
  projectImageOntoMeshes(key, strength, previewOnly, stride);
}

function projectImageOntoMeshes(key, strength, previewOnly, stride = 1) {
  for (const entry of meshEntries.values()) {
    if (!entry.baseReady) continue;
    const positions = entry.mesh.geometry.getAttribute("position");
    const normals = entry.mesh.geometry.getAttribute("normal");
    const colors = entry.mesh.geometry.getAttribute("color");
    const accum = entry.accum;
    const painted = entry.painted;
    const world = entry.worldMatrix;
    const we = world.elements;
    const ve = key.viewMatrix.elements;
    const pe = key.proj.elements;
    let dirty = false;

    for (let i = 0; i < positions.count; i += stride) {
      const ix = i * 3;
      const ax = positions.array[ix];
      const ay = positions.array[ix + 1];
      const az = positions.array[ix + 2];

      const wx = we[0] * ax + we[4] * ay + we[8] * az + we[12];
      const wy = we[1] * ax + we[5] * ay + we[9] * az + we[13];
      const wz = we[2] * ax + we[6] * ay + we[10] * az + we[14];

      const nx = normals.array[ix];
      const ny = normals.array[ix + 1];
      const nz = normals.array[ix + 2];
      const wnx = we[0] * nx + we[4] * ny + we[8] * nz;
      const wny = we[1] * nx + we[5] * ny + we[9] * nz;
      const wnz = we[2] * nx + we[6] * ny + we[10] * nz;
      const nlen = Math.hypot(wnx, wny, wnz) || 1;
      const nnx = wnx / nlen;
      const nny = wny / nlen;
      const nnz = wnz / nlen;

      const vx = ve[0] * wx + ve[4] * wy + ve[8] * wz + ve[12];
      const vy = ve[1] * wx + ve[5] * wy + ve[9] * wz + ve[13];
      const vz = ve[2] * wx + ve[6] * wy + ve[10] * wz + ve[14];
      if (vz >= -0.08) continue;

      const clipx = pe[0] * vx + pe[4] * vy + pe[8] * vz + pe[12];
      const clipy = pe[1] * vx + pe[5] * vy + pe[9] * vz + pe[13];
      const clipw = pe[3] * vx + pe[7] * vy + pe[11] * vz + pe[15];
      if (clipw <= 0.0001) continue;
      const ndcX = clipx / clipw;
      const ndcY = clipy / clipw;
      if (ndcX < -1.02 || ndcX > 1.02 || ndcY < -1.02 || ndcY > 1.02) continue;

      const u = ndcX * 0.5 + 0.5;
      const vCoord = 1 - (ndcY * 0.5 + 0.5);
      if (u < 0.008 || u > 0.992 || vCoord < 0.008 || vCoord > 0.992) continue;

      const toCamX = -vx;
      const toCamY = -vy;
      const toCamZ = -vz;
      const toLen = Math.hypot(toCamX, toCamY, toCamZ) || 1;
      const facing = (nnx * toCamX + nny * toCamY + nnz * toCamZ) / toLen;
      if (facing < 0.12) continue;

      const depthMeters = -vz;
      if (key.depth) {
        let measured = 0;
        try {
          measured = key.depth.getDepthInMeters(u, vCoord);
        } catch {
          measured = 0;
        }
        if (measured > 0.05) {
          const err = Math.abs(measured - depthMeters);
          const tol = Math.max(0.07, depthMeters * 0.07);
          if (err > tol) continue;
        }
      }

      const center = 1 - Math.hypot(u - 0.5, vCoord - 0.5) * 1.55;
      const weight = strength * facing * facing * Math.max(0.04, center);

      // Bilinear sample for cleaner colour than nearest neighbour.
      const fx = u * (key.width - 1);
      const fy = vCoord * (key.height - 1);
      const x0 = fx | 0;
      const y0 = fy | 0;
      const x1 = Math.min(key.width - 1, x0 + 1);
      const y1 = Math.min(key.height - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const s00 = sampleRgbLinear(key.data, key.width, x0, y0);
      const s10 = sampleRgbLinear(key.data, key.width, x1, y0);
      const s01 = sampleRgbLinear(key.data, key.width, x0, y1);
      const s11 = sampleRgbLinear(key.data, key.width, x1, y1);
      const r =
        s00[0] * (1 - tx) * (1 - ty) +
        s10[0] * tx * (1 - ty) +
        s01[0] * (1 - tx) * ty +
        s11[0] * tx * ty;
      const g =
        s00[1] * (1 - tx) * (1 - ty) +
        s10[1] * tx * (1 - ty) +
        s01[1] * (1 - tx) * ty +
        s11[1] * tx * ty;
      const b =
        s00[2] * (1 - tx) * (1 - ty) +
        s10[2] * tx * (1 - ty) +
        s01[2] * (1 - tx) * ty +
        s11[2] * tx * ty;

      const ai = i * 4;
      const priorW = accum[ai + 3];
      let useW = weight;
      if (priorW > 0.35) {
        const invPrior = 1 / priorW;
        const dr = r - accum[ai] * invPrior;
        const dg = g - accum[ai + 1] * invPrior;
        const db = b - accum[ai + 2] * invPrior;
        const delta = Math.sqrt(dr * dr + dg * dg + db * db);
        // Down-weight flashes / transient mismatches once a surface already has consensus.
        if (delta > 0.55) useW *= Math.max(0.05, 1 - (delta - 0.55));
      }
      accum[ai] += r * useW;
      accum[ai + 1] += g * useW;
      accum[ai + 2] += b * useW;
      accum[ai + 3] += useW;

      if (accum[ai + 3] > 0.05) {
        if (!painted[i]) {
          painted[i] = 1;
          paintedVerts += 1;
        }
        if (!previewOnly || settings.preview !== "shell") {
          const invW = 1 / accum[ai + 3];
          let cr = Math.pow(Math.min(1, Math.max(0, accum[ai] * invW)), 1 / 2.2);
          let cg = Math.pow(Math.min(1, Math.max(0, accum[ai + 1] * invW)), 1 / 2.2);
          let cb = Math.pow(Math.min(1, Math.max(0, accum[ai + 2] * invW)), 1 / 2.2);
          if (settings.preview === "coverage" && phase === "paint") {
            const cov = Math.min(1, accum[ai + 3] / 2);
            colors.array[ix] = cov;
            colors.array[ix + 1] = 0.2 + cov * 0.6;
            colors.array[ix + 2] = 1 - cov;
          } else {
            colors.array[ix] = cr;
            colors.array[ix + 1] = cg;
            colors.array[ix + 2] = cb;
          }
          dirty = true;
        }
      }
    }
    if (dirty) colors.needsUpdate = true;
  }
}

function sampleRgbLinear(data, width, x, y) {
  const p = (y * width + x) * 4;
  return [Math.pow(data[p] / 255, 2.2), Math.pow(data[p + 1] / 255, 2.2), Math.pow(data[p + 2] / 255, 2.2)];
}

function updatePaintStatus() {
  const cov = totalVerts ? Math.round((paintedVerts / totalVerts) * 100) : 0;
  const cams = cameraRigs.length;
  const depthLabel = depthUsage && settings.depthGate ? ` · depth` : "";
  status.textContent = `Paint ${cov}% · ${keyframes.length} keys · ${cams} cam${cams === 1 ? "" : "s"}${depthLabel}`;
  finishBtn.hidden = phase !== "paint";
}

function finalizeCapture() {
  if (phase === "review") return;
  phase = "review";
  finishBtn.hidden = true;
  status.textContent = "Baking capture…";
  hint.textContent = "B or Y exits";

  // Re-project all keyframes at full strength for a clean bake.
  for (const entry of meshEntries.values()) {
    if (!entry.accum) continue;
    entry.accum.fill(0);
    entry.painted.fill(0);
  }
  paintedVerts = 0;

  for (const key of keyframes) {
    projectImageOntoMeshes(key, 1.0, false);
  }

  for (const entry of meshEntries.values()) {
    fillHoles(entry);
    writeFinalColors(entry);
    entry.mesh.geometry.computeVertexNormals();
  }
  recountPainted();

  stopCameras();
  renderer.setClearColor(0x0b0d0c, 1);
  hemi.intensity = 0.85;
  sun.intensity = 0.55;
  status.textContent = `Captured room · ${keyframes.length} keyframes · ${coveragePercent()}% covered`;
}

function recountPainted() {
  let count = 0;
  let verts = 0;
  for (const entry of meshEntries.values()) {
    verts += entry.vertexCount;
    if (!entry.painted) continue;
    for (let i = 0; i < entry.painted.length; i += 1) {
      if (entry.painted[i]) count += 1;
    }
  }
  paintedVerts = count;
  totalVerts = verts;
}

function coveragePercent() {
  return totalVerts ? Math.round((paintedVerts / totalVerts) * 100) : 0;
}

function fillHoles(entry) {
  const painted = entry.painted;
  const accum = entry.accum;
  const index = entry.mesh.geometry.getIndex();
  if (!index || !painted) return;

  const n = painted.length;
  const neighbors = Array.from({ length: n }, () => []);
  const arr = index.array;
  for (let t = 0; t < arr.length; t += 3) {
    const a = arr[t];
    const b = arr[t + 1];
    const c = arr[t + 2];
    neighbors[a].push(b, c);
    neighbors[b].push(a, c);
    neighbors[c].push(a, b);
  }

  for (let pass = 0; pass < 6; pass += 1) {
    const nextPaint = painted.slice();
    const nextAccum = accum.slice();
    for (let i = 0; i < n; i += 1) {
      if (painted[i]) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let w = 0;
      const list = neighbors[i];
      for (let k = 0; k < list.length; k += 1) {
        const j = list[k];
        if (!painted[j]) continue;
        const ai = j * 4;
        const jw = accum[ai + 3];
        r += accum[ai];
        g += accum[ai + 1];
        b += accum[ai + 2];
        w += jw;
      }
      if (w > 0.02) {
        const ai = i * 4;
        nextAccum[ai] = r;
        nextAccum[ai + 1] = g;
        nextAccum[ai + 2] = b;
        nextAccum[ai + 3] = w;
        nextPaint[i] = 1;
      }
    }
    painted.set(nextPaint);
    accum.set(nextAccum);
  }
}

function writeFinalColors(entry) {
  const colors = entry.mesh.geometry.getAttribute("color");
  const accum = entry.accum;
  for (let i = 0; i < colors.count; i += 1) {
    const ai = i * 4;
    const w = accum[ai + 3];
    const ix = i * 3;
    if (w > 0.01) {
      let r = accum[ai] / w;
      let g = accum[ai + 1] / w;
      let b = accum[ai + 2] / w;
      r = Math.pow(Math.min(1, Math.max(0, r)), 1 / 2.2);
      g = Math.pow(Math.min(1, Math.max(0, g)), 1 / 2.2);
      b = Math.pow(Math.min(1, Math.max(0, b)), 1 / 2.2);
      colors.array[ix] = r;
      colors.array[ix + 1] = g;
      colors.array[ix + 2] = b;
    } else {
      colors.array[ix] = 0.18;
      colors.array[ix + 1] = 0.2;
      colors.array[ix + 2] = 0.22;
    }
  }
  colors.needsUpdate = true;
}

function maybeScan(frame) {
  if (!settings.scan || scanRequested) return;
  if (meshEntries.size > 0) return;
  if (performance.now() - startedAt < 4000) return;

  const session = frame.session;
  scanRequested = true;
  if (typeof session.initiateRoomCapture !== "function") {
    status.textContent = "No room mesh on this headset.";
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

function clearMeshes() {
  for (const entry of meshEntries.values()) {
    scene.remove(entry.mesh);
    disposeMeshEntry(entry);
  }
  meshEntries.clear();
  totalVerts = 0;
  paintedVerts = 0;
}

function disposeMeshEntry(entry) {
  entry.mesh.geometry.dispose();
  entry.mesh.material.dispose();
}
