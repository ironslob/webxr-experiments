import assert from "node:assert/strict";
import {
  BLADE_EDGE,
  advanceCombo,
  bladeHit,
  bladeSection,
  canSliceAgain,
  chooseTarget,
  compareScores,
  emptyTables,
  formatClock,
  insertScore,
  loadTables,
  normalizeTables,
  pointsForSlice,
  recordTableScore,
  saveTables,
  segmentPointDistanceSq,
  swingSegments,
} from "./logic.js";

const centerGap = segmentPointDistanceSq(0, 1, 0, 0, 0, 0, 0, 0, 2);
assert.equal(centerGap, 1);

const onSegment = segmentPointDistanceSq(0, 0, 1, 0, 0, 0, 0, 0, 2);
assert.equal(onSegment, 0);

const prevBase = { x: 0, y: 0, z: 0.4 };
const prevTip = { x: 0, y: 0, z: 0 };
const base = { x: 0, y: 2, z: 0.4 };
const tip = { x: 0, y: 2, z: 0 };
const segments = swingSegments(prevBase, prevTip, base, tip);
const swept = bladeHit(segments, { x: 0, y: 1, z: 0 }, 0.15);
assert.ok(swept);
assert.equal(swept.clean, true);

const miss = bladeHit(segments, { x: 0, y: 1, z: 2 }, 0.1);
assert.equal(miss, null);

const edge = bladeHit(
  [{ ax: 0, ay: 0, az: 0, bx: 1, by: 0, bz: 0 }],
  { x: 0.2, y: 0.7, z: 0 },
  0.8,
);
assert.ok(edge);
assert.equal(edge.clean, false);

assert.equal(pointsForSlice({ base: 10, combo: 1, clean: false, hazard: false }), 10);
assert.equal(pointsForSlice({ base: 10, combo: 2, clean: true, hazard: false }), 30);
assert.equal(pointsForSlice({ base: 25, combo: 3, clean: false, hazard: false }), 75);
assert.equal(pointsForSlice({ base: 50, combo: 4, clean: true, hazard: true }), -50);
assert.equal(pointsForSlice({ base: 10, combo: 1, clean: false, hazard: false, cuts: 1 }), 5);
assert.equal(pointsForSlice({ base: 10, combo: 2, clean: true, hazard: false, cuts: 1 }), 15);
assert.equal(pointsForSlice({ base: 10, combo: 1, clean: false, hazard: false, cuts: 2 }), 3);
assert.equal(pointsForSlice({ base: 10, combo: 1, clean: false, hazard: true, cuts: 2 }), -10);

assert.equal(canSliceAgain(0), true);
assert.equal(canSliceAgain(2), true);
assert.equal(canSliceAgain(3), false);

function alongEdge(point) {
  return point[0] * BLADE_EDGE.x + point[1] * BLADE_EDGE.y;
}

function spineMid(section) {
  return [
    (section.spineA[0] + section.spineB[0]) / 2,
    (section.spineA[1] + section.spineB[1]) / 2,
    section.spineA[2],
  ];
}

for (const t of [0, 0.25, 0.5, 0.75, 1]) {
  const section = bladeSection(t, 0.68);
  const spine = spineMid(section);
  const past =
    (section.edge[0] - spine[0]) * BLADE_EDGE.x +
    (section.edge[1] - spine[1]) * BLADE_EDGE.y;
  assert.ok(past > 0, `edge stays on the cutting side at ${t}`);
  assert.ok(section.edge[1] < spine[1], `edge is below the spine at ${t}`);
  assert.ok(section.edge[0] < spine[0], `edge faces the palm at ${t}`);
}

const guard = bladeSection(0, 0.68);
const belly = bladeSection(0.5, 0.68);
const kissaki = bladeSection(1, 0.68);
assert.ok(alongEdge(spineMid(belly)) > alongEdge(spineMid(guard)) + 0.02);
assert.ok(alongEdge(spineMid(belly)) > alongEdge(spineMid(kissaki)) + 0.02);
assert.ok(Math.abs(guard.edge[2]) < 1e-9);
assert.ok(Math.abs(kissaki.edge[2] + 0.68) < 1e-9);

assert.equal(advanceCombo(0, 0.1, false), 1);
assert.equal(advanceCombo(1, 0.2, false), 2);
assert.equal(advanceCombo(4, 2, false), 1);
assert.equal(advanceCombo(4, 0.1, true), 0);

assert.deepEqual(formatClock(0), "0:00");
assert.deepEqual(formatClock(65), "1:05");
assert.deepEqual(formatClock(-3), "0:00");
assert.deepEqual(formatClock(59.2), "1:00");

const ranked = insertScore(
  [
    { score: 40, combo: 2, at: 1 },
    { score: 90, combo: 3, at: 2 },
  ],
  { score: 90, combo: 8, at: 3 },
);
assert.deepEqual(
  ranked.map((entry) => entry.combo),
  [8, 3, 2],
);

const capped = insertScore(
  Array.from({ length: 8 }, (_, index) => ({ score: 100 - index, combo: 1, at: index + 1 })),
  { score: 10, combo: 1, at: 50 },
);
assert.equal(capped.length, 8);
assert.equal(capped.some((entry) => entry.at === 50), false);
assert.equal(capped[0].score, 100);

const junk = normalizeTables({
  fruit: [{ score: "12", combo: "2", at: "5" }, { score: 0 }, null, { score: -4 }],
  animals: "nope",
  extra: [{ score: 99 }],
});
assert.equal(junk.fruit.length, 1);
assert.equal(junk.fruit[0].score, 12);
assert.deepEqual(junk.animals, []);
assert.equal(junk.cosmos.length, 0);
assert.equal("extra" in junk, false);

const memory = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
};
const storage = memory();
assert.deepEqual(loadTables(storage), emptyTables());
const saved = recordTableScore(emptyTables(), "animals", { score: 80, combo: 4, at: 9 });
saveTables(storage, saved);
assert.equal(loadTables(storage).animals[0].score, 80);
assert.equal(recordTableScore(saved, "nope", { score: 5, combo: 1, at: 1 }).fruit.length, 0);

const bomb = { id: "bomb", hazard: true };
const apple = { id: "apple", weight: 1 };
const melon = { id: "melon", weight: 1 };
assert.equal(chooseTarget([apple, melon], bomb, 0.5, () => 0.1), bomb);

let call = 0;
const picked = chooseTarget([apple, melon], bomb, 0.2, () => {
  call += 1;
  return call === 1 ? 0.9 : 0;
});
assert.equal(picked, apple);
assert.equal(compareScores({ score: 5, combo: 1, at: 2 }, { score: 5, combo: 1, at: 1 }), 1);

console.log("slice logic ok");
