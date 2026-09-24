"use strict";

/* GlowyMacgOrb dashboard.

   Glowy is a tiny fairy of light who lives in the rose and can't fly yet; the
   orb is her lantern. Lift it and she goes exploring with you, somewhere in the
   garden. Bring it back and she returns with the friend she found there, who
   moves in. Every few friends the garden grows a stage.

   Presenter keys: Space = lift/return the orb by hand   F = a friend arrives now
                   0-5 = jump to a garden stage          R R = reset the garden
                   H = hide the status line   M = mute */

// ---------- scene layout (1920x1080 design space, matched to the art) ----------
const W = 1920;
const H = 1080;
const LANTERN = { x: 970, y: 365 }; // Glowy's lantern (the orb's twin) rests on the rose
const GLOWY_HOME = { x: 970, y: 270 }; // Glowy hovers just above her lantern
const GLOWY_CORE_Y = GLOWY_HOME.y - 179 * 0.455; // her glowing core (see #glowy in style.css)
const FLOWER = { x: 970, y: 520 }; // center of the rose, where light bursts from
const POP = { x: 1170, y: 470 }; // where a new friend first appears, beside Glowy
const MIN_TRIP_MS = 2000; // shorter trips don't bring back a friend
const HOMESICK_MS = 60000;
const SAVE_KEY = "glowymacgorb.garden.v1";

const STAGES = [
  { name: "Bare soil", need: 0, fireflies: 8 },
  { name: "Sprouts", need: 1, fireflies: 12 },
  { name: "Meadow", need: 2, fireflies: 20 },
  { name: "Pond", need: 4, fireflies: 28 },
  { name: "Grove", need: 6, fireflies: 38 },
  { name: "Full bloom", need: 9, fireflies: 55 },
];

// x, y = where the friend lives (bottom center), h = sprite height.
// where / at = the part of the garden Glowy explores to find them.
const FRIENDS = {
  earthworm: { name: "Earthworm", x: 470, y: 880, h: 150, where: "the soft soil", at: "in the soft soil" },
  bee: { name: "Bumblebee", x: 380, y: 660, h: 125, where: "the flower patch", at: "in the flower patch" },
  snail: { name: "Snail", x: 1310, y: 830, h: 120, where: "the mossy stones", at: "on the mossy stones" },
  frog: { name: "Frog", x: 1390, y: 915, h: 140, where: "the pond", at: "by the pond" },
  moth: { name: "Moth", x: 1480, y: 520, h: 150, where: "the moonlit meadow", at: "in the moonlit meadow" },
  bat: { name: "Fruit Bat", x: 330, y: 470, h: 160, where: "the old tree", at: "up in the old tree" },
  ladybug: { name: "Ladybug", x: 1160, y: 690, h: 85, where: "the leaves", at: "on the leaves" },
  mushroom: { name: "Mushroom", x: 400, y: 1010, h: 150, where: "under the ferns", at: "under the ferns" },
  firefly: { name: "Firefly", x: 1240, y: 430, h: 95, where: "the tall grass", at: "in the tall grass" },
  spider: { name: "Garden Spider", x: 680, y: 560, h: 140, where: "the branches", at: "in the branches" },
  luna_moth: { name: "Luna Moth", rare: true, x: 1650, y: 620, h: 175, where: "the starry sky", at: "under the stars" },
  tortoise: { name: "Ancient Tortoise", rare: true, x: 1720, y: 900, h: 150, where: "the far edge of the garden", at: "at the edge of the garden" },
};
// The first friends arrive in an order that matches what each stage adds
// (worm -> sprouts, bee -> meadow, frog -> pond, bat -> tree, firefly -> full bloom).
const ORDER = ["earthworm", "bee", "snail", "frog", "moth", "bat", "ladybug", "mushroom", "firefly", "spider"];
const RARE = ["luna_moth", "tortoise"];

const ATTRACT = ["Lift Glowy's lantern to take her exploring", "Every trip, Glowy finds a new friend"];
const HOMESICK = "Glowy's getting sleepy… bring her lantern home";
const QUICK = "Too quick! Take Glowy a little farther";
const FULL = "Every friend has come home";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const sceneEl = $("scene");
const friendsEl = $("friends");
const glowyEl = $("glowy");
const lanternEl = $("lantern");
const dimEl = $("dim");
const flashEl = $("flash");
const narrEl = $("narration");
const statusEl = $("status");
const startEl = $("start");

let started = false;
let home = true; // is the orb sitting on the flower?
let awaySince = 0;
let homesickShown = false;
let busy = false; // a friend-arrival sequence is running
let shownStage = 0;
let nextFriend = null; // who Glowy will find on this trip, picked when she leaves
let lastGlimmer = 0;
const friendEls = new Map();

// ---------- saved garden ----------
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (saved && Array.isArray(saved.friends)) return { friends: saved.friends.filter((id) => FRIENDS[id]) };
  } catch {
    /* no storage: start fresh */
  }
  return { friends: [] };
}
let garden = load();
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(garden));
  } catch {
    /* no storage: the garden just won't survive a reload */
  }
}

function stageIndex() {
  let s = 0;
  STAGES.forEach((st, i) => {
    if (garden.friends.length >= st.need) s = i;
  });
  return s;
}

// ---------- scaling ----------
const sceneBox = { left: 0, top: 0, scale: 1 };
function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  sceneEl.style.transform = `translate(-50%, -50%) scale(${s})`;
  const r = sceneEl.getBoundingClientRect();
  Object.assign(sceneBox, { left: r.left, top: r.top, scale: s });
}
addEventListener("resize", fit);

function sceneXY(el, fy = 0.5) {
  const r = el.getBoundingClientRect();
  return {
    x: (r.left + r.width / 2 - sceneBox.left) / sceneBox.scale,
    y: (r.top + r.height * fy - sceneBox.top) / sceneBox.scale,
  };
}

// ---------- backgrounds ----------
const bgImgs = STAGES.map((_, i) => {
  const img = new Image();
  img.src = `assets/stage${i}.jpg`;
  $("bg").appendChild(img);
  return img;
});
let bgZ = 1;
function showStage(n, instant = false) {
  if (instant) {
    bgImgs.forEach((img, i) => {
      img.style.transition = "none";
      img.classList.toggle("on", i === n);
      void img.offsetWidth;
      img.style.transition = "";
    });
    return;
  }
  // Fade the new stage in on top, then drop the old one.
  bgImgs[n].style.zIndex = ++bgZ;
  bgImgs[n].classList.add("on");
  setTimeout(() => bgImgs.forEach((img, i) => i !== n && img.classList.remove("on")), 2800);
}

// ---------- HUD, narration, status ----------
function updateHud() {
  const n = garden.friends.length;
  const s = stageIndex();
  $("stageName").textContent = STAGES[s].name;
  $("friendCount").textContent = n === 0 ? "no friends yet" : n === 1 ? "1 friend" : `${n} friends`;
  const dots = $("dots");
  dots.innerHTML = "";
  const next = STAGES[s + 1];
  if (!next) return;
  for (let i = 0; i < next.need - STAGES[s].need; i++) {
    const d = document.createElement("span");
    d.className = "dot" + (i < n - STAGES[s].need ? " full" : "");
    dots.appendChild(d);
  }
}

function pulseHud() {
  const hud = $("hud");
  hud.classList.remove("grow");
  void hud.offsetWidth;
  hud.classList.add("grow");
}

let narrTimer = null;
let lastNarration = 0;
function narrate(text, hold = 0) {
  lastNarration = performance.now();
  clearTimeout(narrTimer);
  const show = () => {
    narrEl.textContent = text;
    narrEl.classList.add("on");
    if (hold) narrTimer = setTimeout(() => narrEl.classList.remove("on"), hold);
  };
  if (narrEl.classList.contains("on")) {
    narrEl.classList.remove("on");
    narrTimer = setTimeout(show, 450);
  } else {
    show();
  }
}

const exploring = () => (nextFriend ? `Exploring ${FRIENDS[nextFriend].where}…` : "Glowy's off exploring!");

function status(text, ok) {
  statusEl.textContent = text;
  statusEl.classList.toggle("off", !ok);
}

// ---------- sound (all synthesized, no files) ----------
const Sound = (() => {
  let ctx = null;
  let master = null;
  let wet = null;
  let muted = false;
  const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0];
  const live = () => ctx && !muted;

  function impulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function out(node, verb = 0.5) {
    node.connect(master);
    if (verb) {
      const send = ctx.createGain();
      send.gain.value = verb;
      node.connect(send);
      send.connect(wet);
    }
  }

  function tone(freq, { t = 0, dur = 0.4, type = "sine", gain = 0.2, attack = 0.006, to = null, verb = 0.5 } = {}) {
    if (!live()) return;
    const t0 = ctx.currentTime + t;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    out(g, verb);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function bell(freq, t = 0, gain = 0.1, dur = 2.4) {
    tone(freq, { t, dur, gain });
    tone(freq * 2.01, { t, dur: dur * 0.6, gain: gain * 0.35 });
    tone(freq * 3.02, { t, dur: dur * 0.35, gain: gain * 0.15 });
  }

  function buzz(freq, dur, am, { t = 0, type = "sawtooth", gain = 0.05, to = null } = {}) {
    if (!live()) return;
    const t0 = ctx.currentTime + t;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.linearRampToValueAtTime(to, t0 + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.03);
    g.gain.setValueAtTime(gain, t0 + dur - 0.08);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = am;
    const depth = ctx.createGain();
    depth.gain.value = gain * 0.7;
    lfo.connect(depth);
    depth.connect(g.gain);
    o.connect(lp);
    lp.connect(g);
    out(g, 0.3);
    o.start(t0);
    lfo.start(t0);
    o.stop(t0 + dur + 0.05);
    lfo.stop(t0 + dur + 0.05);
  }

  function noise(dur, { t = 0, gain = 0.05, freq = 1000, q = 1, am = 0 } = {}) {
    if (!live()) return;
    const t0 = ctx.currentTime + t;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    if (am) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = am;
      const depth = ctx.createGain();
      depth.gain.value = gain * 0.8;
      lfo.connect(depth);
      depth.connect(g.gain);
      lfo.start(t0);
      lfo.stop(t0 + dur);
    }
    out(g, 0.3);
    src.start(t0);
    src.stop(t0 + dur);
  }

  function ambience() {
    // A soft, slowly breathing pad...
    const pad = ctx.createGain();
    pad.gain.setValueAtTime(0, ctx.currentTime);
    pad.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 5);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 800;
    [110, 164.81, 220.5, 277.18].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? "triangle" : "sine";
      o.frequency.value = f;
      o.detune.value = (i - 1.5) * 5;
      o.connect(lp);
      o.start();
    });
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 0.018;
    lfo.connect(depth);
    depth.connect(pad.gain);
    lfo.start();
    lp.connect(pad);
    out(pad, 0.6);
    // ...plus the odd wind chime and a few crickets.
    const chime = () => {
      bell(pick(PENTA) * 2, 0, 0.022, 3.2);
      setTimeout(chime, 5000 + Math.random() * 9000);
    };
    const crickets = () => {
      for (let i = 0; i < 3; i++) noise(0.05, { t: i * 0.09, gain: 0.018, freq: 4800, q: 8 });
      setTimeout(crickets, 2500 + Math.random() * 5000);
    };
    setTimeout(chime, 3000);
    setTimeout(crickets, 1500);
  }

  return {
    init() {
      if (ctx) return;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
      const verb = ctx.createConvolver();
      verb.buffer = impulse(2.8, 2.2);
      wet = ctx.createGain();
      wet.gain.value = 0.35;
      wet.connect(verb);
      verb.connect(master);
      ambience();
    },
    toggleMute() {
      if (!ctx) return;
      muted = !muted;
      master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.1);
    },
    lift() {
      [659.25, 783.99, 880, 1046.5, 1174.66, 1318.51].forEach((f, i) =>
        tone(f, { t: i * 0.07, dur: 0.6, type: "triangle", gain: 0.07 }));
    },
    home() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(f, i * 0.06, 0.09, 3));
      [2093, 2637, 3136].forEach((f, i) => tone(f, { t: 0.3 + i * 0.08, dur: 0.8, gain: 0.03 }));
    },
    stageUp() {
      const notes = [...PENTA, ...PENTA.map((f) => f * 2)];
      notes.forEach((f, i) => tone(f, { t: i * 0.06, dur: 1.4, type: "triangle", gain: 0.06 }));
      [523.25, 783.99, 1046.5, 1318.51].forEach((f) => bell(f, notes.length * 0.06, 0.07, 3.5));
    },
    homesick() {
      tone(783.99, { dur: 1.2, gain: 0.06 });
      tone(659.25, { t: 0.5, dur: 1.8, gain: 0.06 });
    },
    friend(id) {
      if (!live()) return;
      switch (id) {
        case "bee": buzz(190, 0.7, 28, { to: 230 }); break;
        case "earthworm": tone(420, { dur: 0.25, to: 180 }); tone(380, { t: 0.3, dur: 0.25, to: 160 }); break;
        case "snail": tone(600, { dur: 0.3, to: 300 }); tone(900, { t: 0.15, dur: 0.25, to: 500 }); break;
        case "frog": buzz(120, 0.3, 24, { type: "square", to: 95 }); buzz(115, 0.3, 24, { t: 0.4, type: "square", to: 90 }); break;
        case "moth": noise(0.6, { freq: 1200, q: 2, am: 18, gain: 0.05 }); break;
        case "bat": [0, 0.12, 0.24].forEach((t) => tone(3000, { t, dur: 0.08, to: 4200, gain: 0.04 })); break;
        case "ladybug": [0, 0.1, 0.2].forEach((t) => tone(1800, { t, dur: 0.1, to: 2600, gain: 0.05 })); break;
        case "mushroom": tone(900, { dur: 0.12, to: 250 }); tone(1200, { t: 0.15, dur: 0.05, gain: 0.08 }); break;
        case "firefly": [2093, 2637, 3136].forEach((f, i) => bell(f, i * 0.08, 0.04, 1.2)); break;
        case "spider": tone(1500, { dur: 0.1, type: "triangle" }); tone(1500, { t: 0.15, dur: 0.1, type: "triangle" }); break;
        case "tortoise": tone(130.81, { dur: 1.6, gain: 0.08, attack: 0.3 }); tone(196, { t: 0.2, dur: 1.6, gain: 0.06, attack: 0.3 }); break;
        default: [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => bell(f, i * 0.09, 0.07, 2.5));
      }
    },
  };
})();

// ---------- particles ----------
const fx = $("fx").getContext("2d");
const glowSprites = {};
function glowSprite(rgb) {
  if (!glowSprites[rgb]) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, `rgba(${rgb},1)`);
    grd.addColorStop(0.25, `rgba(${rgb},0.55)`);
    grd.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    glowSprites[rgb] = c;
  }
  return glowSprites[rgb];
}
let heartCanvas = null;
function heartSprite() {
  if (!heartCanvas) {
    heartCanvas = document.createElement("canvas");
    heartCanvas.width = heartCanvas.height = 64;
    const g = heartCanvas.getContext("2d");
    g.fillStyle = "rgb(255, 150, 180)";
    g.shadowColor = "rgba(255, 110, 150, 0.9)";
    g.shadowBlur = 10;
    g.beginPath();
    g.moveTo(32, 52);
    g.bezierCurveTo(8, 36, 8, 14, 22, 14);
    g.bezierCurveTo(28, 14, 32, 19, 32, 23);
    g.bezierCurveTo(32, 19, 36, 14, 42, 14);
    g.bezierCurveTo(56, 14, 56, 36, 32, 52);
    g.fill();
  }
  return heartCanvas;
}
const COLORS = ["255,200,215", "255,236,190", "170,255,235"];
const GOLD = ["255,214,150", "255,180,100", "255,240,205"]; // Glowy's own light, the orb's orange
const flies = [];
let flyTarget = 8;
const sparks = [];
const rings = [];
const trails = new Set(); // elements that leave sparkles while they fly

function burst(x, y, n = 40, colors = COLORS, power = 7) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = Math.random() * power;
    sparks.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.5,
      life: 1, decay: 0.01 + Math.random() * 0.02, size: 6 + Math.random() * 14, c: pick(colors),
    });
  }
}
// Little hearts drifting up: a friend's thank-you, without words.
function hearts(x, y, n = 5) {
  for (let i = 0; i < n; i++) {
    sparks.push({
      x: x + (Math.random() - 0.5) * 70, y: y + (Math.random() - 0.5) * 30,
      vx: (Math.random() - 0.5) * 0.8, vy: -1.2 - Math.random() * 1.2,
      life: 1, decay: 0.008 + Math.random() * 0.006, size: 26 + Math.random() * 16, heart: true,
    });
  }
}
function ring(x, y, color = "255,210,225", max = 1100) {
  rings.push({ x, y, r: 20, max, color });
}

// ---------- Glowy's lantern: an orange dodecahedron, the on-screen twin of the real orb ----------
const lanternCtx = lanternEl.getContext("2d");
const DODECA = (() => {
  const PHI = (1 + Math.sqrt(5)) / 2;
  const v = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
  const normals = [];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      v.push([0, a / PHI, b * PHI], [a / PHI, b * PHI, 0], [a * PHI, 0, b / PHI]);
      normals.push([0, a * PHI, b], [b, 0, a * PHI], [a * PHI, b, 0]);
    }
  }
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  // Each face is the five corners nearest its normal, put in order around it.
  const faces = normals.map((raw) => {
    const n = raw.map((c) => c / Math.hypot(...raw));
    const idx = v.map((p, i) => [dot(p, n), i]).sort((p, q) => q[0] - p[0]).slice(0, 5).map(([, i]) => i);
    const mid = [0, 1, 2].map((k) => idx.reduce((s, i) => s + v[i][k], 0) / 5);
    const ref = v[idx[0]].map((c, k) => c - mid[k]);
    const angle = (i) => {
      const d = v[i].map((c, k) => c - mid[k]);
      return Math.atan2(dot(cross(ref, d), n), dot(ref, d));
    };
    return { idx: idx.sort((p, q) => angle(p) - angle(q)), n };
  });
  return { v, faces };
})();

function drawLantern(now) {
  const S = lanternEl.width;
  const c = S / 2;
  const R = 50; // corners sit ~87 px from the center
  const g = lanternCtx;
  g.clearRect(0, 0, S, S);

  // Glowy's light inside, breathing like the real orb
  const pulse = 0.75 + 0.25 * Math.sin(now / 650);
  const glow = g.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, `rgba(255, 232, 175, ${0.95 * pulse})`);
  glow.addColorStop(0.35, `rgba(255, 150, 50, ${0.5 * pulse})`);
  glow.addColorStop(1, "rgba(255, 120, 30, 0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);

  const ay = now / 4200;
  const ax = 0.45;
  const turn = ([x, y, z]) => {
    const x1 = x * Math.cos(ay) + z * Math.sin(ay);
    const z1 = -x * Math.sin(ay) + z * Math.cos(ay);
    return [x1, y * Math.cos(ax) - z1 * Math.sin(ax), y * Math.sin(ax) + z1 * Math.cos(ax)];
  };
  const pts = DODECA.v.map(turn);
  const light = [-0.35, -0.6, 0.72];
  const faces = DODECA.faces
    .map((f) => ({ f, n: turn(f.n), z: f.idx.reduce((s, i) => s + pts[i][2], 0) / 5 }))
    .sort((p, q) => p.z - q.z); // back faces first, so the glass reads as see-through
  for (const { f, n } of faces) {
    const front = n[2] > 0;
    const lit = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
    g.beginPath();
    f.idx.forEach((i, k) => {
      const x = c + pts[i][0] * R;
      const y = c + pts[i][1] * R;
      if (k) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.closePath();
    g.fillStyle = front ? `rgba(255, 150, 55, ${0.3 + 0.4 * lit})` : "rgba(200, 90, 20, 0.2)";
    g.fill();
    g.strokeStyle = `rgba(255, 222, 165, ${front ? 0.85 : 0.25})`;
    g.lineWidth = front ? 2 : 1;
    g.stroke();
  }
}

function draw(now) {
  fx.clearRect(0, 0, W, H);
  fx.globalCompositeOperation = "lighter";

  while (flies.length < flyTarget) {
    flies.push({
      x: Math.random() * W, y: 330 + Math.random() * 700, seed: Math.random() * 1000,
      speed: 0.3 + Math.random() * 0.6, size: 14 + Math.random() * 16, c: Math.random() < 0.75 ? COLORS[1] : COLORS[2],
    });
  }
  flies.length = Math.min(flies.length, flyTarget);
  for (const f of flies) {
    f.x += Math.cos(now / 2100 * f.speed + f.seed) * 0.7;
    f.y += Math.sin(now / 1700 * f.speed + f.seed * 1.3) * 0.45;
    if (f.x < -20) f.x = W + 20;
    if (f.x > W + 20) f.x = -20;
    const blink = 0.25 + 0.75 * Math.max(0, Math.sin(now / 900 * f.speed + f.seed));
    fx.globalAlpha = blink * 0.8;
    fx.drawImage(glowSprite(f.c), f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
  }

  for (const el of trails) {
    const p = sceneXY(el);
    for (let i = 0; i < 2; i++) {
      sparks.push({
        x: p.x + (Math.random() - 0.5) * 30, y: p.y + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 1.2, vy: (Math.random() - 0.5) * 1.2,
        life: 1, decay: 0.025, size: 8 + Math.random() * 10, c: pick(COLORS),
      });
    }
  }

  // Glowy sheds a little fairy dust while she hovers.
  if (home && !glowyEl.classList.contains("gone") && Math.random() < 0.3) {
    const p = sceneXY(glowyEl, 0.545);
    sparks.push({
      x: p.x + (Math.random() - 0.5) * 40, y: p.y + (Math.random() - 0.5) * 20,
      vx: (Math.random() - 0.5) * 0.6, vy: 0.4 + Math.random() * 0.6,
      life: 1, decay: 0.012 + Math.random() * 0.01, size: 5 + Math.random() * 7, c: pick(GOLD),
    });
  }

  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.r += (r.max - r.r) * 0.05 + 4;
    const a = Math.max(0, 1 - r.r / r.max) ** 2;
    fx.globalAlpha = a * 0.7;
    fx.strokeStyle = `rgba(${r.color},1)`;
    fx.lineWidth = 10 * a + 2;
    fx.beginPath();
    fx.ellipse(r.x, r.y, r.r, r.r * 0.45, 0, 0, Math.PI * 2);
    fx.stroke();
    if (a <= 0.01) rings.splice(i, 1);
  }

  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.x += s.vx;
    s.y += s.vy;
    s.vy += s.heart ? -0.01 : 0.04; // hearts float up, sparkles drift down
    s.vx *= 0.985;
    s.life -= s.decay;
    if (s.life <= 0) {
      sparks.splice(i, 1);
      continue;
    }
    fx.globalAlpha = s.life;
    const img = s.heart ? heartSprite() : glowSprite(s.c);
    fx.drawImage(img, s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
  }

  fx.globalAlpha = 1;
  fx.globalCompositeOperation = "source-over";
  drawLantern(now);
  requestAnimationFrame(draw);
}

function flash(at, rgb, strength) {
  flashEl.style.background = `radial-gradient(circle at ${at.x}px ${at.y}px, rgba(${rgb},0.95) 0%, rgba(${rgb},0.35) 22%, rgba(${rgb},0) 55%)`;
  flashEl.animate([{ opacity: 0 }, { opacity: strength, offset: 0.08 }, { opacity: 0 }], { duration: 900, easing: "ease-out" });
}

// ---------- characters ----------
function spot(dx = 0, dy = 0, scale = 1) {
  return `translate(-50%, -100%) translate(${dx}px, ${dy}px) scale(${scale})`;
}

// Each friend idles in its own way (style.css keys the animation off data-id);
// .act carries one-off reactions like the happy hop.
function makeFriendEl(id) {
  const f = FRIENDS[id];
  const el = document.createElement("div");
  el.className = "friend";
  el.dataset.id = id;
  el.style.left = `${f.x}px`;
  el.style.top = `${f.y}px`;
  el.style.height = `${f.h}px`;
  el.style.transformOrigin = "50% 100%";
  el.innerHTML = `<div class="bob"><div class="act"><img src="assets/friends/${id}.png" alt=""></div></div>`;
  el.querySelector(".bob").style.animationDelay = `${-Math.random() * 6}s`;
  friendsEl.appendChild(el);
  return el;
}

function rebuildFriends() {
  friendsEl.innerHTML = "";
  friendEls.clear();
  for (const id of garden.friends) friendEls.set(id, makeFriendEl(id));
}

function happy(el) {
  const act = el.querySelector(".act");
  act.classList.remove("happy");
  void act.offsetWidth;
  act.classList.add("happy");
  act.addEventListener("animationend", () => act.classList.remove("happy"), { once: true });
}

function lanternAt(dx = 0, dy = 0, scale = 1) {
  return `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${scale})`;
}

// Steps run on timers, not on animation-finished events: browsers pause animations
// while a page isn't being drawn (window covered, screen asleep), and the story
// shouldn't freeze with them. The animations are just the visuals.
let lanternTimers = [];
function later(ms, fn) {
  lanternTimers.push(setTimeout(fn, ms));
}

// Lifting the real orb: Glowy dives into her lantern and the lantern floats away with you.
function leaveWithLantern() {
  lanternTimers.forEach(clearTimeout);
  lanternTimers = [];
  glowyEl.getAnimations().forEach((a) => a.cancel());
  lanternEl.getAnimations().forEach((a) => a.cancel());
  glowyEl.animate([
    { transform: spot(), opacity: 1 },
    { transform: spot(0, LANTERN.y - GLOWY_CORE_Y, 0.2), opacity: 0 },
  ], { duration: 450, easing: "ease-in", fill: "forwards" });
  later(450, () => {
    glowyEl.classList.add("gone");
    burst(LANTERN.x, LANTERN.y, 24, GOLD, 4);
  });
  trails.add(lanternEl);
  lanternEl.animate([
    { transform: lanternAt(), opacity: 1 },
    { transform: lanternAt(0, -40, 1.08), opacity: 1, offset: 0.25 },
    { transform: lanternAt(780, -600, 1.9), opacity: 0 },
  ], { duration: 1500, delay: 380, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" });
  later(1900, () => {
    trails.delete(lanternEl);
    lanternEl.classList.add("gone");
  });
}

// Putting the orb back: the lantern swoops home to the rose and Glowy pops out.
function returnWithLantern() {
  lanternTimers.forEach(clearTimeout);
  lanternTimers = [];
  lanternEl.getAnimations().forEach((a) => a.cancel());
  glowyEl.getAnimations().forEach((a) => a.cancel());
  lanternEl.classList.remove("gone");
  glowyEl.classList.add("gone");
  trails.add(lanternEl);
  lanternEl.animate([
    { transform: lanternAt(-820, 420, 1.9), opacity: 0 },
    { transform: lanternAt(-160, 30, 1.15), opacity: 1, offset: 0.65 },
    { transform: lanternAt(), opacity: 1 },
  ], { duration: 900, easing: "cubic-bezier(.2,.7,.3,1)" });
  later(900, () => {
    trails.delete(lanternEl);
    burst(LANTERN.x, LANTERN.y, 40, GOLD, 6);
    glowyEl.classList.remove("gone");
    glowyEl.animate([
      { transform: spot(0, LANTERN.y - GLOWY_CORE_Y, 0.2), opacity: 0 },
      { transform: spot(0, -20, 1.15), opacity: 1, offset: 0.7 },
      { transform: spot(), opacity: 1 },
    ], { duration: 550, easing: "ease-out" });
  });
}

function popIn(el, id) {
  const f = FRIENDS[id];
  const dx = POP.x - f.x;
  const dy = POP.y - f.y;
  el._pop = el.animate([
    { transform: spot(dx, dy, 0), opacity: 0 },
    { transform: spot(dx, dy, 1.25), opacity: 1, offset: 0.6 },
    { transform: spot(dx, dy, 1), opacity: 1 },
  ], { duration: 650, easing: "ease-out", fill: "forwards" });
}

async function moveToSpot(el, id) {
  const f = FRIENDS[id];
  const dx = POP.x - f.x;
  const dy = POP.y - f.y;
  trails.add(el);
  el.animate([
    { transform: spot(dx, dy, 1) },
    { transform: spot(dx * 0.5, dy * 0.5 - 180, 1.08), offset: 0.5 },
    { transform: spot() },
  ], { duration: 1500, easing: "ease-in-out" });
  el._pop?.cancel(); // the move animation now owns the transform
  await wait(1500); // a timer, not a.finished: see later() above
  trails.delete(el);
  burst(f.x, f.y - f.h / 2, 30, COLORS, 5);
}

// ---------- the story ----------
function pickFriend() {
  const have = new Set(garden.friends);
  const rares = RARE.filter((id) => !have.has(id));
  if (have.size >= 4 && rares.length && Math.random() < 0.18) return pick(rares);
  const next = ORDER.find((id) => !have.has(id));
  if (next) return next;
  if (rares.length) return pick(rares);
  return pick(garden.friends); // everyone's here: an old friend visits again
}

function foundLine(id, isNew) {
  const f = FRIENDS[id];
  const noun = f.name.toLowerCase();
  if (!isNew) return `${f.name} came back to visit!`;
  if (f.rare) return `A rare ${noun}, ${f.at}!`;
  return `Glowy found ${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun} ${f.at}!`;
}

async function stageUp(n) {
  shownStage = n;
  Sound.stageUp();
  ring(FLOWER.x, FLOWER.y, "255,220,235", 1500);
  setTimeout(() => ring(FLOWER.x, FLOWER.y, "170,255,235", 1500), 260);
  burst(FLOWER.x, FLOWER.y, 90, COLORS, 11);
  showStage(n);
  flyTarget = STAGES[n].fireflies;
  narrate("The garden grows!", 4000);
  updateHud();
  pulseHud();
  await wait(3200);
}

async function arrival(id) {
  busy = true;
  await wait(1600); // let the lantern land and Glowy pop out first
  const f = FRIENDS[id];
  const isNew = !garden.friends.includes(id);

  const el = makeFriendEl(id);
  popIn(el, id);
  Sound.friend(id);
  burst(POP.x, POP.y - f.h / 2, 40, COLORS, 7);
  hearts(POP.x, POP.y - f.h * 0.8, 6);
  narrate(foundLine(id, isNew), 5000);
  await wait(700);
  happy(el);
  await wait(2300);
  await moveToSpot(el, id);

  if (isNew) {
    garden.friends.push(id);
    friendEls.set(id, el);
    save();
  } else {
    el.remove(); // the friend already lives here
  }
  const settled = friendEls.get(id);
  if (settled) {
    happy(settled);
    hearts(f.x, f.y - f.h, 4);
  }
  updateHud();
  const st = stageIndex();
  if (st > shownStage) await stageUp(st);
  if (isNew && garden.friends.length === ORDER.length + RARE.length) narrate(FULL, 6000);
  nextFriend = null;
  busy = false;
}

function onLift() {
  awaySince = performance.now();
  homesickShown = false;
  if (!nextFriend) nextFriend = pickFriend();
  Sound.lift();
  flash(LANTERN, "255,200,130", 0.35);
  burst(LANTERN.x, LANTERN.y, 30, GOLD, 6);
  leaveWithLantern();
  dimEl.classList.add("on");
  narrate("Glowy's off exploring!");
  setTimeout(() => {
    if (!home && !homesickShown) narrate(exploring());
  }, 2600);
}

function welcomeHome() {
  Sound.home();
  flash(LANTERN, "255,215,170", 0.75); // instant: the moment the orb touches the flower
  ring(FLOWER.x, FLOWER.y);
  burst(FLOWER.x, FLOWER.y, 70, COLORS, 9);
  dimEl.classList.remove("on");
  returnWithLantern();
}

function onReturn() {
  const trip = performance.now() - awaySince;
  welcomeHome();
  if (busy) return;
  if (trip < MIN_TRIP_MS) {
    narrate(QUICK, 4500);
    return;
  }
  arrival(nextFriend || pickFriend());
}

function setHome(isHome, silent = false) {
  if (isHome === home) return;
  home = isHome;
  if (!home) awaySince = performance.now();
  if (silent) {
    glowyEl.classList.toggle("gone", !home);
    lanternEl.classList.toggle("gone", !home);
    dimEl.classList.toggle("on", !home);
    return;
  }
  if (home) onReturn();
  else onLift();
}

// ---------- presenter controls ----------
function jumpToStage(n) {
  if (busy) return;
  garden.friends = ORDER.slice(0, STAGES[n].need);
  save();
  rebuildFriends();
  nextFriend = null;
  shownStage = n;
  showStage(n, true);
  flyTarget = STAGES[n].fireflies;
  updateHud();
  narrate(`Garden: ${STAGES[n].name}`, 2500);
}

function resetGarden() {
  if (busy) return;
  garden = { friends: [] };
  save();
  rebuildFriends();
  nextFriend = null;
  shownStage = 0;
  showStage(0, true);
  flyTarget = STAGES[0].fireflies;
  updateHud();
  narrate("A new garden, waiting to grow", 4000);
}

function forceFriend() {
  if (busy) return;
  if (!home) {
    home = true;
    welcomeHome();
  } else {
    Sound.home();
    flash(FLOWER, "255,215,225", 0.6);
    ring(FLOWER.x, FLOWER.y);
  }
  arrival(nextFriend || pickFriend());
}

let resetArmed = 0;
document.addEventListener("keydown", (e) => {
  if (!started) {
    start();
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    setHome(!home);
  } else if (e.code === "KeyF") forceFriend();
  else if (e.code === "KeyH") document.body.classList.toggle("clean");
  else if (e.code === "KeyM") Sound.toggleMute();
  else if (e.code === "KeyR") {
    if (performance.now() - resetArmed < 2000) resetGarden();
    else {
      resetArmed = performance.now();
      narrate("Press R again to reset the garden", 2000);
    }
  } else if (/^Digit[0-5]$/.test(e.code)) jumpToStage(Number(e.code.slice(5)));
});

// ---------- orb events from bridge.py ----------
let bridgeOrb = null;
let flipperSeen = false;
function connect() {
  if (location.protocol === "file:") {
    status("open through bridge.py to hear the flower (keys still work)", false);
    return;
  }
  const events = new EventSource("/events");
  events.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    status(msg.flipper ? "listening to the flower" : "waiting to hear the flower…", msg.flipper);
    if (msg.flipper && !flipperSeen) {
      // First time we hear the Flipper: match the orb's real position quietly.
      flipperSeen = true;
      bridgeOrb = msg.orb;
      setHome(msg.orb, true);
      return;
    }
    // Only trust fresh news: if the Flipper goes quiet, keep things as they are
    // rather than treating the silence as the orb being lifted.
    if (flipperSeen && msg.flipper && msg.orb !== bridgeOrb) {
      bridgeOrb = msg.orb;
      setHome(msg.orb);
    }
  };
  events.onerror = () => status("bridge offline: is bridge.py running?", false);
}

// ---------- timers ----------
setInterval(() => {
  if (!started) return;
  const now = performance.now();
  if (!home) {
    if (!homesickShown && now - awaySince > HOMESICK_MS) {
      homesickShown = true;
      narrate(HOMESICK);
      Sound.homesick();
    }
    // A shimmer where Glowy is exploring hints at who she'll find there.
    if (nextFriend && now - lastGlimmer > 1400) {
      lastGlimmer = now;
      const f = FRIENDS[nextFriend];
      burst(f.x + (Math.random() - 0.5) * 80, f.y - f.h * 0.5 + (Math.random() - 0.5) * 60, 8, COLORS, 2.5);
    }
  }
  if (!busy && now - lastNarration > 26000) {
    narrate(home ? pick(ATTRACT) : homesickShown ? HOMESICK : exploring(), 9000);
  }
}, 500);

// ---------- start ----------
function start() {
  if (started) return;
  started = true;
  Sound.init();
  startEl.classList.add("gone");
  try {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } catch {
    /* fullscreen is optional */
  }
  narrate(home ? pick(ATTRACT) : exploring(), 9000);
}
startEl.addEventListener("click", start);

glowyEl.style.left = `${GLOWY_HOME.x}px`;
glowyEl.style.top = `${GLOWY_HOME.y}px`;
lanternEl.style.left = `${LANTERN.x}px`;
lanternEl.style.top = `${LANTERN.y}px`;
fit();
rebuildFriends();
shownStage = stageIndex();
showStage(shownStage, true);
flyTarget = STAGES[shownStage].fireflies;
updateHud();
requestAnimationFrame(draw);
connect();
