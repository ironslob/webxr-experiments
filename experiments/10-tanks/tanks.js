import * as THREE from "three";
import { heightAt } from "./terrain.js";

export const TANK_TYPES = {
  light: {
    id: "light",
    label: "Light",
    hull: { length: 3.2, width: 2.0, height: 0.85 },
    turret: { radius: 0.55, height: 0.45 },
    barrel: { length: 2.4, radius: 0.08 },
    trackHeight: 0.55,
    speed: 9.5,
    turn: 1.6,
    turretTurn: 1.8,
    barrelPitch: 0.9,
    hitRadius: 1.6,
    color: 0x6b8f3c,
  },
  medium: {
    id: "medium",
    label: "Medium",
    hull: { length: 4.2, width: 2.5, height: 1.05 },
    turret: { radius: 0.72, height: 0.55 },
    barrel: { length: 3.2, radius: 0.1 },
    trackHeight: 0.65,
    speed: 7.2,
    turn: 1.15,
    turretTurn: 1.35,
    barrelPitch: 0.75,
    hitRadius: 2.0,
    color: 0x5a6b3a,
  },
  heavy: {
    id: "heavy",
    label: "Heavy",
    hull: { length: 5.4, width: 3.1, height: 1.25 },
    turret: { radius: 0.95, height: 0.7 },
    barrel: { length: 4.0, radius: 0.13 },
    trackHeight: 0.8,
    speed: 5.0,
    turn: 0.75,
    turretTurn: 0.95,
    barrelPitch: 0.55,
    hitRadius: 2.5,
    color: 0x4a5534,
  },
};

const TYPE_IDS = Object.keys(TANK_TYPES);

export function randomTankType() {
  return TYPE_IDS[(Math.random() * TYPE_IDS.length) | 0];
}

/** Track contact patch: length along the hull, width across the track centerlines. */
export function trackContact(type) {
  return {
    length: type.hull.length * 0.92,
    width: type.hull.width * 0.84,
  };
}

let bullseyeMap = null;

export function bullseyeTexture() {
  if (bullseyeMap) return bullseyeMap;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f4f0e4";
  ctx.fillRect(0, 0, 512, 512);
  const rings = [
    ["#1a140f", 230],
    ["#f4f0e4", 190],
    ["#d01212", 150],
    ["#f4f0e4", 110],
    ["#1a140f", 72],
    ["#f0c014", 34],
  ];
  for (const [color, radius] of rings) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(256, 256, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "#ffb000";
  ctx.lineWidth = 14;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(256, 148);
  ctx.lineTo(256, 214);
  ctx.moveTo(256, 298);
  ctx.lineTo(256, 364);
  ctx.moveTo(148, 256);
  ctx.lineTo(214, 256);
  ctx.moveTo(298, 256);
  ctx.lineTo(364, 256);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  bullseyeMap = tex;
  return tex;
}

const sightMat = {
  amber: () => new THREE.MeshBasicMaterial({ color: 0xffc44d, fog: false }),
  hot: () => new THREE.MeshBasicMaterial({ color: 0xfff4cc, fog: false }),
  ink: () => new THREE.MeshBasicMaterial({ color: 0x140e08, fog: false }),
};

function createAimSight(barrelLength) {
  const sight = new THREE.Group();
  sight.name = "aim-sight";
  const reach = 15;
  const amber = sightMat.amber();
  const hot = sightMat.hot();
  const ink = sightMat.ink();

  const laserLen = Math.max(1, reach - barrelLength - 0.4);
  const laser = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, laserLen, 6),
    new THREE.MeshBasicMaterial({ color: 0xffc44d, transparent: true, opacity: 0.8, fog: false }),
  );
  laser.rotation.x = Math.PI / 2;
  laser.position.z = barrelLength + 0.35 + laserLen * 0.5;
  sight.add(laser);

  const reticle = new THREE.Group();
  reticle.position.z = reach;
  reticle.add(new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.09, 8, 28), ink));
  reticle.add(new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.045, 8, 28), amber));
  reticle.add(new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.03, 8, 20), amber));

  const tickGeo = new THREE.BoxGeometry(0.07, 0.72, 0.05);
  for (let i = 0; i < 4; i += 1) {
    const tick = new THREE.Mesh(tickGeo, amber);
    const angle = (i * Math.PI) / 2;
    tick.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0);
    tick.rotation.z = angle - Math.PI / 2;
    reticle.add(tick);
  }

  const chevron = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 3), hot);
  chevron.position.y = 1.32;
  reticle.add(chevron);
  sight.add(reticle);
  return sight;
}

function createEnemyMarker(type) {
  const marker = new THREE.Group();
  marker.name = "target-marker";
  const color = new THREE.MeshBasicMaterial({ color: 0xff4d3a, fog: false });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.85, 5), color);
  pole.position.y = type.turret.height + 0.55;
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), color);
  diamond.position.y = type.turret.height + 1.35;
  diamond.name = "target-diamond";
  marker.add(pole, diamond);
  return marker;
}

/**
 * Upright bullseye standing on the terrain, facing the origin.
 * Group origin is the board center so shots can test that point.
 */
export function createRangeTarget({ x, z, size }) {
  const ground = heightAt(x, z);
  const lift = size * 0.62;
  const group = new THREE.Group();
  group.name = "range-target";
  group.position.set(x, ground + lift, z);
  group.rotation.y = Math.atan2(-x, -z);

  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: bullseyeTexture(), side: THREE.DoubleSide }),
  );
  board.name = "board";
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 1.1, size * 1.1),
    new THREE.MeshBasicMaterial({ color: 0x1c140e, side: THREE.DoubleSide }),
  );
  frame.position.z = -0.05;
  group.add(frame, board);

  const postMat = new THREE.MeshStandardMaterial({ color: 0x2c2418, roughness: 0.9 });
  const postGeo = new THREE.CylinderGeometry(0.08, 0.1, lift, 6);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(side * size * 0.34, -lift * 0.5, -0.1);
    post.castShadow = true;
    group.add(post);
  }

  return { group, board, hitRadius: size * 0.5 };
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.82,
    metalness: opts.metalness ?? 0.12,
    ...opts,
  });
}

/**
 * Procedural tank with separable turret/barrel and a simple cockpit.
 * @returns {{
 *   root: THREE.Group,
 *   turret: THREE.Group,
 *   barrelPivot: THREE.Group,
 *   muzzle: THREE.Object3D,
 *   cockpitSeat: THREE.Object3D,
 *   chaseSeat: THREE.Object3D,
 *   aimSight: THREE.Object3D | null,
 *   targetMarker: THREE.Object3D | null,
 *   exterior: THREE.Object3D[],
 *   interior: THREE.Object3D[],
 *   type: object,
 * }}
 */
export function createTank(typeId, { player = false, color } = {}) {
  const type = TANK_TYPES[typeId] || TANK_TYPES.medium;
  const paint = color ?? (player ? 0x8fbf4a : type.color);
  const dark = new THREE.Color(paint).multiplyScalar(0.55).getHex();
  const trackColor = 0x2a2e28;
  const interiorColor = 0x3a4034;

  const root = new THREE.Group();
  root.name = player ? "player-tank" : "enemy-tank";

  const exterior = [];
  const interior = [];

  const hullMat = mat(paint);
  const darkMat = mat(dark);
  const trackMat = mat(trackColor, { roughness: 0.95, metalness: 0.05 });
  const interiorMat = mat(interiorColor, { roughness: 0.9 });

  const { length: L, width: W, height: H } = type.hull;
  const trackH = type.trackHeight;

  const hull = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, H, L), hullMat);
  hull.position.y = trackH + H * 0.5;
  hull.castShadow = true;
  hull.receiveShadow = true;
  root.add(hull);
  exterior.push(hull);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, H * 0.55, L * 0.22), darkMat);
  nose.position.set(0, trackH + H * 0.55, L * 0.42);
  root.add(nose);
  exterior.push(nose);

  for (const side of [-1, 1]) {
    const track = new THREE.Mesh(
      new THREE.BoxGeometry(W * 0.18, trackH, L * 1.02),
      trackMat,
    );
    track.position.set(side * (W * 0.42), trackH * 0.5, 0);
    track.castShadow = true;
    root.add(track);
    exterior.push(track);

    for (const z of [-L * 0.35, 0, L * 0.35]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(trackH * 0.38, trackH * 0.38, W * 0.16, 10),
        darkMat,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * (W * 0.42), trackH * 0.42, z);
      root.add(wheel);
      exterior.push(wheel);
    }
  }

  const turret = new THREE.Group();
  turret.position.y = trackH + H + 0.02;
  root.add(turret);

  const turretMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(type.turret.radius, type.turret.radius * 1.08, type.turret.height, 14),
    hullMat,
  );
  turretMesh.position.y = type.turret.height * 0.5;
  turretMesh.castShadow = true;
  turret.add(turretMesh);
  exterior.push(turretMesh);

  const cupola = new THREE.Mesh(
    new THREE.CylinderGeometry(type.turret.radius * 0.35, type.turret.radius * 0.4, 0.18, 10),
    darkMat,
  );
  cupola.name = "cupola";
  cupola.position.set(0.15, type.turret.height + 0.08, -0.1);
  turret.add(cupola);
  exterior.push(cupola);

  const barrelPivot = new THREE.Group();
  barrelPivot.position.set(0, type.turret.height * 0.55, type.turret.radius * 0.55);
  turret.add(barrelPivot);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(type.barrel.radius, type.barrel.radius * 1.15, type.barrel.length, 10),
    darkMat,
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = type.barrel.length * 0.5;
  barrel.castShadow = true;
  barrelPivot.add(barrel);
  exterior.push(barrel);

  const muzzleBrake = new THREE.Mesh(
    new THREE.CylinderGeometry(type.barrel.radius * 1.4, type.barrel.radius * 1.4, 0.22, 8),
    trackMat,
  );
  muzzleBrake.rotation.x = Math.PI / 2;
  muzzleBrake.position.z = type.barrel.length;
  barrelPivot.add(muzzleBrake);
  exterior.push(muzzleBrake);

  const muzzle = new THREE.Object3D();
  muzzle.position.z = type.barrel.length + 0.15;
  barrelPivot.add(muzzle);

  // Coaxial machine gun beside the main barrel
  const mg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.04, type.barrel.length * 0.55, 8),
    darkMat,
  );
  mg.rotation.x = Math.PI / 2;
  mg.position.set(type.barrel.radius + 0.12, -0.05, type.barrel.length * 0.28);
  barrelPivot.add(mg);
  exterior.push(mg);

  const mgMuzzle = new THREE.Object3D();
  mgMuzzle.position.set(type.barrel.radius + 0.12, -0.05, type.barrel.length * 0.55 + 0.05);
  barrelPivot.add(mgMuzzle);

  let aimSight = null;
  let targetMarker = null;
  if (player) {
    aimSight = createAimSight(type.barrel.length);
    barrelPivot.add(aimSight);
  } else {
    targetMarker = createEnemyMarker(type);
    turret.add(targetMarker);
  }

  // Interior — visible mainly in cockpit view
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.55, H * 0.7, L * 0.35),
    interiorMat,
  );
  cabin.position.set(0, trackH + H * 0.55, -L * 0.05);
  root.add(cabin);
  interior.push(cabin);

  const dash = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.35), mat(0x1c2218));
  dash.position.set(0, trackH + H * 0.95, L * 0.08);
  root.add(dash);
  interior.push(dash);

  const seatPad = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.4), mat(0x2c3328));
  seatPad.position.set(0, trackH + H * 0.55, -0.15);
  root.add(seatPad);
  interior.push(seatPad);

  const periscope = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 0.12), mat(0x111511));
  periscope.position.set(0, trackH + H + type.turret.height * 0.2, type.turret.radius * 0.2);
  turret.add(periscope);
  interior.push(periscope);

  // Hatch seat on the hull: hull steer turns you with the tracks; turret/gun
  // traverse independently in front of you (true tank-style separation).
  const cockpitSeat = new THREE.Object3D();
  cockpitSeat.position.set(0, trackH + H + type.turret.height + 0.4, -0.35);
  root.add(cockpitSeat);

  const chaseSeat = new THREE.Object3D();
  chaseSeat.position.set(0, 4.2, -9.5);
  root.add(chaseSeat);

  return {
    root,
    turret,
    barrelPivot,
    muzzle,
    mgMuzzle,
    cockpitSeat,
    chaseSeat,
    aimSight,
    targetMarker,
    exterior,
    interior,
    type,
  };
}

export function setTankViewMode(tank, mode) {
  const cockpit = mode === "cockpit";
  for (const mesh of tank.exterior) {
    mesh.visible = true;
  }
  tank.root.traverse((obj) => {
    if (obj.name === "cupola") obj.visible = !cockpit;
  });
  for (const mesh of tank.interior) {
    mesh.visible = true;
  }
  if (tank.aimSight) tank.aimSight.visible = cockpit;
}
