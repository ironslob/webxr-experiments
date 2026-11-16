import * as THREE from "three";
import { createRangeTarget, createTank, setTankViewMode, TANK_TYPES, trackContact } from "./tanks.js";
import { createTerrain, heightAt, clampToMap, randomMapPoint, seatOnTerrain } from "./terrain.js";
import {
  spawnShell,
  stepShells,
  resolveHits,
  spawnHitFlash,
  spawnMuzzleFlash,
  stepFlashes,
} from "./combat.js";
import { createEnemyState, placeTankOnTerrain, stepEnemy, killEnemy } from "./ai.js";
import { createRadar, drawRadar } from "./radar.js";

const SECONDARY_BUTTON = 5;
const TRIGGER_BUTTON = 0;
const SQUEEZE_BUTTON = 1;
const PRIMARY_BUTTON = 4;
const STICK_DEADZONE = 0.15;
const CANNON_COOLDOWN = 0.85;
const MG_COOLDOWN = 0.09;
// local-floor looks down -Z. Hull forward is local +Z, so π puts the gun,
// the sight, and the range in front of the headset when the session starts.
const SPAWN_YAW = Math.PI;
const RANGE_LAYOUT = [
  { dist: 18, side: 0, size: 3.6 },
  { dist: 36, side: -10, size: 4.4 },
  { dist: 54, side: 12, size: 5 },
];

const setup = document.querySelector("#setup");
const form = document.querySelector("#settings");
const note = document.querySelector("#note");
const enter = document.querySelector("#enter");
const exit = document.querySelector("#exit");
const overlay = document.querySelector("#overlay");
const status = document.querySelector("#status");

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.domElement.classList.add("xr-view");
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87a7c4, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9eb6c8, 40, 160);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 400);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x3d4a28, 0.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d0, 1.15);
sun.position.set(40, 60, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 5;
sun.shadow.camera.far = 160;
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
scene.add(sun);

const world = new THREE.Group();
scene.add(world);

const clock = new THREE.Clock();
const tmp = {
  seat: new THREE.Vector3(),
  muzzle: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  forward: new THREE.Vector3(),
};

let terrain = null;
let player = null;
let playerState = null;
let enemies = [];
let shells = [];
let flashes = [];
let radar = null;
let rangeTargets = [];
let viewMode = "cockpit";
let enemyCount = 6;
let ending = false;
let cannonCooldown = 0;
let mgCooldown = 0;
let prevPrimary = false;
let prevTrigger = false;
let sessionActive = false;

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(280, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0x87a7c4, side: THREE.BackSide, fog: false }),
);
scene.add(sky);

let desktopPreview = false;
const keys = new Set();

enter.addEventListener("click", () => {
  applyForm();
  if (!navigator.xr) {
    startDesktopPreview("WebXR unavailable — desktop preview.");
    return;
  }

  const sessionPromise = navigator.xr.requestSession("immersive-vr", {
    requiredFeatures: ["local-floor"],
    optionalFeatures: ["bounded-floor"],
  });

  sessionPromise
    .then((session) => renderer.xr.setSession(session))
    .catch((error) => {
      startDesktopPreview(error?.message || "VR unavailable — desktop preview.");
    });
});

exit.addEventListener("click", () => {
  if (desktopPreview) {
    stopDesktopPreview();
    return;
  }
  renderer.xr.getSession()?.end();
});

renderer.xr.addEventListener("sessionstart", () => {
  beginSession("Commander online");
});

renderer.xr.addEventListener("sessionend", () => {
  endSession();
});

window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (!desktopPreview || !sessionActive) return;
  if (event.code === "Space" || event.code.startsWith("Arrow")) event.preventDefault();
  if (event.code === "KeyV") {
    viewMode = viewMode === "cockpit" ? "chase" : "cockpit";
    if (player) setTankViewMode(player, viewMode);
  }
  if (event.code === "Escape") stopDesktopPreview();
});
window.addEventListener("keyup", (event) => keys.delete(event.code));

renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (sessionActive) {
    if (frame && !desktopPreview) {
      exitFromControllers(frame);
      stepGame(frame, dt, time * 0.001);
    } else if (desktopPreview) {
      stepGame(desktopInputFrame(), dt, time * 0.001);
      updateDesktopCamera();
    }
  }
  renderer.render(scene, camera);
});

function beginSession(message) {
  setup.hidden = true;
  overlay.style.display = "block";
  status.textContent = message;
  document.body.classList.add("stage");
  ending = false;
  sessionActive = true;
  bootWorld();
}

function endSession() {
  overlay.style.display = "none";
  setup.hidden = false;
  document.body.classList.remove("stage");
  renderer.domElement.classList.remove("preview-view");
  sessionActive = false;
  desktopPreview = false;
  teardownWorld();
  ending = false;
}

function startDesktopPreview(message) {
  desktopPreview = true;
  note.textContent = message;
  renderer.domElement.classList.add("preview-view");
  beginSession("Desktop preview — WASD hull, arrows turret, Space cannon, F MG, V view, Esc exit");
  camera.position.set(0, 1.6, 0);
  camera.rotation.set(0, 0, 0);
}

function stopDesktopPreview() {
  if (!desktopPreview) return;
  endSession();
}

function desktopInputFrame() {
  return {
    session: { inputSources: [] },
  };
}

function updateDesktopCamera() {
  if (!player) return;
  world.position.set(0, 0, 0);
  const seat = viewMode === "cockpit" ? player.cockpitSeat : player.chaseSeat;
  seat.updateWorldMatrix(true, false);
  seat.getWorldPosition(tmp.seat);
  camera.position.copy(tmp.seat);
  if (viewMode === "chase") {
    camera.lookAt(
      player.root.position.x,
      player.root.position.y + 1.5,
      player.root.position.z,
    );
  } else {
    // Look hull-forward so right-stick turret traverse is visible across the view
    // (looking at the muzzle would keep the barrel glued to screen center).
    const lookDist = 50;
    camera.lookAt(
      playerState.x + Math.sin(playerState.yaw) * lookDist,
      tmp.seat.y - 0.4,
      playerState.z + Math.cos(playerState.yaw) * lookDist,
    );
  }
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function applyForm() {
  const data = new FormData(form);
  const typeId = String(data.get("tank") || "medium");
  viewMode = String(data.get("view") || "cockpit");
  enemyCount = Number(data.get("enemies") || 6);
  playerState = playerState || {};
  playerState.pendingType = TANK_TYPES[typeId] ? typeId : "medium";
}

function bootWorld() {
  teardownWorld();

  terrain = createTerrain();
  world.add(terrain);

  const typeId = playerState?.pendingType || "medium";
  player = createTank(typeId, { player: true });
  world.add(player.root);
  setTankViewMode(player, viewMode);

  playerState = {
    pendingType: typeId,
    x: 0,
    z: 0,
    yaw: SPAWN_YAW,
    turretYaw: 0,
    barrelPitch: -0.05,
    speed: 0,
    pitch: 0,
    roll: 0,
  };
  syncPlayerTank();
  rangeTargets = spawnRangeTargets();

  enemies = [];
  for (let i = 0; i < enemyCount; i += 1) {
    spawnEnemy(`enemy-${i}`, i, enemyCount);
  }

  shells = [];
  flashes = [];
  cannonCooldown = 0;
  mgCooldown = 0;
  prevPrimary = false;
  prevTrigger = false;

  radar = createRadar();
  camera.add(radar.mesh);
}

function spawnEnemy(id, index = 0, total = 1) {
  const typeIds = Object.keys(TANK_TYPES);
  const typeId = typeIds[(Math.random() * typeIds.length) | 0];
  // Distinct drab paints so enemies read apart from the player
  const paints = [0x5a4e32, 0x3f4a38, 0x6a5b3c, 0x4a5538, 0x58503a, 0x3a4834];
  const tank = createTank(typeId, { player: false, color: paints[index % paints.length] });
  world.add(tank.root);
  const spawn = randomMapPoint(28, 95);
  // Spread initial headings around the compass so they don't look parallel
  const yaw = (index / Math.max(total, 1)) * Math.PI * 2 + (Math.random() - 0.5) * 0.7;
  const state = createEnemyState(
    id,
    tank,
    { x: spawn.x, z: spawn.z, yaw },
    performance.now() * 0.001,
  );
  // Stagger first turn so they don't all reorient together
  state.nextTurnAt = state.nextTurnAt + index * 2.5;
  placeTankOnTerrain(state);
  enemies.push(state);
}

function rangeOffset(dist, side) {
  const fx = Math.sin(SPAWN_YAW);
  const fz = Math.cos(SPAWN_YAW);
  const rx = Math.cos(SPAWN_YAW);
  const rz = -Math.sin(SPAWN_YAW);
  return { x: fx * dist + rx * side, z: fz * dist + rz * side };
}

function spawnRangeTargets() {
  return RANGE_LAYOUT.map((spec, index) => {
    const at = rangeOffset(spec.dist, spec.side);
    const built = createRangeTarget({ x: at.x, z: at.z, size: spec.size });
    world.add(built.group);
    return {
      id: `range-${index}`,
      group: built.group,
      board: built.board,
      hitRadius: built.hitRadius,
      alive: true,
      flash: 0,
    };
  });
}

function teardownWorld() {
  while (world.children.length) {
    world.remove(world.children[0]);
  }
  if (radar) {
    radar.mesh.removeFromParent();
    radar = null;
  }
  terrain = null;
  player = null;
  enemies = [];
  rangeTargets = [];
  shells = [];
  flashes = [];
  world.position.set(0, 0, 0);
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

function readSticks(frame) {
  if (desktopPreview) {
    return {
      leftX: (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
      // Quest stick Y: forward is negative; WASD W = forward
      leftY: (keys.has("KeyS") ? 1 : 0) - (keys.has("KeyW") ? 1 : 0),
      rightX: (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0),
      rightY: (keys.has("ArrowDown") ? 1 : 0) - (keys.has("ArrowUp") ? 1 : 0),
      trigger: keys.has("Space"),
      squeeze: keys.has("KeyF"),
      primary: false, // toggled via KeyV in keydown
    };
  }

  let leftX = 0;
  let leftY = 0;
  let rightX = 0;
  let rightY = 0;
  let trigger = false;
  let squeeze = false;
  let primary = false;

  for (const source of frame.session.inputSources) {
    const pad = source.gamepad;
    if (!pad) continue;
    const ax = pad.axes || [];
    // Quest: thumbstick is usually axes 2/3 (with 0/1 unused) or 0/1
    const sx = Math.abs(ax[2]) > Math.abs(ax[0] || 0) ? ax[2] : ax[0] || 0;
    const sy = Math.abs(ax[3]) > Math.abs(ax[1] || 0) ? ax[3] : ax[1] || 0;
    const x = Math.abs(sx) < STICK_DEADZONE ? 0 : sx;
    const y = Math.abs(sy) < STICK_DEADZONE ? 0 : sy;

    if (source.handedness === "left") {
      leftX = x;
      leftY = y;
    } else if (source.handedness === "right") {
      rightX = x;
      rightY = y;
    }

    if (pad.buttons[TRIGGER_BUTTON]?.pressed) trigger = true;
    if (pad.buttons[SQUEEZE_BUTTON]?.pressed) squeeze = true;
    if (pad.buttons[PRIMARY_BUTTON]?.pressed) primary = true;
  }

  return { leftX, leftY, rightX, rightY, trigger, squeeze, primary };
}

function stepGame(frame, dt, now) {
  if (!player || !playerState) return;

  const input = readSticks(frame);

  if (input.primary && !prevPrimary) {
    viewMode = viewMode === "cockpit" ? "chase" : "cockpit";
    setTankViewMode(player, viewMode);
  }
  prevPrimary = input.primary;

  // Hull only: left stick drives the tracks. Turret aim is separate (right stick).
  const throttle = -input.leftY;
  const steer = -input.leftX;
  const type = player.type;

  playerState.yaw += steer * type.turn * (0.35 + Math.abs(playerState.speed) / type.speed) * dt;
  const targetSpeed = throttle * type.speed;
  playerState.speed = THREE.MathUtils.damp(playerState.speed, targetSpeed, 4, dt);

  playerState.x += Math.sin(playerState.yaw) * playerState.speed * dt;
  playerState.z += Math.cos(playerState.yaw) * playerState.speed * dt;
  const clamped = clampToMap(playerState.x, playerState.z, 10);
  playerState.x = clamped.x;
  playerState.z = clamped.z;

  // Independent turret traverse / elevation — does not change move direction
  playerState.turretYaw += -input.rightX * type.turretTurn * dt;
  playerState.barrelPitch = THREE.MathUtils.clamp(
    playerState.barrelPitch - input.rightY * type.barrelPitch * dt,
    -0.35,
    0.2,
  );

  syncPlayerTank();

  cannonCooldown = Math.max(0, cannonCooldown - dt);
  mgCooldown = Math.max(0, mgCooldown - dt);
  if (input.trigger && !prevTrigger && cannonCooldown <= 0) {
    firePlayerWeapon("cannon");
    cannonCooldown = CANNON_COOLDOWN;
  }
  if (input.squeeze && mgCooldown <= 0) {
    firePlayerWeapon("mg");
    mgCooldown = MG_COOLDOWN;
  }
  prevTrigger = input.trigger;

  for (const enemy of enemies) {
    stepEnemy(enemy, dt, now);
    const diamond = enemy.tank.targetMarker?.getObjectByName("target-diamond");
    if (diamond && enemy.alive) diamond.rotation.y += dt * 1.4;
  }

  stepShells(shells, dt);
  const targets = enemies
    .filter((e) => e.alive)
    .map((e) => ({
      id: e.id,
      position: e.tank.root.position,
      hitRadius: e.tank.type.hitRadius,
      alive: e.alive,
    }));
  for (const range of rangeTargets) {
    targets.push({
      id: range.id,
      position: range.group.position,
      hitRadius: range.hitRadius,
      alive: true,
    });
  }

  const hits = resolveHits(shells, targets);
  for (const hit of hits) {
    const enemy = enemies.find((e) => e.id === hit.targetId);
    if (enemy) {
      flashes.push(spawnHitFlash(world, enemy.tank.root.position.clone(), hit.shell.kind));
      // Cannon one-shots; MG chips until dead via repeated hits (same kill for now)
      killEnemy(enemy, now, 4.5);
      continue;
    }
    const range = rangeTargets.find((t) => t.id === hit.targetId);
    if (!range) continue;
    range.flash = 0.45;
    flashes.push(spawnHitFlash(world, range.group.position.clone(), hit.shell.kind));
  }

  for (const range of rangeTargets) {
    if (range.flash <= 0) continue;
    range.flash = Math.max(0, range.flash - dt);
    if (range.flash < 0.001) range.flash = 0;
    const k = range.flash / 0.45;
    range.board.material.color.setRGB(1, 1 - 0.25 * k, 1 - 0.55 * k);
  }

  // Ground impact for shells
  for (const shell of shells) {
    if (!shell.alive) continue;
    const p = shell.mesh.position;
    if (p.y < heightAt(p.x, p.z) + 0.1) {
      flashes.push(spawnHitFlash(world, p.clone(), shell.kind));
      shell.alive = false;
      shell.mesh.removeFromParent();
    }
  }
  shells = shells.filter((s) => s.alive);

  stepFlashes(flashes, dt);
  if (!desktopPreview) alignWorldToSeat();

  if (radar) {
    drawRadar(
      radar,
      { x: playerState.x, z: playerState.z, yaw: playerState.yaw },
      enemies,
    );
  }
}

function syncPlayerTank() {
  const { length, width } = trackContact(player.type);
  const pose = seatOnTerrain(player.root, playerState.x, playerState.z, playerState.yaw, length, width);
  playerState.pitch = pose.pitch;
  playerState.roll = pose.roll;
  player.turret.rotation.y = playerState.turretYaw;
  player.barrelPivot.rotation.x = playerState.barrelPitch;
}

function firePlayerWeapon(kind) {
  const tip = kind === "mg" ? player.mgMuzzle : player.muzzle;
  tip.updateWorldMatrix(true, false);
  tip.getWorldPosition(tmp.muzzle);
  tip.getWorldQuaternion(tmp.quat);
  tmp.dir.set(0, 0, 1).applyQuaternion(tmp.quat);
  // Shells are parented to `world` (translation only in VR seat mode)
  world.worldToLocal(tmp.muzzle);
  const localDir = tmp.dir.clone();
  shells.push(spawnShell(world, tmp.muzzle, localDir, "player", kind));
  flashes.push(spawnMuzzleFlash(world, tmp.muzzle.clone(), localDir, kind));
}

function alignWorldToSeat() {
  const seat = viewMode === "cockpit" ? player.cockpitSeat : player.chaseSeat;
  seat.getWorldPosition(tmp.seat);
  // seat world pos currently includes world.position; we want seat at camera
  const cam = camera.position;
  world.position.x += cam.x - tmp.seat.x;
  world.position.y += cam.y - tmp.seat.y;
  world.position.z += cam.z - tmp.seat.z;
}

// Desktop/dev introspection for automated checks
window.__tanksDebug = () => ({
  viewMode,
  desktopPreview,
  sessionActive,
  hullYaw: playerState?.yaw ?? null,
  turretYaw: playerState?.turretYaw ?? null,
  barrelPitch: playerState?.barrelPitch ?? null,
  x: playerState?.x ?? null,
  z: playerState?.z ?? null,
  pitch: playerState?.pitch ?? null,
  roll: playerState?.roll ?? null,
  aimSight: player?.aimSight?.visible ?? null,
  contact: contactErrors(),
  rangeTargets: rangeTargets.map((t) => ({ id: t.id, flash: t.flash })),
  shellCount: shells.length,
  shellKinds: shells.map((s) => s.kind),
  enemies: enemies.map((e) => ({
    id: e.id,
    yaw: e.yaw,
    desiredYaw: e.desiredYaw,
    turretYaw: e.turretYaw,
    pitch: e.pitch,
    roll: e.roll,
    alive: e.alive,
  })),
});

function contactErrors() {
  if (!player || !playerState) return null;
  const { length, width } = trackContact(player.type);
  player.root.updateWorldMatrix(true, true);
  const pts = [
    [-width / 2, length / 2],
    [width / 2, length / 2],
    [-width / 2, -length / 2],
    [width / 2, -length / 2],
  ];
  return pts.map(([lx, lz]) => {
    tmp.forward.set(lx, 0, lz);
    player.root.localToWorld(tmp.forward);
    const ground = heightAt(tmp.forward.x, tmp.forward.z);
    return Number((tmp.forward.y - ground).toFixed(3));
  });
}
