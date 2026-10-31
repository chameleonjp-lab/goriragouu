export const LANGUAGES = Object.freeze([
  ['ja','日本語'],['en','English'],['es','Español'],['pt-BR','Português (Brasil)'],
  ['zh-Hans','简体中文'],['fr','Français'],['de','Deutsch'],['ko','한국어'],
  ['ru','Русский'],['it','Italiano'],['zh-Hant','繁體中文'],['id','Bahasa Indonesia'],
  ['tr','Türkçe'],['vi','Tiếng Việt'],['th','ไทย'],
]);
const KEY = 'goriragouu-language';
const FALLBACK_ENGLISH = {
  "volume": "Volume",
  "retryRanking": "Retry ranking",
  "retryScore": "Retry score submission",
  "gameTitle": "Gorilla Downpour",
  "eyebrow": "3D survival",
  "loading": "Preparing the spherical island…",
  "loadSlow": "Loading is taking longer than expected. Check your connection and reload.",
  "loadFailed": "Could not load the 3D engine. Check your connection and reload.",
  "intro": "Run around a spherical island and dodge sudden gorilla downpours for 60 seconds. Keep moving in one direction and they will target the path ahead.",
  "contactRule": "Contact ends the game",
  "bananaRule": "2-second boost; every 10 adds 5 seconds",
  "obstacleRule": "Rocks slow you; trees block you",
  "nameLabel": "Leaderboard name (optional)",
  "namePlaceholder": "Up to 10 characters",
  "nameHelp": "Enter a name to publish your name and score on the leaderboard. You can play with it blank.",
  "nameSaved": "Scores will be submitted under the saved name “{name}”.",
  "nameReady": "This run will be submitted automatically as “{name}”.",
  "guest": "Playing without a name. Your score will not be published.",
  "localBest": "Best on this device",
  "registeredBest": "Best for this registered name",
  "start": "Enter the downpour",
  "startHint": "Tap to start",
  "mobileTitle": "Hold and swipe",
  "mobileDetail": "Hold near the center and slide in the direction you want to run. Release to stop.",
  "desktopTitle": "Drag to move",
  "desktopDetail": "Hold the mouse button and drag toward your escape route. You can also use the arrow keys.",
  "rules": "How to play",
  "rule1": "Touching a gorilla ends the game immediately.",
  "rule2": "Rocks slow you while touching them. You cannot pass through the translucent trees.",
  "rule3": "Each banana gives 100 points and a 2-second boost. Every 10 bananas adds 5 seconds to the remaining time.",
  "rule4": "Keep running in one direction and an extra downpour will appear ahead.",
  "language": "Language",
  "motionOn": "Motion: on",
  "motionOff": "Motion: off",
  "soundOn": "Sound: on",
  "soundOff": "Sound: off",
  "soundToggle": "Toggle sound",
  "share": "Share on X",
  "ranking": "Leaderboard",
  "score": "Score",
  "time": "Time left",
  "bananas": "Bananas",
  "bananaNext": "{count} more for +5 seconds",
  "phase": "{count} storm sites",
  "boost": "Boost",
  "seconds": "s",
  "bananaUnit": "",
  "pause": "Pause",
  "paused": "Paused",
  "pauseDetail": "The timer and gorillas are paused.",
  "resume": "Resume",
  "getReady": "Get ready to run!",
  "go": "Go! Escape the downpour!",
  "resumed": "Resumed!",
  "stage2": "Downpours at 2 sites! More bananas too.",
  "stage3": "Final downpour! Gorillas arrive at 3 sites.",
  "bonusToast": "🍌 10 bananas! 5 seconds added.",
  "survived": "Survived",
  "caught": "Caught",
  "clearTitle": "You survived the downpour!",
  "clearMessage": "You made it to the end.",
  "caughtTitle": "A gorilla caught you!",
  "caughtMessage": "Collect bananas and try another escape.",
  "finalScore": "Final score",
  "newBest": "New personal best!",
  "survivalTime": "Time survived",
  "bonusTime": "Time added",
  "pending": "With a name entered, your final result is submitted automatically.",
  "notPublished": "No name was entered, so this score is not published.",
  "submitting": "Submitting to the leaderboard…",
  "submitted": "Submitted the score for “{name}”.",
  "submittedBest": "Updated the best score for “{name}”.",
  "submitFailed": "Could not submit the score. Check your connection.",
  "rankingLoading": "Loading the leaderboard…",
  "rankingEmpty": "No leaderboard scores yet.",
  "rankingFailed": "Could not load the leaderboard. Try opening the full leaderboard.",
  "rankingTitle": "Best-score leaderboard",
  "top30": "Top 30 players",
  "you": "You",
  "rank": "#{rank}",
  "points": "{score} pts",
  "retry": "Run again",
  "home": "Home",
  "recovering": "Restoring the 3D view",
  "recoveryDetail": "3D rendering paused on your device. The game is paused too. Please wait here.",
  "recovered": "3D view restored",
  "webglTitle": "Could not open the 3D view",
  "webglDetail": "Open the game in a recent Safari, Chrome or Edge browser with WebGL enabled.",
  "shareIntro": "Run around a spherical island and survive sudden gorilla downpours.",
  "shareStats": "Survived {seconds}s / {count} bananas",
  "copied": "Copied",
  "copyPrompt": "Copy the share text",
  "gameScreen": "Game screen",
  "moveArea": "Movement controls",
  "menu": "Related links",
  "keyRules": "Key rules",
  "noscript": "Enable JavaScript to play this game."
};
const cache = new Map([["en", FALLBACK_ENGLISH]]);
let locale = 'en', messages = FALLBACK_ENGLISH, english = FALLBACK_ENGLISH, generation = 0;
export function matchLanguage(value) {
  const tag = String(value || '').replaceAll('_','-').toLowerCase();
  if (/^zh-(tw|hk|mo|hant)(-|$)/.test(tag)) return 'zh-Hant';
  if (tag === 'zh' || /^zh-(cn|sg|hans)(-|$)/.test(tag)) return 'zh-Hans';
  if (tag === 'pt' || tag.startsWith('pt-')) return 'pt-BR';
  return LANGUAGES.find(([id]) => id.toLowerCase() === tag || id === tag.split('-')[0])?.[0] || null;
}
export function chooseLanguage(saved, browserLanguages = []) {
  return matchLanguage(saved) || browserLanguages.map(matchLanguage).find(Boolean) || 'en';
}
export function getLanguage() { return locale; }
export function t(key, params = {}) {
  return String(messages[key] ?? english[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}
export function setText(element, key, params = {}, attribute = '') {
  if (!element) return;
  element.dataset.i18n = key;
  element.dataset.i18nParams = JSON.stringify(params);
  if (attribute) element.dataset.i18nAttr = attribute;
  else delete element.dataset.i18nAttr;
  renderElement(element);
}
function renderElement(element) {
  let params = {};
  try { params = JSON.parse(element.dataset.i18nParams || '{}'); } catch {}
  const value = t(element.dataset.i18n, params);
  if (element.dataset.i18nAttr) element.setAttribute(element.dataset.i18nAttr, value);
  else element.textContent = value;
}
function render() {
  document.documentElement.lang = locale;
  document.title = t('gameTitle');
  document.querySelectorAll('[data-i18n]').forEach(renderElement);
  const selector = document.querySelector('#language-select');
  if (selector) selector.value = locale;
}
async function load(language) {
  if (cache.has(language)) return cache.get(language);
  const controller = new AbortController();
  let timer;
  try {
    const dictionary = await Promise.race([
      fetch(new URL(`./locales/${language}.json`, import.meta.url), {cache:'no-cache', signal:controller.signal})
        .then(response => {
          if (!response.ok) throw new Error(`Locale unavailable: ${language}`);
          return response.json();
        }),
      new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Locale request timed out'));
      }, 8000); }),
    ]);
    cache.set(language, dictionary);
    return dictionary;
  } finally { clearTimeout(timer); }
}
export async function changeLanguage(language, persist = true) {
  const id = matchLanguage(language) || 'en';
  const request = ++generation;
  let dictionary;
  try { dictionary = await load(id); }
  catch { dictionary = english; }
  if (request !== generation) return;
  locale = dictionary === english && id !== 'en' ? 'en' : id;
  messages = dictionary;
  // A transient fetch failure changes the displayed fallback, not the user's preference.
  if (persist) { try { localStorage.setItem(KEY, id); } catch {} }
  render();
  document.dispatchEvent(new Event('game-language-change'));
}
export function initI18n() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  english = FALLBACK_ENGLISH;
  const selector = document.querySelector('#language-select');
  if (selector) {
    for (const [id,name] of LANGUAGES) {
      const option = document.createElement('option');option.value=id;option.textContent=name;selector.appendChild(option);
    }
    selector.addEventListener('change', () => { void changeLanguage(selector.value); });
  }
  // Render the bundled English copy immediately; translations never block starting a run.
  locale = 'en';
  messages = english;
  render();
  void changeLanguage(chooseLanguage(saved, navigator.languages || [navigator.language]), false);
}
