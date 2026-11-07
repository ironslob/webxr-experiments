export const SCORE_KEY = "webxr-experiments.slice-scores";
export const COMBO_WINDOW = 0.7;
export const TOP_N = 8;
export const MIN_SLICE_SPEED = 0.85;
export const MODES = ["fruit", "animals", "cosmos"];

export function segmentPointDistanceSq(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (abLenSq > 1e-8) {
    t = (apx * abx + apy * aby + apz * abz) / abLenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const dx = ax + abx * t - px;
  const dy = ay + aby * t - py;
  const dz = az + abz * t - pz;
  return dx * dx + dy * dy + dz * dz;
}

export function swingSegments(prevBase, prevTip, base, tip, steps = 4) {
  const segments = [
    {
      ax: base.x,
      ay: base.y,
      az: base.z,
      bx: tip.x,
      by: tip.y,
      bz: tip.z,
    },
  ];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    segments.push({
      ax: prevBase.x + (prevTip.x - prevBase.x) * t,
      ay: prevBase.y + (prevTip.y - prevBase.y) * t,
      az: prevBase.z + (prevTip.z - prevBase.z) * t,
      bx: base.x + (tip.x - base.x) * t,
      by: base.y + (tip.y - base.y) * t,
      bz: base.z + (tip.z - base.z) * t,
    });
  }

  return segments;
}

export function bladeHit(segments, center, radius) {
  const limit = radius * radius;
  const cleanLimit = radius * 0.42 * (radius * 0.42);
  let best = Infinity;

  for (const segment of segments) {
    const distSq = segmentPointDistanceSq(
      center.x,
      center.y,
      center.z,
      segment.ax,
      segment.ay,
      segment.az,
      segment.bx,
      segment.by,
      segment.bz,
    );
    if (distSq < best) best = distSq;
  }

  if (best > limit) return null;
  return { distance: Math.sqrt(best), clean: best <= cleanLimit };
}

export function pointsForSlice({ base, combo, clean, hazard }) {
  if (hazard) return -Math.abs(base);
  const safeCombo = Math.max(1, combo);
  const multiplier = clean ? 1.5 : 1;
  return Math.max(1, Math.round(Math.abs(base) * safeCombo * multiplier));
}

export function advanceCombo(combo, gapSeconds, hazard, windowSeconds = COMBO_WINDOW) {
  if (hazard) return 0;
  if (!combo || gapSeconds > windowSeconds) return 1;
  return combo + 1;
}

export function emptyTables() {
  return { fruit: [], animals: [], cosmos: [] };
}

export function compareScores(a, b) {
  return b.score - a.score || b.combo - a.combo || a.at - b.at;
}

export function normalizeTables(raw) {
  const tables = emptyTables();
  if (!raw || typeof raw !== "object") return tables;

  for (const mode of MODES) {
    const list = Array.isArray(raw[mode]) ? raw[mode] : [];
    tables[mode] = list
      .filter((entry) => entry && Number.isFinite(Number(entry.score)) && Number(entry.score) > 0)
      .map((entry) => ({
        score: Math.round(Number(entry.score)),
        combo: Math.max(0, Math.round(Number(entry.combo) || 0)),
        at: Number(entry.at) || 0,
      }))
      .sort(compareScores)
      .slice(0, TOP_N);
  }

  return tables;
}

export function insertScore(list, entry, limit = TOP_N) {
  if (!entry || !(Number(entry.score) > 0)) return list.slice(0, limit);
  return list
    .concat({
      score: Math.round(Number(entry.score)),
      combo: Math.max(0, Math.round(Number(entry.combo) || 0)),
      at: Number(entry.at) || 0,
    })
    .sort(compareScores)
    .slice(0, limit);
}

export function loadTables(storage, key = SCORE_KEY) {
  try {
    const raw = storage.getItem(key);
    return normalizeTables(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyTables();
  }
}

export function saveTables(storage, tables, key = SCORE_KEY) {
  storage.setItem(key, JSON.stringify(normalizeTables(tables)));
}

export function recordTableScore(tables, mode, entry) {
  const next = normalizeTables(tables);
  if (!MODES.includes(mode)) return next;
  next[mode] = insertScore(next[mode], entry);
  return next;
}

export function pickWeighted(items, random = Math.random) {
  let total = 0;
  for (const item of items) total += item.weight > 0 ? item.weight : 1;
  if (!items.length || total <= 0) return null;

  let roll = random() * total;
  for (const item of items) {
    roll -= item.weight > 0 ? item.weight : 1;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

export function chooseTarget(pieces, hazard, hazardChance, random = Math.random) {
  if (hazard && random() < hazardChance) return hazard;
  return pickWeighted(pieces, random);
}

export function formatClock(seconds) {
  const safe = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
