import * as THREE from "three";
import { heightAt, randomMapPoint, clampToMap } from "./terrain.js";

/**
 * @typedef {{
 *   id: string,
 *   tank: object,
 *   x: number,
 *   z: number,
 *   yaw: number,
 *   turretYaw: number,
 *   barrelPitch: number,
 *   speed: number,
 *   alive: boolean,
 *   respawnAt: number,
 *   waypoint: { x: number, z: number },
 * }} Enemy
 */

export function createEnemyState(id, tank, spawn) {
  return {
    id,
    tank,
    x: spawn.x,
    z: spawn.z,
    yaw: spawn.yaw ?? Math.random() * Math.PI * 2,
    turretYaw: 0,
    barrelPitch: 0,
    speed: 0,
    alive: true,
    respawnAt: 0,
    waypoint: randomMapPoint(20, 95),
  };
}

export function placeTankOnTerrain(state) {
  const y = heightAt(state.x, state.z);
  state.tank.root.position.set(state.x, y, state.z);
  state.tank.root.rotation.y = state.yaw;
  // Mild pitch from terrain slope (forward sample)
  const ahead = 1.2;
  const fx = state.x + Math.sin(state.yaw) * ahead;
  const fz = state.z + Math.cos(state.yaw) * ahead;
  const hy = heightAt(fx, fz) - y;
  state.tank.root.rotation.x = THREE.MathUtils.clamp(-Math.atan2(hy, ahead), -0.25, 0.25);
  state.tank.turret.rotation.y = state.turretYaw;
  state.tank.barrelPivot.rotation.x = state.barrelPitch;
}

export function stepEnemy(state, dt, now) {
  if (!state.alive) {
    if (now >= state.respawnAt) {
      const p = randomMapPoint(25, 100);
      state.x = p.x;
      state.z = p.z;
      state.yaw = Math.random() * Math.PI * 2;
      state.alive = true;
      state.tank.root.visible = true;
      state.waypoint = randomMapPoint(20, 95);
    }
    return;
  }

  const dx = state.waypoint.x - state.x;
  const dz = state.waypoint.z - state.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 4) {
    state.waypoint = randomMapPoint(20, 95);
    return;
  }

  const desiredYaw = Math.atan2(dx, dz);
  let dyaw = desiredYaw - state.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;

  const turn = state.tank.type.turn;
  state.yaw += THREE.MathUtils.clamp(dyaw, -turn * dt, turn * dt);

  const throttle = Math.cos(dyaw) > 0.2 ? 1 : 0.25;
  state.speed = THREE.MathUtils.damp(
    state.speed,
    throttle * state.tank.type.speed * 0.7,
    3.5,
    dt,
  );

  state.x += Math.sin(state.yaw) * state.speed * dt;
  state.z += Math.cos(state.yaw) * state.speed * dt;
  const clamped = clampToMap(state.x, state.z, 10);
  state.x = clamped.x;
  state.z = clamped.z;

  // Turret loosely faces travel direction
  let turretErr = -state.turretYaw;
  while (turretErr > Math.PI) turretErr -= Math.PI * 2;
  while (turretErr < -Math.PI) turretErr += Math.PI * 2;
  state.turretYaw += THREE.MathUtils.clamp(
    turretErr,
    -state.tank.type.turretTurn * dt,
    state.tank.type.turretTurn * dt,
  );

  placeTankOnTerrain(state);
}

export function killEnemy(state, now, respawnDelay = 4) {
  state.alive = false;
  state.respawnAt = now + respawnDelay;
  state.speed = 0;
  state.tank.root.visible = false;
}
