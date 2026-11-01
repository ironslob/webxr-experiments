import * as THREE from "three";

const palette = [0x5b8cff, 0xff5d73, 0xd6ff4a, 0xffb45a, 0xc084fc, 0x3dffe8, 0xff7ad9, 0x7f9a78];
const SECONDARY_BUTTON = 5;
const TRIGGER_BUTTON = 0;
const BALL_RADIUS = 0.08;
const CONTROLLER_RADIUS = 0.04;
const GRAVITY_FORCE = new THREE.Vector3(0, -2.4, 0);
const RESTITUTION = 0.78;
const FRICTION = 0.98;
const ZERO_G_FRICTION = 0.999;
const GRAB_RANGE = 0.16;
const MAX_SPEED = 8;
const BAT_HIT_BOOST = 1.35;
const BAT_SIZES = {
  small: { length: 0.48, radius: 0.028, power: 1.1 },
  medium: { length: 0.72, radius: 0.036, power: 1.25 },
  large: { length: 0.98, radius: 0.045, power: 1.45 },
};

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
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.1));

const clock = new THREE.Clock();
const planes = new Map();
const balls = [];
const controllers = [];
const tmp = {
  local: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  delta: new THREE.Vector3(),
  inverse: new THREE.Matrix4(),
  quat: new THREE.Quaternion(),
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  prevA: new THREE.Vector3(),
  prevB: new THREE.Vector3(),
  closest: new THREE.Vector3(),
  hitVel: new THREE.Vector3(),
};

let ballCount = 10;
let bounceMode = "walls-floor";
let gravityOn = true;
let interactMode = "poke";
let batSize = "off";
let batConfig = null;
let showPlanes = true;
let scan = true;
let nextColor = 0;
let startedAt = 0;
let scanRequested = false;
let scanning = false;
let ending = false;
let spawned = false;
let lastDt = 1 / 72;

for (let hand = 0; hand < 2; hand += 1) {
  const grip = new THREE.Group();
  grip.matrixAutoUpdate = false;
  grip.visible = false;
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(CONTROLLER_RADIUS, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1 }),
  );
  tip.visible = false;
  const bat = createBatMesh();
  bat.visible = false;
  grip.add(tip, bat);
  scene.add(grip);
  controllers.push({
    grip,
    tip,
    bat,
    handedness: hand === 0 ? "left" : "right",
    position: new THREE.Vector3(),
    previous: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    batStart: new THREE.Vector3(),
    batEnd: new THREE.Vector3(),
    prevBatStart: new THREE.Vector3(),
    prevBatEnd: new THREE.Vector3(),
    trigger: false,
    held: null,
  });
}

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
  spawned = false;
  clock.start();
  status.textContent = "Looking for room…";
  applyControllerVisuals();
  for (const controller of controllers) {
    controller.held = null;
    controller.trigger = false;
  }
});

renderer.xr.addEventListener("sessionend", () => {
  overlay.style.display = "none";
  setup.hidden = false;
  clearPlanes();
  clearBalls();
  for (const controller of controllers) {
    controller.tip.visible = false;
    controller.bat.visible = false;
    controller.held = null;
  }
  note.textContent = "Session ended. Enter AR to look again.";
});

renderer.setAnimationLoop((_time, frame) => {
  const dt = Math.min(0.05, clock.getDelta() || 0.016);
  lastDt = Math.max(0.008, dt);

  if (frame) {
    exitFromControllers(frame);
    syncPlanes(frame);
    updateControllers(frame, dt);
    if (!spawned && readyToSpawn()) spawnBalls();
    stepPhysics(dt);
  }

  renderer.render(scene, camera);
});

function applyForm() {
  ballCount = Math.min(60, Math.max(1, Number(form.querySelector("#count").value) || 10));
  bounceMode = form.querySelector("#bounce").value || "walls-floor";
  gravityOn = form.querySelector("#gravity").value !== "off";
  interactMode = form.querySelector("#interact").value || "poke";
  batSize = form.querySelector("#bat").value || "off";
  batConfig = BAT_SIZES[batSize] || null;
  showPlanes = form.querySelector("#planes").checked;
  scan = form.querySelector("#scan").checked;
  if (batConfig) scaleBats(batConfig);
}

function applyControllerVisuals() {
  const showBat = Boolean(batConfig);
  const showTip = !showBat && interactMode !== "none";
  for (const controller of controllers) {
    controller.bat.visible = showBat;
    controller.tip.visible = showTip;
  }
}

function createBatMesh() {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({
    color: 0xc48a3a,
    roughness: 0.55,
    metalness: 0.05,
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.85,
    metalness: 0.05,
  });

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 1, 12), gripMat);
  handle.name = "handle";
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.032, 1, 16), wood);
  barrel.name = "barrel";
  const tipKnob = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), wood);
  tipKnob.name = "knob";

  // Controllers point along -Z; bat extends forward from the grip.
  handle.rotation.x = Math.PI / 2;
  barrel.rotation.x = Math.PI / 2;
  group.add(handle, barrel, tipKnob);
  return group;
}

function scaleBats(config) {
  const handleLen = config.length * 0.28;
  const barrelLen = config.length * 0.72;
  const handleRadius = config.radius * 0.45;
  const barrelTip = config.radius;
  const barrelBase = config.radius * 0.55;

  for (const controller of controllers) {
    const handle = controller.bat.getObjectByName("handle");
    const barrel = controller.bat.getObjectByName("barrel");
    const knob = controller.bat.getObjectByName("knob");

    handle.geometry.dispose();
    handle.geometry = new THREE.CylinderGeometry(handleRadius * 0.9, handleRadius, handleLen, 12);
    handle.position.set(0, 0, -handleLen * 0.5);

    barrel.geometry.dispose();
    barrel.geometry = new THREE.CylinderGeometry(barrelBase, barrelTip, barrelLen, 16);
    barrel.position.set(0, 0, -(handleLen + barrelLen * 0.5));

    knob.geometry.dispose();
    knob.geometry = new THREE.SphereGeometry(barrelTip, 12, 10);
    knob.position.set(0, 0, -config.length);
  }
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

function updateControllers(frame, dt) {
  const referenceSpace = renderer.xr.getReferenceSpace();

  for (const controller of controllers) {
    controller.previous.copy(controller.position);
    const source = [...frame.session.inputSources].find((entry) => entry.handedness === controller.handedness);
    const space = source?.gripSpace || source?.targetRaySpace;
    const pose = space ? frame.getPose(space, referenceSpace) : null;

    controller.prevBatStart.copy(controller.batStart);
    controller.prevBatEnd.copy(controller.batEnd);

    if (pose) {
      controller.grip.matrix.fromArray(pose.transform.matrix);
      controller.grip.updateMatrixWorld(true);
      controller.grip.matrix.decompose(controller.position, tmp.quat, tmp.local);
      controller.grip.visible = true;
      updateBatEndpoints(controller);
    } else {
      controller.grip.visible = false;
    }

    if (dt > 0) {
      controller.velocity.copy(controller.position).sub(controller.previous).divideScalar(dt);
    }

    const pressed = Boolean(source?.gamepad?.buttons[TRIGGER_BUTTON]?.pressed);
    const wasPressed = controller.trigger;
    controller.trigger = pressed;

    if (interactMode === "grab") {
      if (pressed && !wasPressed && !controller.held) {
        const nearest = nearestFreeBall(controller.position, GRAB_RANGE);
        if (nearest) {
          controller.held = nearest;
          nearest.heldBy = controller;
          nearest.velocity.set(0, 0, 0);
        }
      }

      if (!pressed && controller.held) {
        const ball = controller.held;
        ball.heldBy = null;
        ball.velocity.copy(controller.velocity).clampLength(0, MAX_SPEED);
        controller.held = null;
      }

      if (controller.held) {
        controller.held.position.copy(controller.position);
        controller.held.mesh.position.copy(controller.position);
      }
    } else if (controller.held) {
      controller.held.heldBy = null;
      controller.held = null;
    }
  }
}

function readyToSpawn() {
  if (!planes.size) return false;
  if (bounceMode === "walls") return [...planes.values()].some((entry) => entry.orientation === "vertical");
  if (bounceMode === "walls-floor") {
    return [...planes.values()].some((entry) => entry.orientation === "horizontal");
  }
  return true;
}

function spawnBalls() {
  spawned = true;
  const origin = new THREE.Vector3(0, 1.2, -0.4);

  for (let i = 0; i < ballCount; i += 1) {
    const color = palette[i % palette.length];
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 24, 16),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.35,
        metalness: 0.05,
        emissive: color,
        emissiveIntensity: 0.12,
      }),
    );
    mesh.frustumCulled = false;

    const position = origin.clone().add(
      new THREE.Vector3((Math.random() - 0.5) * 0.9, Math.random() * 0.7, (Math.random() - 0.5) * 0.9),
    );
    const speed = gravityOn ? 1.4 : 1.8;
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * speed,
      gravityOn ? Math.random() * 0.6 : (Math.random() - 0.5) * speed,
      (Math.random() - 0.5) * speed,
    );
    if (!gravityOn && velocity.lengthSq() < 0.25) velocity.setLength(0.8);

    mesh.position.copy(position);
    scene.add(mesh);
    balls.push({ mesh, position, velocity, heldBy: null, radius: BALL_RADIUS });
  }

  status.textContent = `${balls.length} balls`;
}

function stepPhysics(dt) {
  if (!balls.length) return;

  const drag = gravityOn ? FRICTION : ZERO_G_FRICTION;

  for (const ball of balls) {
    if (ball.heldBy) continue;

    if (gravityOn) ball.velocity.addScaledVector(GRAVITY_FORCE, dt);
    ball.velocity.multiplyScalar(Math.pow(drag, dt * 60));
    if (ball.velocity.lengthSq() > MAX_SPEED * MAX_SPEED) {
      ball.velocity.setLength(MAX_SPEED);
    }

    ball.position.addScaledVector(ball.velocity, dt);
    collidePlanes(ball);
  }

  collideBalls();

  for (const controller of controllers) {
    if (!controller.grip.visible || controller.held) continue;
    if (batConfig) collideBat(controller);
    else if (interactMode !== "none") collideController(controller);
  }

  for (const ball of balls) {
    ball.mesh.position.copy(ball.position);
  }
}

function collidePlanes(ball) {
  for (const entry of planes.values()) {
    if (!planeAllowed(entry.orientation)) continue;

    tmp.inverse.copy(entry.group.matrix).invert();
    tmp.local.copy(ball.position).applyMatrix4(tmp.inverse);

    const distance = tmp.local.y;
    if (Math.abs(distance) > ball.radius + 0.02) continue;
    if (!pointInPolygon(tmp.local.x, tmp.local.z, entry.polygon)) continue;

    const sign = distance >= 0 ? 1 : -1;
    const penetration = ball.radius - Math.abs(distance);
    if (penetration < 0) continue;

    tmp.normal.set(0, sign, 0).transformDirection(entry.group.matrix).normalize();
    ball.position.addScaledVector(tmp.normal, penetration + 0.001);

    const impact = ball.velocity.dot(tmp.normal);
    if (impact < 0) {
      const bounce = gravityOn ? RESTITUTION : 1;
      ball.velocity.addScaledVector(tmp.normal, -(1 + bounce) * impact);
    }
  }
}

function collideBalls() {
  for (let i = 0; i < balls.length; i += 1) {
    for (let j = i + 1; j < balls.length; j += 1) {
      const a = balls[i];
      const b = balls[j];
      if (a.heldBy && b.heldBy) continue;

      tmp.delta.copy(b.position).sub(a.position);
      const minDist = a.radius + b.radius;
      const distSq = tmp.delta.lengthSq();
      if (distSq === 0 || distSq >= minDist * minDist) continue;

      const dist = Math.sqrt(distSq);
      tmp.normal.copy(tmp.delta).divideScalar(dist);
      const overlap = minDist - dist;

      if (a.heldBy) {
        b.position.addScaledVector(tmp.normal, overlap);
      } else if (b.heldBy) {
        a.position.addScaledVector(tmp.normal, -overlap);
      } else {
        a.position.addScaledVector(tmp.normal, -overlap * 0.5);
        b.position.addScaledVector(tmp.normal, overlap * 0.5);
      }

      tmp.velocity.copy(b.velocity).sub(a.velocity);
      const impact = tmp.velocity.dot(tmp.normal);
      if (impact >= 0) continue;

      const bounce = gravityOn ? RESTITUTION : 1;
      const impulse = -(1 + bounce) * impact * 0.5;
      if (!a.heldBy) a.velocity.addScaledVector(tmp.normal, -impulse);
      if (!b.heldBy) b.velocity.addScaledVector(tmp.normal, impulse);
    }
  }
}

function collideController(controller) {
  for (const ball of balls) {
    if (ball.heldBy) continue;

    tmp.delta.copy(ball.position).sub(controller.position);
    const minDist = ball.radius + CONTROLLER_RADIUS;
    const distSq = tmp.delta.lengthSq();
    if (distSq === 0 || distSq >= minDist * minDist) continue;

    const dist = Math.sqrt(distSq);
    tmp.normal.copy(tmp.delta).divideScalar(dist);
    ball.position.addScaledVector(tmp.normal, minDist - dist + 0.001);

    tmp.velocity.copy(controller.velocity).sub(ball.velocity);
    const impact = tmp.velocity.dot(tmp.normal);
    if (impact > 0) {
      ball.velocity.addScaledVector(tmp.normal, (1 + RESTITUTION) * impact);
      if (ball.velocity.lengthSq() > MAX_SPEED * MAX_SPEED) {
        ball.velocity.setLength(MAX_SPEED);
      }
    }
  }
}

function updateBatEndpoints(controller) {
  if (!batConfig) return;
  tmp.a.set(0, 0, -0.04);
  tmp.b.set(0, 0, -batConfig.length);
  tmp.a.applyMatrix4(controller.grip.matrixWorld);
  tmp.b.applyMatrix4(controller.grip.matrixWorld);
  controller.batStart.copy(tmp.a);
  controller.batEnd.copy(tmp.b);
}

function collideBat(controller) {
  if (!batConfig) return;
  const radius = batConfig.radius;
  const power = batConfig.power * BAT_HIT_BOOST;

  for (const ball of balls) {
    if (ball.heldBy) continue;

    closestPointOnSegment(ball.position, controller.batStart, controller.batEnd, tmp.closest);
    tmp.delta.copy(ball.position).sub(tmp.closest);
    const minDist = ball.radius + radius;
    const distSq = tmp.delta.lengthSq();
    if (distSq === 0 || distSq >= minDist * minDist) continue;

    const dist = Math.sqrt(distSq);
    tmp.normal.copy(tmp.delta).divideScalar(dist);
    ball.position.addScaledVector(tmp.normal, minDist - dist + 0.001);

    // Approximate the bat point's velocity from its previous segment position.
    const span = controller.batStart.distanceTo(controller.batEnd) || 1;
    const t = controller.batStart.distanceTo(tmp.closest) / span;
    tmp.prevA.copy(controller.prevBatStart).lerp(controller.prevBatEnd, t);
    tmp.hitVel.copy(tmp.closest).sub(tmp.prevA).divideScalar(lastDt);
    tmp.hitVel.addScaledVector(controller.velocity, 0.25);

    tmp.velocity.copy(tmp.hitVel).sub(ball.velocity);
    const impact = tmp.velocity.dot(tmp.normal);
    if (impact > 0) {
      ball.velocity.addScaledVector(tmp.normal, (1 + RESTITUTION) * impact * power);
      if (ball.velocity.lengthSq() > MAX_SPEED * MAX_SPEED) {
        ball.velocity.setLength(MAX_SPEED);
      }
    }
  }
}

function closestPointOnSegment(point, start, end, out) {
  tmp.delta.copy(end).sub(start);
  const lengthSq = tmp.delta.lengthSq();
  if (lengthSq < 1e-8) return out.copy(start);
  const t = Math.min(1, Math.max(0, tmp.local.copy(point).sub(start).dot(tmp.delta) / lengthSq));
  return out.copy(start).addScaledVector(tmp.delta, t);
}

function nearestFreeBall(point, range) {
  let best = null;
  let bestDist = range;

  for (const ball of balls) {
    if (ball.heldBy) continue;
    const dist = ball.position.distanceTo(point);
    if (dist > bestDist) continue;
    best = ball;
    bestDist = dist;
  }

  return best;
}

function planeAllowed(orientation) {
  if (bounceMode === "all") return true;
  if (bounceMode === "walls") return orientation === "vertical";
  return orientation === "vertical" || orientation === "horizontal";
}

function syncPlanes(frame) {
  const detected = frame.detectedPlanes;
  if (!detected) return;

  const referenceSpace = renderer.xr.getReferenceSpace();
  const seen = new Set();
  let bounceCount = 0;

  for (const plane of detected) {
    const allowed = planeAllowed(plane.orientation);
    if (allowed) bounceCount += 1;
    if (!allowed) continue;

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
    const gravityLabel = gravityOn ? "gravity on" : "gravity off";
    if (spawned) status.textContent = `${balls.length} balls · ${bounceCount} surfaces · ${gravityLabel}`;
    else status.textContent = `${planeStatus(bounceCount, detected.size)} · ${gravityLabel}`;
  }
  maybeScan(frame, detected.size);
}

function planeStatus(shown, total) {
  if (shown) return `${shown} bounce surfaces`;
  if (total) return `No bounce surfaces yet. ${total} other planes in the scan.`;
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
  session.initiateRoomCapture().then(() => {
    scanning = false;
  }).catch(() => {
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
      opacity: 0.22,
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

function clearPlanes() {
  for (const entry of planes.values()) {
    scene.remove(entry.group);
    disposeEntry(entry);
  }
  planes.clear();
  nextColor = 0;
}

function clearBalls() {
  for (const ball of balls) {
    scene.remove(ball.mesh);
    ball.mesh.geometry.dispose();
    ball.mesh.material.dispose();
  }
  balls.length = 0;
}

function disposeEntry(entry) {
  for (const child of entry.group.children) {
    child.geometry.dispose();
    child.material.dispose();
  }
}
