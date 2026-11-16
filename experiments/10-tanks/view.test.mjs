import assert from "node:assert/strict";
import { radarMapHeading, worldYawForView } from "./view.js";

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
