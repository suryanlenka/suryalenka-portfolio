/* ============================================================
   Save the Baby Dragon — game logic
   Plain JavaScript, no libraries. Uses requestAnimationFrame for
   smooth animation and the Web Audio API for simple sound effects.
   ============================================================ */

(function () {
  "use strict";

  /* ---------- Grab the elements we need from the page ---------- */
  const game = document.getElementById("game");
  const playfield = document.getElementById("playfield");
  const cloudsLayer = document.getElementById("clouds");
  const hud = document.getElementById("hud");
  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const banner = document.getElementById("banner");

  const welcomeScreen = document.getElementById("welcome-screen");
  const gameoverScreen = document.getElementById("gameover-screen");
  const finalScoreEl = document.getElementById("final-score");
  const finalMessageEl = document.getElementById("final-message");
  const startBtn = document.getElementById("start-btn");
  const restartBtn = document.getElementById("restart-btn");

  /* ---------- Game configuration (tuned to stay kid-friendly) ---------- */
  const DRAGON_SPEED = 6; // how fast the dragon moves per frame while a key is held
  const BASE_FALL_SPEED = 2.2; // starting fall speed for gems
  const MAX_FALL_SPEED = 5.5; // cap so it never gets too hard for children
  const SPEED_STEP = 0.4; // extra speed added every difficulty step
  const POINTS_PER_STEP = 15; // difficulty rises every 15 points

  const GEM_EMOJIS = ["\ud83d\udc8e", "\ud83d\udc9a", "\ud83d\udc99", "\u2764\ufe0f", "\ud83d\udc9c"]; // colorful normal gems
  const GOLDEN_GEM = "\ud83c\udf1f"; // rare golden gem worth +5
  const BIRD_EMOJIS = ["\ud83d\udc26", "\ud83e\udd85"]; // angry birds

  /* ---------- Mutable game state ---------- */
  let state = {
    running: false,
    score: 0,
    lives: 3,
    dragonX: 0, // horizontal center of the dragon, in pixels
    dragonY: 0, // vertical center of the dragon, in pixels
    fallSpeed: BASE_FALL_SPEED,
    gems: [], // active gem objects { el, x, y, golden }
    birds: [], // active bird objects { el, x, y, dir, speed }
    keys: { left: false, right: false, up: false, down: false },
    lastGemAt: 0,
    lastBirdAt: 0,
    lastBonusShown: 0, // tracks which bonus milestone was last announced
    celebrationTriggered: false,
    rafId: null,
  };

  /* ============================================================
     Sound effects (Web Audio API) — created lazily on first use
     ============================================================ */
  let audioCtx = null;

  function getAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    return audioCtx;
  }

  // Play a short tone. Used to build happy/oops sounds.
  function playTone(freq, duration, type, startTime, volume) {
    const ctx = getAudio();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume || 0.2, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  // Happy rising chime when collecting a gem
  function playHappy(golden) {
    const ctx = getAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (golden) {
      // A sparkly little arpeggio for golden gems
      [659, 784, 988, 1319].forEach(function (f, i) {
        playTone(f, 0.18, "triangle", now + i * 0.07, 0.22);
      });
    } else {
      playTone(660, 0.12, "triangle", now, 0.2);
      playTone(880, 0.14, "triangle", now + 0.08, 0.2);
    }
  }

  // Gentle "oops" sound when hitting a bird
  function playOops() {
    const ctx = getAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    playTone(300, 0.18, "sawtooth", now, 0.18);
    playTone(180, 0.25, "sawtooth", now + 0.12, 0.18);
  }

  // Festive celebration sound (fanfare at score 100)
  function playCelebration() {
    const ctx = getAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [
      { f: 523, t: 0.0 },  // C
      { f: 659, t: 0.12 }, // E
      { f: 784, t: 0.24 }, // G
      { f: 1047, t: 0.36 }, // C
      { f: 784, t: 0.48 }, // G
      { f: 1047, t: 0.58 }, // C
      { f: 1319, t: 0.68 }, // E
    ];
    notes.forEach(function (n) {
      playTone(n.f, 0.18, "triangle", now + n.t, 0.22);
    });
  }

  /* ============================================================
     Decorative clouds — create a few that drift gently
     ============================================================ */
  function createClouds() {
    cloudsLayer.innerHTML = "";
    const count = 5;
    for (let i = 0; i < count; i++) {
      const cloud = document.createElement("div");
      cloud.className = "cloud";
      const size = 80 + Math.random() * 90;
      cloud.style.width = size + "px";
      cloud.style.height = size * 0.6 + "px";
      cloud.style.top = 10 + Math.random() * 55 + "%";
      // Combine a slow horizontal drift with a soft up/down bob
      const driftTime = 28 + Math.random() * 22;
      cloud.style.animation =
        "drift " + driftTime + "s linear infinite, bob " + (3 + Math.random() * 2) + "s ease-in-out infinite";
      cloud.style.animationDelay = -(Math.random() * driftTime) + "s, 0s";
      cloudsLayer.appendChild(cloud);
    }
  }

  /* ============================================================
     The dragon
     ============================================================ */
  let dragonEl = null;

  function createDragon() {
    dragonEl = document.createElement("div");
    dragonEl.id = "dragon";
    dragonEl.textContent = "\ud83d\udc09";
    playfield.appendChild(dragonEl);
    state.dragonX = game.clientWidth / 2;
    state.dragonY = game.clientHeight / 2;
    dragonEl.style.left = state.dragonX + "px";
    dragonEl.style.top = state.dragonY + "px";
  }

  /* ============================================================
     Spawning gems and birds
     ============================================================ */
  function spawnGem() {
    const golden = Math.random() < 0.15; // ~15% chance of a rare golden gem
    const el = document.createElement("div");
    el.className = "gem" + (golden ? " golden" : "");
    el.textContent = golden ? GOLDEN_GEM : GEM_EMOJIS[Math.floor(Math.random() * GEM_EMOJIS.length)];

    const x = 30 + Math.random() * (game.clientWidth - 60);
    el.style.left = x + "px";
    el.style.top = "-50px";
    playfield.appendChild(el);

    state.gems.push({ el: el, x: x, y: -50, golden: golden });
  }

  function spawnBird() {
    const dir = Math.random() < 0.5 ? 1 : -1; // 1 = left\u2192right, -1 = right\u2192left
    const el = document.createElement("div");
    el.className = "bird" + (dir === 1 ? " flip" : "");
    el.textContent = BIRD_EMOJIS[Math.floor(Math.random() * BIRD_EMOJIS.length)];

    // Birds fly across at a random height anywhere on the screen
    const y = 40 + Math.random() * (game.clientHeight - 80);
    const startX = dir === 1 ? -60 : game.clientWidth + 60;
    el.style.left = startX + "px";
    el.style.top = y + "px";
    playfield.appendChild(el);

    state.birds.push({ el: el, x: startX, y: y, dir: dir, speed: state.fallSpeed + 1.5 });
  }

  /* ============================================================
     Sparkle particle effect when collecting a gem
     ============================================================ */
  function sparkle(x, y, golden) {
    const count = golden ? 14 : 8;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("div");
      p.className = "sparkle";
      p.style.left = x + "px";
      p.style.top = y + "px";
      if (golden) p.style.background = "gold";
      else p.style.background = ["#ff7eb6", "#7ec8ff", "#5fd06a", "gold"][i % 4];

      // Random direction for each particle
      const angle = (Math.PI * 2 * i) / count;
      const dist = 30 + Math.random() * 30;
      p.style.setProperty("--dx", Math.cos(angle) * dist + "px");
      p.style.setProperty("--dy", Math.sin(angle) * dist + "px");

      playfield.appendChild(p);
      // Clean up the particle after its animation finishes
      setTimeout(function () {
        p.remove();
      }, 650);
    }
  }

  /* ============================================================
     HUD + bonus messages
     ============================================================ */
  function updateHud() {
    scoreEl.textContent = state.score;
    livesEl.textContent = "\u2764\ufe0f".repeat(state.lives) || "\ud83d\udc94";
  }

  function showBanner(text) {
    banner.textContent = text;
    banner.classList.remove("hidden");
    // Restart the CSS animation by forcing a reflow
    banner.style.animation = "none";
    void banner.offsetWidth;
    banner.style.animation = "";
    setTimeout(function () {
      banner.classList.add("hidden");
    }, 2000);
  }

  // Show milestone messages exactly once as the score crosses them
  function checkBonus() {
    if (state.score >= 50 && state.lastBonusShown < 50) {
      showBanner("Dragon Master!");
      state.lastBonusShown = 50;
    } else if (state.score >= 25 && state.lastBonusShown < 25) {
      showBanner("Baby Dragon is getting stronger!");
      state.lastBonusShown = 25;
    }
  }

  // Trigger celebration exactly once when score hits 100
  function checkCelebration() {
    if (state.score >= 100 && !state.celebrationTriggered) {
      launchCelebration();
    }
  }

  // Difficulty rises gradually every POINTS_PER_STEP points, capped for kids
  function updateDifficulty() {
    const steps = Math.floor(state.score / POINTS_PER_STEP);
    state.fallSpeed = Math.min(MAX_FALL_SPEED, BASE_FALL_SPEED + steps * SPEED_STEP);
  }

  /* ============================================================
     Celebration — confetti + fireworks at score 100
     ============================================================ */
  const CONFETTI_COLORS = ["#ff7eb6", "#7ec8ff", "#5fd06a", "#ffd700", "#ff9f43", "#a29bfe", "#fd79a8"];

  function createConfetti(overlay, count) {
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("div");
      piece.className = "confetti";
      piece.style.left = Math.random() * 100 + "%";
      piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      piece.style.animationDuration = (2 + Math.random() * 2.5) + "s";
      piece.style.animationDelay = (Math.random() * 0.8) + "s";
      overlay.appendChild(piece);
      setTimeout(function () {
        piece.remove();
      }, 5000);
    }
  }

  function createFirework(overlay, x, y) {
    const shell = document.createElement("div");
    shell.className = "firework-shell";
    shell.style.left = x + "px";
    shell.style.top = y + "px";
    shell.style.width = "60px";
    shell.style.height = "60px";
    shell.style.background = "radial-gradient(circle, " + CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] + " 0%, transparent 70%)";
    overlay.appendChild(shell);
    setTimeout(function () {
      shell.remove();
    }, 1000);

    const burstCount = 12 + Math.floor(Math.random() * 8);
    for (let i = 0; i < burstCount; i++) {
      const spark = document.createElement("div");
      spark.className = "firework";
      spark.style.left = x + "px";
      spark.style.top = y + "px";
      spark.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      const angle = (Math.PI * 2 * i) / burstCount;
      const dist = 40 + Math.random() * 60;
      spark.style.setProperty("--dx", Math.cos(angle) * dist + "px");
      spark.style.setProperty("--dy", Math.sin(angle) * dist + "px");
      // Custom fly animation for each spark
      spark.style.animation = "none";
      void spark.offsetWidth;
      spark.animate(
        [
          { transform: "translate(0,0) scale(1)", opacity: 1 },
          { transform: "translate(" + Math.cos(angle) * dist + "px," + Math.sin(angle) * dist + "px) scale(0)", opacity: 0 },
        ],
        { duration: 800 + Math.random() * 400, easing: "ease-out", fill: "forwards" }
      );
      overlay.appendChild(spark);
      setTimeout(function () {
        spark.remove();
      }, 1500);
    }
  }

  function launchCelebration() {
    if (state.celebrationTriggered) return;
    state.celebrationTriggered = true;

    const overlay = document.createElement("div");
    overlay.className = "celebration-overlay";
    overlay.id = "celebration-overlay";
    game.appendChild(overlay);

    // Play a festive fanfare
    playCelebration();

    // Show a big win banner
    const win = document.createElement("div");
    win.className = "win-banner";
    win.textContent = "\ud83c\udf89 Score 100! Dragon Legend! \ud83c\udf89";
    overlay.appendChild(win);
    setTimeout(function () {
      win.remove();
    }, 3000);

    // Rain confetti
    createConfetti(overlay, 60);

    // Launch fireworks across the screen in waves
    const w = game.clientWidth;
    const h = game.clientHeight;
    const positions = [
      [w * 0.2, h * 0.25],
      [w * 0.5, h * 0.2],
      [w * 0.8, h * 0.3],
      [w * 0.35, h * 0.45],
      [w * 0.65, h * 0.4],
      [w * 0.15, h * 0.55],
      [w * 0.85, h * 0.5],
      [w * 0.5, h * 0.6],
    ];

    positions.forEach(function (pos, idx) {
      setTimeout(function () {
        if (!state.running) return;
        createFirework(overlay, pos[0], pos[1]);
      }, idx * 350);
    });

    // Continue raining more confetti
    setTimeout(function () {
      if (!state.running) return;
      createConfetti(overlay, 40);
    }, 1200);

    setTimeout(function () {
      if (!state.running) return;
      createConfetti(overlay, 40);
    }, 2400);

    // Clean up the overlay after everything finishes
    setTimeout(function () {
      if (overlay.parentNode) overlay.remove();
    }, 5500);
  }

  /* ============================================================
     Collision helper — simple distance check between centers
     ============================================================ */
  function isHit(ax, ay, bx, by, radius) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy < radius * radius;
  }

  /* ============================================================
     Main game loop
     ============================================================ */
  function loop(timestamp) {
    if (!state.running) return;

    const w = game.clientWidth;
    const h = game.clientHeight;

    /* --- Move the dragon in all four directions based on keys --- */
    if (state.keys.left) state.dragonX -= DRAGON_SPEED;
    if (state.keys.right) state.dragonX += DRAGON_SPEED;
    if (state.keys.up) state.dragonY -= DRAGON_SPEED;
    if (state.keys.down) state.dragonY += DRAGON_SPEED;

    // Keep the dragon fully inside the screen
    const margin = 45;
    state.dragonX = Math.max(margin, Math.min(w - margin, state.dragonX));
    state.dragonY = Math.max(margin, Math.min(h - margin, state.dragonY));

    dragonEl.style.left = state.dragonX + "px";
    dragonEl.style.top = state.dragonY + "px";

    /* --- Spawn new gems on a timer (slightly faster as score rises) --- */
    const gemInterval = Math.max(550, 1100 - state.score * 6);
    if (timestamp - state.lastGemAt > gemInterval) {
      spawnGem();
      state.lastGemAt = timestamp;
    }

    /* --- Spawn birds occasionally --- */
    const birdInterval = Math.max(1400, 2600 - state.score * 8);
    if (timestamp - state.lastBirdAt > birdInterval) {
      spawnBird();
      state.lastBirdAt = timestamp;
    }

    /* --- Update gems: fall down, check collection, remove off-screen --- */
    for (let i = state.gems.length - 1; i >= 0; i--) {
      const gem = state.gems[i];
      gem.y += state.fallSpeed;
      gem.el.style.top = gem.y + "px";

      // Collected by the dragon?
      if (isHit(gem.x, gem.y, state.dragonX, state.dragonY, 65)) {
        const points = gem.golden ? 5 : 1;
        state.score += points;
        sparkle(gem.x, gem.y, gem.golden);
        playHappy(gem.golden);
        gem.el.remove();
        state.gems.splice(i, 1);
        updateHud();
        updateDifficulty();
        checkBonus();
        checkCelebration();
        continue;
      }

      // Fell past the bottom — remove it
      if (gem.y > h + 50) {
        gem.el.remove();
        state.gems.splice(i, 1);
      }
    }

    /* --- Update birds: fly across, check hit, remove off-screen --- */
    for (let i = state.birds.length - 1; i >= 0; i--) {
      const bird = state.birds[i];
      bird.x += bird.dir * bird.speed;
      bird.el.style.left = bird.x + "px";

      // Hit the dragon?
      if (isHit(bird.x, bird.y, state.dragonX, state.dragonY, 60)) {
        state.lives -= 1;
        playOops();
        bird.el.remove();
        state.birds.splice(i, 1);
        updateHud();
        // Brief hurt flash on the dragon
        dragonEl.classList.add("dragon-hurt");
        setTimeout(function () {
          if (dragonEl) dragonEl.classList.remove("dragon-hurt");
        }, 500);
        if (state.lives <= 0) {
          endGame();
          return;
        }
        continue;
      }

      // Flew off the far side — remove it
      if (bird.x < -80 || bird.x > w + 80) {
        bird.el.remove();
        state.birds.splice(i, 1);
      }
    }

    state.rafId = requestAnimationFrame(loop);
  }

  /* ============================================================
     Start / end game
     ============================================================ */
  function clearObjects() {
    state.gems.forEach(function (g) {
      g.el.remove();
    });
    state.birds.forEach(function (b) {
      b.el.remove();
    });
    state.gems = [];
    state.birds = [];
    if (dragonEl) {
      dragonEl.remove();
      dragonEl = null;
    }
  }

  function startGame() {
    // Resume audio (browsers require a user gesture before sound plays)
    const ctx = getAudio();
    if (ctx && ctx.state === "suspended") ctx.resume();

    // Reset state
    clearObjects();
    state.running = true;
    state.score = 0;
    state.lives = 3;
    state.fallSpeed = BASE_FALL_SPEED;
    state.lastGemAt = 0;
    state.lastBirdAt = 0;
    state.lastBonusShown = 0;
    state.celebrationTriggered = false;
    state.keys.left = false;
    state.keys.right = false;
    state.keys.up = false;
    state.keys.down = false;

    // Show the right screens
    welcomeScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    hud.classList.remove("hidden");

    createDragon();
    updateHud();

    cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(loop);
  }

  function endGame() {
    state.running = false;
    cancelAnimationFrame(state.rafId);
    hud.classList.add("hidden");

    finalScoreEl.textContent = state.score;
    // A friendly closing message based on how well they did
    let msg = "Great flying, little dragon!";
    if (state.score >= 50) msg = "Dragon Master! Incredible flying! \ud83c\udf1f";
    else if (state.score >= 25) msg = "Wow, you got really strong! \ud83d\udcaa";
    else if (state.score >= 10) msg = "Nice job collecting gems! \ud83d\udc8e";
    finalMessageEl.textContent = msg;

    gameoverScreen.classList.remove("hidden");
  }

  /* ============================================================
     Input handling
     ============================================================ */
  function onKeyDown(e) {
    const key = e.key;
    if (key === "ArrowLeft" || key === "a" || key === "A") {
      state.keys.left = true;
    } else if (key === "ArrowRight" || key === "d" || key === "D") {
      state.keys.right = true;
    } else if (key === "ArrowUp" || key === "w" || key === "W") {
      state.keys.up = true;
    } else if (key === "ArrowDown" || key === "s" || key === "S") {
      state.keys.down = true;
    }
    // Prevent the page from scrolling with arrow keys
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) {
      e.preventDefault();
    }
  }

  function onKeyUp(e) {
    const key = e.key;
    if (key === "ArrowLeft" || key === "a" || key === "A") {
      state.keys.left = false;
    } else if (key === "ArrowRight" || key === "d" || key === "D") {
      state.keys.right = false;
    } else if (key === "ArrowUp" || key === "w" || key === "W") {
      state.keys.up = false;
    } else if (key === "ArrowDown" || key === "s" || key === "S") {
      state.keys.down = false;
    }
  }

  // Touch/mouse support: move the dragon to where you press
  function onPointer(e) {
    if (!state.running || !dragonEl) return;
    const rect = game.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    state.dragonX = clientX - rect.left;
    state.dragonY = clientY - rect.top;
  }

  /* ============================================================
     Wire everything up
     ============================================================ */
  createClouds();
  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  game.addEventListener("mousemove", onPointer);
  game.addEventListener("touchmove", function (e) {
    onPointer(e);
    e.preventDefault();
  }, { passive: false });

  // Keep the dragon inside the screen if the window is resized
  window.addEventListener("resize", function () {
    if (dragonEl) {
      const w = game.clientWidth;
      const h = game.clientHeight;
      const margin = 45;
      state.dragonX = Math.max(margin, Math.min(w - margin, state.dragonX));
      state.dragonY = Math.max(margin, Math.min(h - margin, state.dragonY));
      dragonEl.style.left = state.dragonX + "px";
      dragonEl.style.top = state.dragonY + "px";
    }
  });
})();
