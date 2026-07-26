import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js";

import {
  BASE_GAME_SECONDS,
  bananasUntilBonus,
  calculateScore,
  extendBoost,
  formatScore,
  getBonusMilestones,
  getBonusSeconds,
  getDeviceProfile,
  getRemainingSeconds,
  getStage,
} from "./rules.js";

const FIXED_STEP = 1 / 60;
const MAX_FIXED_STEPS = 5;
const IS_COARSE_POINTER = window.matchMedia("(pointer: coarse)").matches;
const IS_SMALL_SCREEN = Math.min(window.innerWidth, window.innerHeight) < 700;
const URL_PARAMS = new URLSearchParams(window.location.search);
const FORCED_DEVICE = URL_PARAMS.get("device");
const IS_MOBILE =
  FORCED_DEVICE === "sp" ||
  (FORCED_DEVICE !== "pc" && (IS_COARSE_POINTER || IS_SMALL_SCREEN));
const QUALITY_OVERRIDE = URL_PARAMS.get("quality");
const PLANET_RADIUS = 18;
const PLAYER_HEIGHT = 0.05;
const PLAYER_SPEED = 5.2;
const BOOST_MULTIPLIER = 1.52;
const GORILLA_CHASE_SECONDS = 5;
const GORILLA_CONTACT_DISTANCE = 0.92;
const BANANA_CONTACT_DISTANCE = 1.05;
const STORM_WARNING_SECONDS = 0.9;
const STORM_RAIN_SECONDS = 1.25;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ZERO_VECTOR = new THREE.Vector3();
const COLOR_LAND_LIGHT = new THREE.Color(0x75a843);
const COLOR_LAND = new THREE.Color(0x39743c);
const COLOR_LAND_DARK = new THREE.Color(0x214e35);
const COLOR_SAND = new THREE.Color(0xc8ab63);

const ui = {
  app: document.querySelector("#app"),
  scene: document.querySelector("#scene"),
  loading: document.querySelector("#loading"),
  loadingMessage: document.querySelector("#loading-message"),
  webglError: document.querySelector("#webgl-error"),
  home: document.querySelector("#home-screen"),
  game: document.querySelector("#game-screen"),
  result: document.querySelector("#result-screen"),
  startButton: document.querySelector("#start-button"),
  replayButton: document.querySelector("#replay-button"),
  shareButton: document.querySelector("#share-button"),
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
  soundButton: document.querySelector("#sound-button"),
  homeSoundButton: document.querySelector("#home-sound-button"),
  motionButton: document.querySelector("#motion-button"),
  controlTitle: document.querySelector("#control-title"),
  controlDetail: document.querySelector("#control-detail"),
  stormFlash: document.querySelector("#storm-flash"),
  resultIcon: document.querySelector("#result-icon"),
  resultKicker: document.querySelector("#result-kicker"),
  resultTitle: document.querySelector("#result-title"),
  resultMessage: document.querySelector("#result-message"),
  resultScore: document.querySelector("#result-score"),
  resultTime: document.querySelector("#result-time"),
  resultBananas: document.querySelector("#result-bananas"),
  resultBonus: document.querySelector("#result-bonus"),
  resultMode: document.querySelector("#result-mode"),
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
    this.enabled = safeStorageGet("goriragouu-sound", "on") !== "off";
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

    const safeX = clamp(event.clientX, 72, window.innerWidth - 72);
    const safeY = clamp(event.clientY, 82, window.innerHeight - 82);
    this.joystick.style.left = `${safeX}px`;
    this.joystick.style.top = `${safeY}px`;
    this.joystick.classList.add("visible");
    this.updateKnob(0, 0);
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
  constructor(scene, random, maxCount = 16) {
    this.random = random;
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
  }

  reset(playerNormal) {
    for (const item of this.items) {
      item.active = false;
      item.respawnAt = 0;
      this.place(item, playerNormal);
    }
    this.bananas.count = 0;
    this.tips.count = 0;
  }

  randomNormal(target) {
    const z = this.random.range(-1, 1);
    const angle = this.random.range(0, Math.PI * 2);
    const radius = Math.sqrt(Math.max(0, 1 - z * z));
    return target.set(radius * Math.cos(angle), z, radius * Math.sin(angle));
  }

  place(item, playerNormal) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      this.randomNormal(item.normal);
      if (item.normal.distanceToSquared(playerNormal) > 0.045) break;
    }
    item.spin = this.random.range(0, Math.PI * 2);
    item.phase = this.random.range(0, Math.PI * 2);
  }

  collect(playerNormal, time, targetCount) {
    const threshold = (BANANA_CONTACT_DISTANCE / PLANET_RADIUS) ** 2;
    for (let index = 0; index < Math.min(targetCount, this.items.length); index += 1) {
      const item = this.items[index];
      if (!item.active) continue;
      if (item.normal.distanceToSquared(playerNormal) > threshold) continue;
      item.active = false;
      item.respawnAt = time + 0.55;
      return true;
    }
    return false;
  }

  update(time, targetCount, playerNormal) {
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
        this.place(item, playerNormal);
        item.active = true;
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

    const ringGeometry = new THREE.RingGeometry(2.1, 2.55, 40);
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc84a,
      transparent: true,
      opacity: 0.64,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(ringGeometry, this.ringMaterial);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.035;
    this.group.add(this.ring);

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
    this.rain = new THREE.Points(this.rainGeometry, shared.rainMaterial);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.group.add(this.rain);

    this.splash = new THREE.Mesh(shared.splashGeometry, shared.splashMaterial);
    this.splash.rotation.x = -Math.PI / 2;
    this.splash.position.y = 0.06;
    this.splash.visible = false;
    this.group.add(this.splash);
  }

  activate(normal, time, random) {
    this.active = true;
    this.startedAt = time;
    this.startedRain = false;
    this.normal.copy(normal);
    this.group.visible = true;
    this.group.position.copy(normal).multiplyScalar(PLANET_RADIUS + 0.01);
    this.group.quaternion.setFromUnitVectors(Y_AXIS, normal);
    this.ring.visible = true;
    this.ring.scale.setScalar(0.82);
    this.ringMaterial.color.setHex(0xffc84a);
    this.rain.visible = false;
    this.splash.visible = false;
    this.cloud.scale.setScalar(0.72);

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
    this.rainGeometry.attributes.position.needsUpdate = true;
  }

  deactivate() {
    this.active = false;
    this.group.visible = false;
    this.rain.visible = false;
    this.splash.visible = false;
  }

  update(time, callbacks) {
    if (!this.active) return;
    const age = time - this.startedAt;
    const warningProgress = clamp(age / STORM_WARNING_SECONDS, 0, 1);
    const pulse = 1 + Math.sin(age * 15) * 0.06;
    this.ring.scale.setScalar((0.82 + warningProgress * 0.18) * pulse);
    this.ringMaterial.opacity = 0.42 + Math.sin(age * 13) * 0.2;
    this.cloud.scale.setScalar(0.72 + warningProgress * 0.28);
    this.cloud.rotation.y += 0.015;

    if (age >= STORM_WARNING_SECONDS && !this.startedRain) {
      this.startedRain = true;
      this.rain.visible = true;
      this.splash.visible = true;
      this.ringMaterial.color.setHex(0xff5b4d);
      callbacks.onRainStart(this);
    }

    if (this.startedRain) {
      const rainAge = age - STORM_WARNING_SECONDS;
      const positions = this.rainPositions;
      for (let index = 0; index < this.rainSeeds.length; index += 1) {
        const offset = index * 3 + 1;
        const height = this.rainSeeds[index] - rainAge * this.rainSpeeds[index];
        positions[offset] = ((height % 6.2) + 6.2) % 6.2 + 0.2;
      }
      this.rainGeometry.attributes.position.needsUpdate = true;
      const splashScale = 0.88 + Math.sin(rainAge * 19) * 0.12;
      this.splash.scale.setScalar(splashScale);
      this.splash.material.opacity = 0.26 + Math.sin(rainAge * 14) * 0.08;
    }

    if (age >= STORM_WARNING_SECONDS + STORM_RAIN_SECONDS) {
      callbacks.onImpact(this);
      this.deactivate();
    }
  }
}

class GorillaRainGame {
  constructor() {
    this.profile = { ...getDeviceProfile(IS_MOBILE) };
    if (QUALITY_OVERRIDE === "low") {
      this.profile.maxPixelRatio = Math.min(1, this.profile.maxPixelRatio);
      this.profile.rainDropsPerStorm = Math.min(260, this.profile.rainDropsPerStorm);
      this.profile.realShadows = false;
      this.profile.treeCount = Math.min(18, this.profile.treeCount);
      this.profile.rockCount = Math.min(14, this.profile.rockCount);
    }

    this.sound = new AudioController();
    this.motionEnabled =
      safeStorageGet("goriragouu-motion", "on") !== "off" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    this.lastCountdownNumber = -1;
    this.pixelRatio = 1;
    this.performanceFrames = 0;
    this.performanceSeconds = 0;
    this.performanceCooldown = 0;

    const seedParam = Number.parseInt(URL_PARAMS.get("seed") || "", 10);
    this.seed = Number.isFinite(seedParam) ? seedParam >>> 0 : Date.now() >>> 0;
    this.random = new SeededRandom(this.seed);

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
    this.tempQuaternion = new THREE.Quaternion();
    this.tempMatrix = new THREE.Matrix4();

    this.gorillaPool = Array.from(
      { length: this.profile.maxGorillas },
      (_, index) => ({
        index,
        active: false,
        normal: new THREE.Vector3(),
        forward: new THREE.Vector3(0, 0, -1),
        bornAt: 0,
        dangerAt: 0,
        expiresAt: 0,
        speed: 4.58,
        phase: this.random.range(0, Math.PI * 2),
      }),
    );

    this.initializeRenderer();
    this.initializeScene();
    this.initializeWorld();
    this.initializePlayer();
    this.initializeEffects();

    this.bananaField = new BananaField(this.scene3d, this.random);
    this.bananaField.reset(this.playerNormal);
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

    this.bindUI();
    this.updateOptionButtons();
    this.updateControlCopy();
    this.resetGameState();
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
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = this.profile.realShadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    ui.scene.appendChild(this.renderer.domElement);
  }

  initializeScene() {
    this.scene3d = new THREE.Scene();
    this.scene3d.background = new THREE.Color(0x0b343a);
    this.scene3d.fog = new THREE.FogExp2(0x0b343a, 0.0115);
    this.camera = new THREE.PerspectiveCamera(IS_MOBILE ? 58 : 52, 1, 0.1, 130);
    this.baseFov = this.camera.fov;

    const hemisphere = new THREE.HemisphereLight(0xbff4ee, 0x183323, 2.4);
    this.scene3d.add(hemisphere);

    this.sun = new THREE.DirectionalLight(0xffe7b0, 2.25);
    this.sun.position.set(12, 30, 18);
    this.sun.castShadow = this.profile.realShadows;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -13;
    this.sun.shadow.camera.right = 13;
    this.sun.shadow.camera.top = 13;
    this.sun.shadow.camera.bottom = -13;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 48;
    this.sun.shadow.bias = -0.00045;
    this.sun.target.position.set(0, PLANET_RADIUS, 0);
    this.scene3d.add(this.sun, this.sun.target);
  }

  initializeWorld() {
    const detail = IS_MOBILE ? 4 : 5;
    const landGeometry = new THREE.IcosahedronGeometry(PLANET_RADIUS, detail);
    const positions = landGeometry.getAttribute("position");
    const colors = [];
    const vertex = new THREE.Vector3();
    const color = new THREE.Color();

    for (let index = 0; index < positions.count; index += 1) {
      vertex.fromBufferAttribute(positions, index).normalize();
      const noise =
        Math.sin(vertex.x * 12.3 + vertex.z * 4.1) * 0.42 +
        Math.sin(vertex.y * 17.7 - vertex.x * 3.4) * 0.28 +
        Math.cos(vertex.z * 21.1 + vertex.y * 5.7) * 0.22;
      if (noise < -0.56) {
        color.copy(COLOR_SAND);
      } else if (noise > 0.5) {
        color.copy(COLOR_LAND_LIGHT);
      } else if (noise < -0.1) {
        color.copy(COLOR_LAND_DARK);
      } else {
        color.copy(COLOR_LAND);
      }
      colors.push(color.r, color.g, color.b);
    }
    landGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

    const landMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0,
      flatShading: true,
    });
    this.land = new THREE.Mesh(landGeometry, landMaterial);
    this.land.receiveShadow = this.profile.realShadows;
    this.scene3d.add(this.land);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(PLANET_RADIUS + 0.38, 32, 24),
      new THREE.MeshBasicMaterial({
        color: 0x8ce9d7,
        transparent: true,
        opacity: 0.06,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.scene3d.add(atmosphere);

    this.createDecorations();
    this.createStars();
    this.createAmbientClouds();
  }

  createDecorations() {
    const trunkGeometry = new THREE.CylinderGeometry(0.14, 0.2, 0.9, 5);
    const crownGeometry = new THREE.ConeGeometry(0.58, 1.45, 6);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x674528,
      roughness: 0.96,
    });
    const crownMaterial = new THREE.MeshStandardMaterial({
      color: 0x1b633b,
      roughness: 0.94,
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
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const normal = new THREE.Vector3();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();

    for (let index = 0; index < this.profile.treeCount; index += 1) {
      this.randomUnitNormal(normal);
      if (normal.dot(Y_AXIS) > 0.91) normal.negate();
      quaternion.setFromUnitVectors(Y_AXIS, normal);
      const size = this.random.range(0.72, 1.18);
      position.copy(normal).multiplyScalar(PLANET_RADIUS + 0.43 * size);
      scale.set(size, size, size);
      matrix.compose(position, quaternion, scale);
      trunkMesh.setMatrixAt(index, matrix);

      position.copy(normal).multiplyScalar(PLANET_RADIUS + 1.36 * size);
      matrix.compose(position, quaternion, scale);
      crownMesh.setMatrixAt(index, matrix);
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    crownMesh.instanceMatrix.needsUpdate = true;
    this.scene3d.add(trunkMesh, crownMesh);

    const rockGeometry = new THREE.DodecahedronGeometry(0.52, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x62706a,
      roughness: 0.98,
      flatShading: true,
    });
    const rocks = new THREE.InstancedMesh(
      rockGeometry,
      rockMaterial,
      this.profile.rockCount,
    );
    for (let index = 0; index < this.profile.rockCount; index += 1) {
      this.randomUnitNormal(normal);
      if (normal.dot(Y_AXIS) > 0.94) normal.negate();
      quaternion.setFromUnitVectors(Y_AXIS, normal);
      quaternion.multiply(
        this.tempQuaternion.setFromAxisAngle(Y_AXIS, this.random.range(0, Math.PI * 2)),
      );
      const size = this.random.range(0.45, 1.15);
      position.copy(normal).multiplyScalar(PLANET_RADIUS + size * 0.2);
      scale.set(size, size * this.random.range(0.6, 1), size);
      matrix.compose(position, quaternion, scale);
      rocks.setMatrixAt(index, matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    this.scene3d.add(rocks);
  }

  createStars() {
    const count = IS_MOBILE ? 170 : 290;
    const positions = new Float32Array(count * 3);
    const normal = new THREE.Vector3();
    for (let index = 0; index < count; index += 1) {
      this.randomUnitNormal(normal);
      const radius = this.random.range(64, 104);
      const offset = index * 3;
      positions[offset] = normal.x * radius;
      positions[offset + 1] = normal.y * radius;
      positions[offset + 2] = normal.z * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xc9f5ec,
      size: IS_MOBILE ? 0.16 : 0.2,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    this.stars = new THREE.Points(geometry, material);
    this.scene3d.add(this.stars);
  }

  createAmbientClouds() {
    this.ambientClouds = new THREE.Group();
    const geometry = new THREE.IcosahedronGeometry(1.15, 1);
    const material = new THREE.MeshLambertMaterial({
      color: 0xb9d5d2,
      transparent: true,
      opacity: 0.23,
      depthWrite: false,
    });
    for (let index = 0; index < (IS_MOBILE ? 9 : 14); index += 1) {
      const cloud = new THREE.Group();
      const normal = new THREE.Vector3();
      this.randomUnitNormal(normal);
      cloud.position.copy(normal).multiplyScalar(this.random.range(28, 38));
      cloud.quaternion.setFromUnitVectors(Y_AXIS, normal);
      for (let puffIndex = 0; puffIndex < 3; puffIndex += 1) {
        const puff = new THREE.Mesh(geometry, material);
        puff.position.set((puffIndex - 1) * 1.4, this.random.range(-0.2, 0.35), 0);
        puff.scale.set(
          this.random.range(0.8, 1.3),
          this.random.range(0.55, 0.85),
          this.random.range(0.65, 1),
        );
        cloud.add(puff);
      }
      this.ambientClouds.add(cloud);
    }
    this.scene3d.add(this.ambientClouds);
  }

  initializePlayer() {
    this.player = new THREE.Group();
    this.scene3d.add(this.player);
    const skin = new THREE.MeshStandardMaterial({ color: 0xd8a77e, roughness: 0.82 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x42b6a7, roughness: 0.76 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x243c55, roughness: 0.86 });
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
      splashGeometry: new THREE.RingGeometry(0.65, 2.1, 28),
      splashMaterial: new THREE.MeshBasicMaterial({
        color: 0xb5eef2,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    };
  }

  createStormPool() {
    this.stormPool = Array.from(
      { length: 3 },
      () => new StormCell(this.scene3d, this.profile, this.sharedStorm),
    );
  }

  bindUI() {
    ui.startButton.addEventListener("click", async () => {
      await this.sound.unlock();
      this.requestFullscreen();
      this.startNewGame();
    });
    ui.replayButton.addEventListener("click", async () => {
      await this.sound.unlock();
      this.startNewGame();
    });
    ui.shareButton.addEventListener("click", () => this.shareResult());
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

    window.addEventListener("resize", () => this.onResize());
    window.addEventListener("orientationchange", () => {
      this.controls?.reset();
      window.setTimeout(() => this.onResize(), 120);
    });
    window.addEventListener("blur", () => {
      if (this.mode === "playing") this.pauseGame();
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

  resetGameState() {
    this.gameElapsed = 0;
    this.bananaCount = 0;
    this.boostUntil = 0;
    this.currentStage = getStage(0);
    this.nextStormAt = 1.2;
    this.accumulator = 0;
    this.cameraShake = 0;
    this.playerNormal.set(0, 1, 0);
    this.playerFacing.set(0, 0, -1);
    this.viewForward.set(0, 0, -1);
    for (const gorilla of this.gorillaPool) gorilla.active = false;
    for (const storm of this.stormPool || []) storm.deactivate();
    this.bananaField?.reset(this.playerNormal);
    this.updatePlayerTransform();
    this.updateCamera(1, true);
    this.gorillaRenderer?.update(this.gorillaPool, 0);
    this.updateHUD();
  }

  startNewGame() {
    this.seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    this.random = new SeededRandom(this.seed);
    this.bananaField.random = this.random;
    this.resetGameState();
    this.showScreen("game");
    this.mode = "countdown";
    this.countdownRemaining = 3;
    this.lastCountdownNumber = -1;
    ui.countdown.hidden = false;
    ui.pauseOverlay.hidden = true;
    ui.app.classList.add("is-playing");
    document.body.classList.add("is-playing");
    this.lastFrameAt = performance.now();
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
    ui.pauseOverlay.hidden = false;
  }

  resumeGame() {
    if (this.mode !== "paused") return;
    ui.pauseOverlay.hidden = true;
    ui.countdown.hidden = false;
    this.mode = "countdown";
    this.countdownRemaining =
      this.resumeFromMode === "countdown" && this.gameElapsed === 0 ? 3 : 1.5;
    this.lastCountdownNumber = -1;
    this.lastFrameAt = performance.now();
    this.accumulator = 0;
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
    const rawDelta = clamp((timeMs - this.lastFrameAt) / 1000, 0, 0.083);
    this.lastFrameAt = timeMs;
    this.ambientTime += rawDelta;

    if (this.mode === "countdown") {
      this.updateCountdown(rawDelta);
    } else if (this.mode === "playing") {
      this.accumulator += rawDelta;
      let steps = 0;
      while (
        this.accumulator >= FIXED_STEP &&
        steps < MAX_FIXED_STEPS &&
        this.mode === "playing"
      ) {
        this.updateGame(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (steps === MAX_FIXED_STEPS) this.accumulator = 0;
      this.updateAdaptiveQuality(rawDelta);
    }

    this.updateVisuals(rawDelta);
    this.renderer.render(this.scene3d, this.camera);
  }

  updateGame(delta) {
    this.gameElapsed += delta;
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

    this.updatePlayer(delta);
    this.bananaField.update(
      this.gameElapsed,
      this.currentStage.bananaTarget,
      this.playerNormal,
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
      this.nextStormAt += this.profile.stormInterval;
      if (this.nextStormAt <= this.gameElapsed) {
        this.nextStormAt = this.gameElapsed + this.profile.stormInterval;
      }
    }

    for (const storm of this.stormPool) {
      storm.update(this.gameElapsed, {
        onRainStart: () => this.onRainStart(),
        onImpact: (cell) => this.spawnGorillaSwarm(cell.normal),
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

  updatePlayer(delta) {
    this.controls.getVector(this.inputVector);
    const inputStrength = clamp(this.inputVector.length(), 0, 1);
    if (inputStrength < 0.01) return;

    this.viewRight.crossVectors(this.viewForward, this.playerNormal).normalize();
    this.desiredMove
      .copy(this.viewForward)
      .multiplyScalar(this.inputVector.y)
      .addScaledVector(this.viewRight, this.inputVector.x);
    this.desiredMove.addScaledVector(
      this.playerNormal,
      -this.desiredMove.dot(this.playerNormal),
    );
    if (this.desiredMove.lengthSq() < 0.0001) return;
    this.desiredMove.normalize();

    const boosted = this.gameElapsed < this.boostUntil;
    const speed = PLAYER_SPEED * (boosted ? BOOST_MULTIPLIER : 1) * inputStrength;
    const angle = (speed * delta) / PLANET_RADIUS;
    this.previousNormal.copy(this.playerNormal);
    this.playerNormal
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(this.desiredMove, Math.sin(angle))
      .normalize();

    this.tempA
      .copy(this.viewForward)
      .addScaledVector(this.playerNormal, -this.viewForward.dot(this.playerNormal));
    if (this.tempA.lengthSq() > 0.0001) this.viewForward.copy(this.tempA.normalize());

    this.tempB
      .copy(this.desiredMove)
      .addScaledVector(this.playerNormal, -this.desiredMove.dot(this.playerNormal))
      .normalize();
    const turn = 1 - Math.exp(-delta * 12);
    this.playerFacing.lerp(this.tempB, turn);
    this.playerFacing
      .addScaledVector(this.playerNormal, -this.playerFacing.dot(this.playerNormal))
      .normalize();
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
      gorilla.normal
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(this.tempA, Math.sin(angle))
        .normalize();
      gorilla.forward
        .copy(this.tempA)
        .addScaledVector(gorilla.normal, -this.tempA.dot(gorilla.normal))
        .normalize();

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
    const available = this.stormPool.filter((storm) => !storm.active);
    const actualCount = Math.min(count, available.length);
    const baseAngle = this.random.range(0, Math.PI * 2);
    const offsets =
      actualCount === 1 ? [0] : actualCount === 2 ? [-0.78, 0.78] : [-1.34, 0, 1.34];
    this.viewRight.crossVectors(this.viewForward, this.playerNormal).normalize();

    for (let index = 0; index < actualCount; index += 1) {
      const angle = baseAngle + offsets[index] + this.random.range(-0.14, 0.14);
      this.tempA
        .copy(this.viewForward)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(this.viewRight, Math.sin(angle))
        .normalize();
      const distance = this.random.range(7.2, 12.5);
      const surfaceAngle = distance / PLANET_RADIUS;
      this.tempB
        .copy(this.playerNormal)
        .multiplyScalar(Math.cos(surfaceAngle))
        .addScaledVector(this.tempA, Math.sin(surfaceAngle))
        .normalize();
      available[index].activate(this.tempB, this.gameElapsed, this.random);
    }
  }

  onRainStart() {
    this.sound.storm();
    this.cameraShake = this.motionEnabled ? Math.max(this.cameraShake, 0.12) : 0;
    ui.stormFlash.classList.remove("flash");
    void ui.stormFlash.offsetWidth;
    ui.stormFlash.classList.add("flash");
  }

  spawnGorillaSwarm(targetNormal) {
    this.sound.gorilla();
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
      const angle = (spawned / this.profile.gorillasPerStorm) * Math.PI * 2;
      const radius = this.random.range(1.45, 2.45);
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
      gorilla.forward
        .copy(this.playerNormal)
        .addScaledVector(
          gorilla.normal,
          -this.playerNormal.dot(gorilla.normal),
        )
        .normalize();
      gorilla.bornAt = this.gameElapsed;
      gorilla.dangerAt = this.gameElapsed + 0.38;
      gorilla.expiresAt = this.gameElapsed + GORILLA_CHASE_SECONDS;
      gorilla.speed = this.random.range(4.5, 4.92);
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
    const inputStrength = this.mode === "playing" ? this.inputVector.length() : 0;
    const boosted = this.gameElapsed < this.boostUntil;
    const cadence = boosted ? 14 : 10;
    const swing = Math.sin(this.gameElapsed * cadence) * 0.6 * inputStrength;
    this.playerLeftArm.rotation.x = swing;
    this.playerRightArm.rotation.x = -swing;
    this.playerLeftLeg.rotation.x = -swing * 0.72;
    this.playerRightLeg.rotation.x = swing * 0.72;
    this.player.position.addScaledVector(
      this.playerNormal,
      Math.abs(Math.sin(this.gameElapsed * cadence)) * 0.045 * inputStrength,
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
    this.camera.fov += (targetFov - this.camera.fov) * (immediate ? 1 : 0.08);
    this.camera.updateProjectionMatrix();

    this.sun.position
      .copy(this.playerNormal)
      .multiplyScalar(PLANET_RADIUS + 19)
      .addScaledVector(this.viewRight, 10);
    this.sun.target.position
      .copy(this.playerNormal)
      .multiplyScalar(PLANET_RADIUS + 1);
    this.sun.target.updateMatrixWorld();
  }

  updateHomeCamera(delta) {
    const angle = this.ambientTime * 0.08;
    this.camera.position.set(
      Math.sin(angle) * 34,
      18 + Math.sin(angle * 0.7) * 3,
      Math.cos(angle) * 34,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 2, 0);
    this.camera.fov += (this.baseFov - this.camera.fov) * 0.08;
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
      );
    } else if (this.mode === "result") {
      this.updateResultCamera(delta);
      this.bananaField.update(
        this.gameElapsed + this.ambientTime,
        this.currentStage.bananaTarget,
        this.playerNormal,
      );
    } else {
      this.updateCamera(delta);
    }

    this.updatePlayerTransform();
    this.updatePlayerAnimation();
    this.gorillaRenderer.update(this.gorillaPool, this.gameElapsed);
    this.ambientClouds.rotation.y += delta * 0.006;

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

  updateHUD() {
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

    const score = calculateScore(this.gameElapsed, this.bananaCount);
    ui.resultScore.textContent = formatScore(score);
    ui.resultTime.textContent = this.gameElapsed.toFixed(1);
    ui.resultBananas.textContent = String(this.bananaCount);
    ui.resultBonus.textContent = String(getBonusSeconds(this.bananaCount));
    ui.resultMode.textContent = `${this.profile.label}：1地点につきゴリラ${this.profile.gorillasPerStorm}体`;

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
  }

  async shareResult() {
    const score = formatScore(calculateScore(this.gameElapsed, this.bananaCount));
    const outcome = this.lastCleared ? "ゴリラ豪雨を生還！" : "ゴリラに捕まった…";
    const text = [
      "【ゴリラ豪雨】",
      outcome,
      `生存 ${this.gameElapsed.toFixed(1)}秒 / 🍌 ${this.bananaCount}本`,
      `SCORE ${score}（${this.profile.label}）`,
    ].join("\n");
    const shareData = { title: "ゴリラ豪雨", text, url: window.location.href };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(`${text}\n${window.location.href}`);
      const original = ui.shareButton.textContent;
      ui.shareButton.textContent = "コピーしました";
      window.setTimeout(() => {
        ui.shareButton.textContent = original;
      }, 1600);
    } catch {
      ui.shareButton.textContent = "コピーできませんでした";
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
    this.pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      this.profile.maxPixelRatio,
      longEdgeCap / Math.max(width, height),
    );
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
