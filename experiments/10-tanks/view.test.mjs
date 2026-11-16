import assert from "node:assert/strict";
import { placeWorldOnHead, radarMapHeading, worldYawForView } from "./view.js";

function scenePoint(placed, seat) {
  const cos = Math.cos(placed.yaw);
  const sin = Math.sin(placed.yaw);
  return {
    x: placed.x + cos * seat.x + sin * seat.z,
    y: placed.y + seat.y,
    z: placed.z - sin * seat.x + cos * seat.z,
  };
}

// Camera yaw 0 looks down -Z, which is hull yaw π. The world stays unrotated.
assert.equal(worldYawForView(0, Math.PI), 0);

// Steering the hull +0.4 rad yaws the world the other way, so the nose stays put.
const steered = worldYawForView(0, Math.PI + 0.4);
assert.ok(Math.abs(steered + 0.4) < 1e-10);

// Head still on the anchor after that steer: headset radar matches the hull,
// because the view turned with the tank.
const withHull = radarMapHeading("headset", Math.PI + 0.4, 0, steered);
assert.ok(Math.abs(withHull - (Math.PI + 0.4)) < 1e-10);

// Looking 0.5 rad right of the anchor puts that direction at the top of the radar.
const look = radarMapHeading("headset", Math.PI, 0.5, worldYawForView(0, Math.PI));
assert.ok(Math.abs(look - (Math.PI + 0.5)) < 1e-10);

// Hull mode ignores where the headset is pointing.
assert.equal(radarMapHeading("hull", 1.2, 0.4, -0.3), 1.2);
assert.equal(radarMapHeading("headset", 1.2, null, 0), 1.2);

// The seat stays on the captured head for the spawn yaw and after a steer.
// A later head position is not part of the placement, so a lean does not drag the tank.
const head = { x: 0.25, y: 1.65, z: -0.4 };
const seat = { x: 0.1, y: 2.7, z: -0.35 };
for (const hullYaw of [Math.PI, Math.PI + 0.8, Math.PI - 1.3]) {
  const placed = placeWorldOnHead(worldYawForView(0.35, hullYaw), seat, head);
  const at = scenePoint(placed, seat);
  assert.ok(Math.abs(at.x - head.x) < 1e-10);
  assert.ok(Math.abs(at.y - head.y) < 1e-10);
  assert.ok(Math.abs(at.z - head.z) < 1e-10);
}
