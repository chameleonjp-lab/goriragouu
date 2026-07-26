export const BASE_GAME_SECONDS = 60;
export const BONUS_SECONDS_PER_TEN_BANANAS = 5;
export const BOOST_SECONDS_PER_BANANA = 2;
export const SCORE_PER_SECOND = 100;
export const SCORE_PER_BANANA = 100;

export const STAGES = Object.freeze([
  Object.freeze({
    index: 0,
    startsAt: 0,
    stormLocations: 1,
    bananaTarget: 6,
    label: "1地点",
  }),
  Object.freeze({
    index: 1,
    startsAt: 30,
    stormLocations: 2,
    bananaTarget: 9,
    label: "2地点",
  }),
  Object.freeze({
    index: 2,
    startsAt: 50,
    stormLocations: 3,
    bananaTarget: 12,
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

export function getDeviceProfile(isMobile) {
  if (isMobile) {
    return Object.freeze({
      id: "sp-standard",
      label: "SP標準",
      gorillasPerStorm: 5,
      maxGorillas: 32,
      stormInterval: 5.8,
      rainDropsPerStorm: 420,
      maxPixelRatio: 1.35,
      treeCount: 26,
      rockCount: 20,
      realShadows: false,
    });
  }

  return Object.freeze({
    id: "pc-crowd",
    label: "PC多群",
    gorillasPerStorm: 7,
    maxGorillas: 48,
    stormInterval: 5.2,
    rainDropsPerStorm: 760,
    maxPixelRatio: 1.6,
    treeCount: 44,
    rockCount: 30,
    realShadows: true,
  });
}
