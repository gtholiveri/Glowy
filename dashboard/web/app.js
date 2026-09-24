"use strict";

/* GlowyMacgOrb dashboard.

   Glowy is a tiny fairy of light who lives in the rose and can't fly yet; the
   orb is her lantern. Lift it and she goes exploring with you. Bring it back and
   she returns with a new friend, who thanks you, shares why we're grateful for
   them, and moves into the garden. Every few friends the garden grows a stage.
   Friends chat with each other (Gemini through bridge.py, built-in lines as a
   fallback).

   Presenter keys: Space = lift/return the orb by hand   F = a friend arrives now
                   0-5 = jump to a garden stage          R R = reset the garden
                   H = hide the status line   M = mute   C = chatter now */

// ---------- scene layout (1920x1080 design space, matched to the art) ----------
const W = 1920;
const H = 1080;
const GLOWY_HOME = { x: 970, y: 420 }; // Glowy hovers just above the rose
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

// x, y = where the friend stands (bottom center), h = sprite height.
const FRIENDS = {
  earthworm: {
    name: "Earthworm", x: 470, y: 880, h: 150, voice: 330,
    desc: "a shy, sweet earthworm who lives in the soil and loves compost",
    thanks: "Nobody ever visits me down here. Thank you for bringing her!",
    fact: "Earthworms pull fallen leaves underground and turn them into rich soil, and their tunnels let air and rain reach plant roots.",
  },
  bee: {
    name: "Bumblebee", x: 380, y: 660, h: 125, fly: true, voice: 520,
    desc: "a round, cheerful bumblebee who hums a lot and loves flowers",
    thanks: "You carried Glowy all the way to my flowers? Thank you!",
    fact: "Bumblebees can 'buzz' a flower, shaking their flight muscles until the pollen falls out. Tomatoes and blueberries grow better thanks to it.",
  },
  snail: {
    name: "Snail", x: 1310, y: 830, h: 120, voice: 260,
    desc: "a slow, polite snail with a glowing crystal shell",
    thanks: "I'm far too slow to ever reach the rose. Thank you for bringing Glowy to me.",
    fact: "Snails nibble dead leaves and old plants, helping turn them back into food for the soil.",
  },
  frog: {
    name: "Frog", x: 1390, y: 915, h: 140, voice: 200,
    desc: "a bubbly pond frog who says ribbit and loves the pond",
    thanks: "Ribbit! Thank you for the visit. The pond felt lonely tonight.",
    fact: "Frogs don't drink with their mouths: they soak up water through their skin. They also eat lots of garden pests.",
  },
  moth: {
    name: "Moth", x: 1480, y: 520, h: 150, fly: true, voice: 600,
    desc: "a dreamy, fluffy night moth who loves moonlight",
    thanks: "I saw her glow from across the garden. Thank you for sharing her light.",
    fact: "Moths are the night shift of pollination: many flowers that bloom after dark are visited by moths.",
  },
  bat: {
    name: "Fruit Bat", x: 330, y: 470, h: 160, fly: true, voice: 760,
    desc: "a fluffy fruit bat who is awake all night and loves fruit",
    thanks: "I'm up all night and hardly anyone says hi. Thank you!",
    fact: "Fruit bats spread the seeds of the fruit they eat, planting new trees wherever they fly.",
  },
  ladybug: {
    name: "Ladybug", x: 1160, y: 690, h: 85, voice: 880,
    desc: "an energetic little ladybug who guards the plants from aphids",
    thanks: "A visit? For me? Thank you, thank you!",
    fact: "One ladybug can eat thousands of aphids in its life, protecting plants without any spray.",
  },
  mushroom: {
    name: "Mushroom", x: 400, y: 1010, h: 150, voice: 420,
    desc: "a bouncy little mushroom who says the underground roots are best friends",
    thanks: "Hello up there! Thank you for carrying such a little light so carefully.",
    fact: "Underground, fungi link plant roots into a huge network, trading water and minerals for the plants' sugar.",
  },
  firefly: {
    name: "Firefly", x: 1240, y: 430, h: 95, fly: true, voice: 980,
    desc: "a tiny firefly who loves to glow along with Glowy",
    thanks: "Another little light! Thank you. Now I have a friend to glow with.",
    fact: "A firefly's glow is 'cold light': almost all of its energy becomes light, with barely any heat.",
  },
  spider: {
    name: "Garden Spider", x: 680, y: 560, h: 140, voice: 460,
    desc: "a friendly garden spider who knits webs and is a little misunderstood",
    thanks: "Most folks run away from me. You brought me a friend instead. Thank you.",
    fact: "Garden spiders catch flies and pests all night, and their silk is stronger than steel for its weight.",
  },
  luna_moth: {
    name: "Luna Moth", rare: true, x: 1650, y: 620, h: 175, fly: true, voice: 700,
    desc: "a rare, elegant luna moth, gentle and wise",
    thanks: "I only get one week to see the world. Thank you for sharing a moment of it with me.",
    fact: "Grown-up luna moths have no mouths. They don't eat at all, and live for only about a week.",
  },
  tortoise: {
    name: "Ancient Tortoise", rare: true, x: 1720, y: 900, h: 150, voice: 150,
    desc: "an ancient, slow, wise tortoise with flowers growing on its shell",
    thanks: "I have waited a very long time for a visit like this. Thank you, little one.",
    fact: "Some tortoises live for more than 150 years, longer than almost any other animal on land.",
  },
};
// The first friends arrive in an order that matches what each stage adds
// (worm -> sprouts, bee -> meadow, frog -> pond, bat -> tree, firefly -> full bloom).
const ORDER = ["earthworm", "bee", "snail", "frog", "moth", "bat", "ladybug", "mushroom", "firefly", "spider"];
const RARE = ["luna_moth", "tortoise"];
const GLOWY = { name: "Glowy", voice: 1100, desc: "Glowy, a tiny fairy of warm light who lives in the rose and can't fly yet" };

const ATTRACT = [
  "Glowy can't fly yet… carry her lantern into the garden.",
  "Lift the orb and take Glowy exploring.",
  "Every trip, Glowy makes a new friend.",
];
const LIFT = ["Glowy's out exploring with you!", "Show Glowy the garden!", "Off you go! Glowy has never been this far."];
const AWAY = ["The garden is waiting for Glowy…", "Who will Glowy meet out there?"];
const HOMESICK = "Glowy's getting sleepy… bring her home?";
const QUICK = "Back so soon? Take Glowy a little farther next time!";
const FULL = "Everyone's here. The garden is full of friends.";
const BYE = ["Bye, Glowy! Bring back someone nice!", "Have fun out there, Glowy!", "Carry her gently!", "Say hi to everyone for us!"];
const HELLO = ["Hi, everyone!", "What a lovely garden!", "Thank you for having me!"];

// Built-in chatter, used whenever Gemini isn't available.
const FALLBACK = [
  { s: "glowy", t: "Thank you all for keeping me company." },
  { s: "glowy", t: "I wonder who we'll meet next time!" },
  { s: "glowy", t: "The rose feels warmer with all of you here." },
  { s: "earthworm", t: "The soil's extra cozy tonight. You're welcome, roots!" },
  { s: "earthworm", t: "Thank you, fallen leaves. Delicious." },
  { s: "bee", t: "Bzz! These flowers smell like thank-you notes." },
  { s: "bee", t: "Thank you, flowers! Same time tomorrow?" },
  { s: "snail", t: "I'll get there. Eventually. Thank you for waiting." },
  { s: "snail", t: "My shell glows brighter when Glowy's home." },
  { s: "frog", t: "Ribbit! The pond says hello to everyone." },
  { s: "frog", t: "I caught three mosquitoes. You're all welcome. Ribbit." },
  { s: "moth", t: "The moonlight is so soft tonight." },
  { s: "moth", t: "Thank you, night flowers, for staying open for me." },
  { s: "bat", t: "Good night? Good morning? Hi, everyone!" },
  { s: "bat", t: "I'll plant us a fig tree. Just give me time." },
  { s: "ladybug", t: "Aphid patrol reporting! The leaves are safe." },
  { s: "mushroom", t: "Psst. The tree roots say thank you." },
  { s: "mushroom", t: "Underground news: everyone's roots are holding hands." },
  { s: "firefly", t: "Glow buddies! Blink twice if you're happy." },
  { s: "firefly", t: "I learned my best glow from Glowy." },
  { s: "spider", t: "I knitted a web. It says 'welcome.'" },
  { s: "spider", t: "Thank you for not running away. It means a lot." },
  { s: "luna_moth", t: "Every moment here is a gift." },
  { s: "tortoise", t: "When I was young, this garden was one pebble. Look at it now." },
  { s: "any", t: "Thank you, {other}, for everything you do here." },
  { s: "any", t: "Has anyone seen how bright the rose is tonight?" },
  { s: "any", t: "{other}, you're my favorite neighbor." },
  { s: "any", t: "I'm grateful for this garden. And for snacks." },
];

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const sceneEl = $("scene");
const friendsEl = $("friends");
const glowyEl = $("glowy");
const dimEl = $("dim");
const flashEl = $("flash");
const narrEl = $("narration");
const statusEl = $("status");
const startEl = $("start");
const cardEl = $("card");

let started = false;
let home = true; // is the orb sitting on the flower?
let awaySince = 0;
let homesickShown = false;
let busy = false; // a friend-arrival sequence is running
let shownStage = 0;
let lastEvent = "a quiet moment in the garden";
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
    blip(pitch) {
      tone(pitch * (0.9 + Math.random() * 0.25), { dur: 0.07, type: "triangle", gain: 0.05, verb: 0.1 });
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
const COLORS = ["255,200,215", "255,236,190", "170,255,235"];
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
function ring(x, y, color = "255,210,225", max = 1100) {
  rings.push({ x, y, r: 20, max, color });
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
      life: 1, decay: 0.012 + Math.random() * 0.01, size: 5 + Math.random() * 7, c: pick(COLORS),
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
    s.vy += 0.04;
    s.vx *= 0.985;
    s.life -= s.decay;
    if (s.life <= 0) {
      sparks.splice(i, 1);
      continue;
    }
    fx.globalAlpha = s.life;
    fx.drawImage(glowSprite(s.c), s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
  }

  fx.globalAlpha = 1;
  fx.globalCompositeOperation = "source-over";
  requestAnimationFrame(draw);
}

function flash(at, rgb, strength) {
  flashEl.style.background = `radial-gradient(circle at ${at.x}px ${at.y}px, rgba(${rgb},0.95) 0%, rgba(${rgb},0.35) 22%, rgba(${rgb},0) 55%)`;
  flashEl.animate([{ opacity: 0 }, { opacity: strength, offset: 0.08 }, { opacity: 0 }], { duration: 900, easing: "ease-out" });
}

// ---------- characters ----------
function spot(id, dx = 0, dy = 0, scale = 1) {
  return `translate(-50%, -100%) translate(${dx}px, ${dy}px) scale(${scale})`;
}

function makeFriendEl(id) {
  const f = FRIENDS[id];
  const el = document.createElement("div");
  el.className = "friend" + (f.fly ? " flier" : "");
  el.style.left = `${f.x}px`;
  el.style.top = `${f.y}px`;
  el.style.height = `${f.h}px`;
  el.style.transformOrigin = "50% 100%";
  el.innerHTML = `<div class="bob"><img src="assets/friends/${id}.png" alt=""></div><div class="bubble"></div>`;
  el.querySelector(".bob").style.animationDelay = `${-Math.random() * 4}s`;
  friendsEl.appendChild(el);
  return el;
}

function rebuildFriends() {
  friendsEl.innerHTML = "";
  friendEls.clear();
  for (const id of garden.friends) friendEls.set(id, makeFriendEl(id));
}

function glowyFlyAway() {
  trails.add(glowyEl);
  const a = glowyEl.animate([
    { transform: spot("glowy"), opacity: 1 },
    { transform: spot("glowy", 120, -160, 1.25), opacity: 1, offset: 0.35 },
    { transform: spot("glowy", 780, -560, 2.2), opacity: 0 },
  ], { duration: 1400, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" });
  a.onfinish = () => {
    trails.delete(glowyEl);
    glowyEl.classList.add("gone");
    a.cancel();
  };
}

function glowyFlyHome() {
  glowyEl.getAnimations().forEach((a) => a.cancel());
  glowyEl.classList.remove("gone");
  trails.add(glowyEl);
  const a = glowyEl.animate([
    { transform: spot("glowy", -820, 420, 2.2), opacity: 0 },
    { transform: spot("glowy", -200, 40, 1.3), opacity: 1, offset: 0.6 },
    { transform: spot("glowy"), opacity: 1 },
  ], { duration: 1300, easing: "cubic-bezier(.2,.7,.3,1)" });
  a.onfinish = () => {
    trails.delete(glowyEl);
    burst(GLOWY_HOME.x, GLOWY_HOME.y - 80, 24, COLORS, 4);
  };
}

function popIn(el, id) {
  const f = FRIENDS[id];
  const dx = POP.x - f.x;
  const dy = POP.y - f.y;
  el._pop = el.animate([
    { transform: spot(id, dx, dy, 0), opacity: 0 },
    { transform: spot(id, dx, dy, 1.25), opacity: 1, offset: 0.6 },
    { transform: spot(id, dx, dy, 1), opacity: 1 },
  ], { duration: 650, easing: "ease-out", fill: "forwards" });
}

async function moveToSpot(el, id) {
  const f = FRIENDS[id];
  const dx = POP.x - f.x;
  const dy = POP.y - f.y;
  trails.add(el);
  const a = el.animate([
    { transform: spot(id, dx, dy, 1) },
    { transform: spot(id, dx * 0.5, dy * 0.5 - 180, 1.08), offset: 0.5 },
    { transform: spot(id) },
  ], { duration: 1500, easing: "ease-in-out" });
  el._pop?.cancel(); // the move animation now owns the transform
  await a.finished;
  trails.delete(el);
  burst(f.x, f.y - f.h / 2, 30, COLORS, 5);
}

// ---------- speech ----------
function typeText(el, text, pitch) {
  return new Promise((resolve) => {
    let i = 0;
    el.textContent = "";
    const step = () => {
      i++;
      el.textContent = text.slice(0, i);
      const ch = text[i - 1];
      if (/[a-z]/i.test(ch) && i % 2 === 0) Sound.blip(pitch);
      if (i < text.length) setTimeout(step, ",.!?…".includes(ch) ? 130 : 34);
      else resolve();
    };
    step();
  });
}

function hideBubbles() {
  document.querySelectorAll(".bubble.on").forEach((b) => b.classList.remove("on"));
}

async function say(id, text) {
  const host = id === "glowy" ? glowyEl : friendEls.get(id);
  if (!host || (id === "glowy" && !home)) return;
  const who = id === "glowy" ? GLOWY : FRIENDS[id];
  hideBubbles();
  const b = host.querySelector(".bubble");
  clearTimeout(b._hide);
  b.innerHTML = '<span class="who"></span><span class="txt"></span>';
  b.querySelector(".who").textContent = who.name;
  b.classList.add("on");
  await typeText(b.querySelector(".txt"), text, who.voice);
  b._hide = setTimeout(() => b.classList.remove("on"), 2200 + text.length * 45);
}

// ---------- chatter ----------
const chat = { queue: [], lastFetch: -1e9, fetching: false, recent: [] };

function cast() {
  return [...(home ? ["glowy"] : []), ...garden.friends];
}

async function refill(eventText) {
  if (chat.fetching || location.protocol === "file:") return;
  if (!eventText && performance.now() - chat.lastFetch < 20000) return;
  const who = cast();
  if (who.length < 2) return;
  chat.fetching = true;
  chat.lastFetch = performance.now();
  try {
    const res = await fetch("/api/chatter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cast: who.map((id) => ({ id, desc: id === "glowy" ? GLOWY.desc : FRIENDS[id].desc })),
        event: eventText || lastEvent,
        n: 8,
      }),
    });
    const data = await res.json();
    if (data.lines && data.lines.length) {
      if (eventText) chat.queue = data.lines;
      else chat.queue.push(...data.lines);
    }
  } catch {
    /* bridge offline: the built-in lines cover it */
  } finally {
    chat.fetching = false;
  }
}

function fallbackLine(present) {
  const friends = present.filter((id) => id !== "glowy");
  const options = FALLBACK.filter((l) => (l.s === "any" ? friends.length > 0 : present.includes(l.s)))
    .filter((l) => !chat.recent.includes(l.t));
  if (!options.length) {
    chat.recent = [];
    return null;
  }
  const l = pick(options);
  chat.recent = [...chat.recent.slice(-8), l.t];
  const speaker = l.s === "any" ? pick(friends) : l.s;
  const others = present.filter((id) => id !== speaker);
  const otherId = others.length ? pick(others) : "glowy";
  const other = otherId === "glowy" ? GLOWY.name : FRIENDS[otherId].name;
  return { speaker, text: l.t.replace("{other}", other) };
}

function nextLine() {
  const present = cast();
  while (chat.queue.length) {
    const l = chat.queue.shift();
    if (present.includes(l.speaker)) return l;
  }
  return fallbackLine(present);
}

function chatter(force = false) {
  if (!started || (busy && !force)) return;
  if (cast().length === 0) return;
  if (chat.queue.length < 3) refill();
  const line = nextLine();
  if (line) say(line.speaker, line.text);
}

function scheduleChatter() {
  setTimeout(() => {
    chatter();
    scheduleChatter();
  }, 5500 + Math.random() * 3500);
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

async function showCard(id, isNew) {
  const f = FRIENDS[id];
  cardEl.classList.toggle("rare", !!f.rare);
  $("cardImg").src = `assets/friends/${id}.png`;
  $("cardKicker").textContent = !isNew ? "An old friend came back!" : f.rare ? "A rare visitor!" : "Glowy brought a friend!";
  $("cardName").textContent = f.name;
  $("cardThanks").textContent = "";
  $("cardFactText").textContent = f.fact;
  $("cardFact").classList.remove("on");
  cardEl.classList.remove("hidden");
  await wait(600);
  await typeText($("cardThanks"), `“${isNew ? f.thanks : "Thank you for visiting me again!"}”`, f.voice);
  await wait(400);
  $("cardFact").classList.add("on");
  await wait(Math.max(5200, f.fact.length * 48));
  cardEl.classList.add("hidden");
  await wait(600);
}

async function stageUp(n) {
  shownStage = n;
  Sound.stageUp();
  ring(FLOWER.x, FLOWER.y, "255,220,235", 1500);
  setTimeout(() => ring(FLOWER.x, FLOWER.y, "170,255,235", 1500), 260);
  burst(FLOWER.x, FLOWER.y, 90, COLORS, 11);
  showStage(n);
  flyTarget = STAGES[n].fireflies;
  narrate(`The garden grows: ${STAGES[n].name}!`, 4500);
  await wait(3200);
}

async function arrival() {
  busy = true;
  hideBubbles();
  await wait(1300); // let Glowy land first
  const id = pickFriend();
  const f = FRIENDS[id];
  const isNew = !garden.friends.includes(id);
  narrate(isNew ? (f.rare ? "Glowy found someone rare!" : "Glowy's home, and she brought a friend!") : `${f.name} came back to say thank you!`, 6000);

  const el = makeFriendEl(id);
  popIn(el, id);
  Sound.friend(id);
  burst(POP.x, POP.y - f.h / 2, 50, COLORS, 8);
  await wait(900);
  await showCard(id, isNew);
  await moveToSpot(el, id);

  if (isNew) {
    garden.friends.push(id);
    friendEls.set(id, el);
    save();
    say(id, pick(HELLO));
  } else {
    el.remove(); // the friend was already living here
    say(id, "Thank you again!");
  }
  updateHud();
  const st = stageIndex();
  if (st > shownStage) await stageUp(st);

  lastEvent = isNew ? `${f.name} just moved into the garden after meeting Glowy` : `${f.name} came back to visit`;
  refill(lastEvent);
  if (garden.friends.length === ORDER.length + RARE.length) narrate(FULL, 6000);
  busy = false;
}

function onLift() {
  awaySince = performance.now();
  homesickShown = false;
  Sound.lift();
  flash(GLOWY_HOME, "160,255,235", 0.35);
  burst(GLOWY_HOME.x, GLOWY_HOME.y - 80, 30, ["190,255,240", "255,240,210"], 6);
  glowyEl.querySelector(".bubble").classList.remove("on");
  glowyFlyAway();
  dimEl.classList.add("on");
  narrate(pick(LIFT), 7000);
  lastEvent = "a visitor just picked up Glowy's lantern and carried her off to explore";
  const f = pick(garden.friends);
  if (f) setTimeout(() => !busy && say(f, pick(BYE)), 1100);
}

function welcomeHome() {
  Sound.home();
  flash(FLOWER, "255,215,225", 0.75);
  ring(FLOWER.x, FLOWER.y);
  burst(FLOWER.x, FLOWER.y, 70, COLORS, 9);
  dimEl.classList.remove("on");
  glowyFlyHome();
}

function onReturn() {
  const trip = performance.now() - awaySince;
  welcomeHome();
  if (busy) return;
  if (trip < MIN_TRIP_MS) {
    narrate(QUICK, 5000);
    return;
  }
  arrival();
}

function setHome(isHome, silent = false) {
  if (isHome === home) return;
  home = isHome;
  if (!home) awaySince = performance.now();
  if (silent) {
    glowyEl.classList.toggle("gone", !home);
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
  shownStage = 0;
  showStage(0, true);
  flyTarget = STAGES[0].fireflies;
  updateHud();
  narrate("A new garden, waiting to grow.", 4000);
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
  arrival();
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
  else if (e.code === "KeyC") chatter(true);
  else if (e.code === "KeyR") {
    if (performance.now() - resetArmed < 2000) resetGarden();
    else {
      resetArmed = performance.now();
      narrate("Press R again to reset the garden.", 2000);
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
  if (!home && !homesickShown && now - awaySince > HOMESICK_MS) {
    homesickShown = true;
    narrate(HOMESICK);
    Sound.homesick();
  }
  if (!busy && now - lastNarration > 26000) narrate(home ? pick(ATTRACT) : pick(AWAY), 9000);
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
  narrate(home ? pick(ATTRACT) : pick(AWAY), 9000);
  scheduleChatter();
}
startEl.addEventListener("click", start);

glowyEl.style.left = `${GLOWY_HOME.x}px`;
glowyEl.style.top = `${GLOWY_HOME.y}px`;
fit();
rebuildFriends();
shownStage = stageIndex();
showStage(shownStage, true);
flyTarget = STAGES[shownStage].fireflies;
updateHud();
requestAnimationFrame(draw);
connect();
