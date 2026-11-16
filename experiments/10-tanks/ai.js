import * as THREE from "three";
import { heightAt, randomMapPoint, clampToMap } from "./terrain.js";

const HEADING_MIN = 12;
const HEADING_MAX = 28;
const TURN_MIN = Math.PI * 0.35;
const TURN_MAX = Math.PI * 1.1;

/**
 * @typedef {{
 *   id: string,
 *   tank: object,
 *   x: number,
 *   z: number,
 *   yaw: number,
 *   desiredYaw: number,
 *   turretYaw: number,
 *   turretTarget: number,
 *   barrelPitch: number,
 *   speed: number,
 *   alive: boolean,
 *   respawnAt: number,
 *   nextTurnAt: number,
 *   nextTurretAt: number,
 * }} Enemy
 */

function nextHeadingHold(now) {
  return now + HEADING_MIN + Math.random() * (HEADING_MAX - HEADING_MIN);
}

function randomTurnDelta() {
  const mag = TURN_MIN + Math.random() * (TURN_MAX - TURN_MIN);
  return Math.random() < 0.5 ? -mag : mag;
}

export function createEnemyState(id, tank, spawn, now = 0) {
  const yaw = spawn.yaw ?? Math.random() * Math.PI * 2;
  return {
    id,
    tank,
    x: spawn.x,
    z: spawn.z,
    yaw,
    desiredYaw: yaw,
    turretYaw: (Math.random() - 0.5) * 1.2,
    turretTarget: (Math.random() - 0.5) * 1.6,
    barrelPitch: -0.05,
    speed: tank.type.speed * (0.35 + Math.random() * 0.45),
    alive: true,
    respawnAt: 0,
    nextTurnAt: nextHeadingHold(now),
    nextTurretAt: now + 6 + Math.random() * 14,
  };
}

export function placeTankOnTerrain(state) {
  const y = heightAt(state.x, state.z);
  state.tank.root.position.set(state.x, y, state.z);
  state.tank.root.rotation.y = state.yaw;
  const ahead = 1.2;
  const fx = state.x + Math.sin(state.yaw) * ahead;
  const fz = state.z + Math.cos(state.yaw) * ahead;
  const hy = heightAt(fx, fz) - y;
  state.tank.root.rotation.x = THREE.MathUtils.clamp(-Math.atan2(hy, ahead), -0.25, 0.25);
  // Turret yaw is relative to the hull — independent traverse
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
      state.desiredYaw = state.yaw;
      state.turretYaw = (Math.random() - 0.5) * 1.2;
      state.turretTarget = (Math.random() - 0.5) * 1.6;
      state.speed = state.tank.type.speed * (0.35 + Math.random() * 0.45);
      state.alive = true;
      state.tank.root.visible = true;
      state.nextTurnAt = nextHeadingHold(now);
      state.nextTurretAt = now + 6 + Math.random() * 14;
    }
    return;
  }

  // Infrequent random heading changes — not every few seconds
  if (now >= state.nextTurnAt) {
    state.desiredYaw = state.yaw + randomTurnDelta();
    state.nextTurnAt = nextHeadingHold(now);
  }

  // Bounce away from map edge instead of stacking on the boundary
  const lim = 95;
  if (Math.abs(state.x) > lim || Math.abs(state.z) > lim) {
    state.desiredYaw = Math.atan2(-state.x, -state.z) + (Math.random() - 0.5) * 0.8;
    state.nextTurnAt = nextHeadingHold(now);
  }

  let dyaw = state.desiredYaw - state.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;

  const turn = state.tank.type.turn;
  state.yaw += THREE.MathUtils.clamp(dyaw, -turn * dt, turn * dt);

  const throttle = Math.abs(dyaw) < 0.9 ? 1 : 0.4;
  state.speed = THREE.MathUtils.damp(
    state.speed,
    throttle * state.tank.type.speed * (0.45 + (state.id.charCodeAt(state.id.length - 1) % 5) * 0.08),
    2.2,
    dt,
  );

  state.x += Math.sin(state.yaw) * state.speed * dt;
  state.z += Math.cos(state.yaw) * state.speed * dt;
  const clamped = clampToMap(state.x, state.z, 10);
  state.x = clamped.x;
  state.z = clamped.z;

  // Turret wanders on its own schedule, not locked to travel direction
  if (now >= state.nextTurretAt) {
    state.turretTarget = (Math.random() - 0.5) * 2.4;
    state.nextTurretAt = now + 8 + Math.random() * 16;
  }
  let turretErr = state.turretTarget - state.turretYaw;
  while (turretErr > Math.PI) turretErr -= Math.PI * 2;
  while (turretErr < -Math.PI) turretErr += Math.PI * 2;
  state.turretYaw += THREE.MathUtils.clamp(
    turretErr,
    -state.tank.type.turretTurn * 0.45 * dt,
    state.tank.type.turretTurn * 0.45 * dt,
  );

  placeTankOnTerrain(state);
}

export function killEnemy(state, now, respawnDelay = 4) {
  state.alive = false;
  state.respawnAt = now + respawnDelay;
  state.speed = 0;
  state.tank.root.visible = false;
}
