// biglake: a virtual campfire on the shore of Big Lake, Alaska.
//
// Loaded on demand by the hidden `biglake` command in index.html and
// registered as a mode (see the mode framework there). Everything is ASCII
// in a <pre>: a static layer (mountains, spruce, shore) is built once per
// layout, and each frame adds the moving parts (stars, aurora, lake
// reflection, fire, sparks, smoke) and serializes the grid to colored spans.
//
// Live conditions at the lake:
//   - time: the sky follows the clock in Anchorage (night / dusk / day),
//     using today's real sunrise and sunset when the weather loads
//   - weather (Open-Meteo, no key): temperature, clouds, wind, snow, rain, fog
//   - aurora (NOAA planetary Kp index): shows when Kp is high enough
//   - moon: real phase, computed locally from the date
// If a request fails the scene falls back to clock-and-season estimates.
//
// Extra words force conditions, e.g. `biglake night snow`:
//   night | dusk | day          sky
//   clear | cloudy | snow | rain | fog | storm    weather
//   aurora                      aurora on
//
// Uses globals from index.html: modes, clamp, lerpColor, curtainHeight,
// measureCharWidth, measureModeGrid, isCoarsePointer, print.

(() => {
    const TZ = "America/Anchorage";
    const FIRE_STEP = 1 / 20; // fire simulation tick, seconds

    // Big Lake, in the Mat-Su valley.
    const LAT = 61.52;
    const LON = -149.95;
    const WEATHER_URL =
        `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
        "&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m" +
        "&daily=sunrise,sunset&timezone=America%2FAnchorage" +
        "&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=1";
    const KP_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";
    const REFRESH_MS = 10 * 60 * 1000;
    // The view looks north-northwest across the lake toward Denali, so
    // screen-right points roughly east-northeast (bearing 70).
    const SCREEN_RIGHT_BEARING = 70;

    // Forced weather (`biglake snow` etc.), as Open-Meteo-style fields.
    const PRESETS = {
        clear: { code: 0, cloud: 0 },
        cloudy: { code: 3, cloud: 95 },
        snow: { code: 73, cloud: 90 },
        rain: { code: 63, cloud: 95 },
        fog: { code: 45, cloud: 100 },
        storm: { code: 95, cloud: 100 },
    };

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
            cloud: "#1b2233", fog: "#3a4458", precip: "#cfd8e8",
        },
        dusk: {
            skyTop: "#141a4a", skyMid: "#4a3478", horizon: "#e08a66",
            lakeTop: "#5a3f6e", lakeBottom: "#1a1838", ground: "#0d0a0e",
            ridge: "#a493c8", mountainBg: "#3a2f5e", snow: "#ffd2c4", snowBg: "#6a4f7e",
            tree: "#2a1f3e", treeBg: "#0e0a18", water: "#e09aa8", groundFg: "#4a3236",
            star: "#f4e6ff", text: "#d8b0c8", light: "#ffc08a", lightX: 0.22,
            smoke: "#8a7a8a", glow: 0.24,
            cloud: "#6b5a80", fog: "#8a7a96", precip: "#f0dce8",
        },
        day: {
            skyTop: "#2f5f99", skyMid: "#6f9bcb", horizon: "#c6d8e8",
            lakeTop: "#5d8bb8", lakeBottom: "#2a4c72", ground: "#1c1813",
            ridge: "#4c5d7a", mountainBg: "#7d8fab", snow: "#f7f9fc", snowBg: "#c9d4e4",
            tree: "#2c5238", treeBg: "#0f2016", water: "#cfe3f5", groundFg: "#55473a",
            star: null, text: "#e8f0f8", light: null, lightX: 0.5,
            smoke: "#b0b0b0", glow: 0.1,
            cloud: "#e3e8ef", fog: "#c8d0da", precip: "#ffffff",
        },
    };

    // `w` cycles these. Index 0 is the live wind from the weather data.
    const WINDS = [
        { live: true },
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

    // rise / set: today's real times when the weather has loaded, else the
    // monthly estimate.
    function skyPhase({ month, hour }, [rise, set]) {
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

    // Recompute everything that depends on the clock and conditions.
    // Returns true when the static layer (palette, fog) must be rebuilt.
    function updateSky() {
        const clock = anchorageNow();
        const wx = effectiveWeather();
        s.clockLabel = clock.label;

        const sun = wx && wx.sunrise != null ? [wx.sunrise, wx.sunset] : SUN[clock.month];
        const phase = s.forced || skyPhase(clock, sun);
        const fx = weatherEffects(wx);

        // Aurora strength 0..1: from the live Kp index when we have it
        // (~2 is faint on the northern horizon at this latitude, 5+ is a
        // big show), otherwise a seasonal guess.
        const kp = conditions.kp;
        let aurora = 0;
        if (phase === "night") {
            if (kp != null) aurora = kp >= 2 ? clamp((kp - 1) / 4, 0.3, 1) : 0;
            // Only guess by season once a fetch has actually failed, so the
            // aurora doesn't flash on and off while the real Kp is loading.
            else if (conditions.fetchedAt && auroraSeason(clock.month)) aurora = 0.5;
        }
        if (s.forceAurora) aurora = Math.max(aurora, 0.85);

        const changed = phase !== s.phase || fx.fog !== s.fx?.fog;
        s.phase = phase;
        s.pal = PALETTES[phase];
        s.aurora = aurora;
        s.fx = fx;
        s.moon = moonPhase();
        return changed;
    }

    // --- live conditions ------------------------------------------------
    // Cached across visits to the mode; refreshed every 10 minutes.

    const conditions = { wx: null, kp: null, fetchedAt: 0, pending: null };

    async function fetchJson(url) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
            const res = await fetch(url, { signal: ctrl.signal });
            if (!res.ok) throw new Error(`${res.status}`);
            return await res.json();
        } finally {
            clearTimeout(timer);
        }
    }

    function refreshConditions() {
        if (conditions.pending) return conditions.pending;
        conditions.pending = Promise.allSettled([fetchJson(WEATHER_URL), fetchJson(KP_URL)])
            .then(([w, k]) => {
                // Keep the last good values if a refresh fails.
                if (w.status === "fulfilled") conditions.wx = parseWeather(w.value) || conditions.wx;
                if (k.status === "fulfilled") conditions.kp = parseKp(k.value) ?? conditions.kp;
                conditions.fetchedAt = Date.now();
            })
            .finally(() => (conditions.pending = null));
        return conditions.pending;
    }

    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

    // "2026-11-04T08:37" -> 8.6167 (local clock hours)
    function clockHours(iso) {
        const m = typeof iso === "string" && iso.match(/T(\d\d):(\d\d)/);
        return m ? Number(m[1]) + Number(m[2]) / 60 : null;
    }

    function parseWeather(d) {
        const c = d && d.current;
        if (!c || num(c.weather_code) == null) return null;
        const rise = clockHours(d.daily && d.daily.sunrise && d.daily.sunrise[0]);
        const set = clockHours(d.daily && d.daily.sunset && d.daily.sunset[0]);
        return {
            tempF: num(c.temperature_2m),
            code: c.weather_code,
            cloud: num(c.cloud_cover) ?? 0,
            windMph: num(c.wind_speed_10m) ?? 0,
            windFrom: num(c.wind_direction_10m) ?? 0,
            sunrise: rise != null && set != null ? rise : null,
            sunset: rise != null && set != null ? set : null,
        };
    }

    // NOAA's feed is a list of 3-hour readings; the last is the latest.
    // Handles both the object form and the older array-of-arrays form.
    function parseKp(list) {
        if (!Array.isArray(list)) return null;
        for (let i = list.length - 1; i >= 0; i--) {
            const row = list[i];
            const kp = Number(Array.isArray(row) ? row[1] : row && row.Kp);
            if (Number.isFinite(kp)) return kp;
        }
        return null;
    }

    function effectiveWeather() {
        const live = conditions.wx;
        if (!s.weatherOverride) return live;
        const base = live || { tempF: null, windMph: 0, windFrom: 0, sunrise: null, sunset: null };
        return { ...base, ...PRESETS[s.weatherOverride] };
    }

    // WMO weather code -> what to draw.
    function weatherEffects(wx) {
        const fx = { cover: 0, precip: null, rate: 0, fog: false, thunder: false, label: "" };
        if (!wx) return fx;
        const code = wx.code;
        fx.cover = clamp(wx.cloud / 100, 0, 1);
        const snow = { 71: 0.3, 73: 0.6, 75: 1, 77: 0.3, 85: 0.5, 86: 0.9 };
        const rain = {
            51: 0.2, 53: 0.3, 55: 0.45, 56: 0.25, 57: 0.4, 61: 0.35, 63: 0.6, 65: 0.9,
            66: 0.4, 67: 0.7, 80: 0.4, 81: 0.65, 82: 0.9, 95: 0.8, 96: 0.9, 99: 1,
        };
        if (snow[code]) [fx.precip, fx.rate] = ["snow", snow[code]];
        else if (rain[code]) [fx.precip, fx.rate] = ["rain", rain[code]];
        fx.fog = code === 45 || code === 48;
        fx.thunder = code >= 95;
        fx.label = describeWeather(code);
        return fx;
    }

    function describeWeather(code) {
        if (code === 0) return "clear";
        if (code === 1) return "mostly clear";
        if (code === 2) return "partly cloudy";
        if (code === 3) return "overcast";
        if (code === 45 || code === 48) return "fog";
        if (code >= 51 && code <= 55) return "drizzle";
        if (code === 56 || code === 57 || code === 66 || code === 67) return "freezing rain";
        if (code === 61 || code === 80) return "light rain";
        if (code === 63 || code === 81) return "rain";
        if (code === 65 || code === 82) return "heavy rain";
        if (code === 71 || code === 77 || code === 85) return "light snow";
        if (code === 73) return "snow";
        if (code === 75 || code === 86) return "heavy snow";
        if (code >= 95) return "thunderstorm";
        return "";
    }

    function compass(deg) {
        const names = ["n", "nne", "ne", "ene", "e", "ese", "se", "sse",
            "s", "ssw", "sw", "wsw", "w", "wnw", "nw", "nnw"];
        return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
    }

    // Days into the 29.53-day lunar cycle -> how much is lit, and on
    // which side. Reference: new moon 2000-01-06 18:14 UTC.
    function moonPhase() {
        const SYNODIC = 29.530588853;
        const days = (Date.now() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
        const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
        const angle = (age / SYNODIC) * Math.PI * 2;
        return { angle, illum: (1 - Math.cos(angle)) / 2 };
    }

    // Smooth 2D value noise in [0, 1) for clouds and fog.
    function valueNoise(x, y, seed) {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const xf = x - xi;
        const yf = y - yi;
        const u = xf * xf * (3 - 2 * xf);
        const v = yf * yf * (3 - 2 * yf);
        const a = hash(xi, yi, seed);
        const b = hash(xi + 1, yi, seed);
        const c = hash(xi, yi + 1, seed);
        const d = hash(xi + 1, yi + 1, seed);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
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
        ctx.overlay.style.setProperty("--lh", `${ctx.lineHeight}px`);
        measureModeGrid(ctx);
    }

    // An inline span's background only covers the font's own height, which
    // leaves thin seams between rows of sky, cloud and fog. Making each span
    // a block exactly one line tall closes them.
    function ensureSceneStyles() {
        if (document.getElementById("biglake-styles")) return;
        const style = document.createElement("style");
        style.id = "biglake-styles";
        style.textContent =
            "#biglake span{display:inline-block;vertical-align:top;height:var(--lh)}";
        document.head.appendChild(style);
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
        // In fog the range is simply gone; the shape still positions the sky.
        for (let x = 0; x < W && !s.fx.fog; x++) {
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
        const treeFg = s.fx.fog ? lerpColor(pal.tree, pal.fog, 0.5) : pal.tree;
        const treeBg = s.fx.fog ? lerpColor(pal.treeBg, pal.fog, 0.55) : pal.treeBg;
        for (let x = 0; x < W; x++) {
            for (let y = colTop[x]; y <= base; y++) {
                const c = y === colTop[x] ? colChar[x] : hash(x, y, 3) < 0.3 ? "|" : " ";
                put(x, y, c, treeFg, treeBg);
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
        s.cloudBottom = s.horizon - s.treeMax; // clouds stay above the treeline
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

    // Sideways wind on screen, in roughly -2..2. The live wind is projected
    // onto the view: wind blowing toward the camera barely moves smoke
    // sideways, but still sways it a little.
    function currentWind() {
        const choice = WINDS[s.windIndex];
        let v = 0;
        let strength = 0;
        if (choice.live) {
            const wx = effectiveWeather();
            if (wx) {
                strength = clamp(wx.windMph / 8, 0, 2.2);
                const toward = wx.windFrom + 180;
                v = strength * Math.cos(((toward - SCREEN_RIGHT_BEARING) * Math.PI) / 180);
            }
        } else {
            v = choice.v;
            strength = Math.abs(v);
        }
        return v + Math.sin(s.t * 0.7) * 0.3 * Math.max(Math.abs(v), strength * 0.5);
    }

    function windLabel() {
        const choice = WINDS[s.windIndex];
        if (!choice.live) return choice.label;
        const wx = effectiveWeather();
        if (!wx || wx.windMph < 1) return "calm";
        return `${Math.round(wx.windMph)} mph ${compass(wx.windFrom)}`;
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
        updatePrecip(dt, wind);
    }

    // Snow drifts down slowly and sways; rain streaks and leans with the wind.
    function updatePrecip(dt, wind) {
        const { precip, rate } = s.fx;
        if (precip) {
            const perSecond = rate * s.W * (precip === "snow" ? 0.45 : 1.1);
            s.precipAcc += dt * perSecond;
            while (s.precipAcc >= 1 && s.precip.length < 900) {
                const snow = precip === "snow";
                s.precip.push({
                    x: Math.random() * (s.W + 20) - 10,
                    y: -Math.random() * 2,
                    vx: wind * (snow ? 1.2 : 2.5),
                    vy: snow ? 2.5 + Math.random() * 2 : 22 + Math.random() * 8,
                    sway: Math.random() * 6.28,
                    big: Math.random() < 0.2,
                });
                s.precipAcc -= 1;
            }
        }
        for (const p of s.precip) {
            p.x += (p.vx + (precip === "snow" ? Math.sin(s.t * 1.3 + p.sway) * 0.8 : 0)) * dt;
            p.y += p.vy * dt;
        }
        s.precip = s.precip.filter((p) => p.y < s.H - 1 && p.x > -12 && p.x < s.W + 12);
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

        // Aurora ribbon (reuses the aurora easter egg's curtain shape);
        // s.aurora (0..1) sets how strong it is.
        if (s.aurora > 0) {
            const strength = 0.55 + 0.45 * s.aurora;
            for (let x = 0; x < W; x++) {
                const ay = Math.round(s.auroraRow + curtainHeight(x, t * 0.5, []) * 0.5);
                const wave = 0.55 + 0.45 * Math.sin(x * 0.09 + t * 0.35);
                for (let dy = -1; dy <= 3; dy++) {
                    const y = ay + dy;
                    if (y < 1 || y >= s.horizon) continue;
                    const i = y * W + x;
                    if (!isOpen(i)) continue;
                    const inten = (dy < 0 ? 0.35 : 1 - dy * 0.22) * wave * strength;
                    if (inten < 0.25) continue;
                    ch[i] = dy < 0 ? "'" : inten > 0.6 ? "|" : ":";
                    fg[i] = lerpColor(pal.skyMid, dy > 1 ? "#ff6fc4" : "#3dffa0", inten * 0.65);
                }
            }
        }

        // Moon in its real phase: a small disc of cells, lit on the right
        // while waxing and on the left while waning. Hidden near new moon.
        const moonUp = s.phase === "night" && s.moon.illum > 0.04;
        if (moonUp) {
            const MW = 8;
            const MH = 4;
            const waxing = s.moon.angle < Math.PI;
            for (let my = 0; my < MH; my++) {
                for (let mx = 0; mx < MW; mx++) {
                    const u = ((mx + 0.5) / MW) * 2 - 1;
                    const v = ((my + 0.5) / MH) * 2 - 1;
                    if (u * u + v * v > 1) continue;
                    const edge = Math.sqrt(1 - v * v) * Math.cos(s.moon.angle);
                    const lit = waxing ? u > edge : u < -edge;
                    set(s.moonX - MW / 2 + mx, s.moonY + my, " ", null, lit ? "#e6e1c4" : "#0b0f1c");
                }
            }
        }

        // Clouds drift with the wind. Coverage follows the live cloud-cover
        // percentage; soft edges come from translucent backgrounds.
        const cover = s.fx.cover;
        if (cover > 0.05) {
            const drift = t * (0.15 + currentWind() * 0.6);
            const threshold = 0.75 - cover * 0.6;
            for (let y = 1; y < s.cloudBottom; y++) {
                for (let x = 0; x < W; x++) {
                    const n =
                        valueNoise((x + drift) / 14, y / 3.5, 21) * 0.65 +
                        valueNoise((x + drift * 1.6) / 6, y / 1.7, 22) * 0.35;
                    if (n <= threshold) continue;
                    const alpha = clamp((n - threshold) / 0.15, 0.2, 0.9);
                    const i = y * W + x;
                    if (bg[i] && bg[i].length === 7) {
                        // over the moon, mountains: blend into the solid color
                        bg[i] = lerpColor(bg[i], pal.cloud, alpha * 0.85);
                        if (fg[i]) fg[i] = lerpColor(fg[i], pal.cloud, alpha * 0.7);
                    } else {
                        bg[i] = pal.cloud + Math.round(alpha * 255).toString(16).padStart(2, "0");
                        if (alpha > 0.4 && isOpen(i)) ch[i] = " "; // hides stars and aurora
                    }
                }
            }
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
            // Moonlight (night) or dusk glow on the water, unless clouded over.
            const streak = pal.light && cover < 0.85 && (s.phase !== "night" || moonUp);
            if (streak) {
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

        // Fog banks drifting low over the water and the far shore.
        if (s.fx.fog) {
            const drift = t * (0.3 + currentWind() * 0.5);
            for (let y = s.horizon - s.treeMax - 3; y < s.shore + 2; y++) {
                for (let x = 0; x < W; x++) {
                    const n = valueNoise((x + drift) / 11, y / 2.2, 31);
                    if (n < 0.35) continue;
                    const i = y * W + x;
                    const alpha = clamp((n - 0.35) * 1.6, 0.15, 0.75);
                    if (bg[i] && bg[i].length === 7) bg[i] = lerpColor(bg[i], pal.fog, alpha);
                    else bg[i] = pal.fog + Math.round(alpha * 255).toString(16).padStart(2, "0");
                    if (fg[i]) fg[i] = lerpColor(fg[i], pal.fog, alpha * 0.8);
                }
            }
        }

        // Snow and rain.
        for (const p of s.precip) {
            if (s.fx.precip === "rain" || p.vy > 10) {
                const c = p.vx > 2 ? "/" : p.vx < -2 ? "\\" : "|";
                set(p.x, p.y, c, lerpColor(pal.precip, pal.skyMid, 0.45));
            } else {
                set(p.x, p.y, p.big ? "*" : ".", pal.precip);
            }
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

        // Lightning in a thunderstorm: a brief whole-scene flash.
        s.ctx.overlay.style.filter = t < s.flashUntil ? "brightness(1.9)" : "";

        // Status line and help.
        const status = statusLine();
        const help = isCoarsePointer()
            ? "tap to stoke the fire"
            : "any key: stoke · w: wind · m: sound · q: leave";
        writeText(ch, fg, bg, 1, 0, status, pal.text);
        writeText(ch, fg, bg, 1, H - 1, help, lerpColor(pal.groundFg, "#c8b8a0", 0.6));

        s.ctx.overlay.innerHTML = serialize(ch, fg, bg);
    }

    // "big lake, alaska · 8:00 pm · 36°F · overcast · wind 7 mph nnw · aurora kp 3"
    // Trailing details drop off on narrow screens.
    function statusLine() {
        const wx = effectiveWeather();
        const parts = ["big lake, alaska", s.clockLabel];
        if (wx && wx.tempF != null) parts.push(`${Math.round(wx.tempF)}°F`);
        if (s.fx.label) parts.push(s.fx.label);
        parts.push(`wind ${windLabel()}`);
        if (s.aurora > 0 && s.fx.cover < 0.8)
            parts.push(conditions.kp != null && !s.forceAurora ? `aurora kp ${Math.round(conditions.kp)}` : "aurora");
        let line = parts.join(" · ");
        // leave room for the [x] exit button (~100px) in the top-right corner
        const maxLen = s.W - 2 - Math.ceil(100 / s.ctx.cw);
        while (line.length > maxLen && parts.length > 2) {
            parts.pop();
            line = parts.join(" · ");
        }
        return line;
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

    // Fetch (or reuse an in-flight fetch), then fold the result into the
    // scene if the visitor is still at the lake.
    function applyFreshConditions(ctx) {
        return refreshConditions().then(() => {
            if (!s || s.ctx !== ctx) return;
            if (updateSky()) buildScene(ctx);
            if (ctx.reduced) render(); // static mode: redraw once with real data
        });
    }

    // One line for the scrollback (and screen readers) saying where you are.
    function describeScene() {
        const sky = s.phase === "day" ? "light" : s.phase === "dusk" ? "glowing at dusk" : "dark";
        const wx = effectiveWeather();
        const details = [];
        if (wx && wx.tempF != null) details.push(`${Math.round(wx.tempF)}°F`);
        if (s.fx.label) details.push(s.fx.label);
        const weather = details.length ? ` (${details.join(", ")})` : "";
        const aurora = s.aurora > 0 && s.fx.cover < 0.8 ? " and the aurora is out" : "";
        print(
            `you're sitting by a campfire on the shore of big lake, alaska. ` +
                `it's ${s.clockLabel} there${weather}; the sky is ${sky}${aurora}.`,
        );
    }

    // --- the mode -------------------------------------------------------

    modes.biglake = {
        path: "~/biglake",
        overlay: { className: "ascii-overlay", fontPx: 15, lineHeight: 17 },
        fps: 20,
        reducedMotion: "static",
        exitMessage: "the fire's down to embers. see you at big lake.",

        start(ctx, ...args) {
            const words = args.map((a) => String(a).toLowerCase());
            s = {
                forced: words.find((w) => PALETTES[w]) || null,
                weatherOverride: words.find((w) => PRESETS[w]) || null,
                forceAurora: words.includes("aurora"),
                phase: null,
                aurora: 0,
                fx: null,
                moon: null,
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
                precip: [],
                precipAcc: 0,
                flashUntil: 0,
                lastFetchCheck: 0,
                audio: null,
                soundBtn: null,
            };
            ensureSceneStyles();
            updateSky();
            sizeToViewport(ctx);
            buildScene(ctx);
            resetFire();
            // Draw right away with what we know; live data swaps in when it
            // lands, and the description waits for it so it's accurate.
            if (Date.now() - conditions.fetchedAt > REFRESH_MS)
                applyFreshConditions(ctx).then(() => s && s.ctx === ctx && describeScene());
            else describeScene();

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
            // Refresh live conditions every 10 minutes while the fire's lit.
            if (t - s.lastFetchCheck > 60) {
                s.lastFetchCheck = t;
                if (Date.now() - conditions.fetchedAt > REFRESH_MS) applyFreshConditions(ctx);
            }
            if (s.fx.thunder && Math.random() < dt / 9) s.flashUntil = t + 0.09;
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
