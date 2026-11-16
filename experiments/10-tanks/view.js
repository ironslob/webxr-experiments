/**
 * Yaw that keeps the hull's nose pointing the same way in the room
 * while the hull steers. `viewAnchor` is the headset yaw captured when
 * the view opened (Three.js camera yaw: 0 looks down -Z). Hull yaw 0
 * faces +Z, so the nose matches a camera yaw of `hullYaw - π`.
 */
export function worldYawForView(viewAnchor, hullYaw) {
  return viewAnchor + Math.PI - hullYaw;
}

/**
 * World-group position that puts `seat` (a point in the group's local space)
 * on `head` after a yaw about Y. Three.js rotation.y is a right-handed yaw:
 * x' = x cos θ + z sin θ, z' = -x sin θ + z cos θ.
 *
 * The XR camera is not moved. The headset pose stays the viewpoint, and the
 * group turns around the head.
 */
export function placeWorldOnHead(worldYaw, seat, head) {
  const cos = Math.cos(worldYaw);
  const sin = Math.sin(worldYaw);
  const rx = cos * seat.x + sin * seat.z;
  const rz = -sin * seat.x + cos * seat.z;
  return {
    yaw: worldYaw,
    x: head.x - rx,
    y: head.y - seat.y,
    z: head.z - rz,
  };
}

/**
 * Map heading drawn "up" on the radar.
 * Hull mode uses the tank nose. Headset mode uses the flat look direction,
 * converted out of scene space (camera yaw, world yaw) into map space.
 */
export function radarMapHeading(mode, hullYaw, cameraYaw, worldYaw) {
  if (mode !== "headset" || cameraYaw == null || !Number.isFinite(cameraYaw)) return hullYaw;
  return cameraYaw + Math.PI - worldYaw;
}
