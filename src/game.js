import {
  BANANA_MAX_SURFACE_DISTANCE,
  BANANA_RESPAWN_DELAY_SECONDS,
  BASE_GAME_SECONDS,
  BOOST_MULTIPLIER,
  FALLING_GORILLA_MAX_REACH,
  FALLING_GORILLA_PARTS,
  FIXED_STEP_SECONDS,
  MAX_FIXED_STEPS_PER_FRAME,
  ORBITAL_FALLER_HEIGHT_MAX,
  ORBITAL_FALLER_HEIGHT_MIN,
  ORBITAL_FALLER_LOW,
  ORBITAL_FALLER_SCALE_MAX,
  ORBITAL_FALLER_SCALE_MIN,
  PLANET_RADIUS,
  PLAYER_SPEED,
  ROCK_MODEL_RADIUS,
  ROCK_SLOW_MULTIPLIER,
  SCORE_PER_BANANA,
  STORM_FALL_SECONDS,
  STORM_MIN_CLEARANCE,
  STORM_SPAWN_DISTANCE_MAX,
  STORM_SPAWN_DISTANCE_MIN,
  STRAIGHT_STORM_AVOIDANCE_DISTANCE_MAX,
  STRAIGHT_STORM_BEARING_JITTER,
  STRAIGHT_STORM_CONTACT_DISTANCE,
  STRAIGHT_STORM_DANGER_DELAY_SECONDS,
  STRAIGHT_STORM_MIN_REGULAR_CLEARANCE,
  TREE_TRUNK_MODEL_RADIUS,
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
} from "./rules.js";

let THREE;
try {
  THREE = await import(
    "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js"
  );
} catch (error) {
  const loading = document.querySelector("#loading");
  const fatal = document.querySelector("#webgl-error");
  const message = fatal?.querySelector("p");
  if (loading) loading.hidden = true;
  if (message) {
    message.textContent =
      "3D機能の読み込みに失敗しました。通信状態を確認して、ページを開き直してください。";
  }
  if (fatal) fatal.hidden = false;
  console.error("Three.jsの読み込みに失敗しました。", error);
  throw error;
}

const FIXED_STEP = FIXED_STEP_SECONDS;
const MAX_FIXED_STEPS = MAX_FIXED_STEPS_PER_FRAME;
const IS_COARSE_POINTER = window.matchMedia("(pointer: coarse)").matches;
const HAS_FINE_POINTER = window.matchMedia(
  "(hover: hover) and (pointer: fine)",
).matches;
const URL_PARAMS = new URLSearchParams(window.location.search);
const FORCED_DEVICE = URL_PARAMS.get("device");
const IS_MOBILE =
  FORCED_DEVICE === "sp" ||
  (FORCED_DEVICE !== "pc" && IS_COARSE_POINTER && !HAS_FINE_POINTER);
const QUALITY_OVERRIDE = URL_PARAMS.get("quality");
const GAME_SLUG = "goriragouu";
const CLIENT_VERSION = "goriragouu_v20260729_01";
const GAME_URL = "https://chameleonjp-lab.github.io/goriragouu/";
const RESULT_RANKING_LIMIT = 5;
const SUPABASE_URL = "https://mlpnjgezrnhdxsxolyzj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM";
const SUPABASE_MODULE_URL =
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.9/+esm";
const NAME_STORAGE_KEY = `chameleonjp_${GAME_SLUG}_player_name`;
const PLAYER_HEIGHT = 0.05;
const GORILLA_CHASE_SECONDS = 5;
const GORILLA_CONTACT_DISTANCE = STRAIGHT_STORM_CONTACT_DISTANCE;
const BANANA_CONTACT_DISTANCE = 1.05;
const SURFACE_PLACEMENT_RETRY_SECONDS = 0.25;
// A banana already placed stays put until collected, but the player keeps
// moving -- so without this, a banana placed in-band would simply be left
// behind a few seconds later and never seen again. Once a banana drifts
// past the band's outer edge relative to the player's *current* position,
// it is relocated back into the band, keeping the annulus meaningful for
// the whole run instead of just at spawn time. Comparing cosines avoids an
// acos() call per banana per frame.
const BANANA_LEASH_MIN_DOT = Math.cos(BANANA_MAX_SURFACE_DISTANCE / PLANET_RADIUS);
// There is deliberately no pre-impact marker or warning phase. The cloud,
// rain, and falling gorillas appear together, then reach the surface after
// this visible fall time.
// With the old 2.2-second marker removed, ordinary random storms stay a little
// farther from the player so the visible fall itself remains enough time to
// turn. This changes placement distance, not their scheduled frequency.
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ZERO_VECTOR = new THREE.Vector3();
const COLOR_LAND_LIGHT = new THREE.Color(0x8fcf5c);
const COLOR_LAND = new THREE.Color(0x3f7a41);
const COLOR_LAND_DARK = new THREE.Color(0x1f4a32);
// Muted rock grey for the very lowest ground only. There is no water and no
// sand band any more (see DEFECT B/C notes below): a narrow, three-green
// palette plus this one grey stop keeps neighbouring facets close in colour.
const COLOR_ROCK = new THREE.Color(0x6d6a5e);
// Inward displacement amplitude for terrain relief. Radius is always
// PLANET_RADIUS - (1 - elevation) * TERRAIN_RELIEF, so the walkable surface's
// maximum radius stays exactly PLANET_RADIUS no matter how large this value
// is -- only valleys sink further, hills never rise past the reference
// sphere. That keeps the player/gorilla/banana placement at
// PLANET_RADIUS + small offset guaranteed clip-free.
const TERRAIN_RELIEF = 1.7;
// Decorations avoid rooting in the lowest, rockiest ground. This replaces the
// old waterline cutoff now that there is no ocean to define a shoreline.
const LOWLAND_ELEVATION = 0.52;
// Planet-scale ambient rain: a shell of grey storm clouds ringing the whole
// globe with gorilla silhouettes falling radially inward (along -normal)
// toward the surface, purely decorative. Shell height and fall range scale
// with PLANET_RADIUS the same way HOME_ORBIT_* does below.
const ORBITAL_CLOUD_SHELL_MIN = PLANET_RADIUS + 9;
const ORBITAL_CLOUD_SHELL_MAX = PLANET_RADIUS + 15;
// Fallers recycle back to the cloud shell well above the true maximum
// terrain radius (PLANET_RADIUS) and above the tallest tree crowns (trees
// top out around 3.4 units), so a clear gap of open air always separates a
// faller from the ground -- nothing ever reads as sitting on or embedded in
// the surface, unlike the old near-zero cutoff that let large silhouettes
// dip into hills. The low point and model scale live beside the shared
// silhouette in rules.js so their clearance is protected by a pure test.
// Fallers whose surface normal sits within this cone of the current viewing
// direction are culled so the ambient rain never overlaps the visible planet
// face or reads as a real threat. Gameplay uses the player's own "up";
// home/result use the orbit camera direction.
const ORBITAL_NEAR_SIDE_DOT = 0.3;
// The home/result screens orbit the whole planet from outside, so unlike the
// gameplay chase camera these distances scale with PLANET_RADIUS to keep the
// planet framed at the same apparent size no matter how big it is.
const HOME_ORBIT_RADIUS = (PLANET_RADIUS * 17) / 9;
const HOME_ORBIT_HEIGHT = PLANET_RADIUS;
const HOME_ORBIT_BOB = PLANET_RADIUS / 6;
const HOME_LOOKAT_HEIGHT = PLANET_RADIUS / 9;
// The home/result orbit camera sits at a roughly fixed elevation angle above
// the planet (only its azimuth changes as it slowly circles), so the patch
// of sphere it can actually see is centred on this latitude, not spread
// evenly over the whole globe. Uniform-random placement therefore wastes
// most fallers on the far side or near the poles, where this camera never
// looks, which is why the ambient rain read as sparse on portrait/mobile
// framing where the visible cone beyond the limb is narrow. Biasing the
// faller latitude toward this camera-derived value (rather than an
// arbitrary tuned constant) keeps more of them somewhere a viewer can
// actually see without hand-picking a "magic" band.
const ORBITAL_FALLER_LATITUDE_BIAS = HOME_ORBIT_HEIGHT / Math.hypot(HOME_ORBIT_HEIGHT, HOME_ORBIT_RADIUS);
// How far latitude is still allowed to spread away from that bias -- wide
// enough that coverage still reads as "the whole globe is raining", not a
// single ring, while shifting the odds toward the visible band.
const ORBITAL_FALLER_LATITUDE_SPREAD = 0.55;
const SKY_ZENITH_COLOR = new THREE.Color(0x0c1a3d);
const SKY_MID_COLOR = new THREE.Color(0x1f6f6c);
const SKY_HORIZON_COLOR = new THREE.Color(0xf2d59c);
// Fog matches the thin, desaturated horizon band rather than the raw warm
// accent colour, so distant terrain fades into the same sky it sits under
// instead of vanishing into an orange haze.
const SKY_FOG_COLOR = SKY_MID_COLOR.clone().lerp(SKY_HORIZON_COLOR, 0.35);
// Fixed world-space sun direction for the sky dome only. This must NOT track
// the player-following `this.sun` light (see updateCamera), or the glow disc
// stays glued to the camera and washes the whole dome into one flat colour.
const SUN_SKY_DIRECTION = new THREE.Vector3(12, 30, 18).normalize();

const ui = {
  app: document.querySelector("#app"),
  scene: document.querySelector("#scene"),
  loading: document.querySelector("#loading"),
  loadingMessage: document.querySelector("#loading-message"),
  webglError: document.querySelector("#webgl-error"),
  webglErrorTitle: document.querySelector("#webgl-error-title"),
  webglErrorMessage: document.querySelector("#webgl-error-message"),
  home: document.querySelector("#home-screen"),
  game: document.querySelector("#game-screen"),
  result: document.querySelector("#result-screen"),
  startButton: document.querySelector("#start-button"),
  replayButton: document.querySelector("#replay-button"),
  shareButton: document.querySelector("#share-button"),
  homeShareButton: document.querySelector("#home-share-button"),
  homeLabLink: document.querySelector("#home-lab-link"),
  resultHomeButton: document.querySelector("#result-home-button"),
  resultLabLink: document.querySelector("#result-lab-link"),
  pauseButton: document.querySelector("#pause-button"),
  resumeButton: document.querySelector("#resume-button"),
  pauseOverlay: document.querySelector("#pause-overlay"),
  gameInput: document.querySelector("#game-input"),
  joystick: document.querySelector("#joystick"),
  joystickKnob: document.querySelector("#joystick-knob"),
  score: document.querySelector("#score-value"),
  timer: document.querySelector("#time-value"),
  timerCard: document.querySelector("#timer-card"),
  bananas: document.querySelector("#banana-value"),
  bananaNext: document.querySelector("#banana-next"),
  phase: document.querySelector("#phase-value"),
  phaseDot: document.querySelector("#phase-dot"),
  boostBadge: document.querySelector("#boost-badge"),
  boostValue: document.querySelector("#boost-value"),
  countdown: document.querySelector("#countdown"),
  countdownValue: document.querySelector("#countdown-value"),
  toast: document.querySelector("#toast"),
  bananaScoreFx: document.querySelector("#banana-score-fx"),
  soundButton: document.querySelector("#sound-button"),
  homeSoundButton: document.querySelector("#home-sound-button"),
  motionButton: document.querySelector("#motion-button"),
  controlTitle: document.querySelector("#control-title"),
  controlDetail: document.querySelector("#control-detail"),
  stormFlash: document.querySelector("#storm-flash"),
  playerNameInput: document.querySelector("#player-name-input"),
  playerNameMessage: document.querySelector("#player-name-message"),
  homeBestScore: document.querySelector("#home-best-score-value"),
  resultIcon: document.querySelector("#result-icon"),
  resultKicker: document.querySelector("#result-kicker"),
  resultTitle: document.querySelector("#result-title"),
  resultMessage: document.querySelector("#result-message"),
  resultScore: document.querySelector("#result-score"),
  resultBestScoreLabel: document.querySelector("#result-best-score-label"),
  resultBestScore: document.querySelector("#result-best-score-value"),
  resultNewRecord: document.querySelector("#result-new-record"),
  resultTime: document.querySelector("#result-time"),
  resultBananas: document.querySelector("#result-bananas"),
  resultBonus: document.querySelector("#result-bonus"),
  rankingStatus: document.querySelector("#ranking-status"),
  resultRanking: document.querySelector("#result-ranking"),
  resultRankingMessage: document.querySelector("#result-ranking-message"),
  resultRankingList: document.querySelector("#result-ranking-list"),
  resultRankingDetailLink: document.querySelector(
    "#result-ranking-detail-link",
  ),
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(value) {
  return 1 - (1 - value) ** 3;
}

function safeStorageGet(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or restricted browser modes.
  }
}

function normalizeDisplayName(value) {
  return String(value || "").trim().slice(0, 10);
}

class SeededRandom {
  constructor(seed) {
    this.state = seed >>> 0 || 0x6d2b79f5;
  }

  next() {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }
}

class AudioController {
  constructor() {
    this.enabled = safeStorageGet("goriragouu-sound", "off") === "on";
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
  }

  async unlock() {
    if (!this.enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.42;
      this.master.connect(this.context.destination);
      this.noiseBuffer = this.createNoiseBuffer();
    }

    if (this.context.state === "suspended") {
      try {
        await this.context.resume();
      } catch {
        // The next explicit user gesture will try again.
      }
    }
  }

  createNoiseBuffer() {
    if (!this.context) return null;
    const length = Math.floor(this.context.sampleRate * 1.2);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    safeStorageSet("goriragouu-sound", enabled ? "on" : "off");
    if (this.master) {
      this.master.gain.setTargetAtTime(
        enabled ? 0.42 : 0,
        this.context.currentTime,
        0.025,
      );
    }
  }

  tone(frequency, duration, options = {}) {
    if (!this.enabled || !this.context || !this.master) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = options.type || "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    if (options.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, options.endFrequency),
        now + duration,
      );
    }
    gain.gain.setValueAtTime(options.volume || 0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  banana() {
    this.tone(720, 0.11, { endFrequency: 980, volume: 0.09, type: "triangle" });
  }

  bonus() {
    [0, 0.1, 0.2].forEach((offset, index) => {
      window.setTimeout(() => {
        this.tone([520, 660, 880][index], 0.18, {
          endFrequency: [620, 780, 1080][index],
          volume: 0.11,
          type: "triangle",
        });
      }, offset * 1000);
    });
  }

  countdown(value) {
    this.tone(value === 0 ? 880 : 360 + (3 - value) * 70, value === 0 ? 0.26 : 0.1, {
      endFrequency: value === 0 ? 1180 : 300,
      volume: 0.1,
      type: "square",
    });
  }

  storm() {
    if (!this.enabled || !this.context || !this.master || !this.noiseBuffer) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(430, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + 0.8);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.095, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.88);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(now);
    source.stop(now + 0.92);
  }

  gorilla() {
    this.tone(115, 0.34, {
      endFrequency: 58,
      volume: 0.13,
      type: "sawtooth",
    });
  }

  gameOver() {
    this.tone(210, 0.65, {
      endFrequency: 55,
      volume: 0.16,
      type: "sawtooth",
    });
  }

  clear() {
    this.tone(460, 0.8, {
      endFrequency: 1120,
      volume: 0.14,
      type: "triangle",
    });
  }
}

class RankingClient {
  constructor() {
    this.clientPromise = null;
  }

  connect() {
    if (!this.clientPromise) {
      this.clientPromise = import(SUPABASE_MODULE_URL)
        .then(({ createClient }) =>
          createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
              detectSessionInUrl: false,
            },
          }),
        )
        .catch((error) => {
          console.warn("ランキング機能の読み込みに失敗しました。", error);
          this.clientPromise = null;
          return null;
        });
    }
    return this.clientPromise;
  }

  async submit(displayName, score) {
    const client = await this.connect();
    if (!client) throw new Error("ranking client unavailable");

    const { data, error } = await client.rpc("submit_score", {
      p_display_name: displayName,
      p_game_slug: GAME_SLUG,
      p_score: Math.trunc(Number(score || 0)),
      p_client_version: CLIENT_VERSION,
    });
    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;
    if (!result || result.accepted !== true) {
      throw new Error("score was not accepted");
    }
    return result;
  }

  async getBestScores(limit = RESULT_RANKING_LIMIT) {
    const client = await this.connect();
    if (!client) throw new Error("ranking client unavailable");

    const { data, error } = await client.rpc("get_best_score_ranking", {
      p_game_slug: GAME_SLUG,
      p_limit: limit,
    });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }
}

class VirtualStick {
  constructor(element, joystick, knob, canStart) {
    this.element = element;
    this.joystick = joystick;
    this.knob = knob;
    this.canStart = canStart;
    this.pointerId = null;
    this.originX = 0;
    this.originY = 0;
    this.x = 0;
    this.y = 0;
    this.maxDistance = IS_MOBILE ? 58 : 72;
    this.keys = new Set();
    this.safeAreaProbe = document.createElement("div");
    this.safeAreaProbe.setAttribute("aria-hidden", "true");
    Object.assign(this.safeAreaProbe.style, {
      position: "fixed",
      width: "0",
      height: "0",
      visibility: "hidden",
      pointerEvents: "none",
    });
    document.body.appendChild(this.safeAreaProbe);

    element.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    element.addEventListener("pointermove", (event) => this.onPointerMove(event));
    element.addEventListener("pointerup", (event) => this.onPointerEnd(event));
    element.addEventListener("pointercancel", (event) => this.onPointerEnd(event));
    element.addEventListener("lostpointercapture", (event) => this.onPointerEnd(event));
    element.addEventListener("contextmenu", (event) => event.preventDefault());
    element.addEventListener("dragstart", (event) => event.preventDefault());

    window.addEventListener("keydown", (event) => this.onKey(event, true));
    window.addEventListener("keyup", (event) => this.onKey(event, false));
  }

  onPointerDown(event) {
    if (!this.canStart() || this.pointerId !== null || !event.isPrimary) return;
    event.preventDefault();
    this.pointerId = event.pointerId;
    this.originX = event.clientX;
    this.originY = event.clientY;
    this.element.setPointerCapture(event.pointerId);

    const safeLeft = this.readSafeInset("--safe-left", 14);
    const safeRight = this.readSafeInset("--safe-right", 14);
    const safeTop = this.readSafeInset("--safe-top", 14);
    const safeBottom = this.readSafeInset("--safe-bottom", 16);
    const visualRadius = 56;
    const safeX = clamp(
      event.clientX,
      safeLeft + visualRadius + 8,
      window.innerWidth - safeRight - visualRadius - 8,
    );
    const safeY = clamp(
      event.clientY,
      safeTop + visualRadius + 8,
      window.innerHeight - safeBottom - visualRadius - 8,
    );
    this.joystick.style.left = `${safeX}px`;
    this.joystick.style.top = `${safeY}px`;
    this.joystick.classList.add("visible");
    this.updateKnob(0, 0);
  }

  readSafeInset(property, fallback) {
    this.safeAreaProbe.style.paddingLeft = `var(${property})`;
    const value = Number.parseFloat(
      getComputedStyle(this.safeAreaProbe).paddingLeft,
    );
    return Number.isFinite(value) ? value : fallback;
  }

  onPointerMove(event) {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - this.originX;
    const deltaY = event.clientY - this.originY;
    const distance = Math.hypot(deltaX, deltaY);
    const limited = Math.min(this.maxDistance, distance);
    const normalX = distance > 0 ? deltaX / distance : 0;
    const normalY = distance > 0 ? deltaY / distance : 0;
    const strength = clamp((distance - 7) / (this.maxDistance - 7), 0, 1);
    this.x = normalX * strength;
    this.y = -normalY * strength;
    this.updateKnob(normalX * limited, normalY * limited);
  }

  onPointerEnd(event) {
    if (event.pointerId !== this.pointerId) return;
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
    this.resetPointer();
  }

  onKey(event, isDown) {
    const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"];
    if (!keys.includes(event.key)) return;
    if (this.canStart()) event.preventDefault();
    if (isDown) {
      this.keys.add(event.key);
    } else {
      this.keys.delete(event.key);
    }
  }

  updateKnob(x, y) {
    this.knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  resetPointer() {
    this.pointerId = null;
    this.x = 0;
    this.y = 0;
    this.joystick.classList.remove("visible");
    this.updateKnob(0, 0);
  }

  reset() {
    this.resetPointer();
    this.keys.clear();
  }

  getVector(target) {
    let keyX = 0;
    let keyY = 0;
    if (this.keys.has("ArrowLeft") || this.keys.has("a")) keyX -= 1;
    if (this.keys.has("ArrowRight") || this.keys.has("d")) keyX += 1;
    if (this.keys.has("ArrowUp") || this.keys.has("w")) keyY += 1;
    if (this.keys.has("ArrowDown") || this.keys.has("s")) keyY -= 1;
    if (keyX || keyY) {
      return target.set(keyX, keyY).normalize();
    }
    return target.set(this.x, this.y);
  }
}

class BananaField {
  constructor(scene, random, isBlocked, maxCount = 16) {
    this.random = random;
    this.isBlocked =
      typeof isBlocked === "function" ? isBlocked : () => false;
    this.maxCount = maxCount;
    this.items = Array.from({ length: maxCount }, (_, index) => ({
      index,
      active: false,
      normal: new THREE.Vector3(),
      spin: random.range(0, Math.PI * 2),
      phase: random.range(0, Math.PI * 2),
      respawnAt: 0,
    }));
    this.torusGeometry = new THREE.TorusGeometry(0.34, 0.09, 6, 13, Math.PI * 1.45);
    this.tipGeometry = new THREE.SphereGeometry(0.085, 6, 4);
    this.bananaMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd22e,
      roughness: 0.58,
      metalness: 0.02,
      emissive: 0x614600,
      emissiveIntensity: 0.2,
      side: THREE.DoubleSide,
    });
    this.tipMaterial = new THREE.MeshStandardMaterial({
      color: 0x6f421f,
      roughness: 0.9,
    });
    this.bananas = new THREE.InstancedMesh(
      this.torusGeometry,
      this.bananaMaterial,
      maxCount,
    );
    this.tips = new THREE.InstancedMesh(
      this.tipGeometry,
      this.tipMaterial,
      maxCount * 2,
    );
    this.bananas.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bananas.frustumCulled = false;
    this.tips.frustumCulled = false;
    this.bananas.count = 0;
    this.tips.count = 0;
    scene.add(this.bananas, this.tips);

    this.rootMatrix = new THREE.Matrix4();
    this.bananaMatrix = new THREE.Matrix4();
    this.localMatrix = new THREE.Matrix4();
    this.worldMatrix = new THREE.Matrix4();
    this.quaternion = new THREE.Quaternion();
    this.spinQuaternion = new THREE.Quaternion();
    this.euler = new THREE.Euler();
    this.position = new THREE.Vector3();
    this.scale = new THREE.Vector3(1, 1, 1);
    this.tipScale = new THREE.Vector3(1, 1, 1);
    this.right = new THREE.Vector3();
    this.back = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.tangent = new THREE.Vector3();
  }

  reset(playerNormal, playerFacing) {
    for (const item of this.items) {
      item.active = false;
      item.respawnAt = 0;
      this.place(item, playerNormal, playerFacing);
    }
    this.bananas.count = 0;
    this.tips.count = 0;
  }

  // Places `target` at the given surface distance from `playerNormal`, at a
  // bearing measured from `playerFacing` (0 = straight ahead of the
  // player's actual movement direction). Distance is arc length (same units
  // as PLANET_RADIUS), matching how storms/gorillas measure spawn distance.
  placeAtSurfaceDistance(target, playerNormal, playerFacing, distance) {
    this.right.crossVectors(playerFacing, playerNormal).normalize();
    const bearing = pickBananaBearing(this.random);
    this.tangent
      .copy(playerFacing)
      .multiplyScalar(Math.cos(bearing))
      .addScaledVector(this.right, Math.sin(bearing));
    const surfaceAngle = distance / PLANET_RADIUS;
    target
      .copy(playerNormal)
      .multiplyScalar(Math.cos(surfaceAngle))
      .addScaledVector(this.tangent, Math.sin(surfaceAngle))
      .normalize();
  }

  place(item, playerNormal, playerFacing) {
    const placed = trySurfacePlacement(
      24,
      () => {
        // Bananas spawn within a reachable annulus of surface distance from
        // the player, biased toward the direction the player is actually
        // heading, rather than uniformly over the whole sphere -- near
        // enough to be worth a detour, far enough to cost something.
        const distance = getBananaSpawnDistance(this.random);
        this.placeAtSurfaceDistance(
          item.normal,
          playerNormal,
          playerFacing,
          distance,
        );
      },
      () =>
        // Belt-and-suspenders: the band's minimum already keeps bananas off
        // the player, but this guards against a degenerate (e.g. test-only)
        // band configuration that could shrink to zero.
        item.normal.distanceToSquared(playerNormal) <= 0.045 ||
        this.isBlocked(item.normal),
    );
    if (!placed) return false;
    item.spin = this.random.range(0, Math.PI * 2);
    item.phase = this.random.range(0, Math.PI * 2);
    return true;
  }

  collect(playerNormal, time, targetCount) {
    const threshold = (BANANA_CONTACT_DISTANCE / PLANET_RADIUS) ** 2;
    for (let index = 0; index < Math.min(targetCount, this.items.length); index += 1) {
      const item = this.items[index];
      if (!item.active) continue;
      if (item.normal.distanceToSquared(playerNormal) > threshold) continue;
      item.active = false;
      item.respawnAt = time + BANANA_RESPAWN_DELAY_SECONDS;
      return true;
    }
    return false;
  }

  update(time, targetCount, playerNormal, playerFacing) {
    let bananaInstance = 0;
    let tipInstance = 0;
    const visibleTarget = Math.min(targetCount, this.items.length);

    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index];
      const shouldExist = index < visibleTarget;
      if (!shouldExist) {
        item.active = false;
        continue;
      }
      if (!item.active && time >= item.respawnAt) {
        item.active = this.place(item, playerNormal, playerFacing);
        if (!item.active) {
          item.respawnAt = time + SURFACE_PLACEMENT_RETRY_SECONDS;
        }
      } else if (item.active && item.normal.dot(playerNormal) < BANANA_LEASH_MIN_DOT) {
        // The player has moved on and left this banana behind (they never
        // move once placed); pull it back into the reachable band around
        // wherever the player is now instead of leaving it stranded.
        if (!this.place(item, playerNormal, playerFacing)) {
          item.active = false;
          item.respawnAt = time + SURFACE_PLACEMENT_RETRY_SECONDS;
        }
      }
      if (!item.active) continue;

      const bob = 0.66 + Math.sin(time * 2.4 + item.phase) * 0.09;
      this.position.copy(item.normal).multiplyScalar(PLANET_RADIUS + 0.08);
      this.quaternion.setFromUnitVectors(Y_AXIS, item.normal);
      this.rootMatrix.compose(this.position, this.quaternion, this.scale);

      this.euler.set(0, item.spin + time * 0.9, 0.42);
      this.spinQuaternion.setFromEuler(this.euler);
      this.localMatrix.compose(
        this.position.set(0, bob, 0),
        this.spinQuaternion,
        this.scale,
      );
      this.bananaMatrix.multiplyMatrices(this.rootMatrix, this.localMatrix);
      this.bananas.setMatrixAt(bananaInstance, this.bananaMatrix);

      const firstAngle = 0;
      const secondAngle = Math.PI * 1.45;
      this.setTipMatrix(tipInstance, this.bananaMatrix, firstAngle);
      tipInstance += 1;
      this.setTipMatrix(tipInstance, this.bananaMatrix, secondAngle);
      tipInstance += 1;
      bananaInstance += 1;
    }

    this.bananas.count = bananaInstance;
    this.tips.count = tipInstance;
    this.bananas.instanceMatrix.needsUpdate = true;
    this.tips.instanceMatrix.needsUpdate = true;
  }

  setTipMatrix(instanceIndex, bananaMatrix, angle) {
    this.position.set(0.34 * Math.cos(angle), 0.34 * Math.sin(angle), 0);
    this.localMatrix.compose(this.position, this.quaternion.identity(), this.tipScale);
    this.worldMatrix.multiplyMatrices(bananaMatrix, this.localMatrix);
    this.tips.setMatrixAt(instanceIndex, this.worldMatrix);
  }
}

class GorillaRenderer {
  constructor(scene, maxGorillas, useShadows) {
    this.maxGorillas = maxGorillas;
    this.boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.shadowGeometry = new THREE.CircleGeometry(0.78, 12);
    this.brownMaterial = new THREE.MeshStandardMaterial({
      color: 0x3e2c28,
      roughness: 0.92,
      metalness: 0,
    });
    this.tanMaterial = new THREE.MeshStandardMaterial({
      color: 0x8f6549,
      roughness: 0.88,
    });
    this.blackMaterial = new THREE.MeshBasicMaterial({ color: 0x100d0c });
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x071312,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });

    this.brown = new THREE.InstancedMesh(
      this.boxGeometry,
      this.brownMaterial,
      maxGorillas * 6,
    );
    this.tan = new THREE.InstancedMesh(
      this.boxGeometry,
      this.tanMaterial,
      maxGorillas * 2,
    );
    this.black = new THREE.InstancedMesh(
      this.boxGeometry,
      this.blackMaterial,
      maxGorillas * 2,
    );
    this.shadows = new THREE.InstancedMesh(
      this.shadowGeometry,
      this.shadowMaterial,
      maxGorillas,
    );

    for (const mesh of [this.brown, this.tan, this.black, this.shadows]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
    }
    this.brown.castShadow = useShadows;

    this.root = new THREE.Matrix4();
    this.local = new THREE.Matrix4();
    this.world = new THREE.Matrix4();
    this.position = new THREE.Vector3();
    this.scale = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.back = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.euler = new THREE.Euler();
  }

  update(pool, time) {
    let gorillaIndex = 0;
    let brownIndex = 0;
    let tanIndex = 0;
    let blackIndex = 0;

    for (const gorilla of pool) {
      if (!gorilla.active) continue;
      const spawnScale = easeOutCubic(clamp((time - gorilla.bornAt) / 0.28, 0.05, 1));
      const run = Math.sin((time - gorilla.bornAt) * 13 + gorilla.phase);
      const bounce = Math.abs(Math.sin((time - gorilla.bornAt) * 12 + gorilla.phase)) * 0.08;
      this.makeRoot(gorilla.normal, gorilla.forward);

      this.setPart(
        this.shadows,
        gorillaIndex,
        0,
        0.025,
        0,
        -Math.PI / 2,
        0,
        0,
        0.88 * spawnScale,
        0.88 * spawnScale,
        0.88 * spawnScale,
      );

      brownIndex = this.setBrownParts(brownIndex, run, bounce, spawnScale);
      tanIndex = this.setTanParts(tanIndex, bounce, spawnScale);
      blackIndex = this.setEyeParts(blackIndex, bounce, spawnScale);
      gorillaIndex += 1;
    }

    this.brown.count = brownIndex;
    this.tan.count = tanIndex;
    this.black.count = blackIndex;
    this.shadows.count = gorillaIndex;
    this.brown.instanceMatrix.needsUpdate = true;
    this.tan.instanceMatrix.needsUpdate = true;
    this.black.instanceMatrix.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  makeRoot(normal, forward) {
    this.right.crossVectors(forward, normal).normalize();
    this.back.copy(forward).multiplyScalar(-1);
    this.root.makeBasis(this.right, normal, this.back);
    this.position.copy(normal).multiplyScalar(PLANET_RADIUS + 0.04);
    this.root.setPosition(this.position);
  }

  setBrownParts(index, run, bounce, size) {
    this.setPart(this.brown, index, 0, 1.08 + bounce, 0, 0, 0, 0, 1.22 * size, 1.22 * size, 0.78 * size);
    index += 1;
    this.setPart(this.brown, index, 0, 2.06 + bounce, -0.04, 0, 0, 0, 0.82 * size, 0.76 * size, 0.76 * size);
    index += 1;
    this.setPart(this.brown, index, -0.88, 0.93 + bounce, -run * 0.09, run * 0.3, 0, -0.12, 0.43 * size, 1.38 * size, 0.46 * size);
    index += 1;
    this.setPart(this.brown, index, 0.88, 0.93 + bounce, run * 0.09, -run * 0.3, 0, 0.12, 0.43 * size, 1.38 * size, 0.46 * size);
    index += 1;
    this.setPart(this.brown, index, -0.37, 0.24, run * 0.14, -run * 0.42, 0, 0, 0.47 * size, 0.72 * size, 0.53 * size);
    index += 1;
    this.setPart(this.brown, index, 0.37, 0.24, -run * 0.14, run * 0.42, 0, 0, 0.47 * size, 0.72 * size, 0.53 * size);
    return index + 1;
  }

  setTanParts(index, bounce, size) {
    this.setPart(this.tan, index, 0, 1.08 + bounce, -0.405, 0, 0, 0, 0.73 * size, 0.76 * size, 0.08 * size);
    index += 1;
    this.setPart(this.tan, index, 0, 1.93 + bounce, -0.43, 0, 0, 0, 0.55 * size, 0.35 * size, 0.16 * size);
    return index + 1;
  }

  setEyeParts(index, bounce, size) {
    this.setPart(this.black, index, -0.18, 2.14 + bounce, -0.43, 0, 0, 0, 0.09 * size, 0.09 * size, 0.05 * size);
    index += 1;
    this.setPart(this.black, index, 0.18, 2.14 + bounce, -0.43, 0, 0, 0, 0.09 * size, 0.09 * size, 0.05 * size);
    return index + 1;
  }

  setPart(mesh, index, x, y, z, rx, ry, rz, sx, sy, sz) {
    this.position.set(x, y, z);
    this.euler.set(rx, ry, rz);
    this.quaternion.setFromEuler(this.euler);
    this.scale.set(sx, sy, sz);
    this.local.compose(this.position, this.quaternion, this.scale);
    this.world.multiplyMatrices(this.root, this.local);
    mesh.setMatrixAt(index, this.world);
  }
}

class StormCell {
  constructor(scene, profile, shared) {
    this.profile = profile;
    this.active = false;
    this.startedRain = false;
    this.normal = new THREE.Vector3();
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.cloud = new THREE.Group();
    this.cloud.position.y = 7.1;
    const cloudLayout = [
      [-1.2, 0, 0, 1.3],
      [0, 0.35, 0, 1.6],
      [1.25, 0.05, 0.2, 1.15],
      [0.35, -0.25, -0.7, 1.05],
    ];
    for (const [x, y, z, scale] of cloudLayout) {
      const puff = new THREE.Mesh(shared.cloudGeometry, shared.cloudMaterial);
      puff.position.set(x, y, z);
      puff.scale.setScalar(scale);
      this.cloud.add(puff);
    }
    this.group.add(this.cloud);

    const count = profile.rainDropsPerStorm;
    this.rainPositions = new Float32Array(count * 3);
    this.rainSeeds = new Float32Array(count);
    this.rainSpeeds = new Float32Array(count);
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.rainPositions, 3),
    );
    this.rainGeometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    this.rain = new THREE.Points(this.rainGeometry, shared.rainMaterial);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.group.add(this.rain);

    this.fallingPartsPerGorilla = FALLING_GORILLA_PARTS.length;
    this.fallingOffsets = Array.from(
      { length: profile.gorillasPerStorm },
      () => ({ x: 0, z: 0, phase: 0, delay: 0 }),
    );
    this.fallingGorillas = new THREE.InstancedMesh(
      shared.fallingGeometry,
      shared.fallingMaterial,
      profile.gorillasPerStorm * this.fallingPartsPerGorilla,
    );
    this.fallingGorillas.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(
        profile.gorillasPerStorm * this.fallingPartsPerGorilla * 3,
      ),
      3,
    );
    this.fallingGorillas.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fallingGorillas.frustumCulled = false;
    this.fallingGorillas.visible = false;
    this.fallingGorillas.count = 0;
    this.group.add(this.fallingGorillas);

    this.lastUpdateTime = -Infinity;
    this.fallRoot = new THREE.Matrix4();
    this.fallLocal = new THREE.Matrix4();
    this.fallWorld = new THREE.Matrix4();
    this.fallPosition = new THREE.Vector3();
    this.fallScale = new THREE.Vector3();
    this.fallUnitScale = new THREE.Vector3(1, 1, 1);
    this.fallQuaternion = new THREE.Quaternion();
    this.fallPartQuaternion = new THREE.Quaternion();
    this.fallEuler = new THREE.Euler();
    this.fallPartEuler = new THREE.Euler();
    this.fallBrownColor = new THREE.Color(0x3e2c28);
    this.fallTanColor = new THREE.Color(0x9f7456);
  }

  activate(normal, time, random) {
    this.active = true;
    this.startedAt = time;
    this.startedRain = false;
    this.lastUpdateTime = -Infinity;
    this.normal.copy(normal);
    this.group.visible = true;
    this.group.position.copy(normal).multiplyScalar(PLANET_RADIUS + 0.01);
    this.group.quaternion.setFromUnitVectors(Y_AXIS, normal);
    this.rain.visible = true;
    this.fallingGorillas.visible = true;
    this.fallingGorillas.count =
      this.profile.gorillasPerStorm * this.fallingPartsPerGorilla;
    this.cloud.scale.setScalar(1);

    for (let index = 0; index < this.rainSeeds.length; index += 1) {
      const radius = Math.sqrt(random.next()) * 2.2;
      const angle = random.range(0, Math.PI * 2);
      const offset = index * 3;
      this.rainPositions[offset] = Math.cos(angle) * radius;
      this.rainPositions[offset + 1] = random.range(0.25, 6.2);
      this.rainPositions[offset + 2] = Math.sin(angle) * radius;
      this.rainSeeds[index] = this.rainPositions[offset + 1];
      this.rainSpeeds[index] = random.range(8.5, 13.5);
    }
    for (let index = 0; index < this.fallingOffsets.length; index += 1) {
      const radius = random.range(0.35, 1.75);
      const angle = random.range(0, Math.PI * 2);
      const offset = this.fallingOffsets[index];
      offset.x = Math.cos(angle) * radius;
      offset.z = Math.sin(angle) * radius;
      offset.phase = random.range(0, Math.PI * 2);
      offset.delay = index * 0.035;
    }
    this.rainGeometry.attributes.position.needsUpdate = true;
  }

  deactivate() {
    this.active = false;
    this.group.visible = false;
    this.rain.visible = false;
    this.fallingGorillas.visible = false;
    this.fallingGorillas.count = 0;
  }

  update(time, callbacks) {
    if (!this.active) return;
    if (this.lastUpdateTime === time) return;
    this.lastUpdateTime = time;
    const age = time - this.startedAt;
    const lifecycle = getStormLifecycle(age, this.startedRain);
    this.cloud.rotation.y += 0.015;

    if (lifecycle.startRain) {
      this.startedRain = true;
      callbacks.onRainStart(this);
    }

    if (this.startedRain) {
      const rainAge = age;
      const positions = this.rainPositions;
      for (let index = 0; index < this.rainSeeds.length; index += 1) {
        const offset = index * 3 + 1;
        const height = this.rainSeeds[index] - rainAge * this.rainSpeeds[index];
        positions[offset] = ((height % 6.2) + 6.2) % 6.2 + 0.2;
      }
      this.rainGeometry.attributes.position.needsUpdate = true;
      this.updateFallingGorillas(rainAge);
    }

    if (lifecycle.impact) {
      callbacks.onImpact(this);
      this.deactivate();
    }
  }

  updateFallingGorillas(rainAge) {
    const overallProgress = clamp(rainAge / STORM_FALL_SECONDS, 0, 1);
    let instanceIndex = 0;
    for (const offset of this.fallingOffsets) {
      const progress = clamp(
        (overallProgress - offset.delay) / (1 - offset.delay),
        0,
        1,
      );
      const eased = progress * progress;
      const impactHeight = FALLING_GORILLA_MAX_REACH + 0.12;
      this.fallPosition.set(offset.x, 6.1 - eased * (6.1 - impactHeight), offset.z);
      this.fallEuler.set(
        offset.phase + rainAge * 3.2,
        offset.phase * 0.7 + rainAge * 2.4,
        rainAge * 2.1,
      );
      this.fallQuaternion.setFromEuler(this.fallEuler);
      this.fallRoot.compose(
        this.fallPosition,
        this.fallQuaternion,
        this.fallUnitScale,
      );

      for (const part of FALLING_GORILLA_PARTS) {
        instanceIndex = this.setFallingPart(instanceIndex, part);
      }
    }
    this.fallingGorillas.instanceMatrix.needsUpdate = true;
    this.fallingGorillas.instanceColor.needsUpdate = true;
  }

  setFallingPart(index, part) {
    this.fallPosition.set(part.x, part.y, part.z);
    this.fallScale.set(part.sx, part.sy, part.sz);
    this.fallPartEuler.set(part.rx, part.ry, part.rz);
    this.fallPartQuaternion.setFromEuler(this.fallPartEuler);
    this.fallLocal.compose(
      this.fallPosition,
      this.fallPartQuaternion,
      this.fallScale,
    );
    this.fallWorld.multiplyMatrices(this.fallRoot, this.fallLocal);
    this.fallingGorillas.setMatrixAt(index, this.fallWorld);
    this.fallingGorillas.setColorAt(
      index,
      part.tone === "tan" ? this.fallTanColor : this.fallBrownColor,
    );
    return index + 1;
  }
}

// Deterministic integer hash used only to pick each faller's *next* landing
// spot when it loops back to the cloud shell. It is a pure function of
// (faller index, loop count) -- never Math.random(), never the shared
// SeededRandom stream -- so the ambient rain never perturbs the sequence
// gameplay code draws from `this.random` for real spawns, and a given
// ?seed=/time combination always looks the same.
function orbitalHash(n) {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

// Planet-scale ambient weather: a shell of grey storm clouds ringing the
// whole sphere, plus a pool of gorilla silhouettes that continuously fall
// inward (down each faller's own -normal) from the shell toward the surface
// and loop back to a new spot once they land. Entirely decorative -- it
// never touches gorillaPool/StormCell/collision code, following the same
// instanced root/local/world matrix pattern as GorillaRenderer/StormCell.
class OrbitalRain {
  constructor(scene, cloudCount, fallerCount, random) {
    this.fallerCount = fallerCount;
    this.partsPerFaller = FALLING_GORILLA_PARTS.length;

    this.cloudGroup = new THREE.Group();
    scene.add(this.cloudGroup);
    const puffsPerCloud = 4;
    // flatShading:false (smooth normals) is what keeps these reading as puffy
    // storm clouds rather than faceted grey boulders -- the low-poly puff
    // silhouette stays, but the hard per-face lighting jumps go away. The
    // base material colour is white so the per-instance HSL colour set in
    // buildClouds is the only thing controlling brightness (a mid-grey base
    // times a mid-grey instance colour was multiplying down to near-black).
    const puffGeometry = new THREE.IcosahedronGeometry(1, 1);
    const puffMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      flatShading: false,
    });
    this.clouds = new THREE.InstancedMesh(
      puffGeometry,
      puffMaterial,
      Math.max(1, cloudCount * puffsPerCloud),
    );
    this.clouds.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(Math.max(1, cloudCount * puffsPerCloud) * 3),
      3,
    );
    this.clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.clouds.frustumCulled = false;
    this.cloudGroup.add(this.clouds);
    this.buildClouds(cloudCount, puffsPerCloud, random);

    // MeshStandardMaterial (not the old MeshLambertMaterial) so these pick up
    // the same hemisphere/sun/fill lighting response as the real gorillas
    // instead of reading flat and dark. The material colour is white and the
    // actual brown/tan comes from per-part instanceColor below, matching
    // GorillaRenderer's real brown (0x3e2c28) / tan (0x8f6549) palette so the
    // fallers read as gorilla bodies, not black silhouettes.
    //
    // That alone is not enough, though: this.sun/this.fillLight are repointed
    // every frame to shine locally "down" on wherever the player currently
    // stands (see updateCamera), because that is what makes the player's own
    // patch of terrain read correctly. A faller anywhere else on the globe --
    // which is most of them, since this rain rings the whole sphere -- can
    // sit well outside both directional lights' reach and fall back to
    // hemisphere ambient alone, which a dark brown albedo still renders as
    // near-black under ACES tonemapping. A modest emissive floor (tuned low
    // enough that direct/hemisphere light still visibly brightens and shades
    // the lit ones) guarantees every faller reads as a dim-but-visible brown
    // body instead of a black speck, no matter where on the sphere it is or
    // how far the player-anchored sun currently points.
    const bodyGeometry = new THREE.BoxGeometry(1, 1, 1);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0,
      emissive: 0x35241b,
      emissiveIntensity: 1.5,
    });
    const fallerInstanceCount = Math.max(1, fallerCount * this.partsPerFaller);
    this.fallers = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, fallerInstanceCount);
    this.fallers.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(fallerInstanceCount * 3),
      3,
    );
    this.fallers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fallers.frustumCulled = false;
    this.fallers.count = 0;
    scene.add(this.fallers);
    this.brownColor = new THREE.Color(0x3e2c28);
    this.tanColor = new THREE.Color(0x8f6549);

    this.startHeight = new Float32Array(fallerCount);
    this.fallSpeed = new Float32Array(fallerCount);
    this.phase = new Float32Array(fallerCount);
    this.tumbleSeed = new Float32Array(fallerCount);
    this.tumbleSpeed = new Float32Array(fallerCount);
    this.bodyScale = new Float32Array(fallerCount);
    for (let index = 0; index < fallerCount; index += 1) {
      this.startHeight[index] = random.range(
        ORBITAL_FALLER_HEIGHT_MIN,
        ORBITAL_FALLER_HEIGHT_MAX,
      );
      this.fallSpeed[index] = random.range(1.3, 2.2);
      this.phase[index] = random.range(0, 400);
      this.tumbleSeed[index] = random.range(0, Math.PI * 2);
      this.tumbleSpeed[index] = random.range(1.4, 3);
      // The old three-box silhouette needed an extreme scale to stay legible.
      // The shared eight-part outline is readable at a smaller scale, which
      // also leaves a verifiable air gap above the planet at the recycle point.
      this.bodyScale[index] = random.range(
        ORBITAL_FALLER_SCALE_MIN,
        ORBITAL_FALLER_SCALE_MAX,
      );
    }

    this.normal = new THREE.Vector3();
    this.position = new THREE.Vector3();
    this.partQuaternion = new THREE.Quaternion();
    this.rootQuaternion = new THREE.Quaternion();
    this.tumbleQuaternion = new THREE.Quaternion();
    this.tumbleEuler = new THREE.Euler();
    this.partEuler = new THREE.Euler();
    this.unitScale = new THREE.Vector3(1, 1, 1);
    this.bodyMatrix = new THREE.Matrix4();
    this.localMatrix = new THREE.Matrix4();
    this.worldMatrix = new THREE.Matrix4();
    this.partPosition = new THREE.Vector3();
    this.partScale = new THREE.Vector3();
  }

  buildClouds(cloudCount, puffsPerCloud, random) {
    const rootMatrix = new THREE.Matrix4();
    const localMatrix = new THREE.Matrix4();
    const worldMatrix = new THREE.Matrix4();
    const normal = new THREE.Vector3();
    const rootQuaternion = new THREE.Quaternion();
    const identityQuaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const rootScale = new THREE.Vector3(1, 1, 1);
    const puffPosition = new THREE.Vector3();
    const puffScale = new THREE.Vector3();
    const color = new THREE.Color();
    const puffOffsets = [
      [-1.25, 0.05, 0],
      [0.1, 0.32, 0.05],
      [1.2, -0.05, 0.18],
      [0.25, -0.22, -0.75],
    ];

    let instanceIndex = 0;
    for (let cloudIndex = 0; cloudIndex < cloudCount; cloudIndex += 1) {
      const y = random.range(-1, 1);
      const angle = random.range(0, Math.PI * 2);
      const radiusXZ = Math.sqrt(Math.max(0, 1 - y * y));
      normal.set(Math.cos(angle) * radiusXZ, y, Math.sin(angle) * radiusXZ);

      const shellRadius = random.range(ORBITAL_CLOUD_SHELL_MIN, ORBITAL_CLOUD_SHELL_MAX);
      position.copy(normal).multiplyScalar(shellRadius);
      rootQuaternion.setFromUnitVectors(Y_AXIS, normal);
      rootMatrix.compose(position, rootQuaternion, rootScale);

      const cloudScale = random.range(1.7, 3.2);
      // Grey with only a faint blue-green cast -- distinct from the pale
      // warm smudges this replaces, and from the near-black storm clouds
      // StormCell uses for the real threat telegraph. Lightness raised from
      // the original 0.32-0.46 (which, combined with the material's own
      // mid-grey base colour, multiplied down into near-black "boulders");
      // the material base is now white so this value alone sets the shade,
      // and it is picked bright enough to read as storm-grey without going
      // pale or wispy.
      const lightness = random.range(0.36, 0.48);
      color.setHSL(0.57, 0.07, lightness);

      for (const [ox, oy, oz] of puffOffsets) {
        const puffSize = cloudScale * random.range(0.55, 1.05);
        puffPosition.set(
          ox * cloudScale + random.range(-0.15, 0.15),
          oy * cloudScale,
          oz * cloudScale,
        );
        puffScale.set(puffSize, puffSize * random.range(0.62, 0.88), puffSize);
        localMatrix.compose(puffPosition, identityQuaternion, puffScale);
        worldMatrix.multiplyMatrices(rootMatrix, localMatrix);
        this.clouds.setMatrixAt(instanceIndex, worldMatrix);
        color.offsetHSL(0, 0, random.range(-0.04, 0.04));
        this.clouds.setColorAt(instanceIndex, color);
        instanceIndex += 1;
      }
    }
    this.clouds.count = instanceIndex;
    this.clouds.instanceMatrix.needsUpdate = true;
    this.clouds.instanceColor.needsUpdate = true;
  }

  updateFallers(time, cullNormal) {
    let instanceIndex = 0;
    for (let index = 0; index < this.fallerCount; index += 1) {
      const totalDistance = this.startHeight[index] - ORBITAL_FALLER_LOW;
      const period = totalDistance / this.fallSpeed[index];
      const raw = (time + this.phase[index]) / period;
      const loopCount = Math.floor(raw);
      const frac = raw - loopCount;
      // Altitude above the surface: starts near the cloud shell (frac=0)
      // and shrinks toward ORBITAL_FALLER_LOW (frac=1) -- always advancing
      // downward along -normal, never sideways in world space.
      const altitude = ORBITAL_FALLER_LOW + totalDistance * (1 - frac);

      const key = (index * 92821 + loopCount * 50261) | 0;
      // Latitude is biased toward where the home/result orbit camera actually
      // looks (see ORBITAL_FALLER_LATITUDE_BIAS above) rather than sampled
      // uniformly over the whole sphere; longitude stays fully uniform since
      // that camera's azimuth keeps rotating, so every longitude eventually
      // faces it.
      const y = Math.max(
        -1,
        Math.min(
          1,
          ORBITAL_FALLER_LATITUDE_BIAS +
            (orbitalHash(key) * 2 - 1) * ORBITAL_FALLER_LATITUDE_SPREAD,
        ),
      );
      const angle = orbitalHash(key + 12345) * Math.PI * 2;
      const radiusXZ = Math.sqrt(Math.max(0, 1 - y * y));
      this.normal.set(Math.cos(angle) * radiusXZ, y, Math.sin(angle) * radiusXZ);

      // Never draw decorative fallers over the near face of the planet.
      // During play cullNormal follows the player; on home/result it follows
      // the orbit camera. Far-side fallers remain visible beyond the limb,
      // but cannot masquerade as objects stuck to the ground.
      if (this.normal.dot(cullNormal) > ORBITAL_NEAR_SIDE_DOT) {
        continue;
      }

      this.position.copy(this.normal).multiplyScalar(PLANET_RADIUS + altitude);
      this.rootQuaternion.setFromUnitVectors(Y_AXIS, this.normal);
      this.tumbleEuler.set(
        this.tumbleSeed[index] * 1.7 + time * this.tumbleSpeed[index],
        this.tumbleSeed[index] * 0.9 + time * this.tumbleSpeed[index] * 0.6,
        time * this.tumbleSpeed[index] * 1.3,
      );
      this.tumbleQuaternion.setFromEuler(this.tumbleEuler);
      this.rootQuaternion.multiply(this.tumbleQuaternion);
      this.bodyMatrix.compose(this.position, this.rootQuaternion, this.unitScale);

      const size = this.bodyScale[index];
      for (const part of FALLING_GORILLA_PARTS) {
        instanceIndex = this.setPart(
          instanceIndex,
          part.tone === "tan" ? this.tanColor : this.brownColor,
          part,
          size,
        );
      }
    }
    this.fallers.count = instanceIndex;
    this.fallers.instanceMatrix.needsUpdate = true;
    this.fallers.instanceColor.needsUpdate = true;
  }

  setPart(index, color, part, size) {
    this.partPosition.set(part.x * size, part.y * size, part.z * size);
    this.partScale.set(part.sx * size, part.sy * size, part.sz * size);
    this.partEuler.set(part.rx, part.ry, part.rz);
    this.partQuaternion.setFromEuler(this.partEuler);
    this.localMatrix.compose(this.partPosition, this.partQuaternion, this.partScale);
    this.worldMatrix.multiplyMatrices(this.bodyMatrix, this.localMatrix);
    this.fallers.setMatrixAt(index, this.worldMatrix);
    this.fallers.setColorAt(index, color);
    return index + 1;
  }
}

class GorillaRainGame {
  constructor() {
    this.profile = { ...getDeviceProfile(IS_MOBILE) };
    if (QUALITY_OVERRIDE === "low") {
      this.profile.maxPixelRatio = Math.min(1, this.profile.maxPixelRatio);
      this.profile.rainDropsPerStorm = Math.min(260, this.profile.rainDropsPerStorm);
      this.profile.realShadows = false;
      this.profile.ambientCloudCount = Math.min(8, this.profile.ambientCloudCount);
      this.profile.ambientFallerCount = Math.min(8, this.profile.ambientFallerCount);
    }

    this.sound = new AudioController();
    this.ranking = new RankingClient();
    this.motionEnabled =
      safeStorageGet("goriragouu-motion", "off") === "on" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.displayName = "";
    this.scoreSubmissionRunId = 0;
    this.scoreSubmitAttempted = false;
    this.scoreSubmitFinished = false;
    this.webglContextLost = false;
    this.contextLossPreviousMode = "home";
    this.mode = "home";
    this.resumeFromMode = "playing";
    this.gameElapsed = 0;
    this.bananaCount = 0;
    this.boostUntil = 0;
    this.currentStage = getStage(0);
    this.nextStormAt = 1.2;
    this.countdownRemaining = 3;
    this.accumulator = 0;
    this.lastFrameAt = performance.now();
    this.ambientTime = 0;
    this.cameraShake = 0;
    this.toastTimer = 0;
    this.scoreFxTimer = 0;
    this.lastCountdownNumber = -1;
    this.pixelRatio = 0;
    this.performanceFrames = 0;
    this.performanceSeconds = 0;
    this.performanceCooldown = 0;
    this.lastHudUpdateAt = -Infinity;

    const seedParam = Number.parseInt(URL_PARAMS.get("seed") || "", 10);
    this.hasFixedSeed = Number.isFinite(seedParam);
    this.seed = this.hasFixedSeed ? seedParam >>> 0 : Date.now() >>> 0;
    this.random = new SeededRandom(this.seed);
    this.straightStormRandom = new SeededRandom(this.seed ^ 0x6a09e667);

    this.playerNormal = new THREE.Vector3(0, 1, 0);
    this.playerFacing = new THREE.Vector3(0, 0, -1);
    this.viewForward = new THREE.Vector3(0, 0, -1);
    this.inputVector = new THREE.Vector2();
    this.desiredMove = new THREE.Vector3();
    this.viewRight = new THREE.Vector3();
    this.previousNormal = new THREE.Vector3();
    this.tempA = new THREE.Vector3();
    this.tempB = new THREE.Vector3();
    this.tempC = new THREE.Vector3();
    this.moveCandidate = new THREE.Vector3();
    this.slideDirection = new THREE.Vector3();
    this.obstacleAway = new THREE.Vector3();
    this.travelHeading = new THREE.Vector3(0, 0, -1);
    this.straightRunHeading = new THREE.Vector3(0, 0, -1);
    this.straightStormCandidate = new THREE.Vector3();
    this.straightStormBestCandidate = new THREE.Vector3();
    this.regularStormBestCandidate = new THREE.Vector3();
    this.orbitalViewNormal = new THREE.Vector3();
    this.scoreFxPosition = new THREE.Vector3();
    this.tempQuaternion = new THREE.Quaternion();
    this.straightTransportQuaternion = new THREE.Quaternion();
    this.tempMatrix = new THREE.Matrix4();
    this.treeObstacles = [];
    this.rockSlowZones = [];
    this.straightRunDistance = 0;
    this.straightRunIdleSeconds = 0;
    this.straightStormPending = false;
    this.currentPlayerSurfaceSpeed = 0;
    this.playerSpeedFactor = 0;

    this.gorillaPool = Array.from(
      { length: this.profile.maxGorillas },
      (_, index) => {
        const reservedForStraight =
          index >= this.profile.regularMaxGorillas;
        const phaseRandom = reservedForStraight
          ? this.straightStormRandom
          : this.random;
        return {
          index,
          active: false,
          reservedForStraight,
          normal: new THREE.Vector3(),
          forward: new THREE.Vector3(0, 0, -1),
          bornAt: 0,
          dangerAt: 0,
          expiresAt: 0,
          speed: 4.58,
          phase: phaseRandom.range(0, Math.PI * 2),
        };
      },
    );

    this.initializeRenderer();
    this.initializeScene();
    this.initializeWorld();
    this.initializePlayer();
    this.initializeEffects();

    this.bananaField = new BananaField(
      this.scene3d,
      this.random,
      (normal) => this.isTreeContact(normal),
    );
    this.bananaField.reset(this.playerNormal, this.playerFacing);
    this.gorillaRenderer = new GorillaRenderer(
      this.scene3d,
      this.profile.maxGorillas,
      this.profile.realShadows,
    );
    this.createStormPool();

    this.controls = new VirtualStick(
      ui.gameInput,
      ui.joystick,
      ui.joystickKnob,
      () => this.mode === "playing",
    );

    this.loadBestScore();
    this.loadPlayerName();
    this.bindUI();
    this.updateOptionButtons();
    this.updateControlCopy();
    this.resetGameState();
    this.updateBestScoreDisplays();
    window.setTimeout(() => {
      void this.ranking.connect();
    }, 0);
    this.showScreen("home");
    this.onResize();
    window.__GORILLA_RAIN_READY__ = true;
    ui.loading.hidden = true;
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  initializeRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.32;
    this.renderer.shadowMap.enabled = this.profile.realShadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.renderer.domElement.addEventListener(
      "webglcontextlost",
      (event) => this.handleWebGLContextLost(event),
      false,
    );
    this.renderer.domElement.addEventListener(
      "webglcontextrestored",
      () => this.handleWebGLContextRestored(),
      false,
    );
    ui.scene.appendChild(this.renderer.domElement);
  }

  initializeScene() {
    this.scene3d = new THREE.Scene();
    this.scene3d.background = null;
    this.scene3d.fog = new THREE.FogExp2(SKY_FOG_COLOR.getHex(), 0.0051);
    this.camera = new THREE.PerspectiveCamera(IS_MOBILE ? 58 : 52, 1, 0.1, 280);
    this.baseFov = this.camera.fov;

    // Ground colour lightened and intensity raised versus the radius-18
    // tuning: at the bigger PLANET_RADIUS=30 scale, the far side of the
    // globe (away from the sun) previously fell close to black, and trees
    // planted there rendered as near-black spikes. This ambient floor is
    // independent of the sun's directional occlusion, so it lifts every
    // surface equally without flattening the lit side.
    const hemisphere = new THREE.HemisphereLight(0x5688a0, 0x3c5c46, 2.55);
    this.scene3d.add(hemisphere);

    this.sun = new THREE.DirectionalLight(0xffd9a0, 2.3);
    this.sun.position.set(12, 30, 18);
    this.sun.castShadow = this.profile.realShadows;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -15;
    this.sun.shadow.camera.right = 15;
    this.sun.shadow.camera.top = 15;
    this.sun.shadow.camera.bottom = -15;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 52;
    this.sun.shadow.bias = -0.00045;
    this.sun.target.position.set(0, PLANET_RADIUS, 0);
    this.scene3d.add(this.sun, this.sun.target);

    // Given to both devices now (a second directional light with no shadow
    // map is cheap) specifically so far-side foliage keeps some colour
    // instead of going black on mobile too; PC gets a slightly stronger dose
    // to match its bigger, more visible tree counts.
    this.fillLight = new THREE.DirectionalLight(0x6f97bd, IS_MOBILE ? 0.85 : 1.1);
    this.fillLight.position.set(-14, -6, -12);
    this.fillLight.target.position.set(0, PLANET_RADIUS, 0);
    this.scene3d.add(this.fillLight, this.fillLight.target);

    this.createSkyDome();
  }

  createSkyDome() {
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDirection: { value: SUN_SKY_DIRECTION.clone() },
        uZenithColor: { value: SKY_ZENITH_COLOR.clone() },
        uMidColor: { value: SKY_MID_COLOR.clone() },
        uHorizonColor: { value: SKY_HORIZON_COLOR.clone() },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunDirection;
        uniform vec3 uZenithColor;
        uniform vec3 uMidColor;
        uniform vec3 uHorizonColor;
        varying vec3 vWorldPosition;

        void main() {
          vec3 viewDir = normalize(vWorldPosition);
          float height = viewDir.y;

          // Deep teal/navy dominates at every viewing angle, including the
          // near-horizontal gameplay camera. Only above the horizon does the
          // dome lighten toward the zenith colour; below it stays the same
          // deep mid tone rather than brightening.
          vec3 sky = mix(uMidColor, uZenithColor, smoothstep(-0.1, 0.75, height));

          // The warm accent is confined to a thin, desaturated band right at
          // the horizon (height ~ 0). Narrow smoothstep + low amplitude keeps
          // this a sliver, never a wall of colour, so home and gameplay read
          // as the same sky from different angles.
          float horizonBand = 1.0 - smoothstep(0.0, 0.09, abs(height));
          vec3 horizonTint = mix(uHorizonColor, uMidColor, 0.6);
          sky = mix(sky, horizonTint, horizonBand * 0.4);

          float shimmer =
            sin(viewDir.x * 30.0 + viewDir.z * 24.0 + uTime * 0.35) * 0.01 * horizonBand;
          sky += shimmer;

          // Small, tight sun glow disc only -- it must read as a bright spot,
          // not tint the whole dome.
          float sunDot = max(dot(viewDir, uSunDirection), 0.0);
          float core = pow(sunDot, 46.0);
          float halo = pow(sunDot, 7.0) * 0.1;
          sky += (core * 0.9 + halo) * vec3(1.0, 0.82, 0.52);

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });
    this.skyMaterial = skyMaterial;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 20), skyMaterial);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene3d.add(this.sky);
  }

  sampleTerrain(vertex) {
    const { x, y, z } = vertex;
    // Two broad, low-frequency octaves only: this keeps elevation spatially
    // coherent so basins read as continuous shapes rather than single
    // isolated triangles jumping to a different colour at random (a
    // high-frequency third octave used to live here and produced exactly
    // that speckle).
    const a = Math.sin(x * 1.1 + z * 0.9) * 0.5 + Math.cos(y * 1.3 - x * 0.7) * 0.5;
    const b =
      Math.sin(x * 2.2 - y * 1.8 + z * 1.4) * 0.5 + Math.cos(z * 2.5 + y * 1.1) * 0.5;
    const raw = a * 0.7 + b * 0.3;
    const elevation = clamp(raw * 0.4 + 0.78, 0, 1);
    return { elevation };
  }

  terrainColor(elevation, vertex, target) {
    const stops = this.terrainStops;
    let index = 0;
    while (index < stops.length - 2 && elevation > stops[index + 1].at) index += 1;
    const lower = stops[index];
    const upper = stops[index + 1];
    const span = upper.at - lower.at;
    const t = span > 0.0001 ? clamp((elevation - lower.at) / span, 0, 1) : 0;
    target.lerpColors(lower.color, upper.color, t);
    // Tiny deterministic per-vertex jitter for texture, kept low-amplitude so
    // no single facet stands out in colour from its neighbours.
    const jitter =
      Math.sin(vertex.x * 53.7 + vertex.y * 19.1) * Math.cos(vertex.z * 41.3 + vertex.x * 11.7);
    target.offsetHSL(jitter * 0.003, 0, jitter * 0.012);
    return target;
  }

  initializeWorld() {
    // Narrow, closely-related palette: three greens blended smoothly by
    // elevation, plus a muted rock grey only on the very lowest ground.
    // There is no waterline any more, so no sand/mud band either.
    this.terrainStops = [
      { at: 0.3, color: COLOR_ROCK },
      { at: 0.5, color: COLOR_LAND_DARK },
      { at: 0.78, color: COLOR_LAND },
      { at: 1, color: COLOR_LAND_LIGHT },
    ];

    const detail = IS_MOBILE ? 4 : 5;
    const landGeometry = new THREE.IcosahedronGeometry(PLANET_RADIUS, detail);
    const positions = landGeometry.getAttribute("position");
    const colors = [];
    const vertex = new THREE.Vector3();
    const color = new THREE.Color();

    for (let index = 0; index < positions.count; index += 1) {
      vertex.fromBufferAttribute(positions, index).normalize();
      const { elevation } = this.sampleTerrain(vertex);
      const radius = PLANET_RADIUS - (1 - elevation) * TERRAIN_RELIEF;
      positions.setXYZ(index, vertex.x * radius, vertex.y * radius, vertex.z * radius);
      this.terrainColor(elevation, vertex, color);
      colors.push(color.r, color.g, color.b);
    }
    landGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    landGeometry.computeVertexNormals();

    const landMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0,
      flatShading: true,
    });
    this.land = new THREE.Mesh(landGeometry, landMaterial);
    this.land.receiveShadow = this.profile.realShadows;
    this.scene3d.add(this.land);

    const rim = new THREE.Mesh(
      new THREE.SphereGeometry(PLANET_RADIUS + 0.55, 32, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          // Softer, less saturated teal so the rim reads as a thin
          // atmospheric glow rather than shrink-wrap around the planet.
          uColor: { value: new THREE.Color(0xa9e8de) },
          // Higher power narrows the Fresnel falloff to a sliver at the
          // silhouette edge instead of a thick halo.
          uPower: { value: 5.2 },
          uIntensity: { value: 0.5 },
        },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vViewPosition;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vViewPosition = -mvPosition.xyz;
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uPower;
          uniform float uIntensity;
          varying vec3 vNormal;
          varying vec3 vViewPosition;
          void main() {
            vec3 viewDir = normalize(vViewPosition);
            float rim = 1.0 - abs(dot(viewDir, normalize(vNormal)));
            float intensity = pow(clamp(rim, 0.0, 1.0), uPower) * uIntensity;
            gl_FragColor = vec4(uColor, intensity);
          }
        `,
      }),
    );
    this.scene3d.add(rim);

    this.createDecorations();
    this.createStars();
    this.createAmbientClouds();
  }

  groundRadius(normal) {
    return PLANET_RADIUS - (1 - this.sampleTerrain(normal).elevation) * TERRAIN_RELIEF;
  }

  pickLandNormal(target, poleThreshold) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      this.randomUnitNormal(target);
      if (target.dot(Y_AXIS) > poleThreshold) target.negate();
      if (this.sampleTerrain(target).elevation > LOWLAND_ELEVATION) break;
    }
    return target;
  }

  createDecorations() {
    this.treeObstacles.length = 0;
    this.rockSlowZones.length = 0;

    const trunkGeometry = new THREE.CylinderGeometry(
      0.16,
      TREE_TRUNK_MODEL_RADIUS,
      0.95,
      5,
    );
    // Stouter than the radius-18 tuning (wider radius, less height) so trees
    // read as a solid silhouette instead of a thin needle at the bigger
    // PLANET_RADIUS=30 scale, where a thin cone can look like a dark spike
    // against space on the unlit limb.
    const crownGeometry = new THREE.ConeGeometry(0.68, 1.3, 6);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.96,
      transparent: true,
      opacity: 0.78,
    });
    const crownMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      transparent: true,
      opacity: 0.7,
    });
    const trunkMesh = new THREE.InstancedMesh(
      trunkGeometry,
      trunkMaterial,
      this.profile.treeCount,
    );
    const crownMesh = new THREE.InstancedMesh(
      crownGeometry,
      crownMaterial,
      this.profile.treeCount,
    );
    const crownTopMesh = new THREE.InstancedMesh(
      crownGeometry,
      crownMaterial,
      this.profile.treeCount,
    );
    trunkMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.profile.treeCount * 3),
      3,
    );
    crownMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.profile.treeCount * 3),
      3,
    );
    crownTopMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.profile.treeCount * 3),
      3,
    );

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const spin = new THREE.Quaternion();
    const normal = new THREE.Vector3();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    const trunkHues = [0x6b4a29, 0x7a5730, 0x5a4025, 0x674a2d];
    const crownHues = [0x2f7d3e, 0x1f6a35, 0x3f8f4a, 0x256b4f];

    for (let index = 0; index < this.profile.treeCount; index += 1) {
      this.pickLandNormal(normal, 0.91);
      quaternion.setFromUnitVectors(Y_AXIS, normal);
      quaternion.multiply(spin.setFromAxisAngle(Y_AXIS, this.random.range(0, Math.PI * 2)));
      // Sized up versus the radius-18 tuning to hold its own against the
      // bigger PLANET_RADIUS=30 globe when viewed from the orbital cameras.
      const size = this.random.range(0.95, 1.5);
      // Trees must root on the displaced terrain surface, not the un-displaced
      // PLANET_RADIUS, or they float above/clip into basins wherever the
      // ground has been pushed inward.
      const base = this.groundRadius(normal);
      this.treeObstacles.push({
        normal: normal.clone(),
        contactDot: getSurfaceContactDot(getTreeCollisionDistance(size)),
      });

      position.copy(normal).multiplyScalar(base + 0.43 * size);
      scale.set(size, size, size);
      matrix.compose(position, quaternion, scale);
      trunkMesh.setMatrixAt(index, matrix);
      color.setHex(trunkHues[Math.floor(this.random.next() * trunkHues.length)]);
      color.offsetHSL(0, 0, this.random.range(-0.05, 0.05));
      trunkMesh.setColorAt(index, color);

      position.copy(normal).multiplyScalar(base + 1.36 * size);
      matrix.compose(position, quaternion, scale);
      crownMesh.setMatrixAt(index, matrix);
      color.setHex(crownHues[Math.floor(this.random.next() * crownHues.length)]);
      color.offsetHSL(0, 0, this.random.range(-0.06, 0.06));
      crownMesh.setColorAt(index, color);

      position.copy(normal).multiplyScalar(base + 2.05 * size);
      scale.set(size * 0.62, size * 0.66, size * 0.62);
      matrix.compose(position, quaternion, scale);
      crownTopMesh.setMatrixAt(index, matrix);
      crownTopMesh.setColorAt(index, color);
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    crownMesh.instanceMatrix.needsUpdate = true;
    crownTopMesh.instanceMatrix.needsUpdate = true;
    trunkMesh.instanceColor.needsUpdate = true;
    crownMesh.instanceColor.needsUpdate = true;
    crownTopMesh.instanceColor.needsUpdate = true;
    this.scene3d.add(trunkMesh, crownMesh, crownTopMesh);

    const rockGeometry = new THREE.DodecahedronGeometry(ROCK_MODEL_RADIUS, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.98,
      flatShading: true,
    });
    const rocks = new THREE.InstancedMesh(
      rockGeometry,
      rockMaterial,
      this.profile.rockCount,
    );
    rocks.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.profile.rockCount * 3),
      3,
    );
    const rockHues = [0x6a746d, 0x5c5650, 0x71614f, 0x808a82];
    for (let index = 0; index < this.profile.rockCount; index += 1) {
      this.pickLandNormal(normal, 0.94);
      quaternion.setFromUnitVectors(Y_AXIS, normal);
      quaternion.multiply(
        this.tempQuaternion.setFromAxisAngle(Y_AXIS, this.random.range(0, Math.PI * 2)),
      );
      const size = this.random.range(0.45, 1.15);
      const heightScale = this.random.range(0.6, 1);
      const ground = this.groundRadius(normal);
      // Deep terrain basins can hide a short rock completely below the
      // player's feet. Such a rock remains visual scenery but must not create
      // an invisible slow zone.
      if (
        isRockTopReachable(
          ground,
          size,
          heightScale,
          PLANET_RADIUS + PLAYER_HEIGHT,
        )
      ) {
        this.rockSlowZones.push({
          normal: normal.clone(),
          contactDot: getSurfaceContactDot(getRockContactDistance(size)),
        });
      }
      position.copy(normal).multiplyScalar(ground + size * 0.2);
      scale.set(size, size * heightScale, size);
      matrix.compose(position, quaternion, scale);
      rocks.setMatrixAt(index, matrix);
      color.setHex(rockHues[Math.floor(this.random.next() * rockHues.length)]);
      color.offsetHSL(0, 0, this.random.range(-0.05, 0.05));
      rocks.setColorAt(index, color);
    }
    rocks.instanceMatrix.needsUpdate = true;
    rocks.instanceColor.needsUpdate = true;
    this.scene3d.add(rocks);
  }

  buildStarLayer(count, minRadius, maxRadius) {
    const positions = new Float32Array(count * 3);
    const normal = new THREE.Vector3();
    for (let index = 0; index < count; index += 1) {
      this.randomUnitNormal(normal);
      const radius = this.random.range(minRadius, maxRadius);
      const offset = index * 3;
      positions[offset] = normal.x * radius;
      positions[offset + 1] = normal.y * radius;
      positions[offset + 2] = normal.z * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geometry;
  }

  createStars() {
    const dimCount = IS_MOBILE ? 150 : 250;
    const brightCount = IS_MOBILE ? 20 : 40;

    const dimStars = new THREE.Points(
      this.buildStarLayer(dimCount, 107, 174),
      new THREE.PointsMaterial({
        color: 0xbfeee7,
        size: IS_MOBILE ? 0.14 : 0.17,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    );
    const brightStars = new THREE.Points(
      this.buildStarLayer(brightCount, 117, 180),
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: IS_MOBILE ? 0.32 : 0.42,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );

    this.stars = new THREE.Group();
    this.stars.add(dimStars, brightStars);
    this.scene3d.add(this.stars);
  }

  createAmbientClouds() {
    // The planet-scale ambient rain: a shell of grey storm clouds ringing
    // the whole globe with gorilla silhouettes falling radially inward.
    // Entirely decorative -- see the OrbitalRain class for the instancing
    // and per-faller fall/tumble/recycle math.
    this.orbitalRain = new OrbitalRain(
      this.scene3d,
      this.profile.ambientCloudCount,
      this.profile.ambientFallerCount,
      this.random,
    );
  }

  initializePlayer() {
    this.player = new THREE.Group();
    this.scene3d.add(this.player);
    const skin = new THREE.MeshStandardMaterial({ color: 0xd8a77e, roughness: 0.82 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, roughness: 0.76 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x4c1d95, roughness: 0.86 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x33251e, roughness: 0.96 });
    const white = new THREE.MeshBasicMaterial({ color: 0xf7fff6 });
    const black = new THREE.MeshBasicMaterial({ color: 0x14201d });
    const yellow = new THREE.MeshBasicMaterial({ color: 0xffdc43 });

    const addBox = (name, size, position, material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.name = name;
      mesh.position.set(...position);
      mesh.castShadow = this.profile.realShadows;
      this.player.add(mesh);
      return mesh;
    };

    addBox("body", [0.86, 1.16, 0.5], [0, 1.48, 0], shirt);
    addBox("head", [0.78, 0.78, 0.72], [0, 2.5, 0], skin);
    addBox("hair", [0.8, 0.22, 0.74], [0, 2.84, 0.02], hair);
    this.playerLeftArm = addBox("left-arm", [0.28, 1.06, 0.32], [-0.58, 1.49, 0], skin);
    this.playerRightArm = addBox("right-arm", [0.28, 1.06, 0.32], [0.58, 1.49, 0], skin);
    this.playerLeftLeg = addBox("left-leg", [0.35, 0.98, 0.42], [-0.23, 0.52, 0], pants);
    this.playerRightLeg = addBox("right-leg", [0.35, 0.98, 0.42], [0.23, 0.52, 0], pants);
    addBox("left-eye-white", [0.2, 0.14, 0.035], [-0.2, 2.57, -0.372], white);
    addBox("right-eye-white", [0.2, 0.14, 0.035], [0.2, 2.57, -0.372], white);
    addBox("left-eye", [0.08, 0.09, 0.04], [-0.2, 2.56, -0.395], black);
    addBox("right-eye", [0.08, 0.09, 0.04], [0.2, 2.56, -0.395], black);
    addBox("shirt-mark", [0.2, 0.2, 0.035], [0, 1.58, -0.27], yellow);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.63, 16),
      new THREE.MeshBasicMaterial({
        color: 0x071312,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
    this.player.add(shadow);
    this.updatePlayerTransform();
  }

  initializeEffects() {
    this.sharedStorm = {
      cloudGeometry: new THREE.IcosahedronGeometry(0.95, 1),
      cloudMaterial: new THREE.MeshStandardMaterial({
        color: 0x273738,
        roughness: 0.96,
        flatShading: true,
      }),
      rainMaterial: new THREE.PointsMaterial({
        color: 0xa7e8ef,
        size: IS_MOBILE ? 0.095 : 0.11,
        transparent: true,
        opacity: 0.86,
        depthWrite: false,
        sizeAttenuation: true,
      }),
      fallingGeometry: new THREE.BoxGeometry(1, 1, 1),
      fallingMaterial: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.92,
        metalness: 0,
        emissive: 0x241812,
        emissiveIntensity: 0.65,
      }),
    };
  }

  createStormPool() {
    this.regularStormPool = Array.from(
      { length: 3 },
      () => new StormCell(this.scene3d, this.profile, this.sharedStorm),
    );
    // The normal final-stage wave owns all three regular slots. The extra
    // straight-run storm cannot consume any of them.
    this.straightRunStorm = new StormCell(
      this.scene3d,
      this.profile,
      this.sharedStorm,
    );
    this.stormPool = [...this.regularStormPool, this.straightRunStorm];
  }

  bindUI() {
    ui.startButton.addEventListener("click", async () => {
      if (!this.acceptPlayerName()) return;
      this.requestFullscreen();
      await this.sound.unlock();
      this.startNewGame();
    });
    ui.replayButton.addEventListener("click", async () => {
      if (!this.displayName) {
        this.returnHome();
        return;
      }
      this.requestFullscreen();
      await this.sound.unlock();
      this.startNewGame();
    });
    ui.shareButton.addEventListener("click", () => this.shareResult());
    ui.homeShareButton.addEventListener("click", () => this.shareGame());
    ui.resultHomeButton.addEventListener("click", () => this.returnHome());
    for (const labLink of [
      ui.homeLabLink,
      ui.resultLabLink,
      ui.resultRankingDetailLink,
    ]) {
      labLink.addEventListener("click", (event) => {
        if (labLink.getAttribute("aria-disabled") === "true") {
          event.preventDefault();
        }
      });
    }
    ui.pauseButton.addEventListener("click", () => this.pauseGame());
    ui.resumeButton.addEventListener("click", async () => {
      await this.sound.unlock();
      this.resumeGame();
    });
    ui.soundButton.addEventListener("click", async () => {
      this.toggleSound();
      await this.sound.unlock();
    });
    ui.homeSoundButton.addEventListener("click", async () => {
      this.toggleSound();
      await this.sound.unlock();
    });
    ui.motionButton.addEventListener("click", () => {
      this.motionEnabled = !this.motionEnabled;
      safeStorageSet("goriragouu-motion", this.motionEnabled ? "on" : "off");
      this.updateOptionButtons();
    });
    ui.playerNameInput.addEventListener("input", () => {
      ui.playerNameInput.closest(".player-name-card")?.classList.remove("invalid");
      ui.playerNameMessage.textContent =
        "この名前で結果をランキングへ自動送信します。";
    });
    ui.playerNameInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      ui.startButton.click();
    });

    window.addEventListener("resize", () => this.onResize());
    window.addEventListener("orientationchange", () => {
      this.controls?.reset();
      window.setTimeout(() => this.onResize(), 120);
    });
    window.addEventListener("blur", () => {
      if (this.mode === "playing" || this.mode === "countdown") this.pauseGame();
    });
    document.addEventListener("visibilitychange", () => {
      this.lastFrameAt = performance.now();
      if (document.hidden && (this.mode === "playing" || this.mode === "countdown")) {
        this.pauseGame();
      }
    });
    document.addEventListener(
      "touchmove",
      (event) => {
        if (this.mode === "playing" && event.target === ui.gameInput) event.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener("gesturestart", (event) => {
      if (this.mode === "playing") event.preventDefault();
    });
    document.addEventListener("dblclick", (event) => {
      if (this.mode === "playing") event.preventDefault();
    });
  }

  requestFullscreen() {
    if (!IS_MOBILE || !document.documentElement.requestFullscreen) return;
    document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {
      // Fullscreen support varies by browser; the fixed viewport remains playable.
    });
  }

  loadPlayerName() {
    const stored = normalizeDisplayName(safeStorageGet(NAME_STORAGE_KEY, ""));
    this.displayName = stored;
    ui.playerNameInput.value = stored;
    if (stored) {
      ui.playerNameMessage.textContent =
        `保存済みの「${stored}」でランキングへ送信します。`;
    }
  }

  acceptPlayerName() {
    const name = normalizeDisplayName(ui.playerNameInput.value);
    const card = ui.playerNameInput.closest(".player-name-card");
    if (!name) {
      this.displayName = "";
      card?.classList.add("invalid");
      ui.playerNameMessage.textContent =
        "ランキング名を入力してからゲームを始めてください。";
      ui.playerNameInput.focus({ preventScroll: false });
      return false;
    }

    this.displayName = name;
    ui.playerNameInput.value = name;
    card?.classList.remove("invalid");
    safeStorageSet(NAME_STORAGE_KEY, name);
    ui.playerNameMessage.textContent =
      `「${name}」でランキングへ自動送信します。`;
    ui.playerNameInput.blur();
    return true;
  }

  returnHome() {
    this.controls.reset();
    ui.app.classList.remove("is-playing", "is-boosting");
    document.body.classList.remove("is-playing");
    ui.bananaScoreFx.classList.remove("active");
    window.clearTimeout(this.scoreFxTimer);
    this.showScreen("home");
    this.updateBestScoreDisplays();
  }

  setRankingStatus(message, state = "pending") {
    ui.rankingStatus.textContent = message;
    ui.rankingStatus.dataset.state = state;
  }

  setLabNavigationLocked(locked) {
    for (const labLink of [
      ui.homeLabLink,
      ui.resultLabLink,
      ui.resultRankingDetailLink,
    ]) {
      labLink.setAttribute("aria-disabled", String(locked));
      labLink.tabIndex = locked ? -1 : 0;
    }
  }

  prepareResultRanking() {
    ui.resultRanking.setAttribute("aria-busy", "true");
    ui.resultRankingMessage.hidden = false;
    ui.resultRankingMessage.dataset.state = "loading";
    ui.resultRankingMessage.textContent = "ランキングを読み込み中…";
    ui.resultRankingList.hidden = true;
    ui.resultRankingList.replaceChildren();
  }

  renderResultRanking(rows) {
    const currentName = normalizeDisplayName(this.displayName);
    const fragment = document.createDocumentFragment();
    let validCount = 0;

    for (const {
      rank,
      displayName,
      bestScore,
    } of normalizeBestRankingRows(rows, RESULT_RANKING_LIMIT)) {
      validCount += 1;
      const isCurrentPlayer = displayName === currentName;
      const item = document.createElement("li");
      item.classList.toggle("is-current-player", isCurrentPlayer);
      if (isCurrentPlayer) item.setAttribute("aria-current", "true");
      item.setAttribute(
        "aria-label",
        `${rank}位、${displayName}、${bestScore.toLocaleString("ja-JP")}点${
          isCurrentPlayer ? "、あなた" : ""
        }`,
      );

      const position = document.createElement("span");
      position.className = "result-ranking-position";
      position.textContent = `${rank}位`;

      const name = document.createElement("span");
      name.className = "result-ranking-name";
      const nameText = document.createElement("span");
      nameText.className = "result-ranking-name-text";
      nameText.textContent = displayName;
      name.appendChild(nameText);
      if (isCurrentPlayer) {
        const you = document.createElement("span");
        you.className = "result-ranking-you";
        you.textContent = "あなた";
        name.appendChild(you);
      }

      const scoreText = document.createElement("span");
      scoreText.className = "result-ranking-score";
      scoreText.textContent = `${bestScore.toLocaleString("ja-JP")}点`;

      item.append(position, name, scoreText);
      fragment.appendChild(item);
    }

    ui.resultRanking.setAttribute("aria-busy", "false");
    if (validCount === 0) {
      ui.resultRankingMessage.hidden = false;
      ui.resultRankingMessage.dataset.state = "empty";
      ui.resultRankingMessage.textContent =
        "まだランキング記録がありません。最初の記録を目指してください。";
      ui.resultRankingList.hidden = true;
      return;
    }

    ui.resultRankingList.replaceChildren(fragment);
    ui.resultRankingList.hidden = false;
    ui.resultRankingMessage.hidden = true;
  }

  async loadResultRanking(runId) {
    if (runId !== this.scoreSubmissionRunId) return;

    try {
      const rows = await this.ranking.getBestScores(RESULT_RANKING_LIMIT);
      if (runId !== this.scoreSubmissionRunId) return;
      this.renderResultRanking(rows);
    } catch (error) {
      if (runId !== this.scoreSubmissionRunId) return;
      console.warn("ランキング取得に失敗しました。", error);
      ui.resultRanking.setAttribute("aria-busy", "false");
      ui.resultRankingList.hidden = true;
      ui.resultRankingMessage.hidden = false;
      ui.resultRankingMessage.dataset.state = "error";
      ui.resultRankingMessage.textContent =
        "ランキングを読み込めませんでした。詳細ランキングから再確認できます。";
    }
  }

  async submitGameScore(score, runId) {
    if (
      runId !== this.scoreSubmissionRunId ||
      this.scoreSubmitAttempted ||
      this.scoreSubmitFinished
    ) {
      return;
    }

    this.scoreSubmitAttempted = true;
    const displayName = normalizeDisplayName(this.displayName);
    if (!displayName) {
      this.setRankingStatus(
        "名前を確認できなかったため、ランキングへ送信できませんでした。",
        "error",
      );
      this.setLabNavigationLocked(false);
      void this.loadResultRanking(runId);
      return;
    }

    this.setRankingStatus("ランキングへ送信中…");
    try {
      const result = await this.ranking.submit(displayName, score);
      if (runId !== this.scoreSubmissionRunId) return;

      this.scoreSubmitFinished = true;
      const registeredBest = Number(result.result_best_score);
      if (Number.isFinite(registeredBest)) {
        ui.resultBestScoreLabel.textContent = "登録名のベスト";
        ui.resultBestScore.textContent = formatScore(registeredBest);
      }
      this.setRankingStatus(
        result.is_new_best
          ? `「${displayName}」のベスト記録を更新しました。`
          : `「${displayName}」の記録をランキングへ送信しました。`,
        "success",
      );
    } catch (error) {
      if (runId !== this.scoreSubmissionRunId) return;
      console.warn("ランキング送信に失敗しました。", error);
      this.setRankingStatus(
        "ランキング送信に失敗しました。通信状態を確認してください。",
        "error",
      );
    } finally {
      if (runId === this.scoreSubmissionRunId) {
        this.setLabNavigationLocked(false);
        void this.loadResultRanking(runId);
      }
    }
  }

  showBananaScoreEffect() {
    const effect = ui.bananaScoreFx;
    const scoreText = effect.querySelector("strong");
    if (scoreText) scoreText.textContent = `+${SCORE_PER_BANANA}`;

    this.scoreFxPosition.copy(this.player.position).project(this.camera);
    const left = clamp((this.scoreFxPosition.x * 0.5 + 0.5) * 100, 16, 84);
    const top = clamp((-this.scoreFxPosition.y * 0.5 + 0.5) * 100, 24, 78);
    effect.style.setProperty("--score-fx-left", `${left.toFixed(2)}%`);
    effect.style.setProperty("--score-fx-top", `${top.toFixed(2)}%`);

    window.clearTimeout(this.scoreFxTimer);
    effect.classList.remove("active");
    void effect.offsetWidth;
    effect.classList.add("active");
    this.scoreFxTimer = window.setTimeout(() => {
      effect.classList.remove("active");
    }, 850);
  }

  updateControlCopy() {
    if (IS_MOBILE) {
      ui.controlTitle.textContent = "押したままスワイプ";
      ui.controlDetail.textContent =
        "画面の中央寄りを押し、逃げたい方向へ滑らせます。指を離すと止まります。";
    } else {
      ui.controlTitle.textContent = "マウスでドラッグ";
      ui.controlDetail.textContent =
        "画面を押したまま、逃げたい方向へマウスを動かします。矢印キーも使えます。";
    }
  }

  toggleSound() {
    this.sound.setEnabled(!this.sound.enabled);
    this.updateOptionButtons();
  }

  updateOptionButtons() {
    ui.motionButton.textContent = `揺れ：${this.motionEnabled ? "あり" : "なし"}`;
    ui.motionButton.setAttribute("aria-pressed", String(this.motionEnabled));
    const soundText = this.sound.enabled ? "あり" : "なし";
    ui.homeSoundButton.textContent = `音：${soundText}`;
    ui.homeSoundButton.setAttribute("aria-pressed", String(this.sound.enabled));
    ui.soundButton.setAttribute("aria-pressed", String(this.sound.enabled));
    ui.soundButton.textContent = this.sound.enabled ? "♪" : "×";
  }

  loadBestScore() {
    const stored = safeStorageGet("goriragouu-best-score", null);
    const parsed = stored === null ? NaN : Number.parseInt(stored, 10);
    this.hasBestScore = stored !== null && Number.isFinite(parsed);
    this.bestScore = this.hasBestScore ? Math.max(0, parsed) : 0;
  }

  // Called after every finished run. Persists a new best when the just-
  // finished score beats (or, on the very first-ever run, simply sets) the
  // stored best, and reports whether this run set a new record.
  registerScore(score) {
    const previousBest = this.hasBestScore ? this.bestScore : -1;
    const isNewRecord = score > previousBest;
    if (isNewRecord) {
      this.bestScore = score;
      this.hasBestScore = true;
      safeStorageSet("goriragouu-best-score", String(score));
    }
    this.updateBestScoreDisplays();
    return isNewRecord;
  }

  updateBestScoreDisplays() {
    const text = this.hasBestScore ? formatScore(this.bestScore) : "------";
    if (ui.homeBestScore) ui.homeBestScore.textContent = text;
    if (ui.resultBestScore) ui.resultBestScore.textContent = text;
  }

  resetGameState() {
    this.gameElapsed = 0;
    this.bananaCount = 0;
    this.boostUntil = 0;
    this.currentStage = getStage(0);
    this.nextStormAt = 1.2;
    this.accumulator = 0;
    this.cameraShake = 0;
    this.lastHudUpdateAt = -Infinity;
    this.playerNormal.set(0, 1, 0);
    this.playerFacing.set(0, 0, -1);
    this.viewForward.set(0, 0, -1);
    this.straightRunHeading.set(0, 0, -1);
    this.travelHeading.set(0, 0, -1);
    this.straightRunDistance = 0;
    this.straightRunIdleSeconds = 0;
    this.straightStormPending = false;
    this.currentPlayerSurfaceSpeed = 0;
    this.playerSpeedFactor = 0;
    for (const gorilla of this.gorillaPool) gorilla.active = false;
    for (const storm of this.stormPool || []) storm.deactivate();
    this.bananaField?.reset(this.playerNormal, this.playerFacing);
    this.updatePlayerTransform();
    this.updateCamera(1, true);
    this.gorillaRenderer?.update(this.gorillaPool, 0);
    this.updateHUD(true);
  }

  startNewGame() {
    if (this.webglContextLost) return;

    if (!this.hasFixedSeed) {
      this.seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    }
    this.random = new SeededRandom(this.seed);
    this.straightStormRandom = new SeededRandom(this.seed ^ 0x6a09e667);
    this.bananaField.random = this.random;
    this.scoreSubmissionRunId += 1;
    this.scoreSubmitAttempted = false;
    this.scoreSubmitFinished = false;
    this.setLabNavigationLocked(false);
    this.setRankingStatus(
      "結果はゲーム終了時にランキングへ自動送信します。",
    );
    this.prepareResultRanking();
    ui.resultBestScoreLabel.textContent = "端末の自己ベスト";
    ui.bananaScoreFx.classList.remove("active");
    window.clearTimeout(this.scoreFxTimer);
    this.resetGameState();
    this.showScreen("game");
    this.mode = "countdown";
    this.countdownRemaining = 3;
    this.lastCountdownNumber = -1;
    ui.countdown.hidden = false;
    ui.pauseOverlay.hidden = true;
    ui.pauseButton.disabled = false;
    ui.soundButton.disabled = false;
    ui.app.classList.add("is-playing");
    document.body.classList.add("is-playing");
    this.lastFrameAt = performance.now();
    this.performanceFrames = 0;
    this.performanceSeconds = 0;
  }

  showScreen(screen) {
    ui.home.hidden = screen !== "home";
    ui.game.hidden = screen !== "game";
    ui.result.hidden = screen !== "result";
    if (screen === "home") this.mode = "home";
  }

  pauseGame() {
    if (this.mode !== "playing" && this.mode !== "countdown") return;
    this.resumeFromMode = this.mode;
    this.mode = "paused";
    this.controls.reset();
    ui.countdown.hidden = true;
    ui.pauseButton.disabled = true;
    ui.soundButton.disabled = true;
    ui.pauseOverlay.hidden = false;
    window.requestAnimationFrame(() => {
      ui.resumeButton.focus({ preventScroll: true });
    });
  }

  resumeGame() {
    if (this.mode !== "paused") return;
    ui.pauseOverlay.hidden = true;
    ui.countdown.hidden = false;
    ui.pauseButton.disabled = false;
    ui.soundButton.disabled = false;
    this.mode = "countdown";
    this.countdownRemaining =
      this.resumeFromMode === "countdown" && this.gameElapsed === 0 ? 3 : 1.5;
    this.lastCountdownNumber = -1;
    this.lastFrameAt = performance.now();
    this.accumulator = 0;
    window.requestAnimationFrame(() => {
      ui.pauseButton.focus({ preventScroll: true });
    });
  }

  handleWebGLContextLost(event) {
    event.preventDefault();
    if (this.webglContextLost) return;

    this.webglContextLost = true;
    this.contextLossPreviousMode = this.mode;
    this.mode = "context-lost";
    this.controls?.reset();
    ui.countdown.hidden = true;
    ui.pauseButton.disabled = true;
    ui.soundButton.disabled = true;
    ui.webglErrorTitle.textContent = "3D画面を復旧しています";
    ui.webglErrorMessage.textContent =
      "端末の3D表示が一時停止しました。ゲームの進行も止めています。この画面のままお待ちください。";
    ui.webglError.hidden = false;
  }

  handleWebGLContextRestored() {
    if (!this.webglContextLost) return;

    this.webglContextLost = false;
    const previousMode = this.contextLossPreviousMode;
    this.lastFrameAt = performance.now();
    this.accumulator = 0;
    ui.webglError.hidden = true;
    ui.webglErrorTitle.textContent = "3D画面を開けませんでした";
    ui.webglErrorMessage.textContent =
      "WebGLが使える最新のSafari、Chrome、Edgeで開き直してください。";

    if (previousMode === "playing" || previousMode === "countdown") {
      this.resumeFromMode = previousMode;
      this.mode = "paused";
      ui.pauseOverlay.hidden = false;
      if (!document.hidden) {
        this.resumeGame();
        this.showToast("3D画面を復旧しました");
      }
      return;
    }

    if (previousMode === "paused") {
      this.mode = "paused";
      ui.pauseOverlay.hidden = false;
      ui.pauseButton.disabled = true;
      ui.soundButton.disabled = true;
      return;
    }

    this.mode = previousMode;
    ui.pauseButton.disabled = false;
    ui.soundButton.disabled = false;
  }

  updateCountdown(delta) {
    this.countdownRemaining = Math.max(0, this.countdownRemaining - delta);
    const number = Math.ceil(this.countdownRemaining);
    if (number !== this.lastCountdownNumber && number > 0) {
      this.lastCountdownNumber = number;
      ui.countdownValue.textContent = String(number);
      this.sound.countdown(number);
    }
    if (this.countdownRemaining <= 0) {
      this.mode = "playing";
      ui.countdown.hidden = true;
      this.lastCountdownNumber = -1;
      this.lastFrameAt = performance.now();
      this.accumulator = 0;
      this.sound.countdown(0);
      this.showToast(this.gameElapsed > 0 ? "再開！" : "GO！ 豪雨から逃げろ");
    }
  }

  frame(timeMs) {
    if (this.webglContextLost) {
      this.lastFrameAt = timeMs;
      return;
    }

    const measuredDelta = Math.max(0, (timeMs - this.lastFrameAt) / 1000);
    let rawDelta = getPlayableFrameDelta(measuredDelta);
    this.lastFrameAt = timeMs;
    if (this.mode === "playing" && measuredDelta > 0.5) {
      this.pauseGame();
      rawDelta = 0;
    }
    this.ambientTime += rawDelta;

    if (this.mode === "countdown") {
      this.updateCountdown(rawDelta);
    } else if (this.mode === "playing") {
      this.advancePlayingFrame(rawDelta);
      this.updateAdaptiveQuality(rawDelta);
    }

    this.updateVisuals(rawDelta);
    this.renderer.render(this.scene3d, this.camera);
  }

  advancePlayingFrame(frameDelta) {
    const epsilon = 0.000001;
    this.accumulator += frameDelta;
    let steps = 0;

    while (this.mode === "playing" && steps < MAX_FIXED_STEPS) {
      const remaining = getRemainingSeconds(this.gameElapsed, this.bananaCount);
      if (remaining <= epsilon) {
        this.accumulator = 0;
        this.finishGame(true);
        return;
      }

      let step = 0;
      if (this.accumulator + epsilon >= FIXED_STEP) {
        step = Math.min(FIXED_STEP, remaining);
      } else if (this.accumulator + epsilon >= remaining) {
        step = remaining;
      } else {
        break;
      }

      this.gameElapsed += step;
      this.accumulator = Math.max(0, this.accumulator - step);
      this.updateGame(step);
      steps += 1;

      if (this.mode !== "playing") return;
      if (getRemainingSeconds(this.gameElapsed, this.bananaCount) <= epsilon) {
        this.accumulator = 0;
        this.finishGame(true);
        return;
      }
    }

    // Every accepted frame (up to 0.5 seconds) fits within the 30-step
    // budget. Keep any sub-step floating-point remainder in the accumulator;
    // never advance only the clock while skipping collisions or storm logic.
  }

  updateGame(delta) {
    const previousStage = this.currentStage;
    this.currentStage = getStage(this.gameElapsed);
    if (this.currentStage.index !== previousStage.index) {
      const text =
        this.currentStage.index === 1
          ? "豪雨が2地点に拡大！ バナナも増加"
          : "最終豪雨！ 3地点からゴリラが来る";
      this.showToast(text, 2600);
      this.cameraShake = this.motionEnabled ? 0.18 : 0;
    }

    const straightRunTriggered = this.updatePlayer(delta);
    this.bananaField.update(
      this.gameElapsed,
      this.currentStage.bananaTarget,
      this.playerNormal,
      this.playerFacing,
    );
    if (
      this.bananaField.collect(
        this.playerNormal,
        this.gameElapsed,
        this.currentStage.bananaTarget,
      )
    ) {
      const previousMilestone = getBonusMilestones(this.bananaCount);
      this.bananaCount += 1;
      this.boostUntil = extendBoost(this.boostUntil, this.gameElapsed);
      this.showBananaScoreEffect();
      const newMilestone = getBonusMilestones(this.bananaCount);
      if (newMilestone > previousMilestone) {
        this.sound.bonus();
        this.showToast("🍌 10本！ 残り時間が5秒増えた", 2300);
      } else {
        this.sound.banana();
      }
    }

    if (this.gameElapsed >= this.nextStormAt) {
      this.spawnStormWave(this.currentStage.stormLocations);
      // Scheduled cadence is unchanged by the independent straight-run
      // countermeasure and still tightens as the run goes on.
      const interval = getStormInterval(this.gameElapsed, this.profile.stormInterval);
      this.nextStormAt += interval;
      if (this.nextStormAt <= this.gameElapsed) {
        this.nextStormAt = this.gameElapsed + interval;
      }
    }
    if (straightRunTriggered) {
      this.straightStormPending = true;
    }
    if (this.straightStormPending && this.spawnStraightRunStorm()) {
      this.straightStormPending = false;
    }

    for (const storm of this.stormPool) {
      storm.update(this.gameElapsed, {
        onRainStart: () => this.onRainStart(),
        onImpact: (cell) =>
          this.spawnGorillaSwarm(
            cell.normal,
            cell === this.straightRunStorm,
          ),
      });
    }

    const caught = this.updateGorillas(delta);
    if (caught) {
      this.finishGame(false);
      return;
    }

    if (getRemainingSeconds(this.gameElapsed, this.bananaCount) <= 0) {
      this.finishGame(true);
      return;
    }
    this.updateHUD();
  }

  setSurfaceCandidate(target, startNormal, direction, angle) {
    return target
      .copy(startNormal)
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(direction, Math.sin(angle))
      .normalize();
  }

  isTreeContact(normal) {
    return this.treeObstacles.some(
      (tree) => normal.dot(tree.normal) >= tree.contactDot,
    );
  }

  findBlockingTree(candidateNormal, currentNormal) {
    for (const tree of this.treeObstacles) {
      const candidateDot = candidateNormal.dot(tree.normal);
      if (candidateDot < tree.contactDot) continue;
      const currentDot = currentNormal.dot(tree.normal);
      if (
        shouldBlockSurfaceObstacle(
          currentDot,
          candidateDot,
          tree.contactDot,
        )
      ) {
        return tree;
      }
    }
    return null;
  }

  isRockContact(normal) {
    return this.rockSlowZones.some(
      (rock) => normal.dot(rock.normal) >= rock.contactDot,
    );
  }

  resetStraightRunProgress() {
    this.straightRunDistance = 0;
    this.straightRunIdleSeconds = 0;
    this.straightRunHeading
      .copy(this.playerFacing)
      .addScaledVector(
        this.playerNormal,
        -this.playerFacing.dot(this.playerNormal),
      );
    if (this.straightRunHeading.lengthSq() < 0.0001) {
      this.straightRunHeading.copy(this.viewForward);
    }
    this.straightRunHeading.normalize();
  }

  updatePlayer(delta) {
    this.controls.getVector(this.inputVector);
    const inputStrength = clamp(this.inputVector.length(), 0, 1);
    this.playerSpeedFactor = 0;
    this.currentPlayerSurfaceSpeed = 0;
    if (inputStrength < 0.01) {
      const idleState = advanceStraightRunIdle(
        this.straightRunDistance,
        this.straightRunIdleSeconds,
        delta,
      );
      this.straightRunIdleSeconds = idleState.idleSeconds;
      if (idleState.reset) {
        this.resetStraightRunProgress();
      }
      return false;
    }

    this.viewRight.crossVectors(this.viewForward, this.playerNormal).normalize();
    this.desiredMove
      .copy(this.viewForward)
      .multiplyScalar(this.inputVector.y)
      .addScaledVector(this.viewRight, this.inputVector.x);
    this.desiredMove.addScaledVector(
      this.playerNormal,
      -this.desiredMove.dot(this.playerNormal),
    );
    if (this.desiredMove.lengthSq() < 0.0001) return false;
    this.desiredMove.normalize();

    const boosted = this.gameElapsed < this.boostUntil;
    const baseSpeed =
      PLAYER_SPEED * (boosted ? BOOST_MULTIPLIER : 1) * inputStrength;
    let slowMultiplier = getRockSpeedMultiplier(
      this.isRockContact(this.playerNormal),
    );
    let movementScale = 1;
    this.slideDirection.copy(this.desiredMove);
    this.previousNormal.copy(this.playerNormal);

    let angle =
      (baseSpeed * slowMultiplier * movementScale * delta) / PLANET_RADIUS;
    this.setSurfaceCandidate(
      this.moveCandidate,
      this.playerNormal,
      this.slideDirection,
      angle,
    );
    if (
      slowMultiplier === 1 &&
      this.isRockContact(this.moveCandidate)
    ) {
      slowMultiplier = ROCK_SLOW_MULTIPLIER;
      angle =
        (baseSpeed * slowMultiplier * movementScale * delta) / PLANET_RADIUS;
      this.setSurfaceCandidate(
        this.moveCandidate,
        this.playerNormal,
        this.slideDirection,
        angle,
      );
    }

    const blockingTree = this.findBlockingTree(
      this.moveCandidate,
      this.playerNormal,
    );
    if (blockingTree) {
      this.obstacleAway
        .copy(this.playerNormal)
        .addScaledVector(
          blockingTree.normal,
          -this.playerNormal.dot(blockingTree.normal),
        );
      if (this.obstacleAway.lengthSq() > 0.000001) {
        this.obstacleAway.normalize();
        const inward = this.desiredMove.dot(this.obstacleAway);
        this.slideDirection.copy(this.desiredMove);
        if (inward < 0) {
          this.slideDirection.addScaledVector(this.obstacleAway, -inward);
        }
        movementScale = getObstacleSlideScale(inward);
      } else {
        movementScale = 0;
      }

      if (movementScale > 0.01) {
        this.slideDirection.normalize();
        angle =
          (baseSpeed * slowMultiplier * movementScale * delta) /
          PLANET_RADIUS;
        this.setSurfaceCandidate(
          this.moveCandidate,
          this.playerNormal,
          this.slideDirection,
          angle,
        );
        if (
          slowMultiplier === 1 &&
          this.isRockContact(this.moveCandidate)
        ) {
          slowMultiplier = ROCK_SLOW_MULTIPLIER;
          angle =
            (baseSpeed * slowMultiplier * movementScale * delta) /
            PLANET_RADIUS;
          this.setSurfaceCandidate(
            this.moveCandidate,
            this.playerNormal,
            this.slideDirection,
            angle,
          );
        }
        if (
          this.findBlockingTree(this.moveCandidate, this.playerNormal)
        ) {
          this.moveCandidate.copy(this.playerNormal);
        }
      } else {
        this.moveCandidate.copy(this.playerNormal);
      }
    }

    this.playerNormal.copy(this.moveCandidate);
    const normalDot = clamp(
      this.previousNormal.dot(this.playerNormal),
      -1,
      1,
    );
    const stepAngle = Math.acos(normalDot);
    const stepDistance = stepAngle * PLANET_RADIUS;
    if (stepDistance <= 0.000001) {
      const idleState = advanceStraightRunIdle(
        this.straightRunDistance,
        this.straightRunIdleSeconds,
        delta,
      );
      this.straightRunIdleSeconds = idleState.idleSeconds;
      if (idleState.reset) {
        this.resetStraightRunProgress();
      }
      return false;
    }

    this.straightRunIdleSeconds = 0;
    this.currentPlayerSurfaceSpeed = stepDistance / Math.max(delta, 0.000001);
    this.playerSpeedFactor = this.currentPlayerSurfaceSpeed / PLAYER_SPEED;

    this.travelHeading
      .copy(this.playerNormal)
      .multiplyScalar(normalDot)
      .sub(this.previousNormal)
      .normalize();
    this.straightTransportQuaternion.setFromUnitVectors(
      this.previousNormal,
      this.playerNormal,
    );
    this.straightRunHeading.applyQuaternion(
      this.straightTransportQuaternion,
    );
    this.straightRunHeading.addScaledVector(
      this.playerNormal,
      -this.straightRunHeading.dot(this.playerNormal),
    );
    if (this.straightRunHeading.lengthSq() < 0.0001) {
      this.straightRunHeading.copy(this.travelHeading);
    } else {
      this.straightRunHeading.normalize();
    }

    const straightState = advanceStraightRun(
      this.straightRunDistance,
      stepDistance,
      this.straightRunHeading.dot(this.travelHeading),
    );
    this.straightRunDistance = straightState.distance;
    if (!straightState.aligned) {
      this.straightRunHeading.copy(this.travelHeading);
    }

    this.tempA
      .copy(this.viewForward)
      .addScaledVector(
        this.playerNormal,
        -this.viewForward.dot(this.playerNormal),
      );
    if (this.tempA.lengthSq() > 0.0001) {
      this.viewForward.copy(this.tempA.normalize());
    }

    const turn = 1 - Math.exp(-delta * 12);
    this.playerFacing.lerp(this.travelHeading, turn);
    this.playerFacing
      .addScaledVector(
        this.playerNormal,
        -this.playerFacing.dot(this.playerNormal),
      )
      .normalize();
    return straightState.triggered;
  }

  updateGorillas(delta) {
    const collisionDot = Math.cos(GORILLA_CONTACT_DISTANCE / PLANET_RADIUS);
    let caught = false;

    for (const gorilla of this.gorillaPool) {
      if (!gorilla.active) continue;
      if (this.gameElapsed >= gorilla.expiresAt) {
        gorilla.active = false;
        continue;
      }

      const dot = clamp(gorilla.normal.dot(this.playerNormal), -1, 1);
      this.tempA
        .copy(this.playerNormal)
        .addScaledVector(gorilla.normal, -dot);
      if (this.tempA.lengthSq() > 0.000001) {
        this.tempA.normalize();
      } else {
        this.tempA.copy(gorilla.forward);
      }
      const angle = (gorilla.speed * delta) / PLANET_RADIUS;
      this.tempC.copy(gorilla.normal);
      this.slideDirection.copy(this.tempA);
      this.setSurfaceCandidate(
        this.moveCandidate,
        this.tempC,
        this.slideDirection,
        angle,
      );
      const blockingTree = this.findBlockingTree(
        this.moveCandidate,
        this.tempC,
      );
      if (blockingTree) {
        this.obstacleAway
          .copy(this.tempC)
          .addScaledVector(
            blockingTree.normal,
            -this.tempC.dot(blockingTree.normal),
          );
        if (this.obstacleAway.lengthSq() > 0.000001) {
          this.obstacleAway.normalize();
          const inward = this.slideDirection.dot(this.obstacleAway);
          if (inward < 0) {
            this.slideDirection.addScaledVector(
              this.obstacleAway,
              -inward,
            );
          }
        }
        const slideScale = clamp(this.slideDirection.length(), 0, 1);
        if (slideScale > 0.01) {
          this.slideDirection.normalize();
          this.setSurfaceCandidate(
            this.moveCandidate,
            this.tempC,
            this.slideDirection,
            angle * slideScale,
          );
          if (this.findBlockingTree(this.moveCandidate, this.tempC)) {
            this.moveCandidate.copy(this.tempC);
          }
        } else {
          this.moveCandidate.copy(this.tempC);
        }
      }
      gorilla.normal.copy(this.moveCandidate);
      if (gorilla.normal.dot(this.tempC) < 0.999999999) {
        gorilla.forward
          .copy(this.slideDirection)
          .addScaledVector(
            gorilla.normal,
            -this.slideDirection.dot(gorilla.normal),
          )
          .normalize();
      }

      if (
        this.gameElapsed >= gorilla.dangerAt &&
        gorilla.normal.dot(this.playerNormal) >= collisionDot
      ) {
        caught = true;
      }
    }
    return caught;
  }

  spawnStormWave(count) {
    const available = this.regularStormPool.filter((storm) => !storm.active);
    const actualCount = Math.min(count, available.length);
    // Angles are measured from the player's actual movement direction
    // (playerFacing), not the camera's view forward. These scheduled storms
    // retain a small forward clearance; the route-pressure storm below is the
    // only one deliberately placed in front.
    const angles = pickStormAngles(actualCount, this.random);
    this.viewRight.crossVectors(this.playerFacing, this.playerNormal).normalize();

    for (let index = 0; index < actualCount; index += 1) {
      const angle = angles[index];
      this.tempA
        .copy(this.playerFacing)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(this.viewRight, Math.sin(angle))
        .normalize();
      const distance = this.random.range(
        STORM_SPAWN_DISTANCE_MIN,
        STORM_SPAWN_DISTANCE_MAX,
      );
      this.setSurfaceCandidate(
        this.tempB,
        this.playerNormal,
        this.tempA,
        distance / PLANET_RADIUS,
      );
      let bestClearance = this.straightRunStorm.active
        ? this.getStormClearance(this.tempB, [this.straightRunStorm])
        : Infinity;
      this.regularStormBestCandidate.copy(this.tempB);
      if (bestClearance >= STRAIGHT_STORM_MIN_REGULAR_CLEARANCE) {
        available[index].activate(this.tempB, this.gameElapsed, this.random);
        continue;
      }

      // Deterministic fallback directions cover the rear and both edges of
      // the scheduled forward-clearance cone. They consume no extra normal
      // random values, so the route-pressure event cannot shift later normal
      // storms, gorilla speeds, or banana placements.
      for (const angle of [
        Math.PI,
        STORM_MIN_CLEARANCE,
        Math.PI * 2 - STORM_MIN_CLEARANCE,
      ]) {
        for (const distance of [
          STORM_SPAWN_DISTANCE_MIN,
          STORM_SPAWN_DISTANCE_MAX,
        ]) {
          this.tempA
            .copy(this.playerFacing)
            .multiplyScalar(Math.cos(angle))
            .addScaledVector(this.viewRight, Math.sin(angle))
            .normalize();
          this.setSurfaceCandidate(
            this.tempB,
            this.playerNormal,
            this.tempA,
            distance / PLANET_RADIUS,
          );
          const clearance = this.getStormClearance(
            this.tempB,
            [this.straightRunStorm],
          );
          if (clearance > bestClearance) {
            bestClearance = clearance;
            this.regularStormBestCandidate.copy(this.tempB);
          }
        }
      }
      if (bestClearance >= STRAIGHT_STORM_MIN_REGULAR_CLEARANCE) {
        available[index].activate(
          this.regularStormBestCandidate,
          this.gameElapsed,
          this.random,
        );
      }
    }
  }

  getStormClearance(candidate, storms) {
    let clearance = Infinity;
    for (const storm of storms) {
      if (!storm.active) continue;
      const distance =
        Math.acos(clamp(candidate.dot(storm.normal), -1, 1)) * PLANET_RADIUS;
      clearance = Math.min(clearance, distance);
    }
    return clearance;
  }

  spawnStraightRunStorm() {
    if (this.straightRunStorm.active) return false;

    this.viewRight
      .crossVectors(this.travelHeading, this.playerNormal)
      .normalize();
    const baseBearing = this.straightStormRandom.range(
      -STRAIGHT_STORM_BEARING_JITTER,
      STRAIGHT_STORM_BEARING_JITTER,
    );
    const preferredDistance = getStraightStormDistance(
      this.currentPlayerSurfaceSpeed,
      STORM_FALL_SECONDS,
    );
    let bestClearance = -Infinity;
    let foundClearCandidate = false;

    // Normally the first candidate is used. The wider deterministic search is
    // only needed when up to three scheduled storms already occupy the front:
    // it preserves the required extra spawn while preventing a doubled swarm.
    for (
      let distance = preferredDistance;
      distance <= STRAIGHT_STORM_AVOIDANCE_DISTANCE_MAX;
      distance += 1
    ) {
      const surfaceAngle = distance / PLANET_RADIUS;
      for (let offsetStep = 0; offsetStep <= 29; offsetStep += 1) {
        const signedStep =
          offsetStep === 0
            ? 0
            : Math.ceil(offsetStep / 2) * (offsetStep % 2 ? 1 : -1);
        const bearing = baseBearing + signedStep * 0.1;
        if (Math.abs(bearing) >= Math.PI / 2) continue;
        this.tempA
          .copy(this.travelHeading)
          .multiplyScalar(Math.cos(bearing))
          .addScaledVector(this.viewRight, Math.sin(bearing))
          .normalize();
        this.setSurfaceCandidate(
          this.straightStormCandidate,
          this.playerNormal,
          this.tempA,
          surfaceAngle,
        );
        const clearance = this.getStormClearance(
          this.straightStormCandidate,
          this.regularStormPool,
        );
        if (clearance > bestClearance) {
          bestClearance = clearance;
          this.straightStormBestCandidate.copy(this.straightStormCandidate);
        }
        if (clearance < STRAIGHT_STORM_MIN_REGULAR_CLEARANCE) continue;
        foundClearCandidate = true;
        break;
      }
      if (foundClearCandidate) break;
    }

    // Three six-unit exclusion discs cannot cover this broad forward search
    // band; the guard keeps that invariant explicit if future constants move.
    if (!foundClearCandidate) return false;
    this.straightRunStorm.activate(
      this.straightStormBestCandidate,
      this.gameElapsed,
      this.straightStormRandom,
    );
    return true;
  }

  onRainStart() {
    this.sound.storm();
    this.cameraShake = this.motionEnabled ? Math.max(this.cameraShake, 0.12) : 0;
    ui.stormFlash.classList.remove("flash");
    void ui.stormFlash.offsetWidth;
    ui.stormFlash.classList.add("flash");
  }

  spawnGorillaSwarm(targetNormal, reservedForStraight = false) {
    this.sound.gorilla();
    const spawnRandom = reservedForStraight
      ? this.straightStormRandom
      : this.random;
    const right = this.tempA
      .crossVectors(
        Math.abs(targetNormal.y) > 0.82 ? new THREE.Vector3(1, 0, 0) : Y_AXIS,
        targetNormal,
      )
      .normalize();
    const forward = this.tempB.crossVectors(targetNormal, right).normalize();
    let spawned = 0;

    for (const gorilla of this.gorillaPool) {
      if (gorilla.active) continue;
      if (gorilla.reservedForStraight !== reservedForStraight) continue;
      const baseAngle =
        (spawned / this.profile.gorillasPerStorm) * Math.PI * 2;
      const placed = trySurfacePlacement(
        24,
        (attempt) => {
          const angle =
            baseAngle +
            (attempt === 0 ? 0 : spawnRandom.range(-0.45, 0.45));
          const radius = spawnRandom.range(1.45, 2.45);
          this.tempC
            .copy(right)
            .multiplyScalar(Math.cos(angle))
            .addScaledVector(forward, Math.sin(angle))
            .normalize();
          const surfaceAngle = radius / PLANET_RADIUS;
          gorilla.normal
            .copy(targetNormal)
            .multiplyScalar(Math.cos(surfaceAngle))
            .addScaledVector(this.tempC, Math.sin(surfaceAngle))
            .normalize();
        },
        () => this.isTreeContact(gorilla.normal),
      );
      if (!placed) continue;
      gorilla.forward
        .copy(this.playerNormal)
        .addScaledVector(
          gorilla.normal,
          -this.playerNormal.dot(gorilla.normal),
        )
        .normalize();
      gorilla.bornAt = this.gameElapsed;
      gorilla.dangerAt =
        this.gameElapsed + STRAIGHT_STORM_DANGER_DELAY_SECONDS;
      gorilla.expiresAt = this.gameElapsed + GORILLA_CHASE_SECONDS;
      const speedRange = getGorillaSpeedRange(this.gameElapsed);
      gorilla.speed = spawnRandom.range(speedRange.min, speedRange.max);
      gorilla.active = true;
      spawned += 1;
      if (spawned >= this.profile.gorillasPerStorm) break;
    }
  }

  updatePlayerTransform() {
    this.viewRight.crossVectors(this.playerFacing, this.playerNormal).normalize();
    this.tempA.copy(this.playerFacing).multiplyScalar(-1);
    this.tempMatrix.makeBasis(this.viewRight, this.playerNormal, this.tempA);
    this.player.position
      .copy(this.playerNormal)
      .multiplyScalar(PLANET_RADIUS + PLAYER_HEIGHT);
    this.player.quaternion.setFromRotationMatrix(this.tempMatrix);
  }

  updatePlayerAnimation() {
    const movement =
      this.mode === "playing"
        ? clamp(this.playerSpeedFactor, 0, BOOST_MULTIPLIER)
        : 0;
    const cadence = 10 * Math.max(0.65, movement);
    const swing =
      Math.sin(this.gameElapsed * cadence) *
      0.6 *
      clamp(movement, 0, 1);
    this.playerLeftArm.rotation.x = swing;
    this.playerRightArm.rotation.x = -swing;
    this.playerLeftLeg.rotation.x = -swing * 0.72;
    this.playerRightLeg.rotation.x = swing * 0.72;
    this.player.position.addScaledVector(
      this.playerNormal,
      Math.abs(Math.sin(this.gameElapsed * cadence)) *
        0.045 *
        clamp(movement, 0, 1),
    );
  }

  updateCamera(delta, immediate = false) {
    this.viewRight.crossVectors(this.viewForward, this.playerNormal).normalize();
    const playerPosition = this.tempA
      .copy(this.playerNormal)
      .multiplyScalar(PLANET_RADIUS + 1.35);
    const desiredPosition = this.tempB
      .copy(this.playerNormal)
      .multiplyScalar(PLANET_RADIUS + (IS_MOBILE ? 6.4 : 6.9))
      .addScaledVector(this.viewForward, IS_MOBILE ? -7.2 : -8.7);
    const smoothing = immediate ? 1 : 1 - Math.exp(-delta * 5.5);
    this.camera.position.lerp(desiredPosition, smoothing);
    this.camera.up.lerp(this.playerNormal, smoothing).normalize();

    if (this.cameraShake > 0 && this.motionEnabled) {
      const shake = this.cameraShake;
      this.camera.position
        .addScaledVector(this.viewRight, (Math.random() - 0.5) * shake)
        .addScaledVector(this.playerNormal, (Math.random() - 0.5) * shake * 0.55);
      this.cameraShake = Math.max(0, this.cameraShake - delta * 0.45);
    }
    this.camera.lookAt(playerPosition.addScaledVector(this.viewForward, 1.3));

    const boosted = this.mode === "playing" && this.gameElapsed < this.boostUntil;
    const targetFov = this.baseFov + (boosted && this.motionEnabled ? 2.5 : 0);
    this.camera.fov +=
      (targetFov - this.camera.fov) *
      (immediate ? 1 : 1 - Math.exp(-delta * 5));
    this.camera.updateProjectionMatrix();

    this.sun.position
      .copy(this.playerNormal)
      .multiplyScalar(PLANET_RADIUS + 19)
      .addScaledVector(this.viewRight, 10);
    this.sun.target.position
      .copy(this.playerNormal)
      .multiplyScalar(PLANET_RADIUS + 1);
    this.sun.target.updateMatrixWorld();

    if (this.fillLight) {
      this.fillLight.position
        .copy(this.playerNormal)
        .multiplyScalar(PLANET_RADIUS + 14)
        .addScaledVector(this.viewRight, -12);
      this.fillLight.target.position
        .copy(this.playerNormal)
        .multiplyScalar(PLANET_RADIUS + 1);
      this.fillLight.target.updateMatrixWorld();
    }
  }

  updateHomeCamera(delta) {
    const angle = this.ambientTime * 0.08;
    this.camera.position.set(
      Math.sin(angle) * HOME_ORBIT_RADIUS,
      HOME_ORBIT_HEIGHT + Math.sin(angle * 0.7) * HOME_ORBIT_BOB,
      Math.cos(angle) * HOME_ORBIT_RADIUS,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, HOME_LOOKAT_HEIGHT, 0);
    this.camera.fov +=
      (this.baseFov - this.camera.fov) * (1 - Math.exp(-delta * 5));
    this.camera.updateProjectionMatrix();
    this.stars.rotation.y += delta * 0.005;
  }

  updateResultCamera(delta) {
    const angle = this.ambientTime * 0.16;
    this.viewRight.crossVectors(this.viewForward, this.playerNormal).normalize();
    const orbitDirection = this.tempA
      .copy(this.viewForward)
      .multiplyScalar(Math.cos(angle) * -7.5)
      .addScaledVector(this.viewRight, Math.sin(angle) * 5.5);
    const desired = this.tempB
      .copy(this.playerNormal)
      .multiplyScalar(PLANET_RADIUS + 5.7)
      .add(orbitDirection);
    this.camera.position.lerp(desired, 1 - Math.exp(-delta * 2.5));
    this.camera.up.lerp(this.playerNormal, 0.08).normalize();
    this.tempC
      .copy(this.playerNormal)
      .multiplyScalar(PLANET_RADIUS + 1.4);
    this.camera.lookAt(this.tempC);
  }

  updateVisuals(delta) {
    if (this.mode === "home") {
      this.updateHomeCamera(delta);
      this.bananaField.update(
        this.ambientTime,
        getStage(0).bananaTarget,
        this.playerNormal,
        this.playerFacing,
      );
    } else if (this.mode === "result") {
      this.updateResultCamera(delta);
      this.bananaField.update(
        this.gameElapsed + this.ambientTime,
        this.currentStage.bananaTarget,
        this.playerNormal,
        this.playerFacing,
      );
    } else {
      this.updateCamera(delta);
    }

    this.updatePlayerTransform();
    this.updatePlayerAnimation();
    this.gorillaRenderer.update(this.gorillaPool, this.gameElapsed);

    // Motion-reduced users still get the ambient rain, just calmed way
    // down rather than removed, per the existing 揺れ(motion) preference.
    const orbitalMotionScale = this.motionEnabled ? 1 : 0.15;
    this.orbitalRain.cloudGroup.rotation.y += delta * 0.006 * orbitalMotionScale;
    const orbitalTime = this.ambientTime * orbitalMotionScale;
    // The gameplay camera follows the player's patch; the home/result camera
    // orbits the whole globe. In either case decorative fallers are limited to
    // the horizon/far side so none project onto the ground as false threats.
    const usePlayerCullNormal =
      this.mode === "playing" || this.mode === "countdown" || this.mode === "paused";
    if (usePlayerCullNormal) {
      this.orbitalRain.updateFallers(orbitalTime, this.playerNormal);
    } else {
      this.orbitalRain.updateFallers(
        orbitalTime,
        this.orbitalViewNormal.copy(this.camera.position).normalize(),
      );
    }

    this.skyMaterial.uniforms.uTime.value = this.ambientTime;

    const boosted = this.mode === "playing" && this.gameElapsed < this.boostUntil;
    ui.app.classList.toggle("is-boosting", boosted && this.motionEnabled);
    ui.boostBadge.hidden = !boosted;
    if (boosted) {
      ui.boostValue.textContent = Math.max(0, this.boostUntil - this.gameElapsed).toFixed(1);
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= delta;
      if (this.toastTimer <= 0) ui.toast.classList.remove("show");
    }
  }

  updateHUD(force = false) {
    if (!force && this.gameElapsed - this.lastHudUpdateAt < 0.1) return;
    this.lastHudUpdateAt = this.gameElapsed;
    const remaining = getRemainingSeconds(this.gameElapsed, this.bananaCount);
    const total = BASE_GAME_SECONDS + getBonusSeconds(this.bananaCount);
    ui.score.textContent = formatScore(calculateScore(this.gameElapsed, this.bananaCount));
    ui.timer.textContent = remaining.toFixed(1);
    ui.timerCard.style.setProperty(
      "--time-progress",
      `${clamp(remaining / total, 0, 1)}turn`,
    );
    ui.timerCard.classList.toggle("urgent", remaining <= 10);
    ui.bananas.textContent = String(this.bananaCount);
    ui.bananaNext.textContent = `あと${bananasUntilBonus(this.bananaCount)}本で +5秒`;
    ui.phase.textContent = this.currentStage.label;
    ui.phaseDot.style.background =
      this.currentStage.index === 0
        ? "#8be5dc"
        : this.currentStage.index === 1
          ? "#ffd34f"
          : "#ff5f56";
  }

  finishGame(cleared) {
    this.lastCleared = cleared;
    this.mode = "result";
    this.controls.reset();
    for (const gorilla of this.gorillaPool) gorilla.active = false;
    for (const storm of this.stormPool) storm.deactivate();
    ui.app.classList.remove("is-playing", "is-boosting");
    document.body.classList.remove("is-playing");
    ui.countdown.hidden = true;
    ui.pauseOverlay.hidden = true;
    ui.pauseButton.disabled = false;
    ui.soundButton.disabled = false;

    const score = calculateScore(this.gameElapsed, this.bananaCount);
    ui.resultScore.textContent = formatScore(score);
    ui.resultTime.textContent = this.gameElapsed.toFixed(1);
    ui.resultBananas.textContent = String(this.bananaCount);
    ui.resultBonus.textContent = String(getBonusSeconds(this.bananaCount));

    ui.resultBestScoreLabel.textContent = "端末の自己ベスト";
    const isNewRecord = this.registerScore(score);
    if (ui.resultNewRecord) ui.resultNewRecord.hidden = !isNewRecord;

    if (cleared) {
      ui.resultIcon.textContent = "🌤️";
      ui.resultKicker.textContent = "SURVIVED";
      ui.resultTitle.textContent = "ゴリラ豪雨を生還！";
      ui.resultMessage.textContent = "最後まで逃げ切りました。";
      this.sound.clear();
    } else {
      ui.resultIcon.textContent = "🦍";
      ui.resultKicker.textContent = "CAUGHT";
      ui.resultTitle.textContent = "ゴリラに捕まった！";
      ui.resultMessage.textContent = "バナナを集めて、もう一度逃げよう。";
      this.sound.gameOver();
    }
    this.showScreen("result");
    ui.result.scrollTop = 0;
    this.setLabNavigationLocked(true);
    void this.submitGameScore(score, this.scoreSubmissionRunId);
    window.requestAnimationFrame(() => {
      ui.resultTitle.focus({ preventScroll: true });
    });
  }

  async shareGame() {
    const text = [
      "【ゴリラ豪雨】",
      "球体の島を走り、突然降るゴリラの群れから生還を目指そう。",
    ].join("\n");
    await this.shareContent(text, ui.homeShareButton);
  }

  async shareResult() {
    const score = formatScore(calculateScore(this.gameElapsed, this.bananaCount));
    const outcome = this.lastCleared ? "ゴリラ豪雨を生還！" : "ゴリラに捕まった…";
    const text = [
      "【ゴリラ豪雨】",
      outcome,
      `生存 ${this.gameElapsed.toFixed(1)}秒 / 🍌 ${this.bananaCount}本`,
      `SCORE ${score}`,
    ].join("\n");
    await this.shareContent(text, ui.shareButton);
  }

  async shareContent(text, button) {
    const textWithUrl = `${text}\n${GAME_URL}`;
    const shareData = { title: "ゴリラ豪雨", text, url: GAME_URL };
    if (navigator.share) {
      try {
        const nativeShareData =
          navigator.canShare && !navigator.canShare(shareData)
            ? { title: "ゴリラ豪雨", text: textWithUrl }
            : shareData;
        await navigator.share(nativeShareData);
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(textWithUrl);
      const original = button.textContent;
      button.textContent = "コピーしました";
      window.setTimeout(() => {
        button.textContent = original;
      }, 1600);
    } catch {
      button.textContent = "コピーできませんでした";
    }
  }

  showToast(message, duration = 1500) {
    ui.toast.textContent = message;
    ui.toast.classList.add("show");
    this.toastTimer = duration / 1000;
  }

  updateAdaptiveQuality(delta) {
    this.performanceFrames += 1;
    this.performanceSeconds += delta;
    this.performanceCooldown = Math.max(0, this.performanceCooldown - delta);
    if (this.performanceSeconds < 2.5 || this.performanceCooldown > 0) return;

    const fps = this.performanceFrames / this.performanceSeconds;
    this.performanceFrames = 0;
    this.performanceSeconds = 0;
    if (fps < 42 && this.pixelRatio > 0.85) {
      this.pixelRatio = Math.max(0.85, this.pixelRatio - 0.15);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.performanceCooldown = 5;
    }
  }

  onResize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const longEdgeCap = IS_MOBILE ? 1400 : 2100;
    const preferredPixelRatio = Math.min(
      window.devicePixelRatio || 1,
      this.profile.maxPixelRatio,
      longEdgeCap / Math.max(width, height),
    );
    this.pixelRatio =
      this.pixelRatio > 0
        ? Math.min(this.pixelRatio, preferredPixelRatio)
        : preferredPixelRatio;
    this.pixelRatio = Math.max(0.8, this.pixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  randomUnitNormal(target) {
    const y = this.random.range(-1, 1);
    const angle = this.random.range(0, Math.PI * 2);
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    return target.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  }
}

try {
  new GorillaRainGame();
} catch (error) {
  console.error("ゴリラ豪雨の初期化に失敗しました。", error);
  ui.loading.hidden = true;
  ui.webglError.hidden = false;
}
