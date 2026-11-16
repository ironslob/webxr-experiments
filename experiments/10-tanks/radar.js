import * as THREE from "three";
import { MAP_SIZE } from "./terrain.js";

const SIZE = 256;

export function createRadar() {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  mesh.renderOrder = 999;
  mesh.position.set(0.22, -0.16, -0.45);
  mesh.frustumCulled = false;

  return { mesh, canvas, ctx, texture };
}

/**
 * @param {ReturnType<typeof createRadar>} radar
 * @param {{ x: number, z: number, yaw: number }} player
 * @param {Array<{ x: number, z: number, alive: boolean }>} enemies
 */
export function drawRadar(radar, player, enemies) {
  const { ctx, texture } = radar;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const scale = (SIZE * 0.42) / (MAP_SIZE * 0.5);

  ctx.clearRect(0, 0, SIZE, SIZE);

  ctx.fillStyle = "rgba(10, 18, 10, 0.72)";
  ctx.beginPath();
  ctx.arc(cx, cy, SIZE * 0.46, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(214, 255, 74, 0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, SIZE * 0.46, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(147, 160, 139, 0.25)";
  ctx.lineWidth = 1;
  for (const r of [0.15, 0.3, 0.45]) {
    ctx.beginPath();
    ctx.arc(cx, cy, SIZE * r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Player heading-up: rotate world so player yaw points up
  const cos = Math.cos(-player.yaw);
  const sin = Math.sin(-player.yaw);

  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = e.x - player.x;
    const dz = e.z - player.z;
    const rx = dx * cos - dz * sin;
    const rz = dx * sin + dz * cos;
    const px = cx + rx * scale;
    const py = cy - rz * scale;
    if (Math.hypot(px - cx, py - cy) > SIZE * 0.44) continue;
    ctx.fillStyle = "#ff5d73";
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player wedge
  ctx.fillStyle = "#d6ff4a";
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx - 5, cy + 5);
  ctx.lineTo(cx + 5, cy + 5);
  ctx.closePath();
  ctx.fill();

  texture.needsUpdate = true;
}
