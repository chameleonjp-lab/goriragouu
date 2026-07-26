import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BASE_GAME_SECONDS,
  bananasUntilBonus,
  calculateScore,
  extendBoost,
  formatScore,
  getBonusMilestones,
  getBonusSeconds,
  getDeviceProfile,
  getPlayableFrameDelta,
  getRemainingSeconds,
  getStage,
} from "../src/rules.js";

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

test("PCはSPよりゴリラと雨を増やすが、地点段階は共通", () => {
  const sp = getDeviceProfile(true);
  const pc = getDeviceProfile(false);
  assert.equal(sp.gorillasPerStorm, 5);
  assert.equal(pc.gorillasPerStorm, 7);
  assert.ok(pc.rainDropsPerStorm > sp.rainDropsPerStorm);
  assert.equal(getStage(0).stormLocations, 1);
  assert.equal(getStage(30).stormLocations, 2);
  assert.equal(getStage(50).stormLocations, 3);
});

test("初期時間は60秒", () => {
  assert.equal(BASE_GAME_SECONDS, 60);
  assert.equal(getRemainingSeconds(0, 0), 60);
});

test("低フレームでもゲーム時計は実時間で60秒進む", () => {
  let elapsed = 0;
  for (let frame = 0; frame < 600; frame += 1) {
    elapsed += getPlayableFrameDelta(0.1);
  }
  assert.ok(Math.abs(elapsed - 60) < 0.000001);
  assert.equal(getPlayableFrameDelta(0.6), 0);
});

test("HTMLにホーム・ゲーム・結果の3画面と操作領域がある", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["home-screen", "game-screen", "result-screen", "game-input"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /src="\.\/src\/game\.js"/);
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

test("Three.jsは固定版を使い、描画上限と使い回し用クラスを備える", async () => {
  const game = await readFile(new URL("../src/game.js", import.meta.url), "utf8");
  assert.match(game, /three@0\.185\.1\/build\/three\.module\.min\.js/);
  assert.match(game, /class GorillaRenderer/);
  assert.match(game, /class StormCell/);
  assert.match(game, /new THREE\.InstancedMesh/);
  assert.match(game, /new THREE\.Points/);
  assert.match(game, /MAX_FIXED_STEPS = 8/);
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
