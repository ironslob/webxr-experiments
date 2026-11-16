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

export function createTerrain() {
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
  scatterProps(group);
  return group;
}

function scatterProps(group) {
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5a28, roughness: 0.85 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a6e64, roughness: 0.92 });
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0x3f7a32,
    roughness: 1,
    side: THREE.DoubleSide,
  });

  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.4, 6);
  const leafGeo = new THREE.ConeGeometry(1.1, 2.4, 7);
  const rockGeo = new THREE.DodecahedronGeometry(0.55, 0);
  const grassGeo = new THREE.PlaneGeometry(0.35, 0.55);

  for (let i = 0; i < 70; i += 1) {
    const x = (Math.random() - 0.5) * MAP_SIZE * 0.88;
    const z = (Math.random() - 0.5) * MAP_SIZE * 0.88;
    if (Math.hypot(x, z) < 12) continue;
    const y = heightAt(x, z);

    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.7;
    trunk.castShadow = true;
    const leaves = new THREE.Mesh(leafGeo, leafMat);
    leaves.position.y = 2.2;
    leaves.castShadow = true;
    tree.add(trunk, leaves);
    tree.position.set(x, y, z);
    tree.rotation.y = Math.random() * Math.PI * 2;
    const s = 0.75 + Math.random() * 0.7;
    tree.scale.setScalar(s);
    group.add(tree);
  }

  for (let i = 0; i < 55; i += 1) {
    const x = (Math.random() - 0.5) * MAP_SIZE * 0.9;
    const z = (Math.random() - 0.5) * MAP_SIZE * 0.9;
    if (Math.hypot(x, z) < 8) continue;
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const s = 0.4 + Math.random() * 1.4;
    rock.scale.set(s, s * (0.5 + Math.random() * 0.6), s);
    rock.position.set(x, heightAt(x, z) + 0.15 * s, z);
    rock.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }

  for (let i = 0; i < 180; i += 1) {
    const x = (Math.random() - 0.5) * MAP_SIZE * 0.85;
    const z = (Math.random() - 0.5) * MAP_SIZE * 0.85;
    const blade = new THREE.Mesh(grassGeo, grassMat);
    blade.position.set(x, heightAt(x, z) + 0.25, z);
    blade.rotation.y = Math.random() * Math.PI;
    blade.rotation.z = (Math.random() - 0.5) * 0.3;
    group.add(blade);
  }
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
