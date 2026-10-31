import * as THREE from "three";

const palette = [0x5b8cff, 0xff5d73, 0xd6ff4a, 0xffb45a, 0xc084fc, 0x3dffe8, 0xff7ad9, 0x7f9a78];
const SECONDARY_BUTTON = 5;
const TRIGGER_BUTTON = 0;
const BALL_RADIUS = 0.08;
const CONTROLLER_RADIUS = 0.04;
const GRAVITY = new THREE.Vector3(0, -2.4, 0);
const RESTITUTION = 0.78;
const FRICTION = 0.98;
const GRAB_RANGE = 0.16;
const MAX_SPEED = 8;

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
};

let ballCount = 10;
let bounceMode = "walls-floor";
let interactMode = "poke";
let showPlanes = true;
let scan = true;
let nextColor = 0;
let startedAt = 0;
let scanRequested = false;
let scanning = false;
let ending = false;
let spawned = false;

for (let hand = 0; hand < 2; hand += 1) {
  const grip = new THREE.Group();
  grip.matrixAutoUpdate = false;
  grip.visible = false;
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(CONTROLLER_RADIUS, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1 }),
  );
  tip.visible = false;
  grip.add(tip);
  scene.add(grip);
  controllers.push({
    grip,
    tip,
    handedness: hand === 0 ? "left" : "right",
    position: new THREE.Vector3(),
    previous: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
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
  for (const controller of controllers) {
    controller.tip.visible = interactMode !== "none";
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
    controller.held = null;
  }
  note.textContent = "Session ended. Enter AR to look again.";
});

renderer.setAnimationLoop((_time, frame) => {
  const dt = Math.min(0.05, clock.getDelta() || 0.016);

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
  const data = new FormData(form);
  ballCount = Math.min(60, Math.max(1, Number(data.get("count")) || 10));
  bounceMode = String(data.get("bounce") || "walls-floor");
  interactMode = String(data.get("interact") || "poke");
  showPlanes = form.querySelector("#planes").checked;
  scan = form.querySelector("#scan").checked;
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

    if (pose) {
      controller.grip.matrix.fromArray(pose.transform.matrix);
      controller.grip.updateMatrixWorld(true);
      controller.grip.matrix.decompose(controller.position, tmp.quat, tmp.local);
      controller.grip.visible = true;
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
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 1.4,
      Math.random() * 0.6,
      (Math.random() - 0.5) * 1.4,
    );

    mesh.position.copy(position);
    scene.add(mesh);
    balls.push({ mesh, position, velocity, heldBy: null, radius: BALL_RADIUS });
  }

  status.textContent = `${balls.length} balls`;
}

function stepPhysics(dt) {
  if (!balls.length) return;

  for (const ball of balls) {
    if (ball.heldBy) continue;

    ball.velocity.addScaledVector(GRAVITY, dt);
    ball.velocity.multiplyScalar(Math.pow(FRICTION, dt * 60));
    if (ball.velocity.lengthSq() > MAX_SPEED * MAX_SPEED) {
      ball.velocity.setLength(MAX_SPEED);
    }

    ball.position.addScaledVector(ball.velocity, dt);
    collidePlanes(ball);
  }

  collideBalls();

  if (interactMode !== "none") {
    for (const controller of controllers) {
      if (!controller.grip.visible || controller.held) continue;
      collideController(controller);
    }
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
      ball.velocity.addScaledVector(tmp.normal, -(1 + RESTITUTION) * impact);
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

      const impulse = -(1 + RESTITUTION) * impact * 0.5;
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
    if (spawned) status.textContent = `${balls.length} balls · ${bounceCount} surfaces`;
    else status.textContent = planeStatus(bounceCount, detected.size);
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
