import * as THREE from "three";

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
}
