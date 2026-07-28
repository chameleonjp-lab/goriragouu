export const BASE_GAME_SECONDS = 60;
export const BONUS_SECONDS_PER_TEN_BANANAS = 5;
export const BOOST_SECONDS_PER_BANANA = 2;
export const SCORE_PER_SECOND = 100;
export const SCORE_PER_BANANA = 100;

// The planet radius is shared by rendering and pure rule calculations. Keeping
// one value prevents "one quarter of the map" and surface collision distances
// from silently drifting away from the sphere the player actually runs on.
export const PLANET_RADIUS = 30;

// Player movement, mirrored 1:1 into game.js (which imports these rather than
// redefining them) so the balance invariant below has a single source of
// truth: unboosted PLAYER_SPEED is what late-game gorillas must exceed, and
// PLAYER_SPEED * BOOST_MULTIPLIER (~7.9) is the hard ceiling gorilla speed
// must always stay comfortably under.
export const PLAYER_SPEED = 5.2;
export const BOOST_MULTIPLIER = 1.52;

// Terrain props now affect play instead of being visual-only. Rocks cut
// movement to 75% while the player overlaps them; trees are solid. The model
// radii match the geometry created in game.js and PLAYER_COLLISION_RADIUS
// accounts for the avatar's roughly 0.86-unit-wide body.
export const PLAYER_COLLISION_RADIUS = 0.63;
export const TREE_TRUNK_MODEL_RADIUS = 0.22;
export const TREE_COLLISION_MODEL_RADIUS = 0.68;
export const ROCK_MODEL_RADIUS = 0.52;
export const ROCK_SLOW_MULTIPLIER = 0.75;

export function getTreeCollisionDistance(size) {
  const safeSize = Number.isFinite(size) ? Math.max(0, size) : 0;
  return PLAYER_COLLISION_RADIUS + TREE_COLLISION_MODEL_RADIUS * safeSize;
}

export function getRockContactDistance(size) {
  const safeSize = Number.isFinite(size) ? Math.max(0, size) : 0;
  return PLAYER_COLLISION_RADIUS + ROCK_MODEL_RADIUS * safeSize;
}

export function getSurfaceContactDot(
  surfaceDistance,
  planetRadius = PLANET_RADIUS,
) {
  const safeDistance = Number.isFinite(surfaceDistance)
    ? Math.max(0, surfaceDistance)
    : 0;
  const safeRadius =
    Number.isFinite(planetRadius) && planetRadius > 0
      ? planetRadius
      : PLANET_RADIUS;
  return Math.cos(Math.min(Math.PI, safeDistance / safeRadius));
}

export function shouldBlockSurfaceObstacle(
  currentDot,
  candidateDot,
  contactDot,
) {
  if (
    !Number.isFinite(currentDot) ||
    !Number.isFinite(candidateDot) ||
    !Number.isFinite(contactDot) ||
    candidateDot < contactDot
  ) {
    return false;
  }
  // Entry from outside, movement farther inward, and exact sideways contact
  // are blocked. Any strictly outward step remains available, even when it is
  // extremely small, so a mover can always escape an overlapping spawn.
  return currentDot < contactDot || candidateDot >= currentDot;
}

export function getObstacleSlideScale(inwardAlignment) {
  if (!Number.isFinite(inwardAlignment)) return 0;
  if (inwardAlignment >= 0) return 1;
  const clamped = Math.max(-1, inwardAlignment);
  return Math.sqrt(Math.max(0, 1 - clamped * clamped));
}

export function getRockSpeedMultiplier(isTouchingRock) {
  return isTouchingRock ? ROCK_SLOW_MULTIPLIER : 1;
}

export function isRockTopReachable(
  groundRadius,
  size,
  heightScale,
  playerSurfaceRadius,
) {
  if (
    !Number.isFinite(groundRadius) ||
    !Number.isFinite(size) ||
    !Number.isFinite(heightScale) ||
    !Number.isFinite(playerSurfaceRadius) ||
    size <= 0 ||
    heightScale <= 0
  ) {
    return false;
  }
  const centerRadius = groundRadius + size * 0.2;
  const topRadius = centerRadius + ROCK_MODEL_RADIUS * size * heightScale;
  return topRadius >= playerSurfaceRadius;
}

export function trySurfacePlacement(maxAttempts, placeCandidate, isBlocked) {
  const attempts = Number.isFinite(maxAttempts)
    ? Math.max(0, Math.floor(maxAttempts))
    : 0;
  if (
    attempts === 0 ||
    typeof placeCandidate !== "function" ||
    typeof isBlocked !== "function"
  ) {
    return false;
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    placeCandidate(attempt);
    if (!isBlocked(attempt)) return true;
  }
  return false;
}

// Holding approximately one great-circle heading for one quarter of the
// planet circumference activates one extra storm in front of the player.
// Normal stage counts and `nextStormAt` cadence remain independent.
export const STRAIGHT_RUN_TRIGGER_DISTANCE = (Math.PI * PLANET_RADIUS) / 2;
export const STRAIGHT_RUN_MAX_HEADING_DELTA = Math.PI / 8;
export const STRAIGHT_RUN_IDLE_RESET_SECONDS = 0.45;
export const STRAIGHT_STORM_DISTANCE_MIN = 18;
export const STRAIGHT_STORM_DISTANCE_MAX = 20;
export const STRAIGHT_STORM_LEAD_DISTANCE = 10;
export const STRAIGHT_STORM_BEARING_JITTER = 0.08;
export const STRAIGHT_STORM_GORILLA_RADIUS_MAX = 2.45;
export const STRAIGHT_STORM_DANGER_DELAY_SECONDS = 0.38;
export const STRAIGHT_STORM_CONTACT_DISTANCE = 1.12;
export const STRAIGHT_STORM_SAFETY_MARGIN = 0.5;
export const STORM_FALL_SECONDS = 1.25;
export const STORM_SPAWN_DISTANCE_MIN = 9.5;
export const STORM_SPAWN_DISTANCE_MAX = 13.5;
export const STRAIGHT_STORM_MIN_REGULAR_CLEARANCE = 6;
export const STRAIGHT_STORM_AVOIDANCE_DISTANCE_MAX = 28;

export function getStormLifecycle(ageSeconds, rainAlreadyStarted) {
  const age = Number.isFinite(ageSeconds) ? Math.max(0, ageSeconds) : 0;
  return {
    startRain: !rainAlreadyStarted,
    impact: age >= STORM_FALL_SECONDS,
  };
}

export function getStraightStormDistance(playerSpeed, fallSeconds) {
  const safeSpeed = Number.isFinite(playerSpeed) ? Math.max(0, playerSpeed) : 0;
  const safeFall = Number.isFinite(fallSeconds) ? Math.max(0, fallSeconds) : 0;
  // A banana or rock boundary can change speed after the storm is selected.
  // Always plan for the game's maximum possible player speed so that fixed
  // seeds and momentary surface effects cannot turn this into an unavoidable
  // spawn. The cluster still lands directly in the held route, forcing a turn.
  const planningSpeed = Math.max(
    safeSpeed,
    PLAYER_SPEED * BOOST_MULTIPLIER,
  );
  return Math.min(
    STRAIGHT_STORM_DISTANCE_MAX,
    Math.max(
      STRAIGHT_STORM_DISTANCE_MIN,
      planningSpeed * safeFall + STRAIGHT_STORM_LEAD_DISTANCE,
    ),
  );
}

export function advanceStraightRun(
  currentDistance,
  stepDistance,
  headingAlignment,
  triggerDistance = STRAIGHT_RUN_TRIGGER_DISTANCE,
  maxHeadingDelta = STRAIGHT_RUN_MAX_HEADING_DELTA,
) {
  const safeCurrent = Number.isFinite(currentDistance)
    ? Math.max(0, currentDistance)
    : 0;
  const safeStep = Number.isFinite(stepDistance) ? Math.max(0, stepDistance) : 0;
  const safeTrigger =
    Number.isFinite(triggerDistance) && triggerDistance > 0
      ? triggerDistance
      : STRAIGHT_RUN_TRIGGER_DISTANCE;
  const safeTurn =
    Number.isFinite(maxHeadingDelta) && maxHeadingDelta >= 0
      ? Math.min(Math.PI, maxHeadingDelta)
      : STRAIGHT_RUN_MAX_HEADING_DELTA;
  const aligned =
    Number.isFinite(headingAlignment) &&
    headingAlignment >= Math.cos(safeTurn);
  const total = (aligned ? safeCurrent : 0) + safeStep;
  const triggered = total >= safeTrigger;

  return {
    aligned,
    triggered,
    distance: triggered ? total % safeTrigger : total,
  };
}

export function advanceStraightRunIdle(
  currentDistance,
  currentIdleSeconds,
  stepSeconds,
) {
  const distance = Number.isFinite(currentDistance)
    ? Math.max(0, currentDistance)
    : 0;
  const idleSeconds =
    (Number.isFinite(currentIdleSeconds)
      ? Math.max(0, currentIdleSeconds)
      : 0) +
    (Number.isFinite(stepSeconds) ? Math.max(0, stepSeconds) : 0);
  const reset =
    distance > 0 && idleSeconds >= STRAIGHT_RUN_IDLE_RESET_SECONDS;
  return {
    reset,
    distance: reset ? 0 : distance,
    idleSeconds: reset ? 0 : idleSeconds,
  };
}

// Falling gorillas share one readable low-poly silhouette in both the real
// storm and the planet-scale ambient rain. Keeping the layout as plain data
// lets tests protect the recognisable head/muzzle/long-arm/leg outline without
// needing a WebGL context.
export const FALLING_GORILLA_PARTS = Object.freeze(
  [
    {
      name: "torso",
      tone: "brown",
      x: 0,
      y: 0.04,
      z: 0.04,
      rx: 0,
      ry: 0,
      rz: 0,
      sx: 0.88,
      sy: 0.9,
      sz: 0.64,
    },
    {
      name: "head",
      tone: "brown",
      x: 0,
      y: 0.78,
      z: -0.06,
      rx: 0,
      ry: 0,
      rz: 0,
      sx: 0.62,
      sy: 0.56,
      sz: 0.58,
    },
    {
      name: "muzzle",
      tone: "tan",
      x: 0,
      y: 0.67,
      z: -0.38,
      rx: 0,
      ry: 0,
      rz: 0,
      sx: 0.42,
      sy: 0.25,
      sz: 0.2,
    },
    {
      name: "chest",
      tone: "tan",
      x: 0,
      y: 0.08,
      z: -0.34,
      rx: 0,
      ry: 0,
      rz: 0,
      sx: 0.56,
      sy: 0.52,
      sz: 0.12,
    },
    {
      name: "left-arm",
      tone: "brown",
      x: -0.7,
      y: -0.03,
      z: 0,
      rx: 0.05,
      ry: 0,
      rz: 0.28,
      sx: 0.34,
      sy: 1.08,
      sz: 0.4,
    },
    {
      name: "right-arm",
      tone: "brown",
      x: 0.7,
      y: -0.03,
      z: 0,
      rx: -0.05,
      ry: 0,
      rz: -0.28,
      sx: 0.34,
      sy: 1.08,
      sz: 0.4,
    },
    {
      name: "left-leg",
      tone: "brown",
      x: -0.32,
      y: -0.69,
      z: 0.08,
      rx: 0.12,
      ry: 0,
      rz: -0.08,
      sx: 0.38,
      sy: 0.7,
      sz: 0.46,
    },
    {
      name: "right-leg",
      tone: "brown",
      x: 0.32,
      y: -0.69,
      z: 0.08,
      rx: -0.12,
      ry: 0,
      rz: 0.08,
      sx: 0.38,
      sy: 0.7,
      sz: 0.46,
    },
  ].map((part) => Object.freeze(part)),
);

export const FALLING_GORILLA_MAX_REACH = Math.max(
  ...FALLING_GORILLA_PARTS.map(
    (part) =>
      Math.hypot(part.x, part.y, part.z) +
      Math.hypot(part.sx, part.sy, part.sz) / 2,
  ),
);

// Ambient fallers recycle before their conservative bounding sphere can
// touch the planet. The explicit values are exported so that geometry edits
// cannot silently reintroduce the old "gorilla stuck on the surface" look.
export const ORBITAL_FALLER_HEIGHT_MIN = 10;
export const ORBITAL_FALLER_HEIGHT_MAX = 15;
export const ORBITAL_FALLER_LOW = 7.5;
export const ORBITAL_FALLER_SCALE_MIN = 3.2;
export const ORBITAL_FALLER_SCALE_MAX = 4;

export const STAGES = Object.freeze([
  Object.freeze({
    index: 0,
    startsAt: 0,
    stormLocations: 1,
    bananaTarget: 2,
    label: "1地点",
  }),
  Object.freeze({
    index: 1,
    startsAt: 30,
    stormLocations: 2,
    bananaTarget: 3,
    label: "2地点",
  }),
  Object.freeze({
    index: 2,
    startsAt: 50,
    stormLocations: 3,
    bananaTarget: 4,
    label: "3地点",
  }),
]);

export function getStage(elapsedSeconds) {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    return STAGES[0];
  }
  if (elapsedSeconds >= STAGES[2].startsAt) return STAGES[2];
  if (elapsedSeconds >= STAGES[1].startsAt) return STAGES[1];
  return STAGES[0];
}

export function getBonusMilestones(bananaCount) {
  if (!Number.isFinite(bananaCount) || bananaCount <= 0) return 0;
  return Math.floor(bananaCount / 10);
}

export function getBonusSeconds(bananaCount) {
  return getBonusMilestones(bananaCount) * BONUS_SECONDS_PER_TEN_BANANAS;
}

export function getRemainingSeconds(elapsedSeconds, bananaCount) {
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  return Math.max(0, BASE_GAME_SECONDS + getBonusSeconds(bananaCount) - elapsed);
}

export const FIXED_STEP_SECONDS = 1 / 60;
export const PLAYABLE_FRAME_DELTA_MAX = 0.5;
export const MAX_FIXED_STEPS_PER_FRAME = Math.ceil(
  PLAYABLE_FRAME_DELTA_MAX / FIXED_STEP_SECONDS,
);

export function getPlayableFrameDelta(measuredSeconds) {
  if (!Number.isFinite(measuredSeconds) || measuredSeconds <= 0) return 0;
  if (measuredSeconds > PLAYABLE_FRAME_DELTA_MAX) return 0;
  return measuredSeconds;
}

export function extendBoost(boostUntil, elapsedSeconds) {
  const safeUntil = Number.isFinite(boostUntil) ? boostUntil : 0;
  const safeElapsed = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
  return Math.max(safeUntil, safeElapsed) + BOOST_SECONDS_PER_BANANA;
}

export function calculateScore(elapsedSeconds, bananaCount) {
  const safeElapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const safeBananas = Number.isFinite(bananaCount) ? Math.max(0, Math.floor(bananaCount)) : 0;
  return Math.floor(safeElapsed * SCORE_PER_SECOND) + safeBananas * SCORE_PER_BANANA;
}

export function formatScore(score) {
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
  return String(safeScore).padStart(6, "0");
}

export function bananasUntilBonus(bananaCount) {
  const safeCount = Number.isFinite(bananaCount) ? Math.max(0, Math.floor(bananaCount)) : 0;
  const remainder = safeCount % 10;
  return remainder === 0 ? 10 : 10 - remainder;
}

// Minimum angular clearance (radians) storms must keep from the player's
// current heading. This used to be wide enough (~0.7 rad / 40°) that a
// storm could never appear anywhere near the forward cone at all, which
// made holding a straight heading a permanent safe lane -- nothing could
// ever spawn in front of a player who simply kept running forward. That is
// too strong a guarantee. Scheduled storms still retain a small ~0.3 rad
// (~17°) clearance because they now begin falling without a ground marker.
// The separate one-quarter-map countermeasure deliberately ignores this
// clearance and appears in front after sustained straight travel.
export const STORM_MIN_CLEARANCE = 0.3;
// Small per-storm randomness applied after spreading storms across the
// clear arc, so placement stays varied without ever violating clearance.
export const STORM_ANGLE_JITTER = 0.12;

// Pure helper: returns `count` angles (radians), each measured from the
// player's heading (0 = straight ahead, +/-PI = directly behind), spread
// across the arc that respects `minClearance` on both sides of the heading.
// `random` must expose `.range(min, max)` (e.g. the game's SeededRandom),
// which keeps this reproducible under a fixed seed.
export function pickStormAngles(count, random, minClearance = STORM_MIN_CLEARANCE) {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (safeCount <= 0 || !random || typeof random.range !== "function") return [];

  const clearance = Number.isFinite(minClearance) ? Math.max(0, minClearance) : 0;
  const usableSpan = Math.max(0.001, Math.PI * 2 - clearance * 2);
  const baseOffset = random.range(0, usableSpan);
  const angles = [];

  for (let index = 0; index < safeCount; index += 1) {
    const spread = safeCount > 1 ? (index / safeCount) * usableSpan : usableSpan / 2;
    const jitter = random.range(-STORM_ANGLE_JITTER, STORM_ANGLE_JITTER);
    let angle = clearance + ((baseOffset + spread + jitter) % usableSpan + usableSpan) % usableSpan;
    // Re-clamp after jitter: the modulo keeps angle inside [clearance, clearance
    // + usableSpan] = [clearance, 2*PI - clearance], but jitter right at either
    // edge could nudge it a hair outside that inclusive range.
    angle = Math.min(Math.max(angle, clearance), Math.PI * 2 - clearance);
    angles.push(angle);
  }

  return angles;
}

// Bananas spawn in an annulus of surface distance from the player: near
// enough that a detour is worthwhile, far enough that it costs something.
// Distances are along the sphere's surface (same units as PLANET_RADIUS).
// A banana already placed stays where it is until collected (or "leashed"
// back into the band -- see BananaField in game.js), so this band also
// controls how tight that leash is: tighter means more frequent, closer
// re-rolls, which matters a lot given the tiny contact radius below.
export const BANANA_MIN_SURFACE_DISTANCE = 9;
export const BANANA_MAX_SURFACE_DISTANCE = 20;

// How long a collected banana's slot stays empty before a replacement is
// placed. Combined with the small number of simultaneous slots (see
// STAGES.bananaTarget above), this is what keeps collection an occasional,
// deliberate detour instead of a passive side-effect of just running
// forward -- the previous short delay (0.55s) let a couple of slots
// conveyor-belt bananas past the player continuously.
export const BANANA_RESPAWN_DELAY_SECONDS = 3.4;

// Pure helper: returns a single random surface distance inside the band.
// `random` must expose `.range(min, max)`, matching pickStormAngles above.
export function getBananaSpawnDistance(
  random,
  minDistance = BANANA_MIN_SURFACE_DISTANCE,
  maxDistance = BANANA_MAX_SURFACE_DISTANCE,
) {
  const safeMin = Number.isFinite(minDistance) ? Math.max(0, minDistance) : 0;
  const safeMax =
    Number.isFinite(maxDistance) && maxDistance > safeMin ? maxDistance : safeMin + 1;
  if (!random || typeof random.range !== "function") return safeMin;
  return random.range(safeMin, safeMax);
}

// A banana's contact radius is tiny next to the band above, so a bearing
// drawn from the full circle almost never lines up with the player's
// actual path. Bearing is instead drawn from a cone around the player's
// current heading (0 = straight ahead) -- wide enough that reaching a
// banana still takes a genuine, if modest, course correction, narrow
// enough that a player who keeps roughly moving forward will cross paths
// with several over the run.
export const BANANA_BEARING_HALF_WIDTH = 0.55;

export function pickBananaBearing(random, halfWidth = BANANA_BEARING_HALF_WIDTH) {
  if (!random || typeof random.range !== "function") return 0;
  const safeHalfWidth = Number.isFinite(halfWidth)
    ? Math.max(0, Math.min(Math.PI, halfWidth))
    : Math.PI;
  return random.range(-safeHalfWidth, safeHalfWidth);
}

// Storm waves tighten as the run goes on so removing the two spawn-fairness
// defects (fair placement + readable telegraph) doesn't leave the late game
// toothless. Interval shrinks linearly from `baseInterval` down to
// `baseInterval * STORM_INTERVAL_MIN_FACTOR` by `STORM_INTERVAL_RAMP_SECONDS`
// elapsed, then holds there.
export const STORM_INTERVAL_MIN_FACTOR = 0.42;
export const STORM_INTERVAL_RAMP_SECONDS = 42;

export function getStormInterval(elapsedSeconds, baseInterval) {
  const safeBase = Number.isFinite(baseInterval) && baseInterval > 0 ? baseInterval : 1;
  const safeElapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const progress = Math.min(1, safeElapsed / STORM_INTERVAL_RAMP_SECONDS);
  const factor = 1 - progress * (1 - STORM_INTERVAL_MIN_FACTOR);
  return safeBase * factor;
}

// Gorillas home in on the player rather than charging a fixed heading. Early
// on they stay under PLAYER_SPEED so the opening is forgiving and readable
// even with no boost banked yet. As the run goes on the range ramps past
// PLAYER_SPEED (5.2) -- late-game gorillas are genuinely faster than an
// unboosted player, so standing still on "just keep running" loses ground
// and boost stops being optional. The late ceiling is kept comfortably
// below the boosted speed (PLAYER_SPEED * BOOST_MULTIPLIER =~ 7.9, see
// above) so a player who banks and uses boost always escapes with margin.
// This is the core rebalance: reaction time + resource management replace
// "the enemy can never be fast enough to catch you" as the fairness basis.
export const GORILLA_SPEED_MIN_EARLY = 4.5;
export const GORILLA_SPEED_MAX_EARLY = 4.92;
export const GORILLA_SPEED_MIN_LATE = 5.6;
export const GORILLA_SPEED_MAX_LATE = 6.55;
export const GORILLA_SPEED_RAMP_SECONDS = 52;

export function getGorillaSpeedRange(elapsedSeconds) {
  const safeElapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const progress = Math.min(1, safeElapsed / GORILLA_SPEED_RAMP_SECONDS);
  return {
    min: GORILLA_SPEED_MIN_EARLY + (GORILLA_SPEED_MIN_LATE - GORILLA_SPEED_MIN_EARLY) * progress,
    max: GORILLA_SPEED_MAX_EARLY + (GORILLA_SPEED_MAX_LATE - GORILLA_SPEED_MAX_EARLY) * progress,
  };
}

export function getDeviceProfile(isMobile) {
  if (isMobile) {
    return Object.freeze({
      id: "sp-standard",
      label: "SP標準",
      gorillasPerStorm: 5,
      // At the shortest interval, three final-stage waves can still be inside
      // their five-second chase window: 3 waves * 3 locations * 5 gorillas.
      regularMaxGorillas: 45,
      // One additional storm can be created by the straight-run countermeasure.
      // Reserve one full swarm so it does not silently lose gorillas when a
      // normal late-game wave is still chasing the player.
      maxGorillas: 50,
      stormInterval: 5.8,
      rainDropsPerStorm: 420,
      maxPixelRatio: 1.35,
      treeCount: 72,
      rockCount: 56,
      realShadows: false,
      // Planet-scale ambient weather (cloud shell + inward-falling gorilla
      // silhouettes) rendered around the whole globe. Kept lower on mobile
      // since it is always-on decoration, never gameplay. Faller count is
      // deliberately modest -- a handful of large, legible falling bodies
      // reads better than a crowd of small ones.
      ambientCloudCount: 12,
      ambientFallerCount: 14,
    });
  }

  return Object.freeze({
    id: "pc-crowd",
    label: "PC多群",
    gorillasPerStorm: 7,
    regularMaxGorillas: 63,
    maxGorillas: 70,
    stormInterval: 5.2,
    rainDropsPerStorm: 760,
    maxPixelRatio: 1.6,
    treeCount: 120,
    rockCount: 85,
    realShadows: true,
    ambientCloudCount: 24,
    ambientFallerCount: 10,
  });
}
