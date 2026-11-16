import * as THREE from "three";

const SHELL_SPEED = 55;
const SHELL_LIFE = 2.8;
const SHELL_RADIUS = 0.12;
const GRAVITY = -9.5;

const shellGeo = new THREE.SphereGeometry(SHELL_RADIUS, 8, 8);
const shellMat = new THREE.MeshStandardMaterial({
  color: 0xffc857,
  emissive: 0xaa5500,
  emissiveIntensity: 0.55,
  roughness: 0.4,
  metalness: 0.3,
});

/**
 * @typedef {{
 *   mesh: THREE.Mesh,
 *   velocity: THREE.Vector3,
 *   age: number,
 *   alive: boolean,
 *   owner: string,
 * }} Shell
 */

/** @returns {Shell} */
export function spawnShell(parent, origin, direction, owner = "player") {
  const mesh = new THREE.Mesh(shellGeo, shellMat);
  mesh.castShadow = true;
  mesh.position.copy(origin);
  parent.add(mesh);
  const velocity = direction.clone().normalize().multiplyScalar(SHELL_SPEED);
  return { mesh, velocity, age: 0, alive: true, owner };
}

export function stepShells(shells, dt) {
  for (const shell of shells) {
    if (!shell.alive) continue;
    shell.age += dt;
    if (shell.age > SHELL_LIFE) {
      killShell(shell);
      continue;
    }
    shell.velocity.y += GRAVITY * dt;
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
      if (dist <= target.hitRadius + SHELL_RADIUS) {
        hits.push({ targetId: target.id, shell });
        killShell(shell);
        break;
      }
    }
  }
  return hits;
}

export function spawnHitFlash(parent, position) {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xff9944, transparent: true, opacity: 0.9 }),
  );
  flash.position.copy(position);
  flash.position.y += 0.8;
  parent.add(flash);
  return { mesh: flash, age: 0 };
}

export function stepFlashes(flashes, dt) {
  for (let i = flashes.length - 1; i >= 0; i -= 1) {
    const f = flashes[i];
    f.age += dt;
    const t = f.age / 0.35;
    f.mesh.scale.setScalar(1 + t * 2.2);
    f.mesh.material.opacity = Math.max(0, 0.9 - t);
    if (f.age > 0.35) {
      f.mesh.removeFromParent();
      flashes.splice(i, 1);
    }
  }
}
