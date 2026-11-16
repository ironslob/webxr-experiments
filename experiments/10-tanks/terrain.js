import * as THREE from "three";

export const MAP_SIZE = 220;
const HALF = MAP_SIZE * 0.5;

function noise2(x, z) {
  const s = Math.sin(x * 0.021) * Math.cos(z * 0.019);
  const t = Math.sin((x + z) * 0.011) * 0.65;
  const u = Math.sin(x * 0.047 + 1.7) * Math.sin(z * 0.039 - 0.4) * 0.35;
  return s * 0.55 + t + u;
}

/** Rolling height in meters at world xz. */
export function heightAt(x, z) {
  const edge = Math.max(
    Math.abs(x) / HALF,
    Math.abs(z) / HALF,
  );
  const bowl = edge > 0.82 ? (edge - 0.82) * (edge - 0.82) * 28 : 0;
  return noise2(x, z) * 4.8 + noise2(x * 2.1, z * 2.1) * 1.4 + bowl;
}

/** Prop counts. Normal matches the original hills. More and Dense add cover. */
export const SCENERY = {
  sparse: { trees: 28, rocks: 18, bushes: 0, logs: 0, grass: 70 },
  normal: { trees: 70, rocks: 55, bushes: 0, logs: 0, grass: 180 },
  many: { trees: 150, rocks: 110, bushes: 80, logs: 28, grass: 400 },
  dense: { trees: 260, rocks: 190, bushes: 150, logs: 48, grass: 700 },
};

export function resolveScenery(level) {
  return SCENERY[level] ? level : "normal";
}

export function createTerrain(level = "normal") {
  const counts = SCENERY[resolveScenery(level)];
  const segments = 140;
  const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);

    const tint = 0.72 + ((Math.sin(x * 0.08) + Math.cos(z * 0.07)) * 0.08);
    c.setRGB(0.28 * tint, 0.48 * tint, 0.22 * tint);
    if (y > 3.2) c.offsetHSL(0, -0.05, 0.08);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.02,
      flatShading: false,
    }),
  );
  mesh.receiveShadow = true;
  mesh.name = "terrain";

  const group = new THREE.Group();
  group.add(mesh);
  group.userData.props = scatterProps(group, counts);
  return group;
}

const _dummy = new THREE.Object3D();

function collectPoints(count, minRadius, spread) {
  const pts = [];
  let guard = 0;
  const limit = Math.max(count * 8, count);
  while (pts.length < count && guard < limit) {
    guard += 1;
    const x = (Math.random() - 0.5) * MAP_SIZE * spread;
    const z = (Math.random() - 0.5) * MAP_SIZE * spread;
    if (Math.hypot(x, z) < minRadius) continue;
    pts.push({ x, z, y: heightAt(x, z) });
  }
  return pts;
}

function addInstances(group, geo, mat, pts, place, { shadow = true } = {}) {
  if (!pts.length) return;
  const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  for (let i = 0; i < pts.length; i += 1) {
    place(_dummy, pts[i], i);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
}

function scatterProps(group, counts) {
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5a28, roughness: 0.85 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a6e64, roughness: 0.92 });
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x3d6b30, roughness: 0.9 });
  const logMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.92 });
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0x3f7a32,
    roughness: 1,
    side: THREE.DoubleSide,
  });

  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.4, 6);
  const leafGeo = new THREE.ConeGeometry(1.1, 2.4, 7);
  const rockGeo = new THREE.DodecahedronGeometry(0.55, 0);
  const bushGeo = new THREE.IcosahedronGeometry(0.7, 0);
  const logGeo = new THREE.CylinderGeometry(0.16, 0.2, 2.4, 6);
  const grassGeo = new THREE.PlaneGeometry(0.35, 0.55);

  const trees = collectPoints(counts.trees, 12, 0.88);
  const treeSpin = trees.map(() => Math.random() * Math.PI * 2);
  const treeScale = trees.map(() => 0.75 + Math.random() * 0.7);
  addInstances(group, trunkGeo, trunkMat, trees, (dummy, p, i) => {
    const s = treeScale[i];
    dummy.position.set(p.x, p.y + 0.7 * s, p.z);
    dummy.rotation.set(0, treeSpin[i], 0);
    dummy.scale.setScalar(s);
  });
  addInstances(group, leafGeo, leafMat, trees, (dummy, p, i) => {
    const s = treeScale[i];
    dummy.position.set(p.x, p.y + 2.2 * s, p.z);
    dummy.rotation.set(0, treeSpin[i], 0);
    dummy.scale.setScalar(s);
  });

  const rocks = collectPoints(counts.rocks, 8, 0.9);
  addInstances(group, rockGeo, rockMat, rocks, (dummy, p) => {
    const s = 0.4 + Math.random() * 1.4;
    const squash = 0.5 + Math.random() * 0.6;
    dummy.position.set(p.x, p.y + 0.15 * s, p.z);
    dummy.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());
    dummy.scale.set(s, s * squash, s);
  });

  const bushes = collectPoints(counts.bushes, 10, 0.86);
  addInstances(group, bushGeo, bushMat, bushes, (dummy, p) => {
    const s = 0.6 + Math.random() * 1.1;
    dummy.position.set(p.x, p.y + 0.4 * s, p.z);
    dummy.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());
    dummy.scale.set(s, s * 0.62, s);
  }, { shadow: false });

  const logs = collectPoints(counts.logs, 10, 0.86);
  addInstances(group, logGeo, logMat, logs, (dummy, p) => {
    const s = 0.7 + Math.random() * 0.8;
    dummy.position.set(p.x, p.y + 0.18 * s, p.z);
    dummy.rotation.set(0, Math.random() * Math.PI, Math.PI / 2);
    dummy.scale.set(1, s, 1);
  });

  const grass = collectPoints(counts.grass, 0, 0.85);
  addInstances(group, grassGeo, grassMat, grass, (dummy, p) => {
    dummy.position.set(p.x, p.y + 0.25, p.z);
    dummy.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.3);
    dummy.scale.set(1, 1, 1);
  }, { shadow: false });

  return {
    trees: trees.length,
    rocks: rocks.length,
    bushes: bushes.length,
    logs: logs.length,
    grass: grass.length,
  };
}

export function clampToMap(x, z, margin = 8) {
  const lim = HALF - margin;
  return {
    x: THREE.MathUtils.clamp(x, -lim, lim),
    z: THREE.MathUtils.clamp(z, -lim, lim),
  };
}

export function randomMapPoint(minRadius = 18, maxRadius = HALF - 15) {
  const a = Math.random() * Math.PI * 2;
  const r = minRadius + Math.random() * (maxRadius - minRadius);
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  return { x, z, y: heightAt(x, z) };
}

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _euler = new THREE.Euler();

/**
 * Sit an object on the ground under a rectangular contact patch.
 * Yaw 0 faces +Z. Local +X is right. The bottom of the object (local y = 0)
 * follows the pitch and roll of the terrain across `length` and `width`.
 */
export function seatOnTerrain(object, x, z, yaw, length, width) {
  const halfL = length * 0.5;
  const halfW = width * 0.5;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const sample = (lx, lz) => heightAt(x + cos * lx + sin * lz, z - sin * lx + cos * lz);

  const fl = sample(-halfW, halfL);
  const fr = sample(halfW, halfL);
  const rl = sample(-halfW, -halfL);
  const rr = sample(halfW, -halfL);
  const y = (fl + fr + rl + rr) * 0.25;

  // Vectors run rear→front and left→right across the patch, then orthonormalized.
  _forward.set(sin * length, (fl + fr) * 0.5 - (rl + rr) * 0.5, cos * length).normalize();
  _right.set(cos * width, (fr + rr) * 0.5 - (fl + rl) * 0.5, -sin * width).normalize();
  _up.crossVectors(_forward, _right).normalize();
  _right.crossVectors(_up, _forward).normalize();
  _basis.makeBasis(_right, _up, _forward);

  object.position.set(x, y, z);
  object.quaternion.setFromRotationMatrix(_basis);
  _euler.setFromQuaternion(object.quaternion, "YXZ");
  return { y, yaw: _euler.y, pitch: _euler.x, roll: _euler.z };
}
