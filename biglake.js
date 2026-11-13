// biglake: a virtual campfire on the shore of Big Lake, Alaska.
//
// Loaded on demand by the hidden `biglake` command in index.html and
// registered as a mode (see the mode framework there).
//
// The scene is layered. Smooth things are painted on canvases; the ASCII
// sits on top in the mode's <pre>, so it still reads as a terminal:
//
//   sky     gradient, moon in its real phase                (static)
//   air     aurora + clouds, 1px per character cell,        (per frame)
//           upscaled by the browser so edges come out soft
//   land    mountains with light and shade, foothills,      (static)
//           spruce, lake, beach, dock
//   refl    the land mirrored in the lake, rippling          (per frame)
//   <pre>   ASCII: stars, ridge lines, snow texture, spruce tips, ripples,
//           fire, sparks, smoke, snow/rain, status
//   fog     low fog banks, 1px per cell like `air`           (per frame)
//   glow    firelight (screen blend), lightning flash        (per frame)
//
// Live conditions at the lake:
//   - time: night / dusk / day from the clock in Anchorage and today's
//     real sunrise and sunset (when the weather loads)
//   - weather (Open-Meteo, no key): temperature, clouds, wind, snow, rain, fog
//   - aurora (NOAA planetary Kp index): shows when Kp is high enough
//   - moon: real phase, computed locally from the date
// If a request fails the scene falls back to clock-and-season estimates.
//
// Extra words force conditions, e.g. `biglake night snow`:
//   night | dusk | day          sky
//   clear | cloudy | snow | rain | fog | storm    weather
//   aurora                      aurora on
//   frozen (or ice) | thaw      lake ice (normally Dec-Apr, Nov if cold)
//
// The fire burns down from freshly lit to embers over about ten minutes
// (never all the way out). Any key or a tap adds a log, which smokes and
// catches a few seconds later; `p` or press-and-hold pokes it for sparks.
//
// Sound (m, -/+ volume) is synthesized by biglake-sound.js, loaded the
// first time it's turned on; the choice is remembered between visits.
//
// Uses globals from index.html: modes, clamp, lerpColor, curtainHeight,
// measureCharWidth, isCoarsePointer, loadScriptOnce, print, readPosture.
//
// On a foldable half-open on a table (tabletop posture), the horizon sits
// on the hinge and a control bar sits on the beach; `tabletop` forces this
// layout, `flat` turns it off. See layout() and updateFold().

(() => {
    const TZ = "America/Anchorage";
    const FIRE_STEP = 1 / 20; // fire simulation tick, seconds
    // Fuel 0..1; below EMBERS_FUEL it's just glowing coals. A fresh fire
    // starts at START_FUEL and burns down to embers in about ten minutes
    // (sooner in the rain); each log adds LOG_FUEL once it catches.
    const START_FUEL = 0.8;
    const EMBERS_FUEL = 0.15;
    const BURN_PER_SEC = (START_FUEL - EMBERS_FUEL) / 600;
    const LOG_FUEL = 0.35;
    const LOG_FEED_SECONDS = 4; // a caught log feeds the fire over this long
    const MAX_UNLIT_LOGS = 3; // more than this on the fire and a key just pokes it
    const PALE_SMOKE = "#cfcac2";

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
            skyTop: "#01030a", skyMid: "#060d22", horizon: "#13223f",
            lakeTop: "#0b1a33", lakeBottom: "#030812", ground: "#070504",
            ridge: "#8ea2c6", mountain: "#24314f", mountainDark: "#121b33",
            snow: "#d2def3", snowShade: "#62739a", hills: "#0b1422",
            tree: "#2c5a3e", treeBg: "#040a08", water: "#3a5c8a", groundFg: "#4a3624",
            star: "#e8eeff", text: "#7f9cc4", light: "#f3efd2", lightX: 0.86,
            smoke: "#6a6a72", glow: 0.55,
            cloud: "#1e2638", fog: "#3a4458", precip: "#d6deec",
        },
        dusk: {
            skyTop: "#151b4e", skyMid: "#4c357c", horizon: "#f09a6e",
            lakeTop: "#6a4a78", lakeBottom: "#1c1a3c", ground: "#0e0a0f",
            ridge: "#d8c0e8", mountain: "#5a4882", mountainDark: "#352a58",
            snow: "#ffd9c8", snowShade: "#b48aa8", hills: "#2a2042",
            tree: "#4a3a66", treeBg: "#120d1e", water: "#f0a8b4", groundFg: "#5a3c40",
            star: "#f6e9ff", text: "#e6bfd4", light: "#ffc890", lightX: 0.15,
            smoke: "#9a8a9a", glow: 0.4,
            cloud: "#7a6490", fog: "#9a88a6", precip: "#f4e2ec",
        },
        day: {
            skyTop: "#2a5b98", skyMid: "#6c9ace", horizon: "#cfe0ee",
            lakeTop: "#6a96c2", lakeBottom: "#2c5078", ground: "#231d16",
            ridge: "#e9f0f8", mountain: "#8195b2", mountainDark: "#56688a",
            snow: "#fbfdff", snowShade: "#bccbe0", hills: "#3d5a52",
            tree: "#3f6e4c", treeBg: "#14281b", water: "#e2f0fb", groundFg: "#6a5844",
            star: null, text: "#f2f6fb", light: null, lightX: 0.5,
            smoke: "#c0c0c0", glow: 0.16,
            cloud: "#eef2f7", fog: "#d4dbe4", precip: "#ffffff",
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

    // Fire ring stones: a few greys, so they read as separate rocks.
    const STONES = ["#8a847e", "#77716b", "#6a645e", "#5c5752", "#807a72"];
    // The coal bed from the center outward: a crossed log, then logs ("=")
    // broken up by coals ("%", "*", ":", ".").
    const BED = ["/", "=", "=", "%", "=", "*", ":", "=", "=", "%", "=", "."];

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

    // Smooth 2D value noise in [0, 1).
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

    function smoothstep(e0, e1, x) {
        const t = clamp((x - e0) / (e1 - e0), 0, 1);
        return t * t * (3 - 2 * t);
    }

    function rgb(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function rgba(hex, a) {
        const [r, g, b] = rgb(hex);
        return `rgba(${r},${g},${b},${a})`;
    }

    function escapeHtml(text) {
        return /[&<>]/.test(text)
            ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            : text;
    }

    // --- Anchorage clock and sky ----------------------------------------

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
    // Returns true when the static layers must be repainted.
    function updateSky() {
        const clock = anchorageNow();
        const wx = effectiveWeather();
        s.clockLabel = clock.label;

        const sun = wx && wx.sunrise != null ? [wx.sunrise, wx.sunset] : SUN[clock.month];
        const phase = s.forced || skyPhase(clock, sun);
        const fx = weatherEffects(wx);
        const moon = moonPhase();

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

        const moonUp = phase === "night" && moon.illum > 0.04;

        // Big Lake freezes over roughly December through April; in November
        // it depends on how cold it is.
        let frozen = clock.month === 11 || clock.month <= 3;
        if (clock.month === 10) frozen = wx != null && wx.tempF != null && wx.tempF < 25;
        if (s.forceIce !== null) frozen = s.forceIce;

        const changed =
            phase !== s.phase ||
            frozen !== s.frozen ||
            fx.fog !== s.fx?.fog ||
            moonUp !== s.moonUp ||
            Math.abs(moon.angle - (s.moon?.angle ?? 0)) > 0.05;
        s.phase = phase;
        s.pal = PALETTES[phase];
        s.aurora = aurora;
        s.fx = fx;
        s.moon = moon;
        s.moonUp = moonUp;
        s.frozen = frozen;
        s.month = clock.month;
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

    // --- layout ---------------------------------------------------------

    // Font size gives ~72 columns on phones, at most 15px on desktop. The
    // grid covers the whole viewport (no padding) so painted layers and
    // text line up edge to edge.
    function sizeToViewport(ctx) {
        const fontPx = clamp(Math.floor(window.innerWidth / (72 * s.charRatio)), 8, 15);
        const lh = Math.round(fontPx * 1.15 * 100) / 100;
        ctx.fontPx = fontPx;
        ctx.lineHeight = lh;
        ctx.cw = fontPx * s.charRatio;
        ctx.overlay.style.fontSize = `${fontPx}px`;
        ctx.overlay.style.lineHeight = `${lh}px`;
        ctx.cols = Math.ceil(window.innerWidth / ctx.cw);
        ctx.rows = Math.ceil(window.innerHeight / lh);
        s.cw = ctx.cw;
        s.lh = lh;
        s.W = ctx.cols;
        s.H = ctx.rows;
        s.Wv = Math.floor(window.innerWidth / ctx.cw); // fully visible
        s.Hv = Math.floor(window.innerHeight / lh);
        s.pw = window.innerWidth;
        s.ph = window.innerHeight;
        s.dpr = Math.min(2, window.devicePixelRatio || 1);
        updateFold(ctx);
    }

    // Tabletop posture (see readPosture in index.html): find the hinge row
    // and show the control bar on the beach, which takes over from the
    // sound button and the help line. Otherwise s.fold is null.
    function updateFold(ctx) {
        const p = ctx.posture;
        const table = p && p.type === "tabletop";
        s.bar.style.display = table ? "" : "none";
        s.soundBtn.style.display = table ? "none" : "";
        if (!table) {
            s.fold = null;
            return;
        }
        const hingeY = (p.hinge.start + p.hinge.end) / 2;
        const barTop = s.bar.getBoundingClientRect().top;
        s.fold = {
            row: clamp(Math.round(hingeY / s.lh), Math.round(s.Hv * 0.25), Math.round(s.Hv * 0.75)),
            reserve: Math.ceil((window.innerHeight - barTop) / s.lh),
        };
    }

    const X = (col) => col * s.cw;
    const Y = (row) => row * s.lh;

    // Mountain height 0..1 at a (fractional) column: a rolling range, Denali
    // and its shoulder on the right, and fine jagged noise.
    function rangeHeight(c) {
        const W = s.Wv;
        const dx = W * 0.7;
        // Denali: a pointed summit on a broad massif, plus a lower shoulder.
        // Minimum widths keep it a massif, not a needle, on narrow screens.
        const peak =
            0.4 * Math.exp(-Math.abs(c - dx) / Math.max(W * 0.035, 4)) +
            0.32 * Math.exp(-(((c - dx) / Math.max(W * 0.08, 8)) ** 2)) +
            0.28 * Math.exp(-(((c - dx + Math.max(W * 0.075, 7)) / Math.max(W * 0.035, 3.5)) ** 2));
        const range =
            0.22 + 0.12 * Math.sin(c * 0.045 + 1.3) +
            0.08 * Math.sin(c * 0.11 + 0.4) + 0.04 * Math.sin(c * 0.23);
        const jag =
            (valueNoise(c * 0.3, 0.5, 41) - 0.5) * 0.1 +
            (valueNoise(c * 0.9, 0.5, 42) - 0.5) * 0.045;
        // Soft ceiling instead of a hard clamp, so peaks never flatten.
        let h = range + peak + jag;
        if (h > 0.85) h = 0.85 + (1 - Math.exp(-(h - 0.85) * 3)) * 0.15;
        return Math.max(0.05, h);
    }
    const ridgeRow = (c) => s.treeTop - rangeHeight(c) * s.maxRise;
    function snowRows(c) {
        const h = rangeHeight(c);
        if (h < 0.4) return 0;
        return (h - 0.36) * s.maxRise * 0.8 * (0.7 + 0.6 * valueNoise(c * 0.5, 1.5, 43));
    }
    const hillRow = (c) =>
        s.treeTop + 0.8 -
        (0.6 + 1.2 * valueNoise(c * 0.035, 2.5, 44) + 0.6 * valueNoise(c * 0.12, 3.5, 45)) *
            clamp(s.Hv * 0.035, 1, 3);

    function layout(ctx) {
        const Hv = s.Hv;
        const Wv = s.Wv;
        const fold = s.fold;
        if (fold) {
            // Half-open on a table: the horizon sits on the hinge. Each side
            // is laid out like its half of a flat screen: sky and mountains
            // on the half that stands up, lake, beach and fire on the half
            // lying on the table, above the controls.
            const ground = Hv - fold.reserve;
            const up = fold.row * 2;
            const down = (ground - fold.row) * 2;
            s.horizon = fold.row;
            s.shore = fold.row + Math.round(down * 0.26);
            s.treeMax = clamp(Math.round(up * 0.06), 2, 5);
            s.maxRise = Math.round(up * 0.24);
            s.fireH = clamp(Math.round(down * 0.24), 8, 16);
            s.fireY = ground - 3 - Math.round(down * 0.05);
        } else {
            s.horizon = Math.round(Hv * 0.5);
            s.shore = Math.round(Hv * 0.76);
            s.treeMax = clamp(Math.round(Hv * 0.06), 2, 5);
            s.maxRise = Math.round(Hv * 0.24);
            s.fireH = clamp(Math.round(Hv * 0.24), 8, 16);
            s.fireY = Hv - 3 - Math.round(Hv * 0.05); // bottom row of flames
        }
        s.treeTop = s.horizon - s.treeMax;
        s.fireW = clamp(Math.round(Wv * 0.11), 11, 21) | 1; // odd, so it has a center
        s.fireX = Math.round(Wv * 0.42);
        let minRidge = Infinity;
        for (let c = 0; c < Wv; c++) minRidge = Math.min(minRidge, ridgeRow(c));
        s.minRidge = minRidge;
        s.moonX = Math.round(Wv * s.pal.lightX);
        s.moonY = Math.max(2.5, minRidge * 0.32);
        s.moonR = 1.35; // in rows
        s.auroraBase = Math.max(6, minRidge * 0.95);
        s.ctx = ctx;
    }

    // --- layers ---------------------------------------------------------

    function makeCanvas(lowRes) {
        const c = document.createElement("canvas");
        c.className = "biglake-layer";
        c.setAttribute("aria-hidden", "true");
        if (lowRes) c.style.imageRendering = "auto";
        return c;
    }

    function ensureStyles() {
        if (document.getElementById("biglake-styles")) return;
        const style = document.createElement("style");
        style.id = "biglake-styles";
        style.textContent =
            ".biglake-layer{position:fixed;left:0;top:0;z-index:10;pointer-events:none}" +
            "#biglake{padding:0!important;background:transparent!important;" +
            // keeps glyphs readable over bright day skies and clouds
            "text-shadow:0 1px 2px rgba(0,0,0,0.55)}" +
            // tabletop controls, on the beach below the fire
            ".biglake-bar{position:fixed;left:50%;transform:translateX(-50%);" +
            "bottom:max(10px,env(safe-area-inset-bottom));z-index:30;display:flex;" +
            "flex-wrap:wrap;justify-content:center;gap:8px;width:max-content;max-width:calc(100vw - 20px)}" +
            ".biglake-bar .chip{background:var(--terminal-bg)}";
        document.head.appendChild(style);
    }

    function createLayers(ctx) {
        ensureStyles();
        const L = {
            sky: makeCanvas(),
            air: makeCanvas(true),
            land: makeCanvas(),
            refl: makeCanvas(),
            fog: makeCanvas(true),
            glow: document.createElement("div"),
            flash: document.createElement("div"),
        };
        for (const el of [L.glow, L.flash]) {
            el.className = "biglake-layer";
            el.setAttribute("aria-hidden", "true");
            el.style.width = "100vw";
            el.style.height = "100vh";
        }
        L.glow.style.mixBlendMode = "screen";
        L.flash.style.background = "#dfe8ff";
        L.flash.style.opacity = "0";
        // Behind the text: sky, air, land, reflection. In front: fog, glow, flash.
        ctx.overlay.before(L.sky, L.air, L.land, L.refl);
        ctx.overlay.after(L.fog, L.glow, L.flash);
        L.reflSrc = document.createElement("canvas"); // offscreen
        s.L = L;
    }

    function sizeFull(canvas) {
        canvas.width = Math.round(s.pw * s.dpr);
        canvas.height = Math.round(s.ph * s.dpr);
        canvas.style.width = `${s.pw}px`;
        canvas.style.height = `${s.ph}px`;
        const g = canvas.getContext("2d");
        g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
        return g;
    }

    // One pixel per column, two per row, stretched over the grid.
    function sizeLow(canvas) {
        canvas.width = s.W;
        canvas.height = s.H * 2;
        canvas.style.width = `${X(s.W)}px`;
        canvas.style.height = `${Y(s.H)}px`;
        const g = canvas.getContext("2d");
        return { g, img: g.createImageData(s.W, s.H * 2) };
    }

    // --- static painting (on layout or when the sky changes) -------------

    function buildScene(ctx) {
        layout(ctx);
        const L = s.L;
        s.g = {
            sky: sizeFull(L.sky),
            land: sizeFull(L.land),
            refl: sizeFull(L.refl),
            air: sizeLow(L.air),
            fog: sizeLow(L.fog),
        };
        paintSky();
        paintLand();
        paintReflectionSource();
        buildText();
        const fx = X(s.fireX + 0.5);
        const fy = Y(s.fireY - s.fireH * 0.15);
        const r = Math.max(s.pw, s.ph) * 0.32;
        L.glow.style.background =
            `radial-gradient(circle at ${fx}px ${fy}px, rgba(255,150,70,0.85) 0, ` +
            `rgba(255,110,40,0.32) ${r * 0.3}px, rgba(255,90,20,0) ${r}px)`;
        s.cloudCell = new Float32Array(s.W * s.H);
    }

    function paintSky() {
        const g = s.g.sky;
        const pal = s.pal;
        const hz = Y(s.horizon);
        const grad = g.createLinearGradient(0, 0, 0, hz);
        grad.addColorStop(0, pal.skyTop);
        grad.addColorStop(0.55, pal.skyMid);
        grad.addColorStop(1, pal.horizon);
        g.fillStyle = grad;
        g.fillRect(0, 0, s.pw, hz + 2);

        // Dusk: warm glow low on the horizon where the sun went down.
        if (s.phase === "dusk") {
            const gx = s.pw * pal.lightX;
            const glow = g.createRadialGradient(gx, hz, 0, gx, hz, s.pw * 0.45);
            glow.addColorStop(0, rgba("#ffb070", 0.55));
            glow.addColorStop(1, rgba("#ffb070", 0));
            g.fillStyle = glow;
            g.fillRect(0, 0, s.pw, hz);
        }

        if (s.moonUp) paintMoon(g);
    }

    // The moon in its real phase: a lit semicircle plus an elliptical
    // terminator. Waxing is lit on the right, waning on the left.
    function paintMoon(g) {
        const cx = X(s.moonX);
        const cy = Y(s.moonY);
        const r = Y(s.moonR);
        const { angle, illum } = s.moon;

        const halo = g.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 6);
        halo.addColorStop(0, rgba("#dfe6ff", 0.18 * illum + 0.04));
        halo.addColorStop(1, rgba("#dfe6ff", 0));
        g.fillStyle = halo;
        g.fillRect(cx - r * 6, cy - r * 6, r * 12, r * 12);

        g.save();
        g.translate(cx, cy);
        // earthshine: the dark side faintly visible
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fillStyle = "#1a2236";
        g.fill();
        if (angle >= Math.PI) g.scale(-1, 1);
        const k = Math.cos(angle);
        g.beginPath();
        g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
        g.ellipse(0, 0, r * Math.abs(k), r, 0, Math.PI / 2, -Math.PI / 2, k > 0);
        g.closePath();
        g.shadowColor = "rgba(240,236,210,0.6)";
        g.shadowBlur = r * 0.8;
        g.fillStyle = "#efeacf";
        g.fill();
        g.restore();
    }

    function paintLand() {
        const g = s.g.land;
        const pal = s.pal;
        const pw = s.pw;
        const hz = Y(s.horizon);
        g.clearRect(0, 0, pw, s.ph);

        if (!s.fx.fog) {
            // Mountains in 2px strips, lit from the left: faces that rise
            // to the right catch the light, the far sides fall into shade.
            const base = Y(s.treeTop + 1);
            for (let px = 0; px < pw; px += 2) {
                const c = px / s.cw;
                const top = Y(ridgeRow(c));
                // Slope averaged over ~4 columns: the fine jagged noise
                // otherwise makes the shading flicker into vertical stripes.
                const slope = (Y(ridgeRow(c + 2)) - Y(ridgeRow(c - 2))) / 3.3;
                const light = clamp(0.55 - slope / (s.lh * 1.4), 0.08, 1);
                g.fillStyle = lerpColor(pal.mountainDark, pal.mountain, light);
                g.fillRect(px, top, 2, base - top);
                const snow = Y(snowRows(c));
                if (snow > 0) {
                    g.fillStyle = lerpColor(pal.snowShade, pal.snow, light);
                    g.fillRect(px, top, 2, snow);
                    // ragged snow line
                    g.fillStyle = rgba(lerpColor(pal.snowShade, pal.mountain, 0.5), 0.6);
                    g.fillRect(px, top + snow, 2, Y(0.35 + valueNoise(c * 1.7, 4, 46) * 0.5));
                }
            }
            // Atmospheric haze thickening toward the base of the range.
            g.globalCompositeOperation = "source-atop";
            const haze = g.createLinearGradient(0, Y(s.minRidge), 0, base);
            haze.addColorStop(0, rgba(pal.horizon, 0));
            haze.addColorStop(1, rgba(pal.horizon, 0.28));
            g.fillStyle = haze;
            g.fillRect(0, 0, pw, base);
            g.globalCompositeOperation = "source-over";

            // Forested foothills in front of the range.
            g.beginPath();
            g.moveTo(0, hz);
            for (let px = 0; px <= pw; px += 3) g.lineTo(px, Y(hillRow(px / s.cw)));
            g.lineTo(pw, hz);
            g.closePath();
            g.fillStyle = pal.hills;
            g.fill();
        }

        // Far-shore spruce: narrow tiered silhouettes along the waterline.
        const rand = seeded(1985);
        const treeFill = s.fx.fog ? lerpColor(pal.treeBg, pal.fog, 0.55) : pal.treeBg;
        g.fillStyle = treeFill;
        g.fillRect(0, hz - s.lh * 0.7, pw, s.lh * 0.7 + 1);
        s.treeTips = [];
        for (let px = -6; px < pw + 6; ) {
            const h = s.lh * s.treeMax * (0.45 + rand() * 0.55);
            const w = h * (0.26 + rand() * 0.08);
            spruce(g, px, hz, w, h);
            s.treeTips.push([px, hz - h]);
            px += s.cw * (0.7 + rand() * 0.9);
        }

        // Lake: open water, or in winter snow-dusted ice.
        const lakeEnd = Y(s.shore) + s.lh * 0.5;
        const lake = g.createLinearGradient(0, hz, 0, lakeEnd);
        if (s.frozen) {
            lake.addColorStop(0, lerpColor(pal.snowShade, pal.lakeTop, 0.35));
            lake.addColorStop(1, lerpColor(pal.snowShade, pal.lakeBottom, 0.55));
        } else {
            lake.addColorStop(0, pal.lakeTop);
            lake.addColorStop(1, pal.lakeBottom);
        }
        g.fillStyle = lake;
        g.fillRect(0, hz, pw, lakeEnd - hz);
        if (s.frozen) {
            // wind-blown snow drifts: long, flat, soft patches on the ice
            const drift = seeded(4242);
            for (let i = 0; i < 40; i++) {
                const y = hz + drift() * (lakeEnd - hz);
                const depth = (y - hz) / (lakeEnd - hz);
                g.fillStyle = rgba(pal.snow, 0.06 + drift() * 0.14);
                g.beginPath();
                g.ellipse(drift() * pw, y, s.cw * (6 + drift() * 20) * (0.6 + depth), s.lh * (0.12 + depth * 0.35), 0, 0, Math.PI * 2);
                g.fill();
            }
        }
        // a faint bright line where water meets the far shore
        g.fillStyle = rgba(pal.horizon, 0.35);
        g.fillRect(0, hz, pw, 1);
        s.lakeEnd = lakeEnd;

        // Beach and ground.
        const ground = g.createLinearGradient(0, lakeEnd, 0, s.ph);
        ground.addColorStop(0, lerpColor(pal.ground, pal.groundFg, 0.45));
        ground.addColorStop(0.12, pal.ground);
        ground.addColorStop(1, pal.ground);
        g.fillStyle = ground;
        g.fillRect(0, lakeEnd, pw, s.ph - lakeEnd);

        // Dock on the right, with its reflection.
        if (s.Wv >= 60) {
            const x0 = X(Math.round(s.Wv * 0.7));
            const x1 = X(Math.round(s.Wv * 0.93));
            const deckY = Y(s.shore - 2) + s.lh * 0.45;
            const deckH = Math.max(3, s.lh * 0.28);
            g.fillStyle = rgba("#1a120c", 0.35);
            g.fillRect(x0, deckY + deckH + s.lh * 0.9, x1 - x0, deckH * 0.8); // reflection
            for (let x = x0 + 4; x < x1; x += X(5)) {
                g.fillStyle = "#24180f";
                g.fillRect(x, deckY, 3, s.lh * 1.1);
                g.fillStyle = rgba("#24180f", 0.35);
                g.fillRect(x, deckY + s.lh * 1.1, 3, s.lh * 0.9);
            }
            g.fillStyle = "#3e2c1e";
            g.fillRect(x0, deckY, x1 - x0, deckH);
            g.fillStyle = "#5c4430";
            g.fillRect(x0, deckY, x1 - x0, 1);
        }
    }

    // A spruce: a narrow, tiered triangle with a spire on top.
    function spruce(g, x, baseY, w, h) {
        const tiers = 4;
        g.beginPath();
        g.moveTo(x, baseY - h);
        for (let i = 1; i <= tiers; i++) {
            const y = baseY - h + (h * i) / tiers;
            const half = (w * i) / tiers;
            g.lineTo(x + half, y);
            if (i < tiers) g.lineTo(x + half * 0.45, y);
        }
        for (let i = tiers; i >= 1; i--) {
            const y = baseY - h + (h * i) / tiers;
            const half = (w * i) / tiers;
            if (i < tiers) g.lineTo(x - half * 0.45, y);
            g.lineTo(x - half, y);
        }
        g.closePath();
        g.fill();
    }

    // The land above the horizon, flipped and tinted toward the water;
    // drawn each frame in rippling strips.
    function paintReflectionSource() {
        const src = s.L.reflSrc;
        const hz = Y(s.horizon);
        const lakeH = Math.ceil(s.lakeEnd - hz);
        src.width = Math.round(s.pw * s.dpr);
        src.height = Math.max(1, Math.round(lakeH * s.dpr));
        const g = src.getContext("2d");
        g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
        g.save();
        g.scale(1, -1);
        g.drawImage(
            s.L.land,
            0, Math.max(0, (hz - lakeH) * s.dpr), src.width, lakeH * s.dpr,
            0, -lakeH, s.pw, lakeH,
        );
        g.restore();
        g.globalCompositeOperation = "source-atop";
        g.fillStyle = rgba(s.pal.lakeTop, 0.55);
        g.fillRect(0, 0, s.pw, lakeH);
        g.globalCompositeOperation = "source-over";
        s.lakeH = lakeH;
    }

    // Static ASCII: ridge outline, snow texture, spruce tips, beach texture,
    // fire ring and bench. Stars are placed here and twinkle per frame.
    function buildText() {
        const W = s.W;
        const H = s.H;
        const pal = s.pal;
        const n = W * H;
        const ch = new Array(n).fill(" ");
        const fg = new Array(n).fill(null);
        const put = (x, y, c, f) => {
            if (x < 0 || y < 1 || x >= W || y >= H) return;
            const i = y * W + x;
            ch[i] = c;
            fg[i] = f;
        };

        if (!s.fx.fog) {
            for (let x = 0; x < W; x++) {
                const rL = ridgeRow(x);
                const rR = ridgeRow(x + 1);
                const r = ridgeRow(x + 0.5);
                if (r > hillRow(x + 0.5) - 0.4) continue; // hidden behind the foothills
                const diff = rR - rL;
                const c = diff < -0.3 ? "/" : diff > 0.3 ? "\\" : r - Math.floor(r) > 0.5 ? "_" : "-";
                const y0 = Math.floor(Math.min(rL, rR));
                const y1 = Math.floor(Math.max(rL, rR));
                for (let y = y0; y <= y1; y++) put(x, y, c, pal.ridge);
                // snow texture and sparse rock below
                const snowEnd = r + snowRows(x + 0.5);
                for (let y = y1 + 1; y < s.treeTop; y++) {
                    const k = hash(x, y, 7);
                    if (y < snowEnd) {
                        if (k < 0.22) put(x, y, k < 0.08 ? "'" : k < 0.15 ? "." : ":", lerpColor(pal.snowShade, pal.snow, 0.3));
                    } else if (k < 0.04 && y < hillRow(x + 0.5) - 1) {
                        put(x, y, ".", pal.ridge);
                    }
                }
            }
        }
        // spruce tips
        const tipColor = s.fx.fog ? lerpColor(pal.tree, pal.fog, 0.5) : pal.tree;
        for (const [px, py] of s.treeTips) {
            const x = Math.floor(px / s.cw);
            const y = Math.floor(py / s.lh + 0.3);
            if (y < s.horizon) put(x, y, "^", tipColor);
        }
        // frozen lake: snow grain on the ice and a few long cracks
        if (s.frozen) {
            const iceFg = lerpColor(pal.snowShade, pal.snow, 0.35);
            for (let y = s.horizon + 1; y < s.shore; y++)
                for (let x = 0; x < W; x++) {
                    const k = hash(x, y, 13);
                    if (k < 0.035) put(x, y, k < 0.015 ? "." : k < 0.028 ? "'" : "_", iceFg);
                }
            const crackFg = lerpColor(pal.snowShade, pal.lakeBottom, 0.5);
            const rand = seeded(77);
            for (let c = 0; c < 4; c++) {
                let x = Math.floor(rand() * W);
                let y = s.horizon + 1 + Math.floor(rand() * (s.shore - s.horizon - 2));
                for (let step = 0; step < 10 + rand() * 18; step++) {
                    const turn = rand();
                    const dy = turn < 0.2 ? -1 : turn > 0.8 ? 1 : 0;
                    if (y + dy <= s.horizon || y + dy >= s.shore) break;
                    put(x, y, dy < 0 ? "/" : dy > 0 ? "\\" : "-", crackFg);
                    x += 1;
                    y += dy;
                }
            }
        }

        // beach and ground texture
        for (let y = s.shore + 1; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const k = hash(x, y, 5);
                const c = k < 0.05 ? "," : k < 0.09 ? "." : k < 0.1 ? "`" : k < 0.11 ? "'" : " ";
                if (c !== " ") put(x, y, c, pal.groundFg);
            }
        }
        // Fire ring, seen a little from above: stones at the back corners
        // beside the flames, the widest row in the middle holding the
        // crossed logs and coals, and a front arc of stones of mixed sizes.
        // The bed's colors are set per frame in render(), where it glows.
        const half = Math.floor(s.fireW / 2);
        const ring = half + 3;
        const logsY = s.fireY + 1;
        const stone = (x0, width, y, seed) => {
            const color = STONES[Math.floor(hash(x0, y, seed) * STONES.length)];
            for (let k = 0; k < width; k++)
                put(s.fireX + x0 + k, y, k === 0 ? "(" : k === width - 1 ? ")" : "_", color);
        };
        stone(-ring + 1, 3, s.fireY, 21); // back corners
        stone(ring - 3, 3, s.fireY, 21);
        stone(-ring, 4, logsY, 22); // sides
        stone(ring - 3, 4, logsY, 22);
        for (let dx = -half + 1; dx < half; dx++) {
            // the bed: two logs crossed in the middle, more logs and coals out
            // to the sides (mirrored, so the left half leans the other way)
            const c = dx === 0 ? "X" : BED[Math.abs(dx) - 1] || "=";
            put(s.fireX + dx, logsY, dx < 0 && c === "/" ? "\\" : c, "#7a4424");
        }
        // front arc: pack stones 3-5 wide edge to edge
        for (let x = -ring + 1; x <= ring - 1; ) {
            const left = ring - x; // cells left in the arc
            let width = 3 + Math.floor(hash(x, logsY, 23) * 3);
            if (left - width < 3) width = left; // don't leave a sliver
            stone(x, width, logsY + 1, 24);
            x += width;
        }
        // log bench to the left
        const benchX = s.fireX - ring - 11;
        if (benchX > 1) {
            put(benchX, logsY, "(", "#5a341c");
            for (let i = 1; i < 8; i++) put(benchX + i, logsY, "=", "#5a341c");
            put(benchX + 8, logsY, ")", "#5a341c");
        }

        // Stars in open sky: above the ridge, clear of the moon.
        s.stars = [];
        if (pal.star) {
            const rand = seeded(7);
            const density = s.phase === "night" ? 0.03 : 0.005;
            const aspect = s.lh / s.cw;
            for (let y = 1; y < s.horizon; y++)
                for (let x = 0; x < W; x++) {
                    if (y > ridgeRow(x + 0.5) - 1) continue;
                    if (s.moonUp && Math.hypot((x - s.moonX) / aspect, y - s.moonY) < s.moonR + 1.2) continue;
                    if (rand() < density)
                        s.stars.push({ x, y, ph: rand() * 6.28, sp: 0.6 + rand() * 2.4, big: rand() < 0.12 });
                }
        }

        s.ch = ch;
        s.fg = fg;
    }

    // --- per-frame painting ----------------------------------------------

    // Aurora and clouds, one pixel per column and two per row. Also records
    // cloud cover per cell so stars and aurora glyphs hide behind clouds.
    function paintAir(t) {
        const { g, img } = s.g.air;
        const data = img.data;
        data.fill(0);
        const W = s.W;
        const rowsPx = s.horizon * 2;
        const pal = s.pal;
        // Rain and storms bring heavier, darker cloud.
        const darken = s.fx.thunder ? 0.6 : s.fx.precip === "rain" ? 0.4 : s.fx.precip ? 0.2 : 0;
        const cloudRgb = rgb(lerpColor(pal.cloud, "#3c434f", darken * (s.phase === "night" ? 0.3 : 1)));
        const moonRgb = [239, 234, 207];
        const cover = s.fx.cover;
        // cover 0 -> almost no cloud; cover 1 -> no gaps at all
        const threshold = 0.75 - cover * 0.78;
        const drift = t * (0.15 + currentWind() * 0.6);
        const aspect = s.lh / s.cw;
        s.cloudCell.fill(0);

        // Aurora: per column, a bright lower edge with rays rising and
        // fading from green into violet. s.aurora (0..1) sets the strength.
        const aur = s.aurora;
        const base = [];
        const height = [];
        const rays = [];
        if (aur > 0) {
            for (let x = 0; x < W; x++) {
                base.push(s.auroraBase + curtainHeight(x, t * 0.5, []) * 0.5);
                height.push((4 + 3 * Math.sin(x * 0.05 + t * 0.2)) * (0.6 + 0.6 * aur));
                rays.push(
                    0.45 + 0.55 * Math.max(0, Math.sin(x * 0.9 + t * 1.1 + 3 * Math.sin(x * 0.13 + t * 0.3))),
                );
            }
        }

        for (let py = 0; py < rowsPx; py++) {
            const row = (py + 0.5) / 2;
            for (let x = 0; x < W; x++) {
                let ar = 0, ag = 0, ab = 0, aa = 0;
                if (aur > 0) {
                    const d = base[x] - row; // rows above the lower edge
                    if (d > -0.8 && d < height[x]) {
                        const v = (d < 0 ? 1 + d / 0.8 : (1 - d / height[x]) ** 1.4) * rays[x] * (0.45 + 0.55 * aur);
                        const k = clamp(d / height[x], 0, 1);
                        ar = 61 + (150 - 61) * k;
                        ag = 255 + (90 - 255) * k;
                        ab = 154 + (255 - 154) * k;
                        aa = clamp(v * 0.8, 0, 1);
                    }
                }
                let ca = 0;
                let cr = 0, cg = 0, cb = 0;
                if (cover > 0.05 && row < s.treeTop + 1) {
                    const n =
                        valueNoise((x + drift) / 14, row / 3.5, 21) * 0.65 +
                        valueNoise((x + drift * 1.6) / 6, row / 1.7, 22) * 0.35;
                    ca = smoothstep(threshold, threshold + 0.2, n) * (0.75 + 0.2 * cover);
                    if (ca > 0) {
                        const lift = clamp((n - threshold) * 1.2, 0, 0.35); // thicker = lighter
                        cr = cloudRgb[0] + (255 - cloudRgb[0]) * lift * 0.3;
                        cg = cloudRgb[1] + (255 - cloudRgb[1]) * lift * 0.3;
                        cb = cloudRgb[2] + (255 - cloudRgb[2]) * lift * 0.3;
                        if (s.moonUp) {
                            // silver lining near the moon
                            const dm = Math.hypot((x - s.moonX) / aspect, row - s.moonY);
                            const lit = clamp(1 - dm / 9, 0, 1) * s.moon.illum * 0.7;
                            cr += (moonRgb[0] - cr) * lit;
                            cg += (moonRgb[1] - cg) * lit;
                            cb += (moonRgb[2] - cb) * lit;
                        }
                    }
                    if ((py & 1) === 1) s.cloudCell[Math.floor(row) * W + x] = ca;
                }
                const outA = ca + aa * (1 - ca);
                if (outA <= 0.003) continue;
                const o = (py * W + x) * 4;
                data[o] = (cr * ca + ar * aa * (1 - ca)) / outA;
                data[o + 1] = (cg * ca + ag * aa * (1 - ca)) / outA;
                data[o + 2] = (cb * ca + ab * aa * (1 - ca)) / outA;
                data[o + 3] = outA * 255;
            }
        }
        g.putImageData(img, 0, 0);
        s.auroraRows = { base, height };
    }

    // Faint sky (aurora, clouds) in the water, then the far shore's
    // reflection in strips that sway more the closer they are.
    function paintReflection(t) {
        const g = s.g.refl;
        const hz = Y(s.horizon);
        const lakeH = s.lakeH;
        g.clearRect(0, 0, s.pw, s.ph);
        g.save();
        g.beginPath();
        g.rect(0, hz, s.pw, lakeH);
        g.clip();
        g.globalAlpha = s.frozen ? 0.08 : 0.3;
        g.translate(0, 2 * hz);
        g.scale(1, -1);
        g.drawImage(s.L.air, 0, 0, X(s.W), Y(s.H));
        g.restore();

        const strip = 3;
        const src = s.L.reflSrc;
        // Rain and wind break the mirror up; ice barely reflects and
        // doesn't move at all.
        const rough = s.frozen ? 0 : (s.fx.precip === "rain" ? 1.8 : 1) * (1 + Math.abs(currentWind()) * 0.25);
        g.globalAlpha = s.frozen ? 0.16 : s.fx.precip === "rain" ? 0.5 : 0.7;
        for (let y = 0; y < lakeH; y += strip) {
            const depth = y / lakeH;
            const amp = (0.4 + depth * 4) * rough;
            const off = Math.sin(y * 0.12 - t * 1.8) * amp + Math.sin(y * 0.031 + t * 0.6) * amp * 0.6;
            const sh = Math.min(strip, lakeH - y);
            g.drawImage(src, 0, y * s.dpr, src.width, sh * s.dpr, off, hz + y, s.pw, sh);
        }
        g.globalAlpha = 1;

        // Dusk: the afterglow on the horizon reflects as a soft warm band
        // straight below it, widening and fading toward the near shore.
        if (s.phase === "dusk" && s.fx.cover < 0.85) {
            const cx = s.pw * s.pal.lightX;
            for (let y = 0; y < lakeH; y += strip) {
                const depth = y / lakeH;
                const w = X(1.5 + depth * 7);
                const off = Math.sin(y * 0.12 - t * 1.8) * (0.5 + depth * 4);
                const band = g.createLinearGradient(cx - w, 0, cx + w, 0);
                const shimmer = s.frozen ? 1 : 0.8 + 0.2 * Math.sin(y * 0.4 + t * 2);
                const a = 0.32 * (1 - depth * 0.7) * shimmer * (s.frozen ? 0.5 : 1);
                band.addColorStop(0, rgba(s.pal.light, 0));
                band.addColorStop(0.5, rgba(s.pal.light, a));
                band.addColorStop(1, rgba(s.pal.light, 0));
                g.fillStyle = band;
                g.fillRect(cx - w + off, hz + y, w * 2, strip);
            }
        }
    }

    // Low fog banks over the water and the far shore, thinning near the fire.
    function paintFog(t) {
        const { g, img } = s.g.fog;
        const data = img.data;
        data.fill(0);
        if (s.fx.fog) {
            const W = s.W;
            const fogRgb = rgb(s.pal.fog);
            const top = s.treeTop - 4;
            const bottom = s.shore + 2;
            const drift = t * (0.3 + currentWind() * 0.5);
            const aspect = s.lh / s.cw;
            for (let py = Math.max(0, top * 2); py < bottom * 2; py++) {
                const row = (py + 0.5) / 2;
                const band = smoothstep(top, top + 3, row) * (1 - smoothstep(bottom - 2, bottom, row));
                for (let x = 0; x < W; x++) {
                    // A fairly even veil with slow, soft variations.
                    const n = valueNoise((x + drift) / 18, row / 3, 31) * 0.75 + valueNoise((x - drift) / 7, row / 1.6, 32) * 0.25;
                    let a = (0.4 + 0.6 * smoothstep(0.2, 0.8, n)) * 0.62 * band;
                    const df = Math.hypot((x - s.fireX) / aspect, row - s.fireY) / 7;
                    a *= clamp(df, 0.1, 1);
                    if (a <= 0.003) continue;
                    const o = (py * W + x) * 4;
                    data[o] = fogRgb[0];
                    data[o + 1] = fogRgb[1];
                    data[o + 2] = fogRgb[2];
                    data[o + 3] = a * 255;
                }
            }
        }
        g.putImageData(img, 0, 0);
    }

    // --- fire, sparks, smoke --------------------------------------------
    //
    // The flames are a heat grid: a source row under the logs, with heat
    // rising and cooling row by row. How hot the source burns comes from
    // `fuel`, which burns down to embers in about ten minutes (faster in
    // the rain) and never quite runs out. A new log doesn't flare
    // the fire at once: it sits and smokes, catches a few seconds later, then
    // feeds its fuel in over several seconds.

    function resetFire() {
        s.heat = Array.from({ length: s.fireH + 2 }, () => new Array(s.fireW).fill(0));
        s.tongue = null;
        for (let i = 0; i < 40; i++) stepFire(); // start already burning
        s.energyAvg = s.energy;
    }

    // How hard the bed burns on fuel alone: ~1 for a steady fire, 0.15 for
    // glowing coals.
    function fuelStrength() {
        return 0.15 + Math.pow(s.fuel, 0.7);
    }

    // Heat at the source right now: fuel, damped a little in the rain, plus
    // short flares (a poke, a log catching) and a bit of draft from the wind.
    function fireIntensity() {
        const wet = rainRate();
        const draft = Math.min(2, Math.abs(currentWind())) * 0.05 * Math.min(1, s.fuel * 2);
        return fuelStrength() * (1 - wet * 0.15) + s.boost + draft;
    }

    function rainRate() {
        return s.fx && s.fx.precip === "rain" ? s.fx.rate : 0;
    }

    function fireState() {
        if (s.fuel > 0.85) return "roaring";
        if (s.fuel > 0.45) return "steady";
        if (s.fuel > EMBERS_FUEL) return "low";
        return "embers";
    }

    // Rows the flames reach right now; they shrink as the fire burns down.
    function flameHeight() {
        return s.fireH * clamp(0.2 + 0.8 * s.intensity, 0.2, 1);
    }

    // Firelight follows the flames: brighter when they surge, dimmer when
    // they dip.
    function flicker() {
        const avg = Math.max(0.03, s.energyAvg);
        return clamp(0.9 + ((s.energy - avg) / avg) * 2.5, 0.72, 1.1);
    }

    // Per frame: burn fuel, let new logs catch and lit ones feed the fire.
    function updateFuel(dt) {
        s.fuel = Math.max(0, s.fuel - dt * BURN_PER_SEC * (1 + rainRate() * 0.5));
        for (const log of s.logs) {
            log.age += dt;
            if (!log.lit) {
                if (log.age >= log.catchAt) catchLog(log);
                continue;
            }
            const take = Math.min(log.fuel, (dt * LOG_FUEL) / LOG_FEED_SECONDS);
            log.fuel -= take;
            s.fuel = Math.min(1, s.fuel + take);
        }
        s.logs = s.logs.filter((log) => !log.lit || log.fuel > 0);
        s.boost *= Math.exp(-dt * 0.7);
        s.lean += (currentWind() - s.lean) * Math.min(1, dt * 1.5);
        s.intensity = fireIntensity();
    }

    // Any key or a tap: put a log on. It smokes for a few seconds first: a
    // hot bed catches it quickly, coals take longer, and on a wet or
    // overloaded fire it mostly smolders.
    function addLog() {
        if (!s || s.ctx.reduced) return; // still picture: no time passes
        if (s.logs.filter((log) => !log.lit).length >= MAX_UNLIT_LOGS) return poke();
        const pending = s.logs.reduce((sum, log) => sum + log.fuel, 0);
        const half = Math.floor(s.fireW / 2);
        s.logs.push({
            dx: Math.round((Math.random() - 0.5) * Math.max(0, half - 3)),
            age: 0,
            catchAt:
                1.2 +
                2.5 * (1 - Math.min(1, s.intensity)) +
                rainRate() * 1.5 +
                (s.fuel + pending > 1 ? 4 : 0) +
                Math.random() * 0.8,
            fuel: LOG_FUEL,
            lit: false,
            smokeAcc: 0,
        });
        if (s.audio) s.audio.addLog();
    }

    function catchLog(log) {
        log.lit = true;
        s.boost = Math.min(1.2, s.boost + 0.35);
        for (let i = 0; i < 8; i++) spawnSpark(true);
        if (s.audio) s.audio.logCatch();
    }

    // `p` or press-and-hold: poke the fire. Sparks and a quick flare, but no
    // new fuel, and coals only flare a little.
    function poke() {
        if (!s) return;
        s.boost = Math.min(1.2, s.boost + 0.45 * Math.min(1, fuelStrength()));
        for (let i = 0; i < 14; i++) spawnSpark(true);
        if (s.audio) s.audio.poke();
    }

    function stepFire() {
        const W = s.fireW;
        const FH = s.fireH;
        const heat = s.heat;
        const intensity = s.intensity;
        const mid = (W - 1) / 2;
        // Now and then a tongue of flame licks up out of the middle.
        if (!s.tongue || s.tongue.left <= 0) {
            s.tongue =
                Math.random() < 0.05
                    ? { x: mid + (Math.random() - 0.5) * W * 0.4, left: 0.25 + Math.random() * 0.45, amt: 0.25 + Math.random() * 0.3 }
                    : null;
        }
        const tongue = s.tongue;
        if (tongue) tongue.left -= FIRE_STEP;
        const src = heat[FH + 1];
        for (let x = 0; x < W; x++) {
            const profile = Math.exp(-(((x - mid) / (W * 0.27)) ** 2));
            const lick = tongue ? tongue.amt * Math.exp(-(((x - tongue.x) / 1.2) ** 2)) : 0;
            src[x] = (profile * (0.75 + Math.random() * 0.45) + lick) * intensity;
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
        // How hard the fire is burning (average heat in the lower flames),
        // for the sound of the roar and crackle.
        let sum = 0;
        for (let y = FH - 3; y < FH; y++) for (let x = 0; x < W; x++) sum += heat[y][x];
        s.energy = sum / (3 * W);
        s.energyAvg += (s.energy - s.energyAvg) * 0.08;
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

    function spawnSpark(burst = false) {
        const wind = currentWind();
        const life = 0.6 + Math.random() * (burst ? 1.8 : 1.2);
        s.sparks.push({
            x: s.fireX + (Math.random() - 0.5) * s.fireW * 0.5,
            y: s.fireY - flameHeight() * (0.4 + Math.random() * 0.4),
            // gusts carry sparks further
            vx: wind * (3 + Math.abs(wind)) + (Math.random() - 0.5) * (burst ? 6 : 2),
            vy: -(5 + Math.random() * (burst ? 10 : 6)),
            age: 0,
            life,
        });
    }

    // `pale` 0..1: thin dark smoke off a hot fire up to thick white smoke
    // off a wet, dying or smoldering one.
    function spawnSmoke(pale, x = s.fireX + (Math.random() - 0.5) * 3, y = s.fireY - flameHeight() * 0.85, life = 4 + Math.random() * 2.5) {
        s.smoke.push({
            x,
            y,
            vx: (Math.random() - 0.5) * 0.4,
            vy: -(1.2 + Math.random() * 1.2) * (1 - pale * 0.35),
            age: 0,
            life,
            pale,
        });
    }

    function updateParticles(dt) {
        const wind = currentWind();
        s.sparkAcc += dt * 3.5 * s.intensity;
        while (s.sparkAcc >= 1) {
            spawnSpark();
            s.sparkAcc -= 1;
        }
        const wet = rainRate();
        const dying = clamp(1 - s.fuel / 0.35, 0, 1);
        s.smokeAcc += dt * (1.2 + wet * 2 + dying * 0.6);
        while (s.smokeAcc >= 1) {
            spawnSmoke(Math.max(wet, dying) * 0.8);
            s.smokeAcc -= 1;
        }
        // Logs waiting to catch smolder: thick, pale smoke curling off them.
        let row = 0;
        for (const log of s.logs) {
            if (log.lit) continue;
            log.smokeAcc += dt * (2 + wet);
            while (log.smokeAcc >= 1) {
                spawnSmoke(1, s.fireX + log.dx + (Math.random() - 0.5) * 4, s.fireY - row - 1, 3 + Math.random() * 2);
                log.smokeAcc -= 1;
            }
            row++;
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
        // Rain falling into the fire sizzles on the coals and puffs up as
        // steam; snowflakes melt in the hot air above the flames.
        const half = s.fireW / 2;
        const flames = flameHeight();
        s.precip = s.precip.filter((p) => {
            if (p.y >= s.H - 1 || p.x <= -12 || p.x >= s.W + 12) return false;
            const rain = p.vy > 10;
            const top = s.fireY - flames * (rain ? 0.7 : 1.4);
            if (Math.abs(p.x - s.fireX) >= half || p.y < top || p.y > s.fireY + 1) return true;
            if (rain) {
                s.sizzles++;
                if (Math.random() < 0.3) spawnSmoke(1, p.x, s.fireY - Math.random() * 2, 1 + Math.random() * 0.8);
            }
            return false;
        });
    }

    // --- sound (optional, off by default) --------------------------------
    // The engine lives in biglake-sound.js, loaded the first time sound is
    // turned on. The AudioContext is created right here, inside the click or
    // key press, because iOS only allows audio to start from a user gesture.

    const SOUND_PREF = "biglake-sound"; // "on" | "off"
    const VOLUME_PREF = "biglake-volume";

    function readPref(key, fallback) {
        try {
            return localStorage.getItem(key) ?? fallback;
        } catch {
            return fallback;
        }
    }

    function writePref(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch {
            /* private mode etc.: just don't remember */
        }
    }

    function toggleSound() {
        s.soundPending = false;
        if (s.audio) {
            s.audio.stop();
            s.audio = null;
            writePref(SOUND_PREF, "off");
            updateSoundButton();
            return;
        }
        if (s.audioLoading) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ac = new AC();
        if (ac.resume) ac.resume();
        s.audioLoading = true;
        updateSoundButton();
        const scene = s;
        loadScriptOnce("biglake-sound.js")
            .then(() => {
                if (s !== scene) return ac.close();
                s.audio = window.createBiglakeAudio(ac, soundState, { volume: s.volume });
                writePref(SOUND_PREF, "on");
                // iPhones mute web audio with the ring/silent switch.
                if (isCoarsePointer()) s.soundHintUntil = performance.now() + 5000;
            })
            .catch(() => ac.close())
            .finally(() => {
                if (s !== scene) return;
                s.audioLoading = false;
                updateSoundButton();
            });
    }

    function changeVolume(delta) {
        s.volume = clamp(Math.round((s.volume + delta) * 10) / 10, 0.1, 1);
        writePref(VOLUME_PREF, String(s.volume));
        if (s.audio) s.audio.setVolume(s.volume);
        updateSoundButton();
    }

    function updateSoundButton() {
        const btn = s.soundBtn;
        if (!btn) return;
        let label;
        if (s.audioLoading) label = "sound: loading\u2026";
        else if (s.soundPending) label = isCoarsePointer() ? "tap for sound" : "press m for sound";
        else if (!s.audio) label = "sound: off";
        else if (performance.now() < s.soundHintUntil) label = "sound on \u00b7 silent switch off?";
        else label = `sound: ${Math.round(s.volume * 100)}%`;
        const text = `[m] ${label}`;
        if (btn.textContent !== text) btn.textContent = text;
        if (s.bar.style.display === "none") return;
        if (s.barSound.textContent !== label) s.barSound.textContent = label;
        const choice = WINDS[s.windIndex];
        const wind = `wind: ${choice.live ? "live" : choice.label}`;
        if (s.barWind.textContent !== wind) s.barWind.textContent = wind;
    }

    // What the sound engine needs to know, read every frame.
    function soundState() {
        const wx = effectiveWeather();
        const wind = currentWind();
        const choice = WINDS[s.windIndex];
        const windStrength = choice.live
            ? (wx ? clamp(wx.windMph / 25, 0, 1.2) : 0)
            : Math.abs(choice.v) / 2;
        return {
            energy: s.energy,
            intensity: s.intensity,
            fuel: s.fuel,
            smolder: s.logs.filter((log) => !log.lit).length, // logs waiting to catch
            sizzles: s.sizzles, // raindrops that hit the fire this frame
            firePan: (s.fireX / s.Wv) * 2 - 1,
            wind,
            windStrength,
            rain: s.fx.precip === "rain" ? s.fx.rate : 0,
            snow: s.fx.precip === "snow" ? s.fx.rate : 0,
            fog: s.fx.fog,
            frozen: s.frozen,
            phase: s.phase,
            month: s.month,
            tempF: wx ? wx.tempF : null,
        };
    }

    // --- per-frame composition -----------------------------------------

    function render() {
        const { W, H, pal, t } = s;
        paintAir(t);
        paintReflection(t);
        paintFog(t);

        const ch = s.ch.slice();
        const fg = s.fg.slice();
        const set = (x, y, c, f) => {
            x = Math.round(x);
            y = Math.round(y);
            if (x < 0 || y < 1 || x >= W || y >= H) return -1;
            const i = y * W + x;
            ch[i] = c;
            fg[i] = f;
            return i;
        };
        const cloudAt = (x, y) => s.cloudCell[y * W + x] || 0;

        // Stars twinkle, unless a cloud is in the way.
        for (const star of s.stars) {
            const hidden = cloudAt(star.x, star.y);
            if (hidden > 0.45) continue;
            const b = (0.5 + 0.5 * Math.sin(t * star.sp + star.ph)) * (1 - hidden);
            const i = star.y * W + star.x;
            ch[i] = star.big && b > 0.7 ? "*" : b > 0.85 ? "+" : ".";
            fg[i] = lerpColor(pal.skyMid, pal.star, 0.35 + b * 0.65);
        }

        // A few ray glyphs in the brightest aurora, for texture.
        if (s.aurora > 0) {
            const { base, height } = s.auroraRows;
            for (let x = 0; x < W; x++) {
                // only in the bright lower half of the curtain
                for (let y = Math.max(1, Math.floor(base[x] - height[x] * 0.5)); y <= base[x]; y++) {
                    if (y > ridgeRow(x + 0.5) - 0.5 || cloudAt(x, y) > 0.4) continue;
                    if (hash(x, y, Math.floor(t * 2)) > 0.06 * s.aurora) continue;
                    set(x, y, base[x] - y < 1 ? "'" : "|", lerpColor("#3dff9a", "#ffffff", 0.3));
                }
            }
        }

        // Lake: sparse moving glints, and moonlight glinting in a column
        // straight below the moon unless it's clouded over. (The dusk
        // afterglow is a painted band in the reflection layer instead.)
        const lakeRows = s.shore - s.horizon;
        const cover = s.fx.cover;
        const streak = s.phase === "night" && s.moonUp && cover < 0.85;
        const lx = Math.round(s.Wv * pal.lightX);
        for (let y = s.horizon + 1; y < s.shore; y++) {
            const d = y - s.horizon;
            // open water glints (ice texture is static, see buildText)
            for (let x = 0; x < W && !s.frozen; x++) {
                const v =
                    Math.sin(x * 0.35 + y * 1.7 - t * (0.6 + d * 0.03)) *
                    Math.sin(x * 0.13 + y * 0.7 + t * 0.5);
                if (v > 0.86) set(x, y, v > 0.93 ? "~" : "-", lerpColor(pal.lakeTop, pal.water, 0.45 + (v - 0.86) * 5));
            }
            if (streak) {
                // on ice the moonlight is a dull, still sheen
                const w = 0.6 + d * 0.35;
                const strength = (0.4 + 0.6 * s.moon.illum) * (s.frozen ? 0.6 : 1);
                for (let x = Math.floor(lx - w); x <= Math.ceil(lx + w); x++) {
                    if (x < 0 || x >= W) continue;
                    if (hash(x, y, s.frozen ? 0 : Math.floor(t * 5)) < (s.frozen ? 0.6 : 0.4)) continue;
                    set(x, y, s.frozen ? "-" : d % 2 ? "=" : "-", lerpColor(pal.water, pal.light, (0.75 - (d / lakeRows) * 0.4) * strength));
                }
            }
        }

        // Firelight on the water just past the shore in front of the fire:
        // warm flickering glints, densest nearest the flames.
        const fireRows = Math.min(5, lakeRows - 1);
        const intensityNow = s.intensity;
        for (let k = 1; k <= fireRows; k++) {
            const y = s.shore - k;
            const reach = s.fireW * (0.35 + k * 0.08);
            for (let x = Math.floor(s.fireX - reach); x <= Math.ceil(s.fireX + reach); x++) {
                if (x < 0 || x >= W) continue;
                const near = 1 - Math.abs(x - s.fireX) / reach;
                const chance = near * (1 - k / (fireRows + 1)) * 0.75 * Math.min(1.3, intensityNow);
                if (hash(x, y, Math.floor(t * 8)) > chance) continue;
                const heat = near * (1 - k / (fireRows + 2));
                // ripples on water; a warm sheen on ice
                const c = s.frozen ? (hash(x, y, 3) < 0.5 ? "." : "-") : hash(x, y, 3) < 0.5 ? "~" : "-";
                set(x, y, c, lerpColor("#8a2a08", "#ffc060", heat));
            }
        }

        // Waves lapping at the near shore, or a still, snowy ice edge.
        for (let x = 0; x < W; x++) {
            if (s.frozen) {
                set(x, s.shore, hash(x, s.shore, 9) > 0.5 ? "_" : ".", lerpColor(pal.snowShade, pal.snow, 0.4));
                continue;
            }
            const c = hash(x, s.shore, Math.floor(t * 1.5 + x * 0.08)) > 0.55 ? "~" : ".";
            set(x, s.shore, c, lerpColor(pal.water, pal.lakeTop, 0.3));
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

        // Smoke.
        for (const p of s.smoke) {
            const k = p.age / p.life;
            const c = k < 0.25 ? "(" : k < 0.5 ? ")" : k < 0.75 ? "~" : ".";
            set(p.x, p.y, c, lerpColor(lerpColor(pal.smoke, PALE_SMOKE, p.pale), pal.skyMid, k));
        }

        // The coal bed: each cell of the burning logs glows on its own slow
        // pulse, hottest in the middle. Once the flames die down this is
        // most of what's left.
        const half = Math.floor(s.fireW / 2);
        const bed = clamp(0.35 + 0.65 * s.intensity, 0.35, 1.2);
        for (let dx = -half + 1; dx < half; dx++) {
            const x = s.fireX + dx;
            const y = s.fireY + 1;
            const near = 1 - Math.abs(dx) / half;
            const phase = t * 0.6 + hash(dx, 0, 11) * 10;
            const k = Math.floor(phase);
            const f = phase - k;
            const a = hash(dx, k, 12);
            const pulse = a + (hash(dx, k + 1, 12) - a) * f * f * (3 - 2 * f);
            const c = s.ch[y * W + x];
            // coals glow hottest; logs are charred, with cracks of light
            // that come and go
            const coal = "%*:.".includes(c);
            const crack = !coal && hash(dx, Math.floor(t * 1.5 + dx), 13) < 0.2 ? 0.35 : 0;
            const body = coal ? 1 : c === "=" ? 0.55 + crack : 0.75;
            const glow = clamp((0.25 + 0.75 * near) * bed * (0.45 + 0.55 * pulse) * body, 0, 1);
            set(x, y, c, lerpColor(coal ? "#4a1608" : "#2a120a", coal ? "#ffd070" : "#ff9a40", glow));
        }
        // Stones facing the coals pick up their glow.
        const ring = half + 3;
        for (let y = s.fireY; y <= s.fireY + 2; y++) {
            for (let dx = -ring; dx <= ring; dx++) {
                const x = s.fireX + dx;
                if (x < 0 || x >= W || (y === s.fireY + 1 && Math.abs(dx) < half)) continue;
                const i = y * W + x;
                if (!"(_)".includes(s.ch[i])) continue;
                const near = 1 - Math.abs(dx) / (ring + 1);
                set(x, y, s.ch[i], lerpColor(s.fg[i], "#e07a3a", clamp(0.45 * near * bed, 0, 0.5)));
            }
        }
        // A few embers that popped out onto the ground in front.
        for (let k = 0; k < 3; k++) {
            const dx = Math.round((hash(k, 0, 31) - 0.5) * (half + 4) * 2);
            const pulse = 0.5 + 0.5 * Math.sin(t * (0.7 + k * 0.3) + k * 2);
            set(s.fireX + dx, s.fireY + 3, k ? "." : ",", lerpColor("#2a0e06", "#c4501a", pulse * Math.min(1, bed)));
        }

        // Flames, leaning with the wind: the tips swing furthest.
        const fireCells = new Set();
        const lean = s.lean * 1.4;
        for (let fy = 0; fy < s.fireH; fy++) {
            const shift = Math.round(lean * (1 - fy / (s.fireH - 1)) ** 1.5);
            for (let fx = 0; fx < s.fireW; fx++) {
                const h = s.heat[fy][fx];
                const stop = FLAME.find(([min]) => h >= min);
                if (!stop) continue;
                const i = set(s.fireX - half + fx + shift, s.fireY - s.fireH + 1 + fy, stop[1], stop[2]);
                if (i >= 0) fireCells.add(i);
            }
        }

        // Logs waiting to catch, stacked on the fire: bark-brown, then
        // charring and glowing at the ends just before they go up.
        let logRow = 0;
        for (const log of s.logs) {
            if (log.lit) continue;
            const ready = clamp(log.age / log.catchAt, 0, 1);
            const y = s.fireY - logRow++;
            for (let k = -2; k <= 2; k++) {
                const c = k === -2 ? "(" : k === 2 ? ")" : "=";
                const glowing = ready > 0.4 && (Math.abs(k) === 2 || hash(k, log.dx, Math.floor(t * 6)) < ready * 0.4);
                const color = glowing
                    ? lerpColor("#5a2a10", "#ff9a40", ((ready - 0.4) / 0.6) * (0.6 + 0.4 * Math.random()))
                    : lerpColor("#6a3e20", "#2a1a10", ready * 0.7);
                set(s.fireX + log.dx + k, y, c, color);
            }
        }

        // Sparks.
        for (const p of s.sparks) {
            const k = p.age / p.life;
            set(p.x, p.y, k < 0.3 ? "*" : k < 0.7 ? "." : "`", lerpColor("#ffe08a", "#7a1a00", k));
        }

        // Firelight warms nearby glyphs.
        const intensity = s.intensity;
        const light = flicker();
        const reach = 18 * Math.sqrt(intensity);
        const aspect = s.lh / s.cw;
        const cx = s.fireX + lean * 0.5;
        const cy = s.fireY - flameHeight() * 0.3;
        for (let y = Math.max(0, Math.floor(cy - reach / aspect)); y < H; y++) {
            for (let x = Math.max(0, Math.floor(cx - reach)); x < Math.min(W, cx + reach); x++) {
                const i = y * W + x;
                if (ch[i] === " " || fireCells.has(i) || !fg[i]) continue;
                const dist = Math.hypot(x - cx, (y - cy) * aspect) / reach;
                if (dist >= 1) continue;
                fg[i] = lerpColor(fg[i], "#ffb070", (1 - dist) ** 2 * 0.8 * light);
            }
        }
        s.L.glow.style.opacity = (pal.glow * clamp(intensity, 0.25, 1.6) * light).toFixed(3);
        s.L.glow.style.transform = `translateX(${(lean * 0.5 * s.cw).toFixed(1)}px)`;

        // Lightning in a thunderstorm: a brief flash over everything.
        s.L.flash.style.opacity = t < s.flashUntil ? "0.4" : "0";

        // Status line and help (kept inside the fully visible area).
        const help = isCoarsePointer()
            ? "tap: add a log · hold: poke the fire"
            : "any key: add a log · p: poke · w: wind · m: sound · -/+: vol · q: leave";
        writeText(ch, fg, 1, 0, statusLine(), pal.text);
        if (!s.fold) writeText(ch, fg, 1, s.Hv - 1, help, lerpColor(pal.groundFg, "#d8c8b0", 0.6));

        s.ctx.overlay.innerHTML = serialize(ch, fg);
    }

    // "big lake, alaska · 8:00 pm · 36°F · overcast · wind 7 mph nnw · aurora kp 3"
    // Trailing details drop off on narrow screens.
    function statusLine() {
        const wx = effectiveWeather();
        const state = fireState();
        const parts = ["big lake, alaska", s.clockLabel, state === "embers" ? "down to embers" : `fire ${state}`];
        if (wx && wx.tempF != null) parts.push(`${Math.round(wx.tempF)}°F`);
        if (s.fx.label) parts.push(s.fx.label);
        if (s.frozen) parts.push("lake frozen");
        parts.push(`wind ${windLabel()}`);
        if (s.aurora > 0 && s.fx.cover < 0.8)
            parts.push(conditions.kp != null && !s.forceAurora ? `aurora kp ${Math.round(conditions.kp)}` : "aurora");
        let line = parts.join(" · ");
        // leave room for the [x] exit button (~100px) in the top-right corner
        const maxLen = s.Wv - 2 - Math.ceil(100 / s.cw);
        while (line.length > maxLen && parts.length > 2) {
            parts.pop();
            line = parts.join(" · ");
        }
        return line;
    }

    function writeText(ch, fg, x0, y, text, color) {
        const W = s.W;
        for (let k = 0; k < text.length && x0 + k < W - 1; k++) {
            const i = y * W + x0 + k;
            ch[i] = text[k];
            fg[i] = color;
        }
    }

    // Grid -> HTML, merging neighbouring glyphs of the same color into one
    // span. Spaces join whatever run they're in.
    function serialize(ch, fg) {
        const { W, H } = s;
        const lines = [];
        for (let y = 0; y < H; y++) {
            let line = "";
            let run = "";
            let rf = null;
            const flush = () => {
                if (!run) return;
                const text = escapeHtml(run);
                line += rf ? `<span style="color:${rf}">${text}</span>` : text;
                run = "";
            };
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                const c = ch[i];
                if (c === " ") {
                    run += c;
                    continue;
                }
                if (fg[i] !== rf) {
                    flush();
                    rf = fg[i];
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
        const ice = s.frozen ? " the lake is frozen over." : "";
        print(
            `you're sitting by a campfire on the shore of big lake, alaska. ` +
                `it's ${s.clockLabel} there${weather}; the sky is ${sky}${aurora}.${ice}`,
        );
    }

    // --- controls -------------------------------------------------------

    // The sound toggle (bottom-right) so touch users can reach it, and the
    // tabletop control bar, shown instead of it when the phone is half-open
    // on a table (see updateFold). Both exist from the start so the layout
    // can measure the bar.
    function createControls() {
        ensureStyles();
        const button = (className, text, label, act) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = className;
            b.textContent = text;
            b.setAttribute("aria-label", label);
            b.addEventListener("click", (e) => {
                e.stopPropagation();
                if (!s) return;
                act();
                if (s.ctx && s.ctx.reduced) render(); // static mode: show the change
            });
            return b;
        };
        // Sound remembered from last visit starts on the first tap.
        const withSound = (act) => () => {
            if (s.soundPending) toggleSound();
            act();
        };

        s.soundBtn = button("mode-exit", "", "Toggle campfire sound", toggleSound);
        s.soundBtn.style.top = "auto";
        s.soundBtn.style.bottom = "max(10px, env(safe-area-inset-bottom))";

        s.bar = document.createElement("div");
        s.bar.className = "biglake-bar";
        s.barWind = button("chip", "wind: live", "Change the wind", withSound(() => {
            s.windIndex = (s.windIndex + 1) % WINDS.length;
        }));
        s.barSound = button("chip", "sound: off", "Toggle campfire sound", toggleSound);
        s.bar.append(
            button("chip", "add a log", "Add a log to the fire", withSound(addLog)),
            button("chip", "poke", "Poke the fire", withSound(poke)),
            s.barWind,
            s.barSound,
        );
        document.body.append(s.soundBtn, s.bar);
    }

    // --- the mode -------------------------------------------------------

    modes.biglake = {
        path: "~/biglake",
        overlay: { className: "ascii-overlay", fontPx: 15, lineHeight: 17 },
        fps: 20,
        reducedMotion: "static",
        exitMessage: "the fire's down to embers. it'll be here when you come back!",

        start(ctx, ...args) {
            const words = args.map((a) => String(a).toLowerCase());
            s = {
                forced: words.find((w) => PALETTES[w]) || null,
                weatherOverride: words.find((w) => PRESETS[w]) || null,
                forceAurora: words.includes("aurora"),
                // `frozen` / `ice` freeze the lake, `thaw` opens it
                forceIce: words.includes("frozen") || words.includes("ice") ? true : words.includes("thaw") ? false : null,
                frozen: false,
                month: 0,
                energy: 0.5,
                phase: null,
                aurora: 0,
                fx: null,
                moon: null,
                moonUp: false,
                pal: null,
                clockLabel: "",
                charRatio: measureCharWidth(16) / 16,
                t: 0,
                lastSkyCheck: 0,
                lastFetchCheck: 0,
                // the fire always starts fresh: freshly lit, nothing on it
                fuel: START_FUEL,
                logs: [],
                intensity: 1,
                energyAvg: 0.5,
                lean: 0,
                tongue: null,
                sizzles: 0,
                holdTimer: null,
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
                audio: null,
                audioLoading: false,
                // If sound was on last visit, start it on the first tap or
                // key press (browsers won't play audio before a gesture).
                soundPending: readPref(SOUND_PREF, "off") === "on",
                soundHintUntil: 0,
                volume: clamp(Number(readPref(VOLUME_PREF, "0.7")) || 0.7, 0.1, 1),
                soundBtn: null,
                bar: null,
                barWind: null,
                barSound: null,
                fold: null,
                onVisibility: null,
            };
            // `tabletop` (or `fold`) lays the scene out across a half-open
            // foldable's hinge even if the browser can't tell; `flat` never does.
            const posture = words.includes("tabletop") || words.includes("fold")
                ? "tabletop"
                : words.includes("flat") ? "flat" : null;
            if (posture) {
                ctx.forcePosture = posture;
                ctx.posture = readPosture(posture);
            }
            createControls();
            updateSky();
            sizeToViewport(ctx);
            createLayers(ctx);
            buildScene(ctx);
            resetFire();
            // Draw right away with what we know; live data swaps in when it
            // lands, and the description waits for it so it's accurate.
            if (Date.now() - conditions.fetchedAt > REFRESH_MS)
                applyFreshConditions(ctx).then(() => s && s.ctx === ctx && describeScene());
            else describeScene();

            // Tap to add a log; press and hold to poke the fire.
            ctx.overlay.addEventListener("pointerdown", () => {
                if (s.soundPending) toggleSound();
                clearTimeout(s.holdTimer);
                s.holdTimer = setTimeout(() => {
                    if (!s) return;
                    s.holdTimer = null;
                    poke();
                }, 450);
            });
            const release = (add) => () => {
                if (!s || !s.holdTimer) return; // already poked
                clearTimeout(s.holdTimer);
                s.holdTimer = null;
                if (add) addLog();
            };
            ctx.overlay.addEventListener("pointerup", release(true));
            ctx.overlay.addEventListener("pointercancel", release(false));
            ctx.overlay.addEventListener("pointerleave", release(false));
            // no long-press menu or text selection while holding
            ctx.overlay.addEventListener("contextmenu", (e) => e.preventDefault());
            updateSoundButton();

            // Go quiet while the tab is in the background.
            s.onVisibility = () => {
                if (!s || !s.audio) return;
                if (document.hidden) s.audio.suspend();
                else s.audio.resume();
            };
            document.addEventListener("visibilitychange", s.onVisibility);
        },

        resize(ctx) {
            sizeToViewport(ctx);
            buildScene(ctx);
            resetFire();
            render(); // repaint text with the canvases, not a frame later
        },

        frame(ctx, t, dt) {
            s.t = t;
            // Re-check the Anchorage clock every 30s; repaint if the sky changed.
            if (t - s.lastSkyCheck > 30) {
                s.lastSkyCheck = t;
                if (updateSky()) buildScene(ctx);
            }
            // Refresh live conditions every 10 minutes while the fire's lit.
            if (t - s.lastFetchCheck > 60) {
                s.lastFetchCheck = t;
                if (Date.now() - conditions.fetchedAt > REFRESH_MS) applyFreshConditions(ctx);
            }
            if (s.fx.thunder && Math.random() < dt / 9) {
                s.flashUntil = t + 0.09;
                if (s.audio) s.audio.thunder();
            }
            updateFuel(dt);
            s.fireAcc += dt;
            while (s.fireAcc >= FIRE_STEP) {
                stepFire();
                s.fireAcc -= FIRE_STEP;
            }
            updateParticles(dt);
            if (s.audio) s.audio.update(dt);
            s.sizzles = 0;
            updateSoundButton();
            render();
        },

        keydown(ctx, e) {
            const key = e.key.toLowerCase();
            if (key === "q" || key === "escape") return false; // framework exits
            if (e.metaKey || e.ctrlKey || e.altKey) return false;
            // Sound remembered from last visit starts on the first key press.
            if (s.soundPending && key !== "m") toggleSound();
            if (key === "w") {
                s.windIndex = (s.windIndex + 1) % WINDS.length;
            } else if (key === "m") {
                toggleSound();
            } else if (key === "-" || key === "_") {
                changeVolume(-0.1);
            } else if (key === "=" || key === "+") {
                changeVolume(0.1);
            } else if (key === "p") {
                poke();
            } else if (e.key.length === 1 || key === "enter") {
                addLog();
            } else {
                return false;
            }
            e.preventDefault();
            if (ctx.reduced) render(); // static mode: show the change
            return true;
        },

        stop() {
            clearTimeout(s.holdTimer);
            if (s.audio) s.audio.stop(); // fades out, then releases the device
            document.removeEventListener("visibilitychange", s.onVisibility);
            s.soundBtn.remove();
            s.bar.remove();
            for (const key of ["sky", "air", "land", "refl", "fog", "glow", "flash"]) s.L[key].remove();
            s = null;
        },
    };
})();
