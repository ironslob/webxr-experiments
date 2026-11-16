import * as THREE from "three";

const GRAVITY = -9.5;

const KINDS = {
  cannon: {
    speed: 42,
    life: 3.2,
    radius: 0.18,
    gravity: GRAVITY,
    color: 0xffc857,
    emissive: 0xaa5500,
    flashSize: 0.85,
  },
  mg: {
    speed: 75,
    life: 1.4,
    radius: 0.045,
    gravity: -2,
    color: 0xffe099,
    emissive: 0xff8800,
    flashSize: 0.22,
  },
};

const geos = {
  cannon: new THREE.SphereGeometry(KINDS.cannon.radius, 8, 8),
  mg: new THREE.SphereGeometry(KINDS.mg.radius, 6, 6),
};

/**
 * @typedef {{
 *   mesh: THREE.Mesh,
 *   velocity: THREE.Vector3,
 *   age: number,
 *   alive: boolean,
 *   owner: string,
 *   kind: string,
 *   radius: number,
 *   gravity: number,
 * }} Shell
 */

/** @returns {Shell} */
export function spawnShell(parent, origin, direction, owner = "player", kind = "cannon") {
  const cfg = KINDS[kind] || KINDS.cannon;
  const mat = new THREE.MeshStandardMaterial({
    color: cfg.color,
    emissive: cfg.emissive,
    emissiveIntensity: 0.7,
    roughness: 0.35,
    metalness: 0.25,
  });
  const mesh = new THREE.Mesh(geos[kind] || geos.cannon, mat);
  mesh.castShadow = true;
  mesh.position.copy(origin);
  parent.add(mesh);
  const velocity = direction.clone().normalize().multiplyScalar(cfg.speed);
  return {
    mesh,
    velocity,
    age: 0,
    alive: true,
    owner,
    kind,
    radius: cfg.radius,
    gravity: cfg.gravity,
  };
}

export function stepShells(shells, dt) {
  for (const shell of shells) {
    if (!shell.alive) continue;
    shell.age += dt;
    const life = (KINDS[shell.kind] || KINDS.cannon).life;
    if (shell.age > life) {
      killShell(shell);
      continue;
    }
    shell.velocity.y += shell.gravity * dt;
    shell.mesh.position.addScaledVector(shell.velocity, dt);
  }
}

export function killShell(shell) {
  if (!shell.alive) return;
  shell.alive = false;
  shell.mesh.removeFromParent();
}

/**
 * @param {Shell[]} shells
 * @param {Array<{ id: string, position: THREE.Vector3, hitRadius: number, alive: boolean }>} targets
 */
export function resolveHits(shells, targets) {
  /** @type {Array<{ targetId: string, shell: Shell }>} */
  const hits = [];
  for (const shell of shells) {
    if (!shell.alive) continue;
    for (const target of targets) {
      if (!target.alive) continue;
      if (shell.owner === target.id) continue;
      const dist = shell.mesh.position.distanceTo(target.position);
      if (dist <= target.hitRadius + shell.radius) {
        hits.push({ targetId: target.id, shell });
        killShell(shell);
        break;
      }
    }
  }
  return hits;
}

export function spawnHitFlash(parent, position, kind = "cannon") {
  const size = (KINDS[kind] || KINDS.cannon).flashSize;
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(size, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xff9944, transparent: true, opacity: 0.9 }),
  );
  flash.position.copy(position);
  flash.position.y += 0.8;
  parent.add(flash);
  return { mesh: flash, age: 0, duration: kind === "mg" ? 0.12 : 0.35 };
}

export function spawnMuzzleFlash(parent, origin, direction, kind = "cannon") {
  const size = kind === "mg" ? 0.12 : 0.45;
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(size, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true, opacity: 1 }),
  );
  flash.position.copy(origin).addScaledVector(direction, size * 0.8);
  parent.add(flash);
  return { mesh: flash, age: 0, duration: kind === "mg" ? 0.06 : 0.14 };
}

export function stepFlashes(flashes, dt) {
  for (let i = flashes.length - 1; i >= 0; i -= 1) {
    const f = flashes[i];
    f.age += dt;
    const dur = f.duration ?? 0.35;
    const t = f.age / dur;
    f.mesh.scale.setScalar(1 + t * 2.2);
    f.mesh.material.opacity = Math.max(0, 1 - t);
    if (f.age > dur) {
      f.mesh.removeFromParent();
      flashes.splice(i, 1);
    }
  }
}
