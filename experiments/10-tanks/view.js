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
 * Map heading drawn "up" on the radar.
 * Hull mode uses the tank nose. Headset mode uses the flat look direction,
 * converted out of scene space (camera yaw, world yaw) into map space.
 */
export function radarMapHeading(mode, hullYaw, cameraYaw, worldYaw) {
  if (mode !== "headset" || cameraYaw == null || !Number.isFinite(cameraYaw)) return hullYaw;
  return cameraYaw + Math.PI - worldYaw;
}
