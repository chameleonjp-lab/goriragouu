import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BANANA_BEARING_HALF_WIDTH,
  BANANA_MAX_SURFACE_DISTANCE,
  BANANA_MIN_SURFACE_DISTANCE,
  BASE_GAME_SECONDS,
  BOOST_MULTIPLIER,
  FALLING_GORILLA_MAX_REACH,
  FALLING_GORILLA_PARTS,
  FIXED_STEP_SECONDS,
  GORILLA_SPEED_MAX_EARLY,
  GORILLA_SPEED_MAX_LATE,
  MAX_FIXED_STEPS_PER_FRAME,
  ORBITAL_FALLER_HEIGHT_MIN,
  ORBITAL_FALLER_LOW,
  ORBITAL_FALLER_SCALE_MAX,
  PLANET_RADIUS,
  PLAYER_COLLISION_RADIUS,
  PLAYER_SPEED,
  ROCK_MODEL_RADIUS,
  ROCK_SLOW_MULTIPLIER,
  SCORE_PER_BANANA,
  STORM_FALL_SECONDS,
  STORM_INTERVAL_MIN_FACTOR,
  STORM_MIN_CLEARANCE,
  STORM_SPAWN_DISTANCE_MAX,
  STORM_SPAWN_DISTANCE_MIN,
  STRAIGHT_RUN_IDLE_RESET_SECONDS,
  STRAIGHT_RUN_MAX_HEADING_DELTA,
  STRAIGHT_RUN_TRIGGER_DISTANCE,
  STRAIGHT_STORM_DISTANCE_MAX,
  STRAIGHT_STORM_DISTANCE_MIN,
  STRAIGHT_STORM_CONTACT_DISTANCE,
  STRAIGHT_STORM_AVOIDANCE_DISTANCE_MAX,
  STRAIGHT_STORM_DANGER_DELAY_SECONDS,
  STRAIGHT_STORM_GORILLA_RADIUS_MAX,
  STRAIGHT_STORM_MIN_REGULAR_CLEARANCE,
  STRAIGHT_STORM_SAFETY_MARGIN,
  TREE_COLLISION_MODEL_RADIUS,
  advanceStraightRun,
  advanceStraightRunIdle,
  bananasUntilBonus,
  calculateScore,
  extendBoost,
  formatScore,
  getBananaSpawnDistance,
  getBonusMilestones,
  getBonusSeconds,
  getDeviceProfile,
  getGorillaSpeedRange,
  getObstacleSlideScale,
  getPlayableFrameDelta,
  getRemainingSeconds,
  getRockContactDistance,
  getRockSpeedMultiplier,
  getStage,
  getStraightStormDistance,
  getStormInterval,
  getStormLifecycle,
  getSurfaceContactDot,
  getTreeCollisionDistance,
  isRockTopReachable,
  normalizeBestRankingRows,
  pickBananaBearing,
  pickStormAngles,
  shouldBlockSurfaceObstacle,
  trySurfacePlacement,
} from "../src/rules.js";

// Minimal stand-in for the game's SeededRandom, deterministic and seedable
// so these pure-function tests stay reproducible like the real game.
function makeRandom(seed) {
  let state = seed >>> 0 || 0x6d2b79f5;
  return {
    next() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
    range(min, max) {
      return min + (max - min) * this.next();
    },
  };
}

test("難度は生存時間30秒と50秒で切り替わる", () => {
  assert.equal(getStage(29.999).stormLocations, 1);
  assert.equal(getStage(30).stormLocations, 2);
  assert.equal(getStage(49.999).stormLocations, 2);
  assert.equal(getStage(50).stormLocations, 3);
});

test("バナナの時間追加で難度段階は戻らない", () => {
  const stage = getStage(52);
  assert.equal(stage.index, 2);
  assert.equal(getRemainingSeconds(52, 10), 13);
  assert.equal(getStage(52).index, 2);
});

test("バナナ10本ごとに5秒を一度だけ追加する", () => {
  assert.equal(getBonusMilestones(9), 0);
  assert.equal(getBonusMilestones(10), 1);
  assert.equal(getBonusSeconds(10), 5);
  assert.equal(getBonusSeconds(19), 5);
  assert.equal(getBonusSeconds(20), 10);
  assert.equal(getRemainingSeconds(60, 0), 0);
  assert.equal(getRemainingSeconds(60, 10), 5);
});

test("加速中の連続取得は残り時間へ2秒ずつ足す", () => {
  assert.equal(extendBoost(0, 10), 12);
  assert.equal(extendBoost(12, 11), 14);
  assert.equal(extendBoost(12, 15), 17);
});

test("次の時間追加までの本数を正しく示す", () => {
  assert.equal(bananasUntilBonus(0), 10);
  assert.equal(bananasUntilBonus(1), 9);
  assert.equal(bananasUntilBonus(9), 1);
  assert.equal(bananasUntilBonus(10), 10);
});

test("スコアは生存時間とバナナの両方を加点する", () => {
  assert.equal(calculateScore(12.345, 3), 1534);
  assert.equal(formatScore(1534), "001534");
  assert.equal(formatScore(-10), "000000");
});

test("結果ランキングはSupabaseの値を検査し、上位5件だけに整える", () => {
  const rows = normalizeBestRankingRows(
    [
      { rank_no: "1", display_name: " べ ", best_score: "9599" },
      { rank_no: 2, display_name: "ゴリそば", best_score: 5584.9 },
      { rank_no: 0, display_name: "順位不正", best_score: 9000 },
      { rank_no: 3, display_name: "", best_score: 5091 },
      { rank_no: 3, display_name: "カメレオンJP", best_score: 5091 },
      { rank_no: 4, display_name: "アキレア", best_score: 4549 },
      { rank_no: 5, display_name: "ランランルー", best_score: 3836 },
      { rank_no: 6, display_name: "6位", best_score: 3000 },
    ],
    5,
  );

  assert.deepEqual(rows, [
    { rank: 1, displayName: "べ", bestScore: 9599 },
    { rank: 2, displayName: "ゴリそば", bestScore: 5584 },
    { rank: 3, displayName: "カメレオンJP", bestScore: 5091 },
    { rank: 4, displayName: "アキレア", bestScore: 4549 },
    { rank: 5, displayName: "ランランルー", bestScore: 3836 },
  ]);
  assert.deepEqual(normalizeBestRankingRows(null), []);
  assert.deepEqual(normalizeBestRankingRows(rows, 0), []);
});

test("PCとSPはランキング条件を共有し、PCは描画だけを増やす", () => {
  const sp = getDeviceProfile(true);
  const pc = getDeviceProfile(false);

  for (const key of [
    "gorillasPerStorm",
    "regularMaxGorillas",
    "maxGorillas",
    "stormInterval",
    "treeCount",
    "rockCount",
  ]) {
    assert.equal(pc[key], sp[key], `${key} は端末間で同じ条件が必要です`);
  }

  assert.ok(pc.rainDropsPerStorm > sp.rainDropsPerStorm);
  assert.ok(pc.maxPixelRatio > sp.maxPixelRatio);
  assert.equal(sp.realShadows, false);
  assert.equal(pc.realShadows, true);
  assert.equal(getStage(0).stormLocations, 1);
  assert.equal(getStage(30).stormLocations, 2);
  assert.equal(getStage(50).stormLocations, 3);
});

test("直進対策専用のゴリラ枠は通常枠から分離する", () => {
  for (const profile of [getDeviceProfile(true), getDeviceProfile(false)]) {
    assert.equal(
      profile.maxGorillas - profile.regularMaxGorillas,
      profile.gorillasPerStorm,
    );
    assert.ok(
      profile.regularMaxGorillas >= profile.gorillasPerStorm * 3 * 3,
      "終盤の3地点×3波を通常枠だけで保持できる必要があります",
    );
  }
  assert.equal(getDeviceProfile(true).regularMaxGorillas, 45);
  assert.equal(getDeviceProfile(false).regularMaxGorillas, 45);
});

test("木と石の接触半径は表示サイズに合わせ、石は速度を75%にする", () => {
  assert.equal(PLAYER_COLLISION_RADIUS, 0.63);
  assert.equal(TREE_COLLISION_MODEL_RADIUS, 0.68);
  assert.equal(ROCK_MODEL_RADIUS, 0.52);
  assert.equal(ROCK_SLOW_MULTIPLIER, 0.75);
  assert.equal(
    getTreeCollisionDistance(1),
    PLAYER_COLLISION_RADIUS + TREE_COLLISION_MODEL_RADIUS,
  );
  assert.equal(
    getRockContactDistance(1),
    PLAYER_COLLISION_RADIUS + ROCK_MODEL_RADIUS,
  );
  assert.ok(
    Math.abs(
      PLAYER_SPEED * BOOST_MULTIPLIER * ROCK_SLOW_MULTIPLIER - 5.928,
    ) < 1e-12,
  );
});

test("球面の接触境界は惑星半径と表面距離から一意に決まる", () => {
  const distance = getTreeCollisionDistance(1.25);
  const boundaryDot = getSurfaceContactDot(distance);
  assert.ok(
    Math.abs(Math.acos(boundaryDot) * PLANET_RADIUS - distance) < 1e-12,
  );
  assert.equal(getSurfaceContactDot(0), 1);
});

test("木は進入と内向き移動を止め、斜め接触は滑り、内部からは脱出できる", () => {
  const boundary = 0.995;
  assert.equal(
    shouldBlockSurfaceObstacle(0.99, 0.996, boundary),
    true,
    "木の外から中へ入れません",
  );
  assert.equal(
    shouldBlockSurfaceObstacle(0.997, 0.998, boundary),
    true,
    "木の中でさらに中心へは進めません",
  );
  assert.equal(
    shouldBlockSurfaceObstacle(0.997, 0.996999999, boundary),
    false,
    "ごく小さい外向き移動でも脱出できます",
  );
  assert.equal(
    shouldBlockSurfaceObstacle(0.997, 0.99, boundary),
    false,
  );
  assert.ok(Math.abs(getObstacleSlideScale(-0.6) - 0.8) < 1e-12);
  assert.equal(getObstacleSlideScale(-1), 0);
  assert.equal(getObstacleSlideScale(0.2), 1);
});

test("石は接触中だけ75%へ減速し、足元に届かない石は判定へ入れない", () => {
  assert.equal(getRockSpeedMultiplier(true), ROCK_SLOW_MULTIPLIER);
  assert.equal(getRockSpeedMultiplier(false), 1);
  assert.equal(
    isRockTopReachable(29, 0.5, 0.6, PLANET_RADIUS + 0.05),
    false,
  );
  assert.equal(
    isRockTopReachable(29.9, 1, 1, PLANET_RADIUS + 0.05),
    true,
  );
});

test("木を避ける配置は全候補が塞がっていれば表示せず再試行できる", () => {
  let attempts = 0;
  const blocked = trySurfacePlacement(
    24,
    () => {
      attempts += 1;
    },
    () => true,
  );
  assert.equal(blocked, false);
  assert.equal(attempts, 24);

  attempts = 0;
  const eventuallyClear = trySurfacePlacement(
    24,
    () => {
      attempts += 1;
    },
    () => attempts < 4,
  );
  assert.equal(eventuallyClear, true);
  assert.equal(attempts, 4);
});

test("同じ方向へマップ4分の1進むと一度だけ追加豪雨を発火する", () => {
  assert.ok(
    Math.abs(
      STRAIGHT_RUN_TRIGGER_DISTANCE - (Math.PI * PLANET_RADIUS) / 2,
    ) < 1e-12,
  );
  const before = advanceStraightRun(
    0,
    STRAIGHT_RUN_TRIGGER_DISTANCE - 0.1,
    1,
  );
  assert.equal(before.triggered, false);
  const reached = advanceStraightRun(before.distance, 0.2, 1);
  assert.equal(reached.triggered, true);
  assert.ok(Math.abs(reached.distance - 0.1) < 1e-9);

  const nextStep = advanceStraightRun(reached.distance, 1, 1);
  assert.equal(nextStep.triggered, false);
  const reachedAgain = advanceStraightRun(
    nextStep.distance,
    STRAIGHT_RUN_TRIGGER_DISTANCE - nextStep.distance,
    1,
  );
  assert.equal(reachedAgain.triggered, true);
  assert.ok(reachedAgain.distance < 1e-9);
});

test("22.5度を超えて曲がると直進距離を数え直す", () => {
  assert.equal(STRAIGHT_RUN_IDLE_RESET_SECONDS, 0.45);
  const turned = advanceStraightRun(
    STRAIGHT_RUN_TRIGGER_DISTANCE * 0.9,
    0.75,
    Math.cos(STRAIGHT_RUN_MAX_HEADING_DELTA + 0.001),
  );
  assert.equal(turned.aligned, false);
  assert.equal(turned.triggered, false);
  assert.equal(turned.distance, 0.75);

  const notYetReset = advanceStraightRunIdle(12, 0, 0.449);
  assert.equal(notYetReset.reset, false);
  assert.equal(notYetReset.distance, 12);
  const reset = advanceStraightRunIdle(
    notYetReset.distance,
    notYetReset.idleSeconds,
    0.001,
  );
  assert.deepEqual(reset, {
    reset: true,
    distance: 0,
    idleSeconds: 0,
  });
});

test("前方豪雨は途中の加速も見込み、接触不能にならない安全距離へ置く", () => {
  const normal = getStraightStormDistance(PLAYER_SPEED, 1.25);
  const boosted = getStraightStormDistance(
    PLAYER_SPEED * BOOST_MULTIPLIER,
    1.25,
  );
  assert.ok(normal >= STRAIGHT_STORM_DISTANCE_MIN);
  assert.equal(boosted, normal);
  assert.ok(boosted <= STRAIGHT_STORM_DISTANCE_MAX);
  assert.equal(getStraightStormDistance(0, 1.25), boosted);
  assert.equal(
    getStraightStormDistance(999, 1.25),
    STRAIGHT_STORM_DISTANCE_MAX,
  );

  const maximumPlayerSpeed = PLAYER_SPEED * BOOST_MULTIPLIER;
  const nearestAtDanger =
    boosted -
    maximumPlayerSpeed *
      (STORM_FALL_SECONDS + STRAIGHT_STORM_DANGER_DELAY_SECONDS) -
    STRAIGHT_STORM_GORILLA_RADIUS_MAX -
    GORILLA_SPEED_MAX_LATE * STRAIGHT_STORM_DANGER_DELAY_SECONDS;
  assert.ok(
    nearestAtDanger >=
      STRAIGHT_STORM_CONTACT_DISTANCE + STRAIGHT_STORM_SAFETY_MARGIN,
    `危険判定開始時の余白が不足しています: ${nearestAtDanger}`,
  );
});

test("通常豪雨と直進対策豪雨は前後どちらの発生順でも6以上離せる", () => {
  const normalAt = (distance, bearing) => {
    const angle = distance / PLANET_RADIUS;
    return [
      Math.sin(angle) * Math.sin(bearing),
      Math.cos(angle),
      Math.sin(angle) * Math.cos(bearing),
    ];
  };
  const surfaceDistance = (left, right) => {
    const dot = Math.max(
      -1,
      Math.min(
        1,
        left[0] * right[0] +
          left[1] * right[1] +
          left[2] * right[2],
      ),
    );
    return Math.acos(dot) * PLANET_RADIUS;
  };

  const regularFallbacks = [];
  for (const bearing of [
    Math.PI,
    STORM_MIN_CLEARANCE,
    Math.PI * 2 - STORM_MIN_CLEARANCE,
  ]) {
    for (const distance of [
      STORM_SPAWN_DISTANCE_MIN,
      STORM_SPAWN_DISTANCE_MAX,
    ]) {
      regularFallbacks.push(normalAt(distance, bearing));
    }
  }
  for (
    let specialDistance = 0;
    specialDistance <= Math.PI * PLANET_RADIUS;
    specialDistance += 1.5
  ) {
    for (
      let specialBearing = -Math.PI;
      specialBearing <= Math.PI;
      specialBearing += 0.12
    ) {
      const special = normalAt(specialDistance, specialBearing);
      const best = Math.max(
        ...regularFallbacks.map((candidate) =>
          surfaceDistance(candidate, special),
        ),
      );
      assert.ok(best >= STRAIGHT_STORM_MIN_REGULAR_CLEARANCE);
    }
  }

  const random = makeRandom(20260728);
  const preferredDistance = getStraightStormDistance(
    PLAYER_SPEED,
    STORM_FALL_SECONDS,
  );
  for (let trial = 0; trial < 500; trial += 1) {
    const regularStorms = Array.from({ length: 3 }, () =>
      normalAt(
        random.range(0, Math.PI * PLANET_RADIUS),
        random.range(-Math.PI, Math.PI),
      ),
    );
    const baseBearing = random.range(-0.08, 0.08);
    let best = -Infinity;
    for (
      let distance = preferredDistance;
      distance <= STRAIGHT_STORM_AVOIDANCE_DISTANCE_MAX;
      distance += 1
    ) {
      for (let offsetStep = 0; offsetStep <= 29; offsetStep += 1) {
        const signedStep =
          offsetStep === 0
            ? 0
            : Math.ceil(offsetStep / 2) * (offsetStep % 2 ? 1 : -1);
        const bearing = baseBearing + signedStep * 0.1;
        if (Math.abs(bearing) >= Math.PI / 2) continue;
        const candidate = normalAt(distance, bearing);
        const clearance = Math.min(
          ...regularStorms.map((storm) =>
            surfaceDistance(candidate, storm),
          ),
        );
        best = Math.max(best, clearance);
      }
    }
    assert.ok(
      best >= STRAIGHT_STORM_MIN_REGULAR_CLEARANCE,
      `前方探索帯の空きが不足しています: ${best}`,
    );
  }
});

test("突然の豪雨は開始直後に雨を出し、1.25秒で一度着地する", () => {
  assert.equal(STORM_FALL_SECONDS, 1.25);
  assert.deepEqual(getStormLifecycle(0, false), {
    startRain: true,
    impact: false,
  });
  assert.deepEqual(getStormLifecycle(0.5, true), {
    startRain: false,
    impact: false,
  });
  assert.deepEqual(getStormLifecycle(STORM_FALL_SECONDS, true), {
    startRain: false,
    impact: true,
  });
});

test("降下ゴリラは顔・長い腕・左右の脚が分かる共通造形を使う", () => {
  const names = new Set(FALLING_GORILLA_PARTS.map((part) => part.name));
  for (const required of [
    "torso",
    "head",
    "muzzle",
    "chest",
    "left-arm",
    "right-arm",
    "left-leg",
    "right-leg",
  ]) {
    assert.ok(names.has(required), `${required} が降下ゴリラに必要です`);
  }
  assert.ok(FALLING_GORILLA_PARTS.length >= 8);

  const leftArm = FALLING_GORILLA_PARTS.find((part) => part.name === "left-arm");
  const rightArm = FALLING_GORILLA_PARTS.find((part) => part.name === "right-arm");
  assert.equal(leftArm.x, -rightArm.x);
  assert.equal(leftArm.rz, -rightArm.rz);
  assert.ok(leftArm.sy > leftArm.sx * 2.5, "ゴリラらしい長い腕が必要です");
});

test("周囲を降るゴリラは最大サイズでも惑星表面へ届かない", () => {
  const conservativeModelReach = Math.max(
    ...FALLING_GORILLA_PARTS.map(
      (part) =>
        Math.hypot(part.x, part.y, part.z) +
        Math.hypot(part.sx, part.sy, part.sz) / 2,
    ),
  );
  const minimumAirGap =
    ORBITAL_FALLER_LOW - FALLING_GORILLA_MAX_REACH * ORBITAL_FALLER_SCALE_MAX;
  assert.ok(Math.abs(FALLING_GORILLA_MAX_REACH - conservativeModelReach) < 1e-12);
  assert.ok(ORBITAL_FALLER_HEIGHT_MIN > ORBITAL_FALLER_LOW);
  assert.ok(minimumAirGap >= 2, `地表との隙間が不足しています: ${minimumAirGap}`);
});

test("初期時間は60秒", () => {
  assert.equal(BASE_GAME_SECONDS, 60);
  assert.equal(getRemainingSeconds(0, 0), 60);
});

test("嵐は進行方向の正面から必ず離れて出現する", () => {
  const random = makeRandom(42);
  for (let trial = 0; trial < 200; trial += 1) {
    const count = 1 + Math.floor(random.next() * 3);
    const angles = pickStormAngles(count, random);
    assert.equal(angles.length, count);
    for (const angle of angles) {
      assert.ok(angle >= STORM_MIN_CLEARANCE - 1e-9);
      assert.ok(angle <= Math.PI * 2 - STORM_MIN_CLEARANCE + 1e-9);
    }
  }
});

test("嵐の角度は本数ぶんだけ返り、0本なら空配列", () => {
  const random = makeRandom(7);
  assert.deepEqual(pickStormAngles(0, random), []);
  assert.equal(pickStormAngles(3, random).length, 3);
  assert.equal(pickStormAngles(1, random).length, 1);
});

test("バナナは球面距離で近すぎず遠すぎない帯に出現する", () => {
  const random = makeRandom(99);
  assert.ok(BANANA_MIN_SURFACE_DISTANCE < BANANA_MAX_SURFACE_DISTANCE);
  for (let trial = 0; trial < 500; trial += 1) {
    const distance = getBananaSpawnDistance(random);
    assert.ok(distance >= BANANA_MIN_SURFACE_DISTANCE);
    assert.ok(distance <= BANANA_MAX_SURFACE_DISTANCE);
  }
});

test("嵐の間隔は経過時間とともに詰まり、下限を割らない", () => {
  const base = 5.2;
  assert.equal(getStormInterval(0, base), base);
  const mid = getStormInterval(27.5, base);
  const late = getStormInterval(120, base);
  assert.ok(mid < base);
  assert.ok(late < mid);
  assert.ok(Math.abs(late - base * STORM_INTERVAL_MIN_FACTOR) < 1e-9);
  assert.equal(getStormInterval(-5, base), base);
});

test("バナナの方位は進行方向を中心とした扇の範囲に収まる", () => {
  const random = makeRandom(13);
  for (let trial = 0; trial < 500; trial += 1) {
    const bearing = pickBananaBearing(random);
    assert.ok(bearing >= -BANANA_BEARING_HALF_WIDTH - 1e-9);
    assert.ok(bearing <= BANANA_BEARING_HALF_WIDTH + 1e-9);
  }
});

test("ゴリラの速度は経過とともに上がり、序盤はプレイヤー未満・終盤は上回る", () => {
  const early = getGorillaSpeedRange(0);
  const late = getGorillaSpeedRange(999);
  // Opening stays forgiving: even the fastest early gorilla can't catch an
  // unboosted player who just keeps moving.
  assert.ok(early.max < PLAYER_SPEED);
  assert.equal(early.max, GORILLA_SPEED_MAX_EARLY);
  assert.ok(late.max > early.max);
  assert.ok(late.min >= early.min);
});

test("終盤のゴリラは無加速のプレイヤーより速いが、加速中のプレイヤーには届かない", () => {
  // This is the core rebalance: reaction time + resource management replace
  // "the enemy can never be fast enough" as the game's fairness basis. Late
  // gorillas must genuinely outrun an unboosted player (so ignoring bananas
  // is punished) while staying comfortably below boosted speed (so a player
  // who banks and uses boost always escapes with margin).
  const boostedSpeed = PLAYER_SPEED * BOOST_MULTIPLIER;
  const late = getGorillaSpeedRange(999);
  assert.ok(late.min > PLAYER_SPEED, "late-game gorillas must outrun an unboosted player");
  assert.ok(
    late.max < boostedSpeed * 0.9,
    "late-game gorillas must stay comfortably below boosted player speed",
  );
});

test("低フレームでもゲーム時計は実時間で60秒進む", () => {
  assert.equal(MAX_FIXED_STEPS_PER_FRAME, 30);
  assert.ok(
    MAX_FIXED_STEPS_PER_FRAME * FIXED_STEP_SECONDS >=
      getPlayableFrameDelta(0.5),
  );

  function simulate(frames) {
    let accumulator = 0;
    let simulated = 0;
    for (const measured of frames) {
      accumulator += getPlayableFrameDelta(measured);
      let steps = 0;
      while (
        accumulator + 1e-12 >= FIXED_STEP_SECONDS &&
        steps < MAX_FIXED_STEPS_PER_FRAME
      ) {
        accumulator -= FIXED_STEP_SECONDS;
        simulated += FIXED_STEP_SECONDS;
        steps += 1;
      }
      assert.ok(steps <= MAX_FIXED_STEPS_PER_FRAME);
    }
    return { simulated, accumulator };
  }

  for (const frames of [
    Array(300).fill(0.2),
    Array(60).fill([0.49, 0.01, 0.2, 0.033, 0.267]).flat(),
  ]) {
    const result = simulate(frames);
    assert.ok(Math.abs(result.simulated - 60) < 0.000001);
    assert.ok(Math.abs(result.accumulator) < 0.000001);
  }
  assert.equal(getPlayableFrameDelta(0.6), 0);
});

test("HTMLにホーム・ゲーム・結果の3画面と操作領域がある", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["home-screen", "game-screen", "result-screen", "game-input"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /src="\.\/src\/game\.js"/);
  assert.match(html, /豪雨は突然降る/);
  assert.match(html, /石は減速/);
  assert.match(html, /木は半透明の壁/);
});

test("HTMLのIDは重複せず、JavaScriptが参照する画面部品が存在する", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const game = await readFile(new URL("../src/game.js", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);

  const referencedIds = [
    ...game.matchAll(/document\.querySelector\("#([^"]+)"\)/g),
  ].map((match) => match[1]);
  for (const id of referencedIds) {
    assert.ok(ids.includes(id), `#${id} がindex.htmlに必要です`);
  }
});

test("揺れと音は初期状態で無効になり、バナナ取得は+100を粒で示す", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const game = await readFile(new URL("../src/game.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.equal(SCORE_PER_BANANA, 100);
  assert.match(
    html,
    /id="motion-button"[\s\S]*?aria-pressed="false"[\s\S]*?揺れ：なし/,
  );
  assert.match(
    html,
    /id="home-sound-button"[\s\S]*?aria-pressed="false"[\s\S]*?音：なし/,
  );
  assert.match(
    game,
    /safeStorageGet\("goriragouu-sound", "off"\) === "on"/,
  );
  assert.match(
    game,
    /safeStorageGet\("goriragouu-motion", "off"\) === "on"/,
  );

  const effectMarkup = html.slice(
    html.indexOf('id="banana-score-fx"'),
    html.indexOf('id="pause-button"'),
  );
  assert.match(effectMarkup, /<strong>\+100<\/strong>/);
  assert.equal((effectMarkup.match(/<i style=/g) || []).length, 8);
  assert.match(game, /this\.showBananaScoreEffect\(\)/);
  assert.match(
    game,
    /scoreText\.textContent = `\+\$\{SCORE_PER_BANANA\}`/,
  );
  assert.match(css, /@keyframes banana-score-pop/);
  assert.match(css, /@keyframes banana-score-spark/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.banana-score-fx\.active strong[\s\S]*?opacity:\s*1/,
  );
});

test("プレイヤーは紫系の服を着て、実験場ランキングへ1回だけ自動送信する", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const game = await readFile(new URL("../src/game.js", import.meta.url), "utf8");

  for (const id of [
    "player-name-input",
    "player-name-message",
    "ranking-status",
    "result-ranking",
    "result-ranking-title",
    "result-ranking-message",
    "result-ranking-list",
    "result-ranking-detail-link",
    "home-share-button",
    "home-lab-link",
    "result-home-button",
    "result-lab-link",
    "webgl-error-title",
    "webgl-error-message",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /maxlength="10"/);
  assert.match(html, /user-scalable=no/);
  assert.match(
    html,
    /https:\/\/chameleonjp-lab\.github\.io\/chameleonjp_lab\//,
  );

  assert.match(game, /const GAME_SLUG = "goriragouu"/);
  assert.match(game, /const CLIENT_VERSION = "goriragouu_v20260729_01"/);
  assert.match(
    game,
    /const GAME_URL = "https:\/\/chameleonjp-lab\.github\.io\/goriragouu\/"/,
  );
  assert.match(game, /supabase-js@2\.110\.9\/\+esm/);
  assert.match(game, /\.rpc\("submit_score"/);
  assert.match(game, /\.rpc\("get_best_score_ranking"/);
  assert.match(game, /p_game_slug:\s*GAME_SLUG/);
  assert.match(game, /p_limit:\s*limit/);
  assert.match(game, /const RESULT_RANKING_LIMIT = 5/);
  assert.match(game, /result\.accepted !== true/);
  assert.match(game, /this\.scoreSubmitAttempted = true/);
  assert.match(game, /this\.setLabNavigationLocked\(true\)/);
  assert.match(game, /this\.setLabNavigationLocked\(false\)/);
  assert.doesNotMatch(game, /service_role|sb_secret_/i);
  assert.doesNotMatch(game, /window\.location\.href/);
  assert.doesNotMatch(game, /resultRankingList\.innerHTML/);
  assert.match(game, /resultRankingList\.replaceChildren/);
  assert.match(game, /nameText\.textContent = displayName/);
  assert.match(game, /item\.setAttribute\("aria-current", "true"\)/);
  assert.match(game, /void this\.loadResultRanking\(runId\)/);
  assert.match(game, /normalizeBestRankingRows\(rows, RESULT_RANKING_LIMIT\)/);
  assert.ok(
    (game.match(/ui\.resultRankingDetailLink/g) || []).length >= 2,
    "詳細ランキングは押下防止・送信中ロックの対象にします",
  );
  assert.match(
    html,
    /ranking\.html\?game=goriragouu/,
  );

  const finishMethod = game.slice(
    game.indexOf("  finishGame(cleared) {"),
    game.indexOf("  async shareGame() {"),
  );
  assert.match(
    finishMethod,
    /void this\.submitGameScore\(score, this\.scoreSubmissionRunId\)/,
  );
  assert.equal(
    (finishMethod.match(/submitGameScore\(/g) || []).length,
    1,
  );
  assert.match(finishMethod, /ui\.result\.scrollTop = 0/);

  assert.match(game, /color: 0x8b5cf6/);
  assert.match(game, /color: 0x4c1d95/);
  assert.doesNotMatch(html, /id="result-mode"/);
  assert.doesNotMatch(game, /resultMode:/);
});

test("Three.jsは固定版を使い、描画上限と使い回し用クラスを備える", async () => {
  const game = await readFile(new URL("../src/game.js", import.meta.url), "utf8");
  assert.match(game, /three@0\.185\.1\/build\/three\.module\.min\.js/);
  assert.match(game, /class GorillaRenderer/);
  assert.match(game, /class StormCell/);
  assert.match(game, /new THREE\.InstancedMesh/);
  assert.match(game, /new THREE\.Points/);
  assert.match(game, /MAX_FIXED_STEPS = MAX_FIXED_STEPS_PER_FRAME/);
  assert.doesNotMatch(game, /const skipped =/);
  assert.match(
    game,
    /this\.fallingPartsPerGorilla = FALLING_GORILLA_PARTS\.length/,
  );
  assert.match(game, /this\.partsPerFaller = FALLING_GORILLA_PARTS\.length/);
  assert.match(game, /this\.orbitalViewNormal = new THREE\.Vector3\(\)/);
  assert.match(
    game,
    /this\.orbitalViewNormal\.copy\(this\.camera\.position\)\.normalize\(\)/,
  );
  assert.doesNotMatch(game, /new THREE\.RingGeometry/);
  assert.doesNotMatch(game, /STORM_WARNING_SECONDS/);
  assert.doesNotMatch(game, /this\.splash/);
  assert.match(
    game,
    /this\.regularStormPool = Array\.from\(\s*\{ length: 3 \}/,
  );
  assert.match(game, /this\.straightRunStorm = new StormCell/);
  assert.match(game, /this\.regularStormPool\.filter/);
  assert.match(game, /cell === this\.straightRunStorm/);
  assert.match(game, /reservedForStraight,/);
  assert.match(game, /gorilla\.reservedForStraight !== reservedForStraight/);
  assert.match(game, /const phaseRandom = reservedForStraight/);
  assert.match(game, /phase: phaseRandom\.range/);
  assert.match(game, /this\.treeObstacles\.push/);
  assert.match(game, /this\.rockSlowZones\.push/);
  assert.match(game, /isRockTopReachable\(/);
  assert.match(game, /trySurfacePlacement\(\s*24/);
  assert.match(game, /findBlockingTree\(candidateNormal, currentNormal\)/);
  assert.match(game, /ROCK_SLOW_MULTIPLIER/);
  assert.match(game, /advanceStraightRun\(/);
  assert.match(
    game,
    /this\.straightTransportQuaternion\.setFromUnitVectors\(\s*this\.previousNormal,\s*this\.playerNormal/,
  );
  assert.match(
    game,
    /const idleState = advanceStraightRunIdle\(/,
  );
  assert.match(game, /spawnStraightRunStorm\(\)/);
  assert.match(game, /this\.straightStormPending = true/);
  assert.match(
    game,
    /this\.straightStormPending && this\.spawnStraightRunStorm\(\)/,
  );
  const regularStormMethod = game.slice(
    game.indexOf("  spawnStormWave(count) {"),
    game.indexOf("  getStormClearance(candidate, storms) {"),
  );
  assert.match(regularStormMethod, /this\.straightRunStorm\.active/);
  assert.match(regularStormMethod, /this\.getStormClearance/);
  assert.doesNotMatch(regularStormMethod, /pickStormAngles\(1,/);
  assert.match(
    regularStormMethod,
    /bestClearance >= STRAIGHT_STORM_MIN_REGULAR_CLEARANCE/,
  );
  const straightStormMethod = game.slice(
    game.indexOf("  spawnStraightRunStorm() {"),
    game.indexOf("  onRainStart() {"),
  );
  assert.match(straightStormMethod, /this\.straightStormRandom/);
  assert.match(straightStormMethod, /this\.regularStormPool/);
  assert.match(straightStormMethod, /if \(!foundClearCandidate\) return false/);
  assert.doesNotMatch(straightStormMethod, /this\.nextStormAt/);
  assert.doesNotMatch(straightStormMethod, /this\.random\./);
  assert.doesNotMatch(
    game,
    /this\.profile\.treeCount = Math\.min/,
  );
  assert.doesNotMatch(
    game,
    /this\.profile\.rockCount = Math\.min/,
  );
  assert.match(
    game,
    /const trunkMaterial = new THREE\.MeshStandardMaterial\(\{[\s\S]*?transparent: true,[\s\S]*?opacity: 0\.78/,
  );
  assert.match(
    game,
    /const crownMaterial = new THREE\.MeshStandardMaterial\(\{[\s\S]*?transparent: true,[\s\S]*?opacity: 0\.7/,
  );
});

test("ゲーム中のスマホ操作を抑えるCSSが揃っている", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.game-input\s*\{[^}]*touch-action:\s*none/s);
  assert.match(css, /overscroll-behavior:\s*none/);
  assert.match(css, /-webkit-touch-callout:\s*none/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.equal(
    [...css].filter((character) => character === "{").length,
    [...css].filter((character) => character === "}").length,
  );
});

test("停止画面の読み上げと安全なPages公開条件を備える", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const pages = await readFile(
    new URL("../.github/workflows/pages.yml", import.meta.url),
    "utf8",
  );
  assert.match(html, /id="pause-overlay"[\s\S]*role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /id="result-title" tabindex="-1"/);
  assert.match(pages, /needs: test/);
  assert.match(pages, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(pages, /deploy:[\s\S]*permissions:[\s\S]*pages: write/);
});

test("WebGLコンテキスト消失中は進行を止め、復旧後に再開準備する", async () => {
  const game = await readFile(new URL("../src/game.js", import.meta.url), "utf8");
  assert.match(game, /addEventListener\(\s*"webglcontextlost"/);
  assert.match(game, /addEventListener\(\s*"webglcontextrestored"/);
  assert.match(game, /handleWebGLContextLost\(event\)/);
  assert.match(game, /event\.preventDefault\(\)/);
  assert.match(game, /this\.mode = "context-lost"/);
  assert.match(
    game,
    /if \(this\.webglContextLost\) \{\s*this\.lastFrameAt = timeMs;\s*return;/,
  );
  assert.match(game, /this\.accumulator = 0/);
  assert.match(game, /this\.resumeGame\(\)/);
  assert.match(game, /startNewGame\(\) \{\s*if \(this\.webglContextLost\) return;/);
});
