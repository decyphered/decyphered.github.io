// biglake: a virtual campfire on the shore of Big Lake, Alaska.
//
// Loaded on demand by the hidden `biglake` command in index.html and
// registered as a mode (see the mode framework there). Everything is ASCII
// in a <pre>: a static layer (mountains, spruce, shore) is built once per
// layout, and each frame adds the moving parts (stars, aurora, lake
// reflection, fire, sparks, smoke) and serializes the grid to colored spans.
//
// The sky follows the real time in Anchorage: dark winter nights (with
// aurora Sep-Apr), the midnight-sun dusk of summer, or daylight.
// `biglake night|dusk|day` forces one.
//
// Uses globals from index.html: modes, clamp, lerpColor, curtainHeight,
// measureCharWidth, measureModeGrid, isCoarsePointer, print.

(() => {
    const TZ = "America/Anchorage";
    const FIRE_STEP = 1 / 20; // fire simulation tick, seconds

    // Approximate Anchorage sunrise / sunset by month, local clock hours.
    const SUN = [
        [10.1, 15.9], [8.9, 17.4], [7.5, 18.9], [7.0, 20.9],
        [5.4, 22.4], [4.4, 23.7], [4.9, 23.2], [6.2, 21.6],
        [7.6, 20.1], [8.9, 18.5], [9.4, 16.4], [10.2, 15.7],
    ];

    const PALETTES = {
        night: {
            skyTop: "#010208", skyMid: "#040a1a", horizon: "#0c1a33",
            lakeTop: "#071226", lakeBottom: "#02060e", ground: "#060403",
            ridge: "#5a6b8f", mountainBg: "#0d1528", snow: "#c4d2ee", snowBg: "#1a2540",
            tree: "#1c3a27", treeBg: "#030806", water: "#2a4a75", groundFg: "#3a2a1c",
            star: "#e4ebff", text: "#6f8fb8", light: "#f3efd2", lightX: 0.86,
            smoke: "#5e5e66", glow: 0.38,
        },
        dusk: {
            skyTop: "#141a4a", skyMid: "#4a3478", horizon: "#e08a66",
            lakeTop: "#5a3f6e", lakeBottom: "#1a1838", ground: "#0d0a0e",
            ridge: "#a493c8", mountainBg: "#3a2f5e", snow: "#ffd2c4", snowBg: "#6a4f7e",
            tree: "#2a1f3e", treeBg: "#0e0a18", water: "#e09aa8", groundFg: "#4a3236",
            star: "#f4e6ff", text: "#d8b0c8", light: "#ffc08a", lightX: 0.22,
            smoke: "#8a7a8a", glow: 0.24,
        },
        day: {
            skyTop: "#2f5f99", skyMid: "#6f9bcb", horizon: "#c6d8e8",
            lakeTop: "#5d8bb8", lakeBottom: "#2a4c72", ground: "#1c1813",
            ridge: "#4c5d7a", mountainBg: "#7d8fab", snow: "#f7f9fc", snowBg: "#c9d4e4",
            tree: "#2c5238", treeBg: "#0f2016", water: "#cfe3f5", groundFg: "#55473a",
            star: null, text: "#e8f0f8", light: null, lightX: 0.5,
            smoke: "#b0b0b0", glow: 0.1,
        },
    };

    const WINDS = [
        { v: 0, label: "calm" },
        { v: 0.8, label: "light →" },
        { v: 1.8, label: "gusty →" },
        { v: -0.8, label: "light ←" },
        { v: -1.8, label: "gusty ←" },
    ];

    // Heat -> flame character and color.
    const FLAME = [
        [0.9, "@", "#fff3c4"],
        [0.75, "#", "#ffd166"],
        [0.6, "%", "#ffa53a"],
        [0.45, "*", "#ff7a1a"],
        [0.3, "^", "#e8480c"],
        [0.18, ":", "#b02a06"],
        [0.08, ".", "#6a1704"],
    ];

    const MIRROR = { "/": "\\", "\\": "/", "^": "v", "'": ",", "_": "-" };

    let s = null; // scene state while the mode is running

    // --- small utilities ------------------------------------------------

    function hash(x, y, z = 0) {
        let h =
            Math.imul(x | 0, 374761393) +
            Math.imul(y | 0, 668265263) +
            Math.imul(z | 0, 1442695041);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    function seeded(seed) {
        return () => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function escapeHtml(text) {
        return /[&<>]/.test(text)
            ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            : text;
    }

    // --- Anchorage clock ------------------------------------------------

    function anchorageNow() {
        const now = new Date();
        const parts = {};
        for (const p of new Intl.DateTimeFormat("en-US", {
            timeZone: TZ, month: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23",
        }).formatToParts(now))
            parts[p.type] = Number(p.value);
        const label = now
            .toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })
            .toLowerCase();
        return { month: parts.month - 1, hour: parts.hour + parts.minute / 60, label };
    }

    function skyPhase({ month, hour }) {
        const [rise, set] = SUN[month];
        if (hour >= rise + 1 && hour <= set - 1) return "day";
        const nearRise = hour > rise - 1.5 && hour < rise + 1;
        const nearSet = hour > set - 1 && hour < set + 1.5;
        if (nearRise || nearSet) return "dusk";
        // May-July never get properly dark: it's dusk all night.
        return month >= 4 && month <= 6 ? "dusk" : "night";
    }

    function auroraSeason(month) {
        return month >= 8 || month <= 3; // Sep - Apr
    }

    function updateSky() {
        const clock = anchorageNow();
        s.clockLabel = clock.label;
        const phase = s.forced || skyPhase(clock);
        const aurora = phase === "night" && (s.forced === "night" || auroraSeason(clock.month));
        const changed = phase !== s.phase || aurora !== s.aurora;
        s.phase = phase;
        s.aurora = aurora;
        s.pal = PALETTES[phase];
        return changed;
    }

    // --- layout ---------------------------------------------------------

    // Pick a font size that gives ~72 columns on phones and stays at most
    // 15px on desktop, then let the framework recompute the grid.
    function sizeToViewport(ctx) {
        const fontPx = clamp(Math.floor((window.innerWidth - 32) / (72 * s.charRatio)), 8, 15);
        ctx.fontPx = fontPx;
        ctx.lineHeight = Math.round(fontPx * 1.15 * 100) / 100;
        ctx.cw = fontPx * s.charRatio;
        ctx.overlay.style.fontSize = `${fontPx}px`;
        ctx.overlay.style.lineHeight = `${ctx.lineHeight}px`;
        measureModeGrid(ctx);
    }

    function buildScene(ctx) {
        const W = ctx.cols;
        const H = ctx.rows;
        const pal = s.pal;
        const n = W * H;
        const rand = seeded(1985);

        s.W = W;
        s.H = H;
        s.ctx = ctx;
        s.horizon = Math.round(H * 0.5);
        s.shore = Math.round(H * 0.76);
        s.treeMax = clamp(Math.round(H * 0.06), 2, 5);
        s.fireW = clamp(Math.round(W * 0.11), 11, 21) | 1; // odd, so it has a center
        s.fireH = clamp(Math.round(H * 0.24), 8, 16);
        s.fireX = Math.round(W * 0.42);
        s.fireY = H - 3 - Math.round(H * 0.05); // bottom row of flames

        const ch = new Array(n).fill(" ");
        const fg = new Array(n).fill(null);
        const bg = new Array(n).fill(null);
        const put = (x, y, c, f, b = null) => {
            if (x < 0 || y < 0 || x >= W || y >= H) return;
            const i = y * W + x;
            ch[i] = c;
            fg[i] = f;
            if (b) bg[i] = b;
        };

        // Mountains: a range with Denali towering on the right.
        const treeTop = s.horizon - s.treeMax;
        const maxRise = Math.round(H * 0.24);
        const denaliX = W * 0.7;
        const tops = [];
        const heights = [];
        for (let x = 0; x < W; x++) {
            const peak =
                0.75 * Math.exp(-(((x - denaliX) / (W * 0.06)) ** 2)) +
                0.35 * Math.exp(-(((x - denaliX + W * 0.07) / (W * 0.04)) ** 2));
            const range =
                0.22 + 0.12 * Math.sin(x * 0.045 + 1.3) +
                0.08 * Math.sin(x * 0.11 + 0.4) + 0.04 * Math.sin(x * 0.23);
            const h = clamp(range + peak, 0.05, 1);
            heights.push(h);
            tops.push(treeTop - Math.round(h * maxRise));
        }
        for (let x = 0; x < W; x++) {
            const top = tops[x];
            const left = x > 0 ? tops[x - 1] : top;
            const right = x < W - 1 ? tops[x + 1] : top;
            const snowDepth = heights[x] > 0.45 ? Math.round((heights[x] - 0.4) * maxRise * 0.7) : 0;
            // Fill all the way to the shore so short spruce never show sky behind them.
            for (let y = top; y < s.horizon; y++) {
                const inSnow = y - top < snowDepth;
                let c = " ";
                if (y === top) {
                    if (left > top && right > top) c = "^";
                    else if (left > top) c = "/";
                    else if (right > top) c = "\\";
                    // flat ridge: the silhouette alone reads better than "----"
                } else if (inSnow) {
                    const r = hash(x, y, 7);
                    c = r < 0.25 ? "'" : r < 0.4 ? "." : r < 0.48 ? ":" : " ";
                } else if (hash(x, y, 9) < 0.06) {
                    c = ".";
                }
                put(x, y, c, inSnow ? pal.snow : pal.ridge, inSnow ? pal.snowBg : pal.mountainBg);
            }
        }

        // Far-shore spruce: a jagged dark band of narrow trees.
        const base = s.horizon - 1;
        const colTop = new Array(W).fill(base + 1);
        const colChar = new Array(W).fill("^");
        for (let x = 0; x < W; ) {
            const h = Math.max(1, Math.round(s.treeMax * (0.4 + rand() * 0.6)));
            const top = base - h + 1;
            const spans = [[x, top, "^"], [x - 1, top + 1, "/"], [x + 1, top + 1, "\\"]];
            for (const [cx, cy, c] of spans) {
                if (cx < 0 || cx >= W || cy > base) continue;
                if (cy < colTop[cx]) {
                    colTop[cx] = cy;
                    colChar[cx] = c;
                }
            }
            x += 2 + Math.floor(rand() * 2);
        }
        for (let x = 0; x < W; x++) {
            for (let y = colTop[x]; y <= base; y++) {
                const c = y === colTop[x] ? colChar[x] : hash(x, y, 3) < 0.3 ? "|" : " ";
                put(x, y, c, pal.tree, pal.treeBg);
            }
        }

        // Near shore: gravel and grass texture.
        for (let y = s.shore + 1; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const r = hash(x, y, 5);
                const c = r < 0.05 ? "," : r < 0.09 ? "." : r < 0.1 ? "`" : r < 0.11 ? "'" : " ";
                if (c !== " ") put(x, y, c, pal.groundFg);
            }
        }

        // Dock reaching into the lake on the right.
        if (W >= 60) {
            const dockY = s.shore - 2;
            const x0 = Math.round(W * 0.7);
            const x1 = Math.round(W * 0.93);
            for (let x = x0; x <= x1; x++) put(x, dockY, "=", "#5a4030");
            for (let x = x0 + 1; x <= x1; x += 5) put(x, dockY + 1, "|", "#3a2a20");
        }

        // Fire ring: stones and crossed logs under the flames.
        const half = Math.floor(s.fireW / 2);
        const logsY = s.fireY + 1;
        for (let dx = -half; dx <= half; dx++) {
            const edge = Math.abs(dx) === half;
            const c = edge ? "o" : Math.abs(dx) <= 1 ? (dx < 0 ? "\\" : dx > 0 ? "/" : "X") : "=";
            put(s.fireX + dx, logsY, c, edge ? "#7a7470" : "#6b3a1f");
        }
        for (let dx = -half + 1; dx < half; dx++)
            put(s.fireX + dx, logsY + 1, dx % 2 ? "o" : "_", "#5a5450");

        // Log bench to the left of the fire.
        const benchX = s.fireX - half - 12;
        if (benchX > 1) {
            put(benchX, logsY, "(", "#4a2c18");
            for (let i = 1; i < 8; i++) put(benchX + i, logsY, "=", "#4a2c18");
            put(benchX + 8, logsY, ")", "#4a2c18");
        }

        // Cache reflected colors so the per-frame lake pass stays cheap.
        const rfg = new Array(n).fill(null);
        const rbg = new Array(n).fill(null);
        for (let y = 0; y < s.horizon; y++) {
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                if (!bg[i]) continue;
                rfg[i] = lerpColor(fg[i], pal.lakeTop, 0.55);
                // Slightly translucent (8-digit hex) so firelight spills over
                // reflections and open water alike, with no hard edge.
                rbg[i] = lerpColor(bg[i], pal.lakeTop, 0.5) + "c8";
            }
        }

        // Stars in open sky only.
        s.stars = [];
        if (pal.star) {
            const density = s.phase === "night" ? 0.025 : 0.004;
            for (let y = 1; y < s.horizon - 1; y++)
                for (let x = 0; x < W; x++) {
                    const i = y * W + x;
                    if (bg[i] || ch[i] !== " ") continue;
                    if (rand() < density)
                        s.stars.push({ i, ph: rand() * 6.28, sp: 0.6 + rand() * 2.4, big: rand() < 0.12 });
                }
        }

        s.ch = ch;
        s.fg = fg;
        s.bg = bg;
        s.rfg = rfg;
        s.rbg = rbg;
        s.auroraRow = Math.max(3, Math.round(Math.min(...tops) * 0.45));
        s.moonX = Math.round(W * pal.lightX);
        s.moonY = Math.max(2, Math.round(Math.min(...tops) * 0.3));
        paintBackground(ctx);
    }

    // Sky / lake / ground gradient plus the firelight glow, as the overlay's
    // background. The glow strength is a CSS variable updated each frame.
    function paintBackground(ctx) {
        const pal = s.pal;
        const pct = (row) =>
            (((16 + row * ctx.lineHeight) / window.innerHeight) * 100).toFixed(2) + "%";
        const fx = 16 + (s.fireX + 0.5) * ctx.cw;
        const fy = 16 + (s.fireY - s.fireH * 0.2) * ctx.lineHeight;
        const r = Math.max(window.innerWidth, window.innerHeight) * 0.3;
        ctx.overlay.style.background =
            `radial-gradient(circle at ${fx}px ${fy}px, rgba(255,120,40,var(--glow,0.3)) 0, rgba(255,90,20,0) ${r}px),` +
            `linear-gradient(to bottom, ${pal.skyTop} 0%, ${pal.skyMid} ${pct(s.horizon * 0.55)}, ` +
            `${pal.horizon} ${pct(s.horizon)}, ${pal.lakeTop} ${pct(s.horizon)}, ` +
            `${pal.lakeBottom} ${pct(s.shore)}, ${pal.ground} ${pct(s.shore + 1)}, ${pal.ground} 100%)`;
    }

    // --- fire, sparks, smoke --------------------------------------------

    function resetFire() {
        s.heat = Array.from({ length: s.fireH + 2 }, () => new Array(s.fireW).fill(0));
        for (let i = 0; i < 40; i++) stepFire(); // start already burning
    }

    function stepFire() {
        const W = s.fireW;
        const FH = s.fireH;
        const heat = s.heat;
        const intensity = 1 + s.boost;
        const mid = (W - 1) / 2;
        const src = heat[FH + 1];
        for (let x = 0; x < W; x++) {
            const profile = Math.exp(-(((x - mid) / (W * 0.3)) ** 2));
            src[x] = profile * intensity * (0.75 + Math.random() * 0.45);
        }
        heat[FH].forEach((_, x) => (heat[FH][x] = src[x] * 0.95));

        const wind = currentWind();
        for (let y = 0; y < FH; y++) {
            const below = heat[y + 1];
            const below2 = heat[Math.min(FH + 1, y + 2)];
            for (let x = 0; x < W; x++) {
                // Wind drags each row's source sideways now and then.
                const shift = Math.random() < Math.abs(wind) * 0.35 ? -Math.sign(wind) : 0;
                const sx = clamp(x + shift, 0, W - 1);
                const l = below[Math.max(0, sx - 1)];
                const r = below[Math.min(W - 1, sx + 1)];
                const v = (l + below[sx] * 2 + r + below2[sx]) / 5;
                // ~0.8 / FH per row on average: flames fill most of the height.
                const cooling = (0.4 + Math.random() * 0.8) * (0.95 / FH);
                heat[y][x] = Math.max(0, v - cooling);
            }
        }
    }

    function currentWind() {
        const w = WINDS[s.windIndex].v;
        return w + Math.sin(s.t * 0.7) * 0.3 * Math.abs(w);
    }

    function stoke() {
        if (!s) return;
        s.boost = Math.min(1.6, s.boost + 0.7);
        for (let i = 0; i < 14; i++) spawnSpark(true);
        if (s.audio) for (let i = 0; i < 5; i++) crackle(Math.random() * 0.25);
    }

    function spawnSpark(burst = false) {
        const wind = currentWind();
        const life = 0.6 + Math.random() * (burst ? 1.8 : 1.2);
        s.sparks.push({
            x: s.fireX + (Math.random() - 0.5) * s.fireW * 0.5,
            y: s.fireY - s.fireH * (0.4 + Math.random() * 0.4),
            vx: wind * 3 + (Math.random() - 0.5) * (burst ? 6 : 2),
            vy: -(5 + Math.random() * (burst ? 10 : 6)),
            age: 0,
            life,
        });
    }

    function spawnSmoke() {
        s.smoke.push({
            x: s.fireX + (Math.random() - 0.5) * 3,
            y: s.fireY - s.fireH * 0.85,
            vx: (Math.random() - 0.5) * 0.4,
            vy: -(1.2 + Math.random() * 1.2),
            age: 0,
            life: 4 + Math.random() * 2.5,
        });
    }

    function updateParticles(dt) {
        const wind = currentWind();
        const intensity = 1 + s.boost;
        s.sparkAcc += dt * 3.5 * intensity;
        while (s.sparkAcc >= 1) {
            spawnSpark();
            s.sparkAcc -= 1;
        }
        s.smokeAcc += dt * 1.4;
        while (s.smokeAcc >= 1) {
            spawnSmoke();
            s.smokeAcc -= 1;
        }
        for (const p of s.sparks) {
            p.age += dt;
            p.vx += (wind * 2 - p.vx) * dt * 0.8 + (Math.random() - 0.5) * dt * 6;
            p.vy += 3 * dt; // slows as it rises and cools
            p.x += p.vx * dt;
            p.y += p.vy * dt;
        }
        for (const p of s.smoke) {
            p.age += dt;
            p.vx += (wind * 1.6 - p.vx) * dt * 0.5;
            p.x += p.vx * dt + Math.sin(p.age * 1.7 + p.y) * dt * 0.6;
            p.y += p.vy * dt;
        }
        s.sparks = s.sparks.filter((p) => p.age < p.life && p.y > 0);
        s.smoke = s.smoke.filter((p) => p.age < p.life && p.y > 0);
    }

    // --- sound (optional, off by default) --------------------------------

    function toggleSound() {
        if (s.audio) {
            s.audio.ac.close();
            s.audio = null;
        } else {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            const ac = new AC();
            const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

            const master = ac.createGain();
            master.gain.value = 0.8;
            master.connect(ac.destination);

            // Low roar of the fire.
            const roar = ac.createBufferSource();
            roar.buffer = buf;
            roar.loop = true;
            const roarFilter = ac.createBiquadFilter();
            roarFilter.type = "lowpass";
            roarFilter.frequency.value = 360;
            const roarGain = ac.createGain();
            roarGain.gain.value = 0.07;
            roar.connect(roarFilter).connect(roarGain).connect(master);
            roar.start();

            // Water lapping: filtered noise swelling slowly.
            const lap = ac.createBufferSource();
            lap.buffer = buf;
            lap.loop = true;
            lap.playbackRate.value = 0.5;
            const lapFilter = ac.createBiquadFilter();
            lapFilter.type = "lowpass";
            lapFilter.frequency.value = 700;
            const lapGain = ac.createGain();
            lapGain.gain.value = 0;
            lap.connect(lapFilter).connect(lapGain).connect(master);
            lap.start();

            s.audio = { ac, buf, master, roarGain, lapGain, crackleAcc: 0 };
        }
        s.soundBtn.textContent = s.audio ? "[m] sound: on" : "[m] sound: off";
    }

    // One pop: a few milliseconds of band-passed noise.
    function crackle(delay = 0) {
        const { ac, buf, master } = s.audio;
        const when = ac.currentTime + delay;
        const src = ac.createBufferSource();
        src.buffer = buf;
        const band = ac.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 1200 + Math.random() * 4000;
        band.Q.value = 0.8;
        const gain = ac.createGain();
        const dur = 0.006 + Math.random() * 0.04;
        gain.gain.setValueAtTime(0.15 + Math.random() * 0.35, when);
        gain.gain.exponentialRampToValueAtTime(0.001, when + dur);
        src.connect(band).connect(gain).connect(master);
        src.start(when, Math.random() * 1.5, dur + 0.02);
    }

    function updateSound(dt) {
        const a = s.audio;
        if (!a) return;
        const intensity = 1 + s.boost;
        a.crackleAcc += dt * 7 * intensity * Math.random() * 2;
        while (a.crackleAcc >= 1) {
            crackle(Math.random() * 0.05);
            a.crackleAcc -= 1;
        }
        a.roarGain.gain.setTargetAtTime(0.05 + 0.04 * intensity, a.ac.currentTime, 0.3);
        const swell = 0.012 + 0.018 * Math.max(0, Math.sin(s.t * 0.9));
        a.lapGain.gain.setTargetAtTime(swell, a.ac.currentTime, 0.4);
    }

    // --- per-frame composition -----------------------------------------

    function render() {
        const { W, H, pal, t } = s;
        const ch = s.ch.slice();
        const fg = s.fg.slice();
        const bg = s.bg.slice();
        const set = (x, y, c, f, b) => {
            x = Math.round(x);
            y = Math.round(y);
            if (x < 0 || y < 0 || x >= W || y >= H) return -1;
            const i = y * W + x;
            ch[i] = c;
            fg[i] = f;
            if (b !== undefined) bg[i] = b;
            return i;
        };
        const isOpen = (i) => !s.bg[i] && s.ch[i] === " ";

        // Stars twinkle.
        for (const star of s.stars) {
            const b = 0.5 + 0.5 * Math.sin(t * star.sp + star.ph);
            ch[star.i] = star.big && b > 0.7 ? "*" : b > 0.85 ? "+" : ".";
            fg[star.i] = lerpColor(pal.skyMid, pal.star, 0.35 + b * 0.65);
        }

        // Aurora ribbon (reuses the aurora easter egg's curtain shape).
        if (s.aurora) {
            for (let x = 0; x < W; x++) {
                const ay = Math.round(s.auroraRow + curtainHeight(x, t * 0.5, []) * 0.5);
                const wave = 0.55 + 0.45 * Math.sin(x * 0.09 + t * 0.35);
                for (let dy = -1; dy <= 3; dy++) {
                    const y = ay + dy;
                    if (y < 1 || y >= s.horizon) continue;
                    const i = y * W + x;
                    if (!isOpen(i)) continue;
                    const inten = (dy < 0 ? 0.35 : 1 - dy * 0.22) * wave;
                    if (inten < 0.25) continue;
                    ch[i] = dy < 0 ? "'" : inten > 0.6 ? "|" : ":";
                    fg[i] = lerpColor(pal.skyMid, dy > 1 ? "#ff6fc4" : "#3dffa0", inten * 0.6);
                }
            }
        }

        // Moon.
        if (s.phase === "night") {
            const art = [" .-. ", "(   )", " `-' "];
            art.forEach((row, ry) => {
                [...row].forEach((c, rx) => {
                    const x = s.moonX - 2 + rx;
                    const y = s.moonY + ry;
                    if (ry === 1 && rx > 0 && rx < 4) set(x, y, " ", null, "#d8d4b8");
                    else if (c !== " ") set(x, y, c, pal.light);
                });
            });
        }

        // Lake: mirrored mountains and spruce that ripple, glints, light streak.
        const lakeRows = s.shore - s.horizon;
        for (let y = s.horizon; y < s.shore; y++) {
            const d = y - s.horizon;
            const sy = s.horizon - 1 - d;
            const wob = Math.round(Math.sin(d * 0.9 - t * 1.6) * Math.min(1.6, 0.3 + d * 0.09));
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                if (s.ch[i] !== " " || s.bg[i]) continue; // dock etc.
                const sx = clamp(x + wob, 0, W - 1);
                const si = sy >= 0 ? sy * W + sx : -1;
                if (si >= 0 && s.rbg[si]) {
                    const broken = hash(x, y, Math.floor(t * 3)) < 0.05 + d * 0.006;
                    ch[i] = broken ? "~" : MIRROR[s.ch[si]] || s.ch[si];
                    fg[i] = s.rfg[si];
                    bg[i] = s.rbg[si];
                    continue;
                }
                const v =
                    Math.sin(x * 0.35 + y * 1.7 - t * (0.6 + d * 0.03)) *
                    Math.sin(x * 0.13 + y * 0.7 + t * 0.5);
                if (v > 0.8) {
                    ch[i] = v > 0.9 ? "~" : "-";
                    fg[i] = lerpColor(pal.lakeTop, pal.water, 0.5 + (v - 0.8) * 4);
                }
            }
            if (pal.light) {
                const lx = Math.round(W * pal.lightX);
                const w = 0.6 + d * 0.35;
                for (let x = Math.floor(lx - w); x <= Math.ceil(lx + w); x++) {
                    if (x < 0 || x >= W || s.ch[y * W + x] !== " ") continue; // dock
                    if (hash(x, y, Math.floor(t * 5)) < 0.4) continue;
                    set(x, y, d % 2 ? "=" : "-", lerpColor(pal.water, pal.light, 0.75 - (d / lakeRows) * 0.4));
                }
            }
        }

        // Waves lapping at the near shore.
        for (let x = 0; x < W; x++) {
            const c = hash(x, s.shore, Math.floor(t * 1.5 + x * 0.08)) > 0.55 ? "~" : ".";
            set(x, s.shore, c, lerpColor(pal.water, pal.lakeTop, 0.3));
        }

        // Smoke drifts above everything else that moves.
        for (const p of s.smoke) {
            const k = p.age / p.life;
            const c = k < 0.25 ? "(" : k < 0.5 ? ")" : k < 0.75 ? "~" : ".";
            set(p.x, p.y, c, lerpColor(pal.smoke, pal.skyMid, k));
        }

        // Flames.
        const half = Math.floor(s.fireW / 2);
        const fireCells = new Set();
        for (let fy = 0; fy < s.fireH; fy++) {
            for (let fx = 0; fx < s.fireW; fx++) {
                const h = s.heat[fy][fx];
                const stop = FLAME.find(([min]) => h >= min);
                if (!stop) continue;
                const i = set(s.fireX - half + fx, s.fireY - s.fireH + 1 + fy, stop[1], stop[2], null);
                if (i >= 0) fireCells.add(i);
            }
        }
        // Embers glow in the logs.
        for (let dx = -1; dx <= 1; dx++) {
            const glow = 0.5 + 0.5 * Math.sin(t * 5 + dx * 2) * Math.random();
            set(s.fireX + dx, s.fireY + 1, dx < 0 ? "\\" : dx > 0 ? "/" : "X", lerpColor("#8a2a08", "#ffb040", glow));
        }

        // Sparks.
        for (const p of s.sparks) {
            const k = p.age / p.life;
            set(p.x, p.y, k < 0.3 ? "*" : k < 0.7 ? "." : "`", lerpColor("#ffe08a", "#7a1a00", k));
        }

        // Firelight warms nearby cells.
        const intensity = 1 + s.boost;
        const flicker = 0.85 + Math.random() * 0.15;
        const reach = 18 * Math.sqrt(intensity);
        const aspect = s.ctx.lineHeight / s.ctx.cw; // rows are taller than columns
        const cy = s.fireY - s.fireH * 0.3;
        for (let y = Math.max(0, Math.floor(cy - reach / aspect)); y < H; y++) {
            for (let x = Math.max(0, Math.floor(s.fireX - reach)); x < Math.min(W, s.fireX + reach); x++) {
                const i = y * W + x;
                if (ch[i] === " " || fireCells.has(i) || !fg[i]) continue;
                const dist = Math.hypot(x - s.fireX, (y - cy) * aspect) / reach;
                if (dist >= 1) continue;
                fg[i] = lerpColor(fg[i], "#ffb070", (1 - dist) ** 2 * 0.8 * flicker);
            }
        }
        s.ctx.overlay.style.setProperty(
            "--glow",
            (pal.glow * Math.min(1.6, intensity) * flicker).toFixed(3),
        );

        // Status line and help.
        const status = `big lake, alaska · ${s.clockLabel} · wind: ${WINDS[s.windIndex].label}`;
        const help = isCoarsePointer()
            ? "tap to stoke the fire"
            : "any key: stoke · w: wind · m: sound · q: leave";
        writeText(ch, fg, bg, 1, 0, status, pal.text);
        writeText(ch, fg, bg, 1, H - 1, help, lerpColor(pal.groundFg, "#c8b8a0", 0.6));

        s.ctx.overlay.innerHTML = serialize(ch, fg, bg);
    }

    function writeText(ch, fg, bg, x0, y, text, color) {
        const W = s.W;
        for (let k = 0; k < text.length && x0 + k < W - 1; k++) {
            const i = y * W + x0 + k;
            ch[i] = text[k];
            fg[i] = color;
            bg[i] = null;
        }
    }

    // Grid -> HTML, merging neighbouring cells with the same colors into
    // one span. Uncolored spaces stay bare text.
    function serialize(ch, fg, bg) {
        const { W, H } = s;
        const lines = [];
        for (let y = 0; y < H; y++) {
            let line = "";
            let run = "";
            let rf = null;
            let rb = null;
            const flush = () => {
                if (!run) return;
                const text = escapeHtml(run);
                if (rf || rb) {
                    const style = (rf ? `color:${rf};` : "") + (rb ? `background:${rb}` : "");
                    line += `<span style="${style}">${text}</span>`;
                } else {
                    line += text;
                }
                run = "";
            };
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                const c = ch[i];
                const b = bg[i];
                // A space's text color is invisible, so it can join any run
                // with the same background instead of starting a new span.
                if (c === " " && b === rb) {
                    run += c;
                    continue;
                }
                const f = c === " " ? null : fg[i];
                if (f !== rf || b !== rb) {
                    flush();
                    rf = f;
                    rb = b;
                }
                run += c;
            }
            flush();
            lines.push(line);
        }
        return lines.join("\n");
    }

    // --- the mode -------------------------------------------------------

    modes.biglake = {
        path: "~/biglake",
        overlay: { className: "ascii-overlay", fontPx: 15, lineHeight: 17 },
        fps: 20,
        reducedMotion: "static",
        exitMessage: "the fire's down to embers. see you at big lake.",

        start(ctx, phaseArg) {
            const forced = phaseArg && PALETTES[phaseArg.toLowerCase()] ? phaseArg.toLowerCase() : null;
            s = {
                forced,
                phase: null,
                aurora: false,
                pal: null,
                clockLabel: "",
                charRatio: measureCharWidth(16) / 16,
                t: 0,
                lastSkyCheck: 0,
                boost: 0,
                windIndex: 0,
                fireAcc: 0,
                sparkAcc: 0,
                smokeAcc: 0,
                sparks: [],
                smoke: [],
                audio: null,
                soundBtn: null,
            };
            updateSky();
            sizeToViewport(ctx);
            buildScene(ctx);
            resetFire();

            ctx.overlay.addEventListener("pointerdown", stoke);

            // Sound toggle (bottom-right) so touch users can reach it too.
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "mode-exit";
            btn.style.top = "auto";
            btn.style.bottom = "max(10px, env(safe-area-inset-bottom))";
            btn.textContent = "[m] sound: off";
            btn.setAttribute("aria-label", "Toggle campfire sound");
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                toggleSound();
            });
            document.body.appendChild(btn);
            s.soundBtn = btn;

            print(
                `you're sitting by a campfire on the shore of big lake, alaska. ` +
                    `it's ${s.clockLabel} there; the sky is ${s.phase === "day" ? "light" : s.phase === "dusk" ? "glowing at dusk" : "dark"}` +
                    `${s.aurora ? " and the aurora is out" : ""}.`,
            );
        },

        resize(ctx) {
            sizeToViewport(ctx);
            buildScene(ctx);
            resetFire();
        },

        frame(ctx, t, dt) {
            s.t = t;
            // Re-check the Anchorage clock every 30s; rebuild if the sky changed.
            if (t - s.lastSkyCheck > 30) {
                s.lastSkyCheck = t;
                if (updateSky()) buildScene(ctx);
            }
            s.boost *= Math.exp(-dt * 0.7);
            s.fireAcc += dt;
            while (s.fireAcc >= FIRE_STEP) {
                stepFire();
                s.fireAcc -= FIRE_STEP;
            }
            updateParticles(dt);
            updateSound(dt);
            render();
        },

        keydown(ctx, e) {
            const key = e.key.toLowerCase();
            if (key === "q" || key === "escape") return false; // framework exits
            if (e.metaKey || e.ctrlKey || e.altKey) return false;
            if (key === "w") {
                s.windIndex = (s.windIndex + 1) % WINDS.length;
            } else if (key === "m") {
                toggleSound();
            } else if (e.key.length === 1 || key === "enter") {
                stoke();
            } else {
                return false;
            }
            e.preventDefault();
            if (ctx.reduced) render(); // static mode: show the change
            return true;
        },

        stop() {
            if (s.audio) s.audio.ac.close();
            s.soundBtn.remove();
            s = null;
        },
    };
})();
