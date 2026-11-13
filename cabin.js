// cabin: what's behind the terminal.
//
// Loaded on demand by the `logout` command in index.html and registered as
// a mode (see the mode framework there). Logging out stands you up from the
// desk: the camera pulls back from the monitor, the live terminal shrinks
// into the CRT, and you're standing in a log cabin on Big Lake, Alaska.
// Click the screen (or press q / Esc) to sit back down.
//
// The room is pixel art in one-point perspective, painted once at 480x270
// and scaled up without smoothing:
//
//   surfaces  walls, floor, ceiling, door, hearth, the view out the
//             window: painted per pixel from their position on each plane
//   objects   shelf, desk, monitor, stove, clock...: flat boxes projected
//             toward the vanishing point (see box())
//   light     ambient by time of day, plus lamp, CRT, stove and window,
//             ordered-dithered so gradients stay pixelated
//   chair     its own layer, so it can be nearer the camera than the room
//             (it swings into view as you step back, and parallaxes after)
//   frame     per-frame bits drawn over the lit room: CRT contents, clock
//             hands and pendulum, stove fire, snow falling past the window,
//             glows, dust, steam, outlines
//
// Live: the time of day and season follow the clock in Anchorage (night /
// dusk / day, snow Nov-Apr, the stove lit Sep-May), the clock shows the
// real time and the moon its real phase. Extra words force them, e.g.
// `logout night` or `logout dusk summer`.
//
// The objects in the room are hotspots: hover (or arrow keys) outlines one
// and names it. The terminal sits you back down and the string lights
// change color; the rest are where other parts of the site will open from.
//
// Sound (m, -/+ volume) is synthesized here: room tone, CRT whine, wind,
// the stove, the clock, a chair creak and footsteps. Off by default.
//
// Uses globals from index.html: modes, exitMode, terminal, terminalTitle,
// clamp, isCoarsePointer, MONO_STACK.

(() => {
    const W = 480;
    const H = 270;
    // The eye looks straight at the back wall; everything recedes to VP.
    const VP = { x: 240, y: 90 };
    const WALL = { l: 80, r: 400, t: 20, b: 196 };
    const FLOOR_DY = WALL.b - VP.y;
    // Window opening on the back wall (the glass, inside the frame).
    const WIN = { x0: 306, x1: 374, y0: 52, y1: 118 };
    // The CRT's screen, in room pixels. 4:3, like the terminal on desktop.
    const MON = { x: 218, y: 105, w: 44, h: 33 };
    const MONC = { x: MON.x + MON.w / 2, y: MON.y + MON.h / 2 };
    // Depths as scale factors (1 = back wall, bigger = nearer).
    const MON_DEPTH = 1.12;
    const CHAIR_DEPTH = 1.45;

    const STAND_SECONDS = 3.0;
    const SIT_SECONDS = 2.3;
    const PAUSE = 0.3; // pushing the chair back before the camera moves
    const LOOK_ZOOM = 1.06; // a little slack so the view can look around

    const TZ = "America/Anchorage";
    // Approximate Anchorage sunrise / sunset by month (same as biglake).
    const SUN = [
        [10.1, 15.9], [8.9, 17.4], [7.5, 18.9], [7.0, 20.9],
        [5.4, 22.4], [4.4, 23.7], [4.9, 23.2], [6.2, 21.6],
        [7.6, 20.1], [8.9, 18.5], [9.4, 16.4], [10.2, 15.7],
    ];

    const SOUND_PREF = "cabin-sound"; // "on" | "off"; also read by `logout`
    const VOLUME_PREF = "cabin-volume";

    // Surface kinds for the per-pixel pass.
    const BACK = 1, SIDE = 2, FLOOR = 3, CEIL = 4, OUTSIDE = 5;

    // Outside the window and the light in the room, by time of day.
    const PHASES = {
        night: {
            sky: ["#01030a", "#060d22", "#13223f"],
            mountain: "#24314f", mountainDark: "#121b33",
            snow: "#8c9cbc", snowShade: "#4a5878",
            lake: ["#0b1a33", "#030812"], ice: "#3c4a66",
            ground: "#080a0c", groundSnow: "#56658a",
            tree: "#03080a", star: "#e8eeff",
            ambient: [0.13, 0.14, 0.22],
            win: [0.35, 0.45, 0.85], winK: 0.14,
            lamp: 1.05, crt: 0.34, stove: 0.9, lantern: 0.8, string: 1,
        },
        dusk: {
            sky: ["#151b4e", "#4c357c", "#f09a6e"],
            mountain: "#5a4882", mountainDark: "#352a58",
            snow: "#ffd9c8", snowShade: "#b48aa8",
            lake: ["#6a4a78", "#1c1a3c"], ice: "#b896b8",
            ground: "#120d18", groundSnow: "#a888a8",
            tree: "#120d1e", star: "#f6e9ff",
            ambient: [0.36, 0.29, 0.37],
            win: [1.0, 0.62, 0.58], winK: 0.38,
            lamp: 0.8, crt: 0.18, stove: 0.55, lantern: 0.5, string: 0.8,
        },
        day: {
            sky: ["#2a5b98", "#6c9ace", "#cfe0ee"],
            mountain: "#8195b2", mountainDark: "#56688a",
            snow: "#fbfdff", snowShade: "#bccbe0",
            lake: ["#6a96c2", "#2c5078"], ice: "#d6e2ee",
            ground: "#3d5a3a", groundSnow: "#e8eef6",
            tree: "#14281b", star: null,
            ambient: [0.62, 0.61, 0.64],
            win: [0.85, 0.92, 1.0], winK: 0.55,
            lamp: 0.22, crt: 0.06, stove: 0.22, lantern: 0, string: 0.3,
            sun: true,
        },
    };

    const LAMP = { x: 294, y: 132, r: 125, c: [1.0, 0.72, 0.42] };
    const CRT = { x: MONC.x, y: MONC.y + 6, r: 52, c: [0.3, 1.0, 0.55] };
    const STOVE = { x: 426, y: 200, r: 100, c: [1.0, 0.48, 0.2] };
    const WINLIGHT = { x: 340, y: 100, r: 175 };
    // a hurricane lantern hanging by the door, lit after dark
    const LANTERN = { x: 68, y: 104, r: 80, c: [1.0, 0.68, 0.38] };

    // Hotspots, left to right (arrow keys step through them in this order).
    // `say` is what clicking shows; only the terminal acts for now.
    const SPOTS = [
        { id: 1, name: "door", label: "the door", say: "it's latched. something's being hung on the other side." },
        { id: 2, name: "shelf", label: "the bookshelf", say: "field guides, manuals, a few dog-eared paperbacks. not open yet." },
        { id: 3, name: "clock", label: () => `the clock · ${s.clock.label}`, say: () => `${s.clock.label} in alaska. it keeps good time.` },
        { id: 4, name: "terminal", label: "the terminal · sit back down", act: () => sitDown() },
        { id: 5, name: "window", label: "the window", say: () => (s.winter ? "big lake, frozen over." : "big lake's out there.") },
        { id: 6, name: "stove", label: "the woodstove", say: () => (s.stoveLit ? "warm. it'll keep till morning." : "cold. it's summer.") },
        { id: 7, name: "lights", label: () => `the string lights · ${lightsSetting()}`, act: () => cycleLights() },
    ];
    const SPOT = Object.fromEntries(SPOTS.map((h) => [h.name, h.id]));

    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

    let s = null; // scene state while the mode is running
    let lastLogout = null; // for the "last login" line when you sit back down

    // --- small utilities ------------------------------------------------

    function hash(x, y, z = 0) {
        let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1442695041)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    }

    function noise(x, y, seed = 0) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed);
        const c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }

    const smoothstep = (e0, e1, x) => {
        const t = clamp((x - e0) / (e1 - e0), 0, 1);
        return t * t * (3 - 2 * t);
    };
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const lerp = (a, b, t) => a + (b - a) * t;
    const frac = (x) => x - Math.floor(x);

    function rgb(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
    const css = (c, a = 1) =>
        a === 1
            ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
            : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

    function makeCanvas(w = W, h = H) {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        return c;
    }

    // A point at back-wall coordinates (xb, yb), pulled toward the viewer
    // to depth `sc` (1 = on the back wall).
    function P(xb, yb, sc) {
        return [VP.x + (xb - VP.x) * sc, VP.y + (yb - VP.y) * sc];
    }

    function rect(g, x, y, w, h, color) {
        g.fillStyle = color;
        g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    }

    function px(g, x, y, color) {
        g.fillStyle = color;
        g.fillRect(x, y, 1, 1);
    }

    // Convex polygon, filled by whole pixel rows so the edges stay crisp
    // (canvas paths antialias).
    function fillPoly(g, pts, color) {
        g.fillStyle = color;
        let minY = Infinity, maxY = -Infinity;
        for (const [, y] of pts) {
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
        for (let y = Math.floor(minY); y < Math.ceil(maxY); y++) {
            const cy = y + 0.5;
            let x0 = Infinity, x1 = -Infinity;
            for (let i = 0; i < pts.length; i++) {
                const [ax, ay] = pts[i];
                const [bx, by] = pts[(i + 1) % pts.length];
                if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
                    const x = ax + ((cy - ay) / (by - ay)) * (bx - ax);
                    x0 = Math.min(x0, x);
                    x1 = Math.max(x1, x);
                }
            }
            const a = Math.round(x0), b = Math.round(x1);
            if (b > a) g.fillRect(a, y, b - a, 1);
        }
    }

    // A box standing in the room: x0..x1, y0..y1 in back-wall coordinates,
    // from depth s0 (back) to s1 (front). Draws whichever top and side face
    // the eye can see, then the front; returns the front face's rect.
    function box(g, b, c) {
        if (c.top && b.y0 > VP.y)
            fillPoly(g, [P(b.x0, b.y0, b.s0), P(b.x1, b.y0, b.s0), P(b.x1, b.y0, b.s1), P(b.x0, b.y0, b.s1)], c.top);
        if (c.side && b.x1 < VP.x)
            fillPoly(g, [P(b.x1, b.y0, b.s1), P(b.x1, b.y0, b.s0), P(b.x1, b.y1, b.s0), P(b.x1, b.y1, b.s1)], c.side);
        if (c.side && b.x0 > VP.x)
            fillPoly(g, [P(b.x0, b.y0, b.s1), P(b.x0, b.y0, b.s0), P(b.x0, b.y1, b.s0), P(b.x0, b.y1, b.s1)], c.side);
        const [x0, y0] = P(b.x0, b.y0, b.s1);
        const [x1, y1] = P(b.x1, b.y1, b.s1);
        const r = { x: Math.round(x0), y: Math.round(y0) };
        r.w = Math.round(x1) - r.x;
        r.h = Math.round(y1) - r.y;
        if (c.front) rect(g, r.x, r.y, r.w, r.h, c.front);
        return r;
    }

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

    // --- Anchorage clock ------------------------------------------------

    let clockFormat = null, labelFormat = null;
    function anchorageNow() {
        clockFormat ||= new Intl.DateTimeFormat("en-US", {
            timeZone: TZ, month: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
        });
        labelFormat ||= new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
        const now = new Date();
        const parts = {};
        for (const p of clockFormat.formatToParts(now)) parts[p.type] = Number(p.value);
        const label = labelFormat.format(now).toLowerCase();
        return {
            month: parts.month - 1,
            hour: parts.hour + parts.minute / 60,
            minute: parts.minute + parts.second / 60,
            second: parts.second,
            label,
        };
    }

    function skyPhase({ month, hour }) {
        const [rise, set] = SUN[month];
        if (hour >= rise + 1 && hour <= set - 1) return "day";
        if ((hour > rise - 1.5 && hour < rise + 1) || (hour > set - 1 && hour < set + 1.5)) return "dusk";
        // May-July never get properly dark: it's dusk all night.
        return month >= 4 && month <= 6 ? "dusk" : "night";
    }

    // Recompute the clock and what depends on it. True when the room
    // needs repainting (time of day or season changed).
    function updateClock() {
        s.clock = anchorageNow();
        const m = s.clock.month;
        const phase = s.forcedPhase || skyPhase(s.clock);
        const winter = s.forcedSeason ? s.forcedSeason === "winter" : m >= 10 || m <= 3;
        const stoveLit = s.forcedSeason ? winter : !(m >= 5 && m <= 7);
        const changed = phase !== s.phase || winter !== s.winter || stoveLit !== s.stoveLit;
        s.phase = phase;
        s.winter = winter;
        s.stoveLit = stoveLit;
        return changed;
    }

    // Days into the 29.53-day lunar cycle -> lit fraction and side.
    function moonPhase() {
        const SYNODIC = 29.530588853;
        const days = (Date.now() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
        const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
        return (age / SYNODIC) * Math.PI * 2;
    }

    // --- surfaces, per pixel --------------------------------------------

    // Stacked logs with chinking. u runs along the log, yb is the height
    // on the back wall.
    function logs(u, yb, k) {
        const LOG = 16;
        const rel = yb - WALL.t;
        const i = Math.floor(rel / LOG);
        const v = (rel - i * LOG) / LOG;
        if (v < 0.1) {
            const n = 0.88 + 0.12 * hash(Math.floor(u), Math.floor(yb), 3);
            return mul([186, 170, 138], n * k);
        }
        const vv = (v - 0.1) / 0.9;
        const round = Math.sin(Math.PI * vv);
        let light = 0.6 + 0.4 * Math.pow(round, 0.55);
        if (vv > 0.78) light -= 0.14; // underside of the log
        const tone = 0.86 + 0.24 * hash(i, 7);
        const grain = 0.86 + 0.26 * noise(u * 0.07, yb * 0.8, i);
        let c = mul([160, 104, 58], light * tone * grain * k);
        // knots
        const kx = Math.floor(u / 52);
        const hk = hash(kx, i, 9);
        if (hk > 0.68) {
            const cxk = (kx + 0.25 + 0.5 * hash(kx, i, 10)) * 52;
            const du = (u - cxk) / 3.5, dv = (vv - 0.5) / 0.16;
            const r = du * du + dv * dv;
            if (r < 1) c = mul(c, r < 0.35 ? 0.55 : 0.78);
        }
        return c;
    }

    function wallPixel(cx, cy) {
        let c = logs(cx, cy, 1);
        // contact shadow along the floor and ceiling, and in the corners
        c = mul(c, 1 - 0.32 * smoothstep(WALL.b - 12, WALL.b, cy) - 0.25 * smoothstep(WALL.t + 6, WALL.t, cy));
        const edge = Math.min(cx - WALL.l, WALL.r - cx);
        if (edge < 4) c = mul(c, 0.72 + 0.07 * edge);
        return c;
    }

    // Left wall: logs, and the door. z = 1 / scale: 1 at the back corner,
    // smaller toward the viewer.
    function leftWall(p, cx, z, yb, ids) {
        const D0 = 0.74, D1 = 0.88, TOP = 70;
        const trim = (z > D0 - 0.012 && z < D1 + 0.012 && yb > TOP - 4) && !(z >= D0 && z <= D1 && yb >= TOP);
        if (trim) {
            ids[p] = SPOT.door;
            const lit = z < D0 || yb < TOP - 2 ? 1 : 0.8;
            return mul([104, 68, 40], lit * 0.82);
        }
        if (z >= D0 && z <= D1 && yb >= TOP) {
            ids[p] = SPOT.door;
            const u = (z - D0) / (D1 - D0); // 0 hinge side (near) .. 1 latch side
            const v = (yb - TOP) / (WALL.b - TOP);
            const board = Math.floor(u * 5);
            const fu = u * 5 - board;
            let c = mul([146, 96, 56], (0.88 + 0.18 * hash(board, 4)) * (0.88 + 0.22 * noise(board * 9, yb * 0.35, 4)));
            if (fu < 0.07) c = mul(c, 0.55);
            const batten = (v > 0.12 && v < 0.19) || (v > 0.8 && v < 0.87);
            const braceU = 0.06 + ((0.8 - v) / 0.61) * 0.86;
            if (batten) c = mul([164, 110, 66], v % 0.5 < 0.14 ? 1 : 0.9);
            else if (v > 0.19 && v < 0.8 && Math.abs(u - braceU) < 0.07) c = mul([158, 106, 62], 0.95);
            if ((v > 0.19 && v < 0.2) || (v > 0.87 && v < 0.88)) c = mul(c, 0.6); // batten shadow
            if (batten && u < 0.34 && Math.abs(v % 0.68 - 0.155) < 0.014) c = [44, 40, 38]; // hinge straps
            if (u > 0.8 && u < 0.9 && v > 0.5 && v < 0.53) c = [34, 32, 30]; // latch bar
            if (u > 0.84 && u < 0.88 && v > 0.53 && v < 0.6) c = [52, 48, 44]; // latch handle
            return mul(c, 0.95);
        }
        return logs(z * 320, yb, 0.8);
    }

    // Right wall: logs, and a stone heat shield behind the stove.
    function rightWall(z, yb) {
        if (z > 0.7 && z < 0.86 && yb > 96) {
            const row = Math.floor((yb - 96) / 7);
            const fv = (yb - 96) / 7 - row;
            const col = z * 70 + (row & 1) * 0.5;
            const fc = frac(col);
            if (fv < 0.16 || fc < 0.09) return [70, 64, 58];
            const t = 0.78 + 0.34 * hash(Math.floor(col), row, 5);
            return mul([132, 120, 106], t * 0.76 * (0.9 + 0.1 * fv));
        }
        return logs(z * 320, yb, 0.74);
    }

    function floorPixel(cx, cy) {
        const sc = (cy - VP.y) / FLOOR_DY;
        const xb = VP.x + (cx - VP.x) / sc;
        const z = 1 / sc;
        const pxPerZ = 1 / (sc * sc * FLOOR_DY); // depth covered by one screen row
        let c;
        // stone hearth under the stove
        if (xb > 352 && xb < 402 && z > 0.69 && z < 0.85) {
            const tx = (xb - 352) / 12.5, tz = (z - 0.69) / 0.04;
            const seam = frac(tx) < 0.08 * sc || frac(tz) < pxPerZ / 0.04 * 1.2;
            c = seam ? [58, 54, 50] : mul([112, 104, 96], 0.85 + 0.25 * hash(Math.floor(tx), Math.floor(tz), 6));
        } else {
            const PW = 18;
            const j = Math.floor(xb / PW);
            const fx = xb - j * PW;
            const seg = z * 5 + hash(j, 3);
            const end = frac(seg) < (pxPerZ * 5) * 1.1;
            c = mul([124, 82, 50], (0.84 + 0.26 * hash(j, Math.floor(seg), 2)) * (0.86 + 0.24 * noise(xb * 0.35, z * 140, j)));
            if (fx < 1 / sc || end) c = mul(c, 0.5);
            // braided rug
            const dx = (xb - 232) / 62, dz = ((z - 0.74) * 288) / 36;
            const r = Math.sqrt(dx * dx + dz * dz);
            if (r < 1) {
                const RUG = [[104, 40, 34], [140, 112, 80], [56, 66, 50], [118, 52, 38], [52, 54, 68], [128, 102, 74], [96, 36, 30]];
                const ring = Math.floor(r * 6.99);
                const ang = Math.atan2(dz, dx);
                const braid = 0.84 + 0.22 * hash(Math.floor((ang + 4) * (12 + ring * 6)), ring, 8);
                c = mul(RUG[ring], braid * (frac(r * 6.99) < 0.12 ? 0.75 : 1));
            }
        }
        // soft contact shadows under the furniture
        let sh = 1;
        sh -= 0.45 * smoothstep(0.82, 0.86, z) * smoothstep(164, 172, xb) * smoothstep(318, 310, xb); // desk
        sh -= 0.4 * smoothstep(0.92, 0.95, z) * smoothstep(86, 92, xb) * smoothstep(150, 144, xb); // shelf
        sh -= 0.45 * smoothstep(0.72, 0.74, z) * smoothstep(0.83, 0.81, z) * smoothstep(358, 364, xb) * smoothstep(396, 390, xb); // stove
        sh -= 0.4 * smoothstep(0.74, 0.76, z) * smoothstep(0.83, 0.81, z) * smoothstep(322, 328, xb) * smoothstep(352, 346, xb); // firewood
        const cdx = (xb - 226) / 26, cdz = ((z - 0.69) * 288) / 16;
        sh -= 0.4 * smoothstep(1, 0.4, cdx * cdx + cdz * cdz); // chair
        sh -= 0.25 * smoothstep(0.97, 1, z); // along the wall
        return mul(c, sh);
    }

    function ceilingPixel(cx, cy) {
        const sc = (VP.y - cy) / (VP.y - WALL.t);
        const xb = VP.x + (cx - VP.x) / sc;
        const z = 1 / sc;
        if (z > 0.8 && z < 0.86) return mul([74, 48, 30], frac(z * 50) < 0.2 ? 0.8 : 1); // beam
        const j = Math.floor(xb / 22);
        let c = mul([100, 66, 40], 0.84 + 0.22 * hash(j, 11));
        if (xb - j * 22 < 1 / sc) c = mul(c, 0.6);
        return mul(c, 0.72);
    }

    // The view out the window: sky, mountains across Big Lake, spruce.
    function outsidePixel(cx, cy) {
        const ph = PHASES[s.phase];
        const u = (cx - WIN.x0) / (WIN.x1 - WIN.x0);
        const v = (cy - WIN.y0) / (WIN.y1 - WIN.y0);
        const HZ = 0.56;
        const sky = ph.sky.map(rgb);
        let c;
        if (v < HZ) {
            const g = v / HZ;
            c = g < 0.6 ? mix(sky[0], sky[1], g / 0.6) : mix(sky[1], sky[2], (g - 0.6) / 0.4);
            if (ph.star && v < 0.42 && hash(Math.floor(cx), Math.floor(cy), 11) > 0.972)
                c = mix(c, rgb(ph.star), 0.4 + 0.5 * hash(Math.floor(cx), Math.floor(cy), 12));
            if (s.phase !== "day") {
                // the moon in its real phase: waxing lit from the right
                const R2 = 12.5;
                const mx = cx - (WIN.x0 + 0.74 * 68), my = cy - (WIN.y0 + 0.2 * 66);
                if (mx * mx + my * my < R2) {
                    const a = moonPhase();
                    const hw = Math.sqrt(R2 - my * my) * Math.cos(a);
                    const lit = Math.sin(a) > 0 ? mx > hw : mx < -hw;
                    c = lit ? [236, 232, 210] : mix(c, [60, 64, 80], 0.35);
                }
            }
        } else if (v < 0.75) {
            // the lake (frozen in winter)
            const lt = (v - HZ) / (0.75 - HZ);
            if (s.winter) c = mul(rgb(ph.ice), 0.92 + 0.12 * noise(cx * 0.2, cy, 14));
            else {
                c = mix(rgb(ph.lake[0]), rgb(ph.lake[1]), lt);
                if (hash(Math.floor(cx / 3), Math.floor(cy), 15) > 0.86) c = mix(c, rgb(ph.sky[2]), 0.35);
            }
        } else {
            c = s.winter ? mul(rgb(ph.groundSnow), 0.9 + 0.1 * noise(cx * 0.3, cy * 0.3, 16)) : rgb(ph.ground);
        }
        // mountains across the lake
        const ridge = HZ - (0.1 + 0.15 * noise(u * 3.2, 0, 5) + 0.05 * noise(u * 11, 0, 6));
        if (v >= ridge && v < HZ) {
            const slope = noise((u + 0.01) * 3.2, 0, 5) - noise(u * 3.2, 0, 5);
            c = rgb(slope > 0 ? ph.mountain : ph.mountainDark);
            const snowLine = ridge + (s.winter ? 0.09 : 0.035) + 0.025 * noise(u * 22, 0, 7);
            if (v < snowLine) c = rgb(slope > 0 ? ph.snow : ph.snowShade);
        }
        // far shore treeline
        if (v < HZ + 0.02 && v > HZ - 0.012 + 0.02 * hash(Math.floor(cx), 3, 13) && hash(Math.floor(cx), 2, 13) > 0.25)
            c = rgb(ph.tree);
        // spruce on the near shore
        const TREES = [[0.06, 0.5, 0.075], [0.17, 0.33, 0.05], [0.27, 0.16, 0.025], [0.58, 0.12, 0.02], [0.84, 0.56, 0.085], [0.96, 0.4, 0.06]];
        for (const [tu, th, tw] of TREES) {
            const base = 0.97, top = base - th;
            if (v < top || v > base) continue;
            const along = (v - top) / th;
            const tier = frac(along * (4 + th * 10));
            const half = tw * along * (0.62 + 0.38 * tier) + 0.008;
            if (Math.abs(u - tu) < half) {
                c = rgb(ph.tree);
                if (s.winter && tier < 0.22 && along > 0.05) c = mix(rgb(ph.groundSnow), c, 0.25);
            }
        }
        return c;
    }

    function paintSurfaces(d, surf, ids) {
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const p = y * W + x;
                const cx = x + 0.5, cy = y + 0.5;
                let c, kind;
                if (cx >= WALL.l && cx < WALL.r && cy >= WALL.t && cy < WALL.b) {
                    if (cx >= WIN.x0 && cx < WIN.x1 && cy >= WIN.y0 && cy < WIN.y1) {
                        c = outsidePixel(cx, cy);
                        kind = OUTSIDE;
                        ids[p] = SPOT.window;
                    } else {
                        c = wallPixel(cx, cy);
                        kind = BACK;
                    }
                } else {
                    const side = cx < VP.x ? (VP.x - cx) / (VP.x - WALL.l) : (cx - VP.x) / (WALL.r - VP.x);
                    const yb = VP.y + (cy - VP.y) / side;
                    if (side > 1 && yb >= WALL.t && yb < WALL.b) {
                        const z = 1 / side;
                        c = cx < VP.x ? leftWall(p, cx, z, yb, ids) : rightWall(z, yb);
                        // darker where the wall meets the floor and the back corner
                        c = mul(c, (1 - 0.3 * smoothstep(WALL.b - 10, WALL.b, yb)) * (1 - 0.2 * smoothstep(0.96, 1, z)));
                        kind = SIDE;
                    } else if (cy > VP.y) {
                        c = floorPixel(cx, cy);
                        kind = FLOOR;
                    } else {
                        c = ceilingPixel(cx, cy);
                        kind = CEIL;
                    }
                }
                const i = p * 4;
                d[i] = c[0];
                d[i + 1] = c[1];
                d[i + 2] = c[2];
                d[i + 3] = 255;
                surf[p] = kind;
            }
        }
    }

    // --- objects ----------------------------------------------------------

    function paintPicture(g) {
        // a small framed photo above the desk: mountains over a lake
        rect(g, 226, 34, 28, 22, "#3e2a1c");
        rect(g, 226, 34, 28, 1, "#5a3e28");
        rect(g, 228, 36, 24, 18, "#d8ccb0");
        for (let y = 38; y < 52; y++) {
            for (let x = 230; x < 250; x++) {
                const v = (y - 38) / 14;
                const ridge = 0.5 - 0.3 * (1 - Math.abs((x - 238) / 9));
                let c = v < 0.55 ? mix([120, 160, 200], [200, 214, 226], v / 0.55) : [70, 104, 140];
                if (v >= ridge && v < 0.56) c = v < ridge + 0.12 ? [240, 244, 248] : [96, 110, 136];
                if (v > 0.84) c = [40, 52, 40];
                px(g, x, y, css(c));
            }
        }
    }

    function paintClock(g) {
        // regulator clock: round face over a pendulum case
        rect(g, 171, 50, 18, 43, "#5e3b22");
        rect(g, 174, 47, 12, 3, "#5e3b22");
        rect(g, 176, 46, 8, 1, "#6e4628");
        rect(g, 171, 50, 1, 43, "#74492a");
        rect(g, 188, 50, 1, 43, "#432a18");
        rect(g, 171, 92, 18, 1, "#3a2414");
        rect(g, 174, 72, 12, 18, "#1c140e"); // pendulum window
        rect(g, 174, 72, 12, 1, "#a68a4a");
        for (let y = 51; y < 70; y++) {
            for (let x = 171; x < 189; x++) {
                const dx = x + 0.5 - 180, dy = y + 0.5 - 60.5;
                const r = Math.sqrt(dx * dx + dy * dy);
                if (r < 8.5) px(g, x, y, r > 7.4 ? (dy < 0 ? "#c8a858" : "#8a6c34") : "#e2d6b6");
            }
        }
        for (const [x, y] of [[180, 54], [186, 60], [180, 67], [173, 60]]) px(g, x, y, "#3a3028");
    }

    function paintWindow(g) {
        // frame, mullions, sill
        const F = "#6a4428";
        rect(g, 302, 48, 76, 4, F);
        rect(g, 302, 118, 76, 2, F);
        rect(g, 302, 48, 4, 72, F);
        rect(g, 374, 48, 4, 72, F);
        rect(g, 302, 48, 76, 1, "#86593a");
        rect(g, 339, 52, 2, 66, F);
        rect(g, 306, 84, 68, 2, F);
        rect(g, 306, 52, 68, 1, "#3e2818"); // shadow under the head
        box(g, { x0: 298, x1: 382, y0: 120, y1: 124, s0: 1, s1: 1.05 }, { top: "#94643c", front: "#6e4628" });
        // curtain rod and buffalo-check curtains
        rect(g, 293, 44, 94, 2, "#2a2624");
        rect(g, 292, 43, 2, 4, "#3a3430");
        rect(g, 386, 43, 2, 4, "#3a3430");
        for (const [x0, x1] of [[295, 312], [368, 385]]) {
            for (let y = 46; y < 128; y++) {
                const tie = y > 92 && y < 98; // tie-back
                for (let x = x0; x < x1; x++) {
                    const inner = x0 < 340 ? x1 - x : x - x0; // distance from the window edge
                    if (y > 92 && inner < (y < 98 ? 4 : 3 - (y - 98) * 0.02)) continue;
                    const cell = (Math.floor(x / 3) & 1) + (Math.floor((y + 1) / 3) & 1);
                    let c = cell === 0 ? [158, 36, 32] : cell === 1 ? [92, 24, 22] : [34, 20, 20];
                    c = mul(c, 0.8 + 0.25 * (0.5 + 0.5 * Math.sin(x * 1.4)));
                    if (tie) c = [196, 176, 134];
                    px(g, x, y, css(c));
                }
            }
        }
    }

    function paintShelf(g) {
        const b = { x0: 90, x1: 146, y0: 70, y1: WALL.b, s0: 1, s1: 1.07 };
        const f = box(g, b, { side: "#4a2e1a", front: "#6a4428" });
        const inX = f.x + 3, inW = f.w - 6;
        rect(g, inX, f.y + 3, inW, f.h - 9, "#2c1c12"); // back of the shelf
        const shelves = 4;
        const inner = (f.h - 9) / shelves;
        for (let i = 0; i < shelves; i++) {
            const top = Math.round(f.y + 3 + i * inner);
            const bottom = Math.round(f.y + 3 + (i + 1) * inner) - 2;
            rect(g, inX, bottom, inW, 2, "#7a5030");
            rect(g, inX, bottom, inW, 1, "#8e6038");
            rect(g, inX, top, inW, 1, "#1c120a");
            // books
            let x = inX + 1;
            let k = 0;
            const COLORS = ["#6b2e2a", "#2f4a5a", "#a0803a", "#3c5a3a", "#5a3a5a", "#c9b98f", "#8a4a2a", "#24384a", "#7a6a4a"];
            while (x < inX + inW - 2) {
                const h1 = hash(i, k, 21), h2 = hash(i, k, 22), h3 = hash(i, k, 23);
                k++;
                if (h3 < 0.08) {
                    x += 3; // a gap
                    continue;
                }
                const w = 2 + Math.floor(h1 * 3);
                const hb = Math.round((bottom - top - 2) * (0.62 + 0.36 * h2));
                if (x + w > inX + inW - 1) break;
                const col = COLORS[Math.floor(h3 * COLORS.length)];
                rect(g, x, bottom - hb, w, hb, col);
                rect(g, x, bottom - hb + 2, w, 1, "rgba(230,210,160,0.35)");
                rect(g, x + w - 1, bottom - hb, 1, hb, "rgba(0,0,0,0.25)");
                x += w;
            }
            if (i === 2) {
                // a lantern on the third shelf
                const lx = inX + inW - 8;
                rect(g, lx, bottom - 12, 6, 12, "#2c1c12");
                rect(g, lx + 1, bottom - 10, 4, 6, "#8a7a5a");
                rect(g, lx, bottom - 11, 6, 1, "#3a3a36");
                rect(g, lx, bottom - 3, 6, 3, "#5a2a1e");
                rect(g, lx + 2, bottom - 14, 2, 2, "#3a3a36");
            }
        }
        rect(g, f.x, f.y + f.h - 6, f.w, 6, "#5a3820"); // kick board
        rect(g, f.x, f.y, f.w, 1, "#86593a");
        // a pothos on top, trailing down the side
        const LEAF = [
            ["#1e3e20", "#2a5428", "#3a6a34"], // back, in shadow
            ["#2c5a2a", "#3f7a3a", "#5a9a48"],
            ["#3a7236", "#52904a", "#7ab85a"], // front, catching the light
        ];
        // a heart-ish leaf: 3 wide, 3 tall, tip pointing dir (-1 left, 1 right)
        const leaf = (x, y, dir, tone) => {
            const [d, m, l] = LEAF[tone];
            rect(g, x, y, 3, 2, m);
            px(g, x + 1, y + 2, m);
            px(g, dir > 0 ? x + 3 : x - 1, y + 1, d); // tip
            px(g, x + 1, y, l); // shine along the midrib
            px(g, x + (dir > 0 ? 0 : 2), y + 1, d);
        };
        const px0 = f.x + 5, potW = 14; // pot
        const potTop = f.y - 10;
        // foliage behind the pot rim
        for (let i = 0; i < 22; i++) {
            const a = hash(i, 1, 31) * Math.PI;
            const r = 0.35 + 0.65 * Math.sqrt(hash(i, 2, 31));
            const lx = Math.round(px0 + potW / 2 - 1 + Math.cos(a) * 12 * r);
            const ly = Math.round(potTop - 3 - Math.sin(a) * 10 * r);
            leaf(lx, ly, Math.cos(a) < 0 ? -1 : 1, r > 0.8 ? 0 : hash(i, 3, 31) < 0.5 ? 0 : 1);
        }
        for (let i = 0; i < 14; i++) {
            const a = 0.15 + hash(i, 4, 31) * (Math.PI - 0.3);
            const r = 0.2 + 0.6 * hash(i, 5, 31);
            const lx = Math.round(px0 + potW / 2 - 1 + Math.cos(a) * 10 * r);
            const ly = Math.round(potTop - 2 - Math.sin(a) * 8 * r);
            leaf(lx, ly, Math.cos(a) < 0 ? -1 : 1, hash(i, 6, 31) < 0.6 ? 2 : 1);
        }
        // terracotta pot, slightly tapered, lit from the left
        for (let y = 0; y < 10; y++) {
            const inset = y < 3 ? 0 : 1 + Math.floor((y - 3) / 4);
            for (let x = inset; x < potW - inset; x++) {
                const t = (x - inset) / (potW - 2 * inset - 1);
                let c = t < 0.25 ? "#c06a3e" : t < 0.75 ? "#a4542e" : "#7e3e22";
                if (y < 3) c = y === 0 ? "#d07a48" : t < 0.25 ? "#b86438" : t < 0.8 ? "#9a4c2a" : "#743820";
                if (y === 3) c = "#5e2e1a"; // shadow under the rim
                px(g, px0 + x, potTop + y, c);
            }
        }
        rect(g, px0 + 1, potTop - 1, potW - 2, 1, "#2a1a10"); // soil
        // a few leaves spilling over the rim in front
        leaf(px0 - 2, potTop - 1, -1, 2);
        leaf(px0 + potW - 1, potTop, 1, 1);
        leaf(px0 + 5, potTop - 2, 1, 2);
        // vines: every stem is drawn as a connected line from where it leaves the plant
        const STEM = "#2c5a2a";
        const line = (x0, y0, x1, y1) => {
            const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
            for (let i = 0; i <= n; i++) {
                const t = n ? i / n : 0;
                px(g, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), STEM);
            }
        };
        // hangs down from `from`, swaying as it goes
        const vine = (from, n, sway, phase) => {
            let [qx, qy] = from;
            const x0 = qx;
            for (let i = 1; i <= n; i++) {
                const ly = from[1] + i * 2;
                const lx = x0 + Math.round(Math.sin(i * 0.55 + phase) * sway);
                line(qx, qy, lx, ly);
                if (i % 3 === 1) leaf(i % 2 ? lx + 1 : lx - 3, ly - 1, i % 2 ? 1 : -1, i % 4 === 1 ? 2 : 1);
                [qx, qy] = [lx, ly];
            }
        };
        // a runner along the shelf top from the pot to the right edge; vines drop from it
        const runY = (x) => f.y - 1 - Math.round(Math.abs(Math.sin((x - px0) * 0.25)) * 1);
        const rx0 = px0 + potW - 3, rx1 = f.x + f.w - 3;
        for (let x = rx0; x <= rx1; x++) {
            line(x - 1, runY(x - 1), x, runY(x));
            if ((x - rx0) % 5 === 3) leaf(x - 1, runY(x) - 3, 1, (x - rx0) % 10 === 3 ? 2 : 1);
        }
        vine([f.x + 2, potTop + 2], 30, 1.6, 0); // long trail down the left side
        line(px0, potTop + 2, f.x + 2, potTop + 2);
        vine([px0 + 1, f.y - 1], 14, 1.0, 2.1);
        vine([px0 + potW - 2, f.y - 1], 9, 1.2, 1.3);
        for (const [dx, n, sway, phase] of [[14, 18, 1.4, 0.6], [24, 7, 1.0, 3.0]]) {
            const x = Math.min(rx0 + dx, rx1);
            vine([x, runY(x)], n, sway, phase);
        }
        vine([rx1, runY(rx1)], 26, 1.3, 1.9); // down the right side
        // a few tendrils reaching up and out of the clump, rooted inside it
        const cx = px0 + Math.floor(potW / 2);
        for (const [sx, sy, ex, ey, dir] of [
            [cx - 3, potTop - 5, px0 - 8, potTop - 13, -1],
            [cx + 3, potTop - 5, px0 + potW + 6, potTop - 12, 1],
            [cx, potTop - 7, cx + 3, potTop - 18, 1],
        ]) {
            // a gentle arc: bow the midpoint upward
            const mx = Math.round((sx + ex) / 2), my = Math.round((sy + ey) / 2) - 3;
            line(sx, sy, mx, my);
            line(mx, my, ex, ey);
            // leaves alternating either side along the arc, brighter toward the tip
            for (const [t, side] of [[0.35, -1], [0.55, 1], [0.75, -1], [0.9, 1]]) {
                const [ax, ay, bx, by] = t < 0.5 ? [sx, sy, mx, my] : [mx, my, ex, ey];
                const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
                const lx = Math.round(ax + (bx - ax) * u), ly = Math.round(ay + (by - ay) * u);
                const d = side * dir;
                leaf(d > 0 ? lx + 1 : lx - 3, ly - 1, d, t < 0.6 ? 1 : 2);
            }
            leaf(dir > 0 ? ex : ex - 2, ey - 2, dir, 2);
        }
    }

    function paintDesk(g) {
        // pedestal with drawers on the left, a leg on the right
        const ped = box(g, { x0: 172, x1: 206, y0: 145, y1: WALL.b, s0: 1.02, s1: 1.17 }, { side: "#4a2c18", front: "#6e4528" });
        for (let i = 0; i < 3; i++) {
            const dy = ped.y + 2 + i * Math.floor((ped.h - 4) / 3);
            const dh = Math.floor((ped.h - 4) / 3) - 2;
            rect(g, ped.x + 2, dy, ped.w - 4, dh, "#7a4e2e");
            rect(g, ped.x + 2, dy, ped.w - 4, 1, "#8e5c36");
            rect(g, ped.x + 2, dy + dh - 1, ped.w - 4, 1, "#4e3018");
            rect(g, ped.x + Math.floor(ped.w / 2) - 2, dy + Math.floor(dh / 2) - 1, 4, 2, "#c8a050");
        }
        box(g, { x0: 304, x1: 310, y0: 145, y1: WALL.b, s0: 1.16, s1: 1.18 }, { side: "#4a2c18", front: "#5e3a20" });
        box(g, { x0: 304, x1: 310, y0: 145, y1: WALL.b, s0: 1.0, s1: 1.02 }, { front: "#3e2614" }); // back leg
        // top
        const top = box(g, { x0: 168, x1: 314, y0: 141, y1: 145, s0: 1, s1: 1.184 }, { top: "#8f5c35", front: "#6e4528", side: "#4a2c18" });
        rect(g, top.x, top.y, top.w, 1, "#a06a3e");
        rect(g, top.x, top.y + top.h, top.w, 1, "#3a2414");
    }

    function paintMonitor(g) {
        // beige CRT on a little stand
        rect(g, 226, 145, 28, 3, "#a89d80");
        rect(g, 230, 145, 20, 1, "#8f856c");
        rect(g, 208, 99, 64, 46, "#cfc4a6");
        rect(g, 208, 99, 64, 1, "#e6ddc4");
        rect(g, 208, 99, 1, 46, "#ded4b8");
        rect(g, 271, 99, 1, 46, "#a89d80");
        rect(g, 208, 144, 64, 1, "#9a8f74");
        rect(g, 210, 98, 60, 1, "#bdb294"); // the bulk behind, just visible
        rect(g, MON.x - 2, MON.y - 2, MON.w + 4, MON.h + 4, "#8f856c"); // recess
        rect(g, MON.x - 1, MON.y - 1, MON.w + 2, MON.h + 2, "#6e664f");
        rect(g, MON.x, MON.y, MON.w, MON.h, "#06120a");
        // badge, vents, power LED
        rect(g, 212, 140, 8, 2, "#8f856c");
        for (let x = 240; x < 258; x += 3) rect(g, x, 140, 2, 2, "#b0a589");
        rect(g, 264, 140, 3, 2, "#1a2a1a");
    }

    function paintDeskThings(g) {
        // papers, mug, keyboard, mouse, lamp
        fillPoly(g, [P(176, 141, 1.03), P(198, 141, 1.03), P(198, 141, 1.1), P(176, 141, 1.1)], "#d6cfbc");
        fillPoly(g, [P(178, 141, 1.05), P(200, 141, 1.05), P(200, 141, 1.13), P(178, 141, 1.13)], "#e4ddca");
        for (let i = 0; i < 3; i++) {
            const [lx, ly] = P(181, 141, 1.07 + i * 0.02);
            rect(g, lx, ly, 12 - i * 2, 1, "#9a948a");
        }
        // enamel camp mug
        rect(g, 189, 144, 8, 8, "#2f5a44");
        rect(g, 189, 144, 8, 1, "#e8e4d8");
        rect(g, 190, 145, 6, 1, "#1a2a20");
        rect(g, 197, 146, 2, 1, "#2f5a44");
        rect(g, 198, 146, 1, 3, "#2f5a44");
        rect(g, 197, 149, 2, 1, "#2f5a44");
        rect(g, 189, 151, 8, 1, "#1e3a2c");
        // keyboard
        const kb = box(g, { x0: 222, x1: 258, y0: 139.5, y1: 141, s0: 1.13, s1: 1.17 }, { top: "#c4b99c", front: "#9a8f74" });
        for (let x = kb.x + 1; x < kb.x + kb.w - 1; x += 2) {
            px(g, x, kb.y - 2, "#a89d80");
            px(g, x + 1, kb.y - 1, "#a89d80");
        }
        // mouse
        rect(g, 266, 150, 4, 3, "#c4b99c");
        rect(g, 266, 150, 4, 1, "#d8cfb4");
        // banker's lamp: brass base, stem, green shade
        rect(g, 288, 145, 13, 2, "#a07a30");
        rect(g, 289, 144, 11, 1, "#c89a40");
        rect(g, 294, 128, 2, 16, "#a07a30");
        fillPoly(g, [[287, 128], [303, 128], [300, 120], [290, 120]], "#2f5a3a");
        rect(g, 290, 120, 10, 1, "#4a8058");
        rect(g, 287, 127, 16, 1, "#1e3a26");
        rect(g, 300, 128, 1, 6, "#c89a40"); // pull chain
    }

    // A pile of firewood beside the stove (far enough left that the stove's
    // side doesn't cover it): rows of 4, 3, 2 and 1 on the floor, each log
    // resting in the gap between two below it, sizes and places a little
    // off. Some are birch (white bark), some split pieces with a flat face.
    //
    // Each log runs back toward the wall from FRONT to BACK depth. Its body
    // is swept from the back end to the front as shaded discs (lit on top,
    // dark underneath), lower rows first and right to left, so upper and
    // left logs cover the ones behind them the way you'd see a pile from
    // above and to its left; then the cut ends go on top.
    function paintFirewood(g) {
        const FRONT = 1.32, BACK = 1.24;
        const R = 4.3; // a typical log's radius on the front plane, px
        const [left] = P(321, 0, FRONT);
        const [, floor] = P(0, WALL.b, FRONT);
        const logs = [];
        [4, 3, 2, 1].forEach((count, row) => {
            for (let k = 0; k < count; k++) {
                const h = (z) => hash(row, k, z);
                const r = R * (0.84 + 0.3 * h(70));
                const angle = h(76) * Math.PI * 2;
                logs.push({
                    row, k, r,
                    cx: left + R + (k + row * 0.5) * 2 * R + (h(71) - 0.5) * 1.4,
                    cy: floor - r - row * R * 1.7 + (h(72) - 0.5) * 0.8,
                    birch: h(74) < 0.35,
                    // a split piece: a flat face across the round, at a random angle
                    split: h(75) < 0.3 ? [Math.cos(angle), Math.sin(angle)] : null,
                    crack: h(77) < 0.4 ? h(78) * Math.PI * 2 : null,
                });
            }
        });
        const inside = (L, nx, ny) => nx * nx + ny * ny <= 1 && (!L.split || nx * L.split[0] + ny * L.split[1] < 0.3);
        const disc = (L, cx, cy, r, color) => {
            for (let y = Math.floor(cy - r); y <= cy + r; y++) {
                for (let x = Math.floor(cx - r); x <= cx + r; x++) {
                    const nx = (x + 0.5 - cx) / r, ny = (y + 0.5 - cy) / r;
                    if (inside(L, nx, ny)) px(g, x, y, css(color(nx, ny, x, y)));
                }
            }
        };
        const barkColor = (L) => (nx, ny, x, y) => {
            let c = L.birch ? [196, 190, 176] : [96, 66, 42];
            if (L.split && nx * L.split[0] + ny * L.split[1] > 0.1) c = [150, 112, 70]; // the split face, bare wood
            else if (L.birch && hash(x, y, 79) > 0.82) c = [56, 48, 42]; // birch's dark marks
            else if (!L.birch && hash(x, y, 80) > 0.72) c = mul(c, 0.78); // rough bark
            const lit = 1.12 - 0.5 * (ny * 0.5 + 0.5); // lit from above
            return mul(c, nx * nx + ny * ny > 0.75 ? lit * 0.78 : lit);
        };
        const endColor = (L) => (nx, ny) => {
            const d = Math.hypot(nx, ny);
            const onCut = L.split && nx * L.split[0] + ny * L.split[1] > 0.12;
            if (d > 0.8 && !onCut) return L.birch ? [206, 200, 186] : [84, 58, 36]; // bark rim
            if (L.crack != null && d > 0.15) {
                const a = Math.atan2(ny, nx) - L.crack;
                if (Math.abs(Math.sin(a)) * d < 0.07 && Math.cos(a) > 0) return [96, 66, 40];
            }
            const wood = L.birch ? [214, 192, 152] : [196, 150, 96];
            return frac(d * 3.2 + L.k * 0.3) < 0.25 ? mul(wood, 0.8) : wood;
        };

        // bodies, back to front along each log
        const order = [...logs].sort((a, b) => a.row - b.row || b.k - a.k);
        for (const L of order) {
            const bx = VP.x + (L.cx - VP.x) / FRONT, by = VP.y + (L.cy - VP.y) / FRONT;
            const [ex, ey] = P(bx, by, BACK);
            const er = (L.r / FRONT) * BACK;
            const steps = Math.ceil(Math.hypot(L.cx - ex, L.cy - ey)) + 1;
            for (let i = 0; i < steps; i++) {
                const t = i / steps;
                disc(L, lerp(ex, L.cx, t), lerp(ey, L.cy, t), lerp(er, L.r, t), barkColor(L));
            }
        }
        // cut ends
        for (const L of logs) disc(L, L.cx, L.cy, L.r, endColor(L));
    }

    function paintStove(g) {
        // stovepipe up to the ceiling, then the body on legs, a kettle on top
        const pipe = box(g, { x0: 373, x1: 380, y0: -40, y1: 140, s0: 1.28, s1: 1.3 }, { front: "#2e2b29", side: "#22201e" });
        rect(g, pipe.x, pipe.y, 2, pipe.h, "#3e3a37");
        rect(g, pipe.x - 1, 96, pipe.w + 2, 2, "#3e3a37"); // damper collar
        rect(g, pipe.x + pipe.w, 97, 2, 1, "#5a5450");
        for (const x0 of [363, 388]) box(g, { x0, x1: x0 + 3, y0: 186, y1: WALL.b, s0: 1.33, s1: 1.36 }, { front: "#1e1c1a", side: "#161412" });
        box(g, { x0: 363, x1: 366, y0: 186, y1: WALL.b, s0: 1.22, s1: 1.25 }, { front: "#161412" });
        const f = box(g, { x0: 362, x1: 392, y0: 140, y1: 186, s0: 1.22, s1: 1.36 }, { top: "#4a4642", side: "#262321", front: "#2e2b29" });
        rect(g, f.x, f.y, f.w, 1, "#5a5450");
        rect(g, f.x, f.y + f.h - 2, f.w, 2, "#3a3633");
        // firebox door with its glass (the fire is drawn each frame)
        const d = { x: f.x + 6, y: f.y + 12, w: f.w - 12, h: f.h - 22 };
        rect(g, d.x - 1, d.y - 1, d.w + 2, d.h + 2, "#45413d");
        rect(g, d.x, d.y, d.w, d.h, "#140c08");
        rect(g, d.x + d.w + 1, d.y + Math.floor(d.h / 2) - 1, 3, 2, "#5a5450");
        s.fireGlass = { x: d.x + 1, y: d.y + 1, w: d.w - 2, h: d.h - 2 };
        rect(g, f.x + 4, f.y + 4, f.w - 8, 3, "#3a3633"); // ash lip
        // enamel kettle
        const [kx, ky] = P(368, 140, 1.3);
        rect(g, kx, ky - 7, 12, 7, "#3a5a8a");
        rect(g, kx + 1, ky - 8, 10, 1, "#3a5a8a");
        rect(g, kx + 1, ky - 7, 10, 1, "#5a7aaa");
        rect(g, kx + 12, ky - 6, 3, 1, "#3a5a8a");
        rect(g, kx + 14, ky - 7, 1, 1, "#3a5a8a");
        rect(g, kx + 3, ky - 11, 6, 1, "#2a2624");
        rect(g, kx + 2, ky - 10, 1, 2, "#2a2624");
        rect(g, kx + 9, ky - 10, 1, 2, "#2a2624");
        s.kettleSpout = [kx + 15, ky - 8];
    }

    function paintLantern(g) {
        // hook, bail, cap, glass globe, tank
        rect(g, 67, 92, 3, 1, "#2a2624");
        rect(g, 68, 93, 1, 2, "#2a2624");
        rect(g, 66, 95, 5, 1, "#3a3633");
        rect(g, 65, 96, 7, 2, "#4a4642");
        rect(g, 66, 98, 5, 7, "#6a5a40");
        rect(g, 65, 99, 1, 5, "#4a4642");
        rect(g, 71, 99, 1, 5, "#4a4642");
        rect(g, 64, 105, 9, 3, "#7a2a22");
        rect(g, 64, 105, 9, 1, "#9a3a2a");
    }

    // String lights, swagged along the top of the walls: in from behind you
    // on the left wall, across the back wall, and out along the right. The
    // wire and sockets are painted into the room (so the room's light falls
    // on them); the bulbs glow and twinkle each frame (drawStringLights).
    //
    // Their color is a setting: a name from CABIN_LIGHTS (index.html) or a
    // hex color, saved by clicking the lights (cycles the names) or by the
    // `lights` command at the terminal. Each bulb gets `c`: its glass color,
    // the hot core, the tint it casts on the room, and a halo sprite.
    const LIGHTS_PREF = "cabin-lights";
    const LIGHT_NAMES = () => (typeof CABIN_LIGHTS === "undefined" ? { pink: "#ff70ce" } : CABIN_LIGHTS);
    const bulbColors = new Map();

    function lightsSetting() {
        const v = readPref(LIGHTS_PREF, "pink");
        return Object.hasOwn(LIGHT_NAMES(), v) || /^#[0-9a-f]{6}$/i.test(v) ? v : "pink";
    }

    function bulbColor(hex) {
        if (!bulbColors.has(hex)) {
            const color = rgb(hex);
            const m = Math.max(color[0], color[1], color[2], 1);
            bulbColors.set(hex, {
                color,
                core: mix(color, [255, 255, 255], 0.7),
                light: color.map((c) => c / m),
                sprite: glowSprite(color),
            });
        }
        return bulbColors.get(hex);
    }

    function colorBulbs() {
        const v = lightsSetting();
        const cols = [].concat(LIGHT_NAMES()[v] ?? v).map(bulbColor);
        s.bulbs.forEach((b, i) => (b.c = cols[i % cols.length]));
    }

    // Click the lights: next color, with a flicker like the plug got jiggled.
    function cycleLights() {
        const names = Object.keys(LIGHT_NAMES());
        const next = names[(names.indexOf(lightsSetting()) + 1) % names.length];
        writePref(LIGHTS_PREF, next);
        s.lightsFlick = s.t;
        paintRoom(); // the bulbs tint the walls, which is baked into the room
        const hint = s.lightsHinted ? "" : " (type lights at the terminal for any color.)";
        s.lightsHinted = true;
        setStatus(`string lights · ${next}${hint}`, hint ? 4200 : 2200);
    }

    // Nails, as [xb, yb, sc] (see P): side-wall nails sit on WALL.l / WALL.r
    // at depth sc; back-wall nails at sc 1. Slightly uneven, hung by hand.
    function stringNails() {
        const n = [];
        for (const sc of [1.62, 1.38, 1.17]) n.push([WALL.l, 23 + hash(sc * 100, 1, 70) * 2, sc]);
        for (let x = WALL.l; x <= WALL.r; x += 40) n.push([x, 22 + hash(x, 2, 70) * 3, 1]);
        for (const sc of [1.15, 1.36, 1.6]) n.push([WALL.r, 23 + hash(sc * 100, 3, 70) * 2, sc]);
        return n;
    }

    function paintStringWire(g) {
        const nails = stringNails();
        const bulbs = [];
        for (let i = 0; i + 1 < nails.length; i++) {
            const [xa, ya, sa] = nails[i], [xb, yb, sb] = nails[i + 1];
            // depth is linear in 1/sc along a side wall; sag is in wall units
            const za = 1 / sa, zb = 1 / sb;
            // uneven, the way a string ends up after one try; the pair over
            // the picture stays above it, and the one over the curtains droops
            const sag = i === 10 ? 17 : i === 6 || i === 7 ? 6 + hash(i, 4, 70) * 2 : 6 + hash(i, 4, 70) * 7;
            const at = (t) => P(lerp(xa, xb, t), lerp(ya, yb, t) + sag * 4 * t * (1 - t), 1 / lerp(za, zb, t));
            const [x0, y0] = at(0), [x1, y1] = at(1);
            const len = Math.hypot(x1 - x0, y1 - y0) + sag;
            const steps = Math.ceil(len * 3);
            for (let k = 0; k <= steps; k++) {
                const [x, y] = at(k / steps);
                px(g, Math.floor(x), Math.floor(y), "#231c18");
            }
            px(g, Math.floor(x0), Math.floor(y0) - 1, "#4a4038"); // the nail
            // bulbs every ~9px along the swag, hanging from little sockets
            const nb = Math.max(2, Math.round(len / 9));
            for (let k = 0; k < nb; k++) {
                const t = (k + 0.5 + (hash(i, k, 71) - 0.5) * 0.3) / nb;
                const [x, y] = at(t);
                const sc = 1 / lerp(za, zb, t);
                const big = sc > 1.25;
                const bx = Math.floor(x) - (big ? 1 : 0), by = Math.floor(y) + 1;
                rect(g, bx, by, big ? 2 : 1, 1, "#1a1614");
                bulbs.push({ x: bx, y: by + 1, w: big ? 2 : 1, h: big ? 3 : 2, seed: hash(i, k, 72), dodgy: hash(i, k, 73) > 0.95 });
            }
        }
        s.bulbs = bulbs;
    }

    // A soft halo, drawn additively around each bulb.
    function glowSprite(color) {
        const c = makeCanvas(32, 32);
        const g = c.getContext("2d");
        const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
        gr.addColorStop(0, css(color, 0.75));
        gr.addColorStop(0.25, css(color, 0.28));
        gr.addColorStop(1, css(color, 0));
        g.fillStyle = gr;
        g.fillRect(0, 0, 32, 32);
        return c;
    }

    // The chair you just got up from: an oak swivel chair, pushed back and
    // turned aside, so it's in profile with its back to the right.
    function paintChair(g) {
        const Q = (xb, yb) => P(xb, yb, CHAIR_DEPTH);
        // base: legs out left and right, one toward you, casters
        const [lx, by] = Q(205, 192);
        const [rx] = Q(240, 192);
        const [cx] = Q(222, 192);
        rect(g, lx + 2, by - 1, rx - lx - 4, 2, "#2a2624");
        rect(g, lx + 2, by - 2, rx - lx - 4, 1, "#4a4642");
        rect(g, cx - 1, by - 1, 3, 4, "#2a2624");
        for (const x of [lx, rx - 3, cx - 1]) rect(g, x, by + 1 + (x === cx - 1 ? 2 : 0), 3, 3, "#141210");
        // post, and the tilt mechanism under the seat
        const [, py0] = Q(222, 167);
        rect(g, cx - 1, py0, 3, by - py0 - 1, "#3a3633");
        rect(g, cx - 1, py0, 1, by - py0 - 1, "#5a5450");
        rect(g, cx - 4, py0, 9, 3, "#2a2624");
        // seat: a thick oak slab, its top just visible from standing height
        const seat = box(g, { x0: 205, x1: 236, y0: 162, y1: 167, s0: 1.38, s1: 1.5 }, { top: "#a8763f", front: "#7a4e2a" });
        rect(g, seat.x, seat.y, seat.w, 1, "#b88a50");
        rect(g, seat.x, seat.y + seat.h - 1, seat.w, 1, "#4a2e18");
        // the back rises from the right end, leaning back a little, on an
        // iron down to the seat
        const [bx, bTop] = Q(233, 131);
        const [, bBot] = Q(233, 163);
        for (let y = Math.round(bTop); y < Math.round(bBot); y++) {
            const t = (y - bTop) / (bBot - bTop);
            const lean = Math.round((1 - t) * 3);
            if (t < 0.5) {
                rect(g, bx + lean, y, 8, 1, t < 0.05 ? "#b88048" : "#8a5a32");
                rect(g, bx + lean, y, 1, 1, "#a87642");
                rect(g, bx + lean + 7, y, 1, 1, "#5e3c22");
            } else rect(g, bx + lean + 2, y, 3, 1, "#2e2a26");
        }
        // an arm from the back toward the front, on a curved support
        const [ax0, ay] = Q(208, 152);
        const [ax1] = Q(235, 152);
        rect(g, ax0, ay, ax1 - ax0, 2, "#946036");
        rect(g, ax0, ay, ax1 - ax0, 1, "#b07a42");
        rect(g, ax0 + 1, ay + 2, 2, seat.y - ay - 2, "#7a4e2a");
        rect(g, ax0, ay + 2, 1, 2, "#7a4e2a");
    }

    // --- light --------------------------------------------------------------

    // Light the albedo in place. Emissive pixels (the view outside) are
    // left alone; floor pixels can catch the sun patch.
    function lightPixels(d, surf, covered) {
        const ph = PHASES[s.phase];
        const stove = s.stoveLit ? ph.stove : 0;
        const lights = [
            [LAMP, LAMP.c, ph.lamp],
            [CRT, CRT.c, ph.crt],
            [STOVE, STOVE.c, stove],
            [WINLIGHT, ph.win, ph.winK],
            [LANTERN, LANTERN.c, ph.lantern],
        ];
        for (const b of s.bulbs || []) lights.push([{ x: b.x + b.w / 2, y: b.y + 1, r: 24 }, b.c.light, ph.string * 0.13]);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const p = y * W + x;
                const i = p * 4;
                if (d[i + 3] === 0) continue;
                if (surf && surf[p] === OUTSIDE && !covered[p]) continue;
                let r = ph.ambient[0], g = ph.ambient[1], b = ph.ambient[2];
                for (const [L, c, k] of lights) {
                    if (!k) continue;
                    const dx = x - L.x, dy = y - L.y;
                    const f = 1 - (dx * dx + dy * dy) / (L.r * L.r);
                    if (f <= 0) continue;
                    const w = f * f * k;
                    r += c[0] * w;
                    g += c[1] * w;
                    b += c[2] * w;
                }
                if (ph.sun && surf && surf[p] === FLOOR && !covered[p]) {
                    const sp = sunPatch(x + 0.5, y + 0.5);
                    r += 0.85 * sp;
                    g += 0.78 * sp;
                    b += 0.6 * sp;
                }
                const dither = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * 7;
                d[i] = Math.round((d[i] * r + dither) / 5) * 5;
                d[i + 1] = Math.round((d[i + 1] * g + dither) / 5) * 5;
                d[i + 2] = Math.round((d[i + 2] * b + dither) / 5) * 5;
            }
        }
    }

    // Sunlight from the window on the floor, with the mullions' shadow.
    const PATCH = { x0: 272, x1: 344, z0: 0.62, z1: 0.8 };
    function sunPatch(cx, cy) {
        const sc = (cy - VP.y) / FLOOR_DY;
        const xb = VP.x + (cx - VP.x) / sc;
        const z = 1 / sc;
        if (z < PATCH.z0 || z > PATCH.z1 || xb < PATCH.x0 || xb > PATCH.x1) return 0;
        const mx = (PATCH.x0 + PATCH.x1) / 2, mz = (PATCH.z0 + PATCH.z1) / 2;
        if (Math.abs(xb - mx) < 1.5 || Math.abs(z - mz) < 0.004) return 0.15;
        return 1;
    }

    // --- painting the room ----------------------------------------------------

    function paintRoom() {
        const alb = makeCanvas();
        const ag = alb.getContext("2d");
        const img = ag.createImageData(W, H);
        const surf = new Uint8Array(W * H);
        const ids = new Uint8Array(W * H);
        paintSurfaces(img.data, surf, ids);
        ag.putImageData(img, 0, 0);
        const surfRGB = new Uint32Array(img.data.buffer.slice(0));

        // Objects go through a scratch canvas so each one can claim its
        // pixels in the hotspot map (later objects cover earlier ones).
        const scratch = makeCanvas();
        const sg = scratch.getContext("2d");
        // `front` marks what's in front of the string lights, to hide bulbs
        // behind things (the stovepipe).
        const front = new Uint8Array(W * H);
        const draw = (id, fn) => {
            sg.clearRect(0, 0, W, H);
            fn(sg);
            const a = sg.getImageData(0, 0, W, H).data;
            for (let p = 0; p < W * H; p++) {
                if (!a[p * 4 + 3]) continue;
                ids[p] = id;
                if (fn !== paintStringWire) front[p] = 1;
            }
            ag.drawImage(scratch, 0, 0);
        };
        draw(SPOT.lights, paintStringWire);
        draw(0, paintPicture);
        draw(0, paintLantern);
        draw(SPOT.clock, paintClock);
        draw(SPOT.window, paintWindow);
        draw(SPOT.shelf, paintShelf);
        draw(0, paintDesk);
        draw(SPOT.terminal, paintMonitor);
        draw(0, paintDeskThings);
        draw(0, paintFirewood);
        draw(SPOT.stove, paintStove);
        s.bulbs = s.bulbs.filter((b) => b.x >= 0 && b.x < W && b.y >= 0 && b.y < H && !front[b.y * W + b.x]);
        colorBulbs();

        const lit = ag.getImageData(0, 0, W, H);
        const now32 = new Uint32Array(lit.data.buffer);
        const covered = new Uint8Array(W * H);
        for (let p = 0; p < W * H; p++) covered[p] = now32[p] !== surfRGB[p] ? 1 : 0;
        // where the view outside shows through the glass (for the snowfall)
        s.glass = new Uint8Array(W * H);
        for (let p = 0; p < W * H; p++) if (surf[p] === OUTSIDE && !covered[p]) s.glass[p] = 1;
        lightPixels(lit.data, surf, covered);
        const base = makeCanvas();
        const bg = base.getContext("2d");
        bg.putImageData(lit, 0, 0);
        paintEmissive(bg);

        // the chair, lit the same way, on its own layer
        const chair = makeCanvas();
        const cg = chair.getContext("2d");
        paintChair(cg);
        const ci = cg.getImageData(0, 0, W, H);
        lightPixels(ci.data, null, null);
        cg.putImageData(ci, 0, 0);
        for (let p = 0; p < W * H; p++) if (ci.data[p * 4 + 3]) ids[p] = 0;

        s.base = base;
        s.chair = chair;
        s.ids = ids;
        s.outlines = buildOutlines(ids);
        // What the pointer hits: the same, except the string lights are a
        // hair-thin wire, so they catch the pointer a few pixels around it
        // (and on the bulbs, which are drawn per frame).
        const hit = ids.slice();
        const L = SPOT.lights;
        for (const b of s.bulbs) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (!hit[y * W + x]) hit[y * W + x] = L;
        const wire = hit.map((id) => (id === L ? 1 : 0));
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (!wire[y * W + x]) continue;
                for (let dy = -2; dy <= 3; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        const qx = x + dx, qy = y + dy;
                        if (qx >= 0 && qy >= 0 && qx < W && qy < H && !hit[qy * W + qx]) hit[qy * W + qx] = L;
                    }
                }
            }
        }
        s.hit = hit;
    }

    // Things that give off light keep their color whatever the room's light.
    function paintEmissive(g) {
        const ph = PHASES[s.phase];
        if (ph.lamp > 0.5) {
            rect(g, 289, 128, 12, 1, "#fff0c0");
            rect(g, 291, 129, 8, 1, "rgba(255,230,170,0.5)");
            rect(g, 290, 120, 10, 1, "#5a9a6a");
        }
        rect(g, 265, 140, 1, 1, "#40ff80"); // power LED
        if (ph.lantern > 0) {
            rect(g, 67, 99, 3, 5, "rgba(255,200,120,0.55)");
            rect(g, 68, 100, 1, 3, "#ffe6a0");
        }
    }

    // A one-pixel outline just outside each hotspot, for hover.
    function buildOutlines(ids) {
        const out = {};
        const data = {};
        for (const h of SPOTS) data[h.id] = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const p = y * W + x;
                const here = ids[p];
                for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
                    if (q < 0) continue;
                    const k = ids[q];
                    if (k && k !== here) data[k][p] = 1;
                }
            }
        }
        for (const h of SPOTS) {
            const c = makeCanvas();
            const g = c.getContext("2d");
            const img = g.createImageData(W, H);
            let any = false;
            for (let p = 0; p < W * H; p++) {
                if (!data[h.id][p]) continue;
                any = true;
                img.data[p * 4] = 255;
                img.data[p * 4 + 1] = 240;
                img.data[p * 4 + 2] = 200;
                img.data[p * 4 + 3] = 255;
            }
            g.putImageData(img, 0, 0);
            if (any) out[h.id] = c;
        }
        return out;
    }

    // --- each frame ------------------------------------------------------------

    // 3x5 glyphs for the login prompt on the CRT.
    const GLYPHS = {
        l: [4, 4, 4, 4, 6], o: [0, 7, 5, 5, 7], g: [7, 5, 7, 1, 6],
        i: [2, 0, 2, 2, 2], n: [0, 6, 5, 5, 5], ":": [0, 2, 0, 2, 0],
    };

    function drawScreen(g, t) {
        const flick = s.reduced ? 1 : 0.94 + 0.06 * noise(t * 9, 0, 40);
        rect(g, MON.x, MON.y, MON.w, MON.h, "#041a0c");
        // scrollback: rows of dim "words", then the login prompt
        g.globalAlpha = flick;
        for (let row = 0; row < 5; row++) {
            const y = MON.y + 3 + row * 5;
            let x = MON.x + 3;
            for (let w = 0; w < 8; w++) {
                const len = 2 + Math.floor(hash(row, w, 41) * 6);
                if (x + len > MON.x + MON.w - 3 - hash(row, 0, 42) * 18) break;
                rect(g, x, y, len, 1, "#0c7a3a");
                x += len + 1 + Math.floor(hash(row, w, 43) * 2);
            }
        }
        const y0 = MON.y + 27;
        let x = MON.x + 3;
        for (const ch of "login:") {
            const rows = GLYPHS[ch];
            for (let r = 0; r < 5; r++)
                for (let c = 0; c < 3; c++) if (rows[r] & (4 >> c)) px(g, x + c, y0 - 4 + r, "#3cff88");
            x += 4;
        }
        if (s.reduced || frac(t / 1.06) < 0.55) rect(g, x + 1, y0 - 4, 3, 5, "#3cff88");
        g.globalAlpha = 1;
        // scanlines, a slow refresh bar, and the glass
        g.fillStyle = "rgba(0,0,0,0.28)";
        for (let y = MON.y + 1; y < MON.y + MON.h; y += 2) g.fillRect(MON.x, y, MON.w, 1);
        if (!s.reduced) {
            const bar = MON.y + ((t * 7) % (MON.h + 8)) - 4;
            g.fillStyle = "rgba(80,255,150,0.05)";
            g.fillRect(MON.x, Math.round(bar), MON.w, 3);
        }
        rect(g, MON.x + 2, MON.y + 1, 6, 1, "rgba(255,255,255,0.08)");
        rect(g, MON.x + 1, MON.y + 2, 1, 4, "rgba(255,255,255,0.08)");
        for (const [cx, cy] of [[MON.x, MON.y], [MON.x + MON.w - 1, MON.y], [MON.x, MON.y + MON.h - 1], [MON.x + MON.w - 1, MON.y + MON.h - 1]])
            px(g, cx, cy, "#2a2a20");
    }

    function drawClock(g, t) {
        const { hour, minute } = s.clock;
        const cx = 180, cy = 60.5;
        const line = (ang, len, color) => {
            for (let r = 0; r <= len; r += 0.5) px(g, Math.floor(cx + Math.sin(ang) * r), Math.floor(cy - Math.cos(ang) * r), color);
        };
        line(((hour % 12) / 12) * Math.PI * 2, 3.6, "#2a201a");
        line((minute / 60) * Math.PI * 2, 5.6, "#2a201a");
        px(g, 180, 60, "#a08040");
        // pendulum: one swing a second, in step with the ticks
        const swing = s.reduced ? 0 : Math.sin((Date.now() / 1000) * Math.PI) * 0.28;
        for (let r = 0; r < 13; r++) px(g, Math.round(180 + Math.sin(swing) * r - 0.5), 73 + r, "#8a6c34");
        const bx = Math.round(180 + Math.sin(swing) * 13);
        rect(g, bx - 2, 85, 4, 3, "#c8a050");
        px(g, bx - 1, 85, "#e8c870");
    }

    function drawFire(g, t) {
        const f = s.fireGlass;
        if (!f) return;
        if (!s.stoveLit) {
            rect(g, f.x, f.y, f.w, f.h, "#0e0806");
            return;
        }
        // Coals and two logs along the bottom; flames rise off them in
        // tongues, each column flickering to its own height (tallest in the
        // middle) and burning out toward its tip. yb counts up from the
        // bottom, and the texture is sampled at (yb - t * speed) so it
        // scrolls upward.
        const bed = Math.max(4, Math.round(f.h * 0.18));
        const room = f.h - bed;
        g.fillStyle = "#1a0a05";
        g.fillRect(f.x, f.y, f.w, f.h);
        for (let x = 0; x < f.w; x++) {
            const u = (x + 0.5) / f.w;
            const middle = 1 - Math.abs(u - 0.5) * 1.6;
            const lick = noise(x * 0.28, t * 1.7, 54);
            const top = room * clamp(0.3 + middle * (0.35 + 0.6 * lick), 0.12, 1);
            for (let yb = 0; yb < f.h; yb++) {
                const y = f.y + f.h - 1 - yb;
                let c = null;
                if (yb < bed) {
                    // two logs lying across the bed, glowing where they char
                    const logRow = yb === bed - 2 || yb === bed - 3;
                    const onLog = logRow && (yb === bed - 2 ? x > 1 && x < f.w - 5 : x > 4 && x < f.w - 2);
                    const ember = noise(x * 0.7, yb * 0.9 + t * 0.6, 55);
                    if (onLog) c = ember > 0.62 ? "#ff8a30" : ember > 0.45 ? "#8a3412" : "#3a1a0c";
                    else c = ember > 0.6 ? "#ffc060" : ember > 0.35 ? "#e0601e" : "#9a3010";
                } else {
                    const k = (yb - bed) / top; // 0 at the base of the flame, 1 at its tip
                    const sway = Math.sin(t * 2.3 + yb * 0.25) * 0.6 * k;
                    const turb = noise((x + sway) * 0.35, (yb - bed) * 0.22 - t * 3.6, 50) * 0.65 +
                        noise(x * 0.8, (yb - bed) * 0.5 - t * 6, 51) * 0.35;
                    const heat = 1.0 - k + (turb - 0.5) * 0.7;
                    if (heat > 0.85) c = "#fff3c4";
                    else if (heat > 0.65) c = "#ffd166";
                    else if (heat > 0.45) c = "#ff9a32";
                    else if (heat > 0.28) c = "#e0581c";
                    else if (heat > 0.14) c = "#7a2410";
                }
                if (c) px(g, f.x + x, y, c);
            }
        }
    }

    // Snow falling past the window in winter, at three depths: nearer flakes
    // are bigger, brighter, faster and sway more. Each flake gets a new
    // column every time it wraps, so the fall doesn't visibly repeat. Drawn
    // only on glass pixels, so it stays behind the frame and curtains.
    const FLAKES = 72;
    function drawSnow(g, t) {
        if (!s.winter || !s.glass) return;
        const ph = PHASES[s.phase];
        const color = mix(rgb(ph.snow), [255, 255, 255], 0.3);
        const w = WIN.x1 - WIN.x0, h = WIN.y1 - WIN.y0;
        for (let i = 0; i < FLAKES; i++) {
            const depth = i % 3; // 0 far .. 2 near
            const fall = hash(i, 1, 60) * h + t * [4, 7, 11][depth];
            const lap = Math.floor(fall / h);
            const y = Math.floor(WIN.y0 + fall - lap * h);
            const drift = Math.sin(t * (0.5 + hash(i, 3, 60) * 0.7) + i) * (0.8 + depth) + t * 0.8;
            const x = Math.floor(WIN.x0 + frac((hash(i, lap, 61) * w + drift) / w) * w);
            g.fillStyle = css(color, [0.4, 0.65, 0.95][depth]);
            const size = depth === 2 ? 2 : 1;
            for (let dy = 0; dy < size; dy++)
                for (let dx = 0; dx < size; dx++)
                    if (s.glass[(y + dy) * W + x + dx]) g.fillRect(x + dx, y + dy, 1, 1);
        }
    }

    function glow(g, x, y, r, color, a) {
        if (a <= 0) return;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, css(color, a));
        gr.addColorStop(1, css(color, 0));
        g.fillStyle = gr;
        g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    function drawGlows(g, t) {
        const ph = PHASES[s.phase];
        g.globalCompositeOperation = "lighter";
        const crtFlick = s.reduced ? 1 : 0.9 + 0.1 * noise(t * 6, 1, 52);
        glow(g, CRT.x, CRT.y - 4, 34, [40, 255, 120], ph.crt * 0.32 * crtFlick);
        if (s.stoveLit) {
            const fl = s.reduced ? 0.8 : 0.65 + 0.35 * noise(t * 2.4, 2, 53);
            const fx = s.fireGlass ? s.fireGlass.x + s.fireGlass.w / 2 : STOVE.x;
            const fy = s.fireGlass ? s.fireGlass.y + s.fireGlass.h / 2 : STOVE.y;
            glow(g, fx, fy + 16, 46, [255, 120, 40], ph.stove * 0.22 * fl);
        }
        if (ph.lamp > 0.5) glow(g, LAMP.x, 136, 26, [255, 200, 120], 0.12 * ph.lamp);
        if (ph.lantern > 0) {
            const fl = s.reduced ? 1 : 0.85 + 0.15 * noise(t * 5, 3, 54);
            glow(g, 68.5, 101, 14, [255, 190, 110], 0.22 * ph.lantern * fl);
        }
        if (ph.sun) {
            // a faint shaft of light from the window to the patch on the floor
            const [ax, ay] = [WIN.x0, WIN.y0];
            const [bx, by] = [WIN.x1, WIN.y0];
            const near = (xb) => [VP.x + (xb - VP.x) / PATCH.z0, VP.y + FLOOR_DY / PATCH.z0];
            const [cx, cy] = near(PATCH.x1);
            const [dx, dy] = near(PATCH.x0);
            const gr = g.createLinearGradient(0, WIN.y0, 0, cy);
            gr.addColorStop(0, "rgba(255,244,220,0.1)");
            gr.addColorStop(1, "rgba(255,244,220,0.0)");
            g.fillStyle = gr;
            g.beginPath();
            g.moveTo(ax, ay);
            g.lineTo(bx, by);
            g.lineTo(cx, cy);
            g.lineTo(dx, dy);
            g.closePath();
            g.fill();
        }
        g.globalCompositeOperation = "source-over";
    }

    // The bulbs: each breathes a little on its own, and one or two are a
    // bit loose in their sockets.
    function drawStringLights(g, t) {
        const k = PHASES[s.phase].string;
        // just after a color change: off, sputter, on
        const since = t - (s.lightsFlick ?? -9);
        const flick = s.reduced || since > 0.45 ? 1 : [0.05, 0.6, 0.1, 0.85, 1][Math.floor(Math.max(0, since) / 0.09)] ?? 1;
        for (const b of s.bulbs) {
            const glass = mix(b.c.color, mix(b.c.color, [215, 205, 200], 0.65), 1 - k); // paler when it's bright out
            let tw = s.reduced ? 1 : 0.8 + 0.2 * noise(t * 0.5 + b.seed * 40, b.seed * 9, 74);
            if (b.dodgy && !s.reduced && noise(t * 6, b.seed * 50, 75) < 0.3) tw *= 0.4;
            tw *= flick;
            b.tw = tw;
            g.globalAlpha = 0.6 + 0.4 * tw;
            rect(g, b.x, b.y, b.w, b.h, css(glass));
            px(g, b.x, b.y + b.h - 2, css(mix(glass, b.c.core, k * tw)));
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = "lighter";
        for (const b of s.bulbs) {
            const r = b.w > 1 ? 12 : 8;
            g.globalAlpha = k * 0.5 * b.tw;
            g.drawImage(b.c.sprite, b.x + b.w / 2 - r, b.y + b.h / 2 - r, r * 2, r * 2);
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
    }

    // Dust drifting in the sun shaft by day, around the lamp at night.
    function updateMotes(dt) {
        if (!s.motes) {
            s.motes = Array.from({ length: 22 }, (_, i) => ({ a: hash(i, 1, 60), b: hash(i, 2, 60), ph: hash(i, 3, 60) * 6.28 }));
        }
        for (const m of s.motes) {
            m.a = frac(m.a + dt * (0.008 + 0.01 * frac(m.ph)));
            m.b = clamp(m.b + Math.sin(s.t * 0.7 + m.ph) * dt * 0.02, 0, 1);
        }
    }

    function drawMotes(g) {
        const ph = PHASES[s.phase];
        for (const m of s.motes) {
            let x, y;
            if (ph.sun) {
                // along the shaft from the window (a = 0) toward the floor
                const top = lerp(WIN.x0, WIN.x1, m.b);
                const xb = lerp(PATCH.x0, PATCH.x1, m.b);
                const bot = VP.x + (xb - VP.x) / PATCH.z0;
                x = lerp(top, bot, m.a * 0.8);
                y = lerp(WIN.y0 + 10, VP.y + FLOOR_DY / PATCH.z0, m.a * 0.8);
            } else if (ph.lamp > 0.5) {
                x = LAMP.x - 14 + m.b * 28;
                y = 147 - m.a * 26;
            } else continue;
            const a = 0.22 + 0.25 * (0.5 + 0.5 * Math.sin(s.t * 1.7 + m.ph));
            px(g, Math.round(x), Math.round(y), `rgba(255,240,210,${a.toFixed(2)})`);
        }
    }

    function drawSteam(g, t, x0, y0, strength) {
        for (let w = 0; w < 3; w++) {
            const life = frac(t * 0.35 + w / 3);
            for (let i = 0; i < 9; i++) {
                const k = i / 9;
                const y = Math.round(y0 - i - life * 3);
                const x = Math.round(x0 + Math.sin(t * 1.3 + i * 0.45 + w * 2.1) * 1.6 * k + (w - 1));
                const a = strength * (1 - k) * Math.sin(Math.PI * life);
                if (a > 0.02) px(g, x, y, `rgba(235,235,230,${a.toFixed(2)})`);
            }
        }
    }

    function composeFrame(t) {
        const g = s.fbg;
        g.drawImage(s.base, 0, 0);
        drawScreen(g, t);
        drawClock(g, t);
        drawFire(g, s.reduced ? 0 : t);
        drawSnow(g, s.reduced ? 0 : t);
        drawGlows(g, t);
        drawStringLights(g, t);
        if (!s.reduced) {
            drawMotes(g);
            drawSteam(g, t, 192, 143, 0.22);
            if (s.stoveLit && s.kettleSpout) drawSteam(g, t * 1.3, s.kettleSpout[0], s.kettleSpout[1], 0.3);
        }
        const hot = s.focus || s.hover;
        if (hot && s.outlines[hot.id] && s.stage === "room") {
            g.globalAlpha = 0.55 + (s.reduced ? 0 : 0.2 * Math.sin(t * 3));
            g.drawImage(s.outlines[hot.id], 0, 0);
            g.globalAlpha = 1;
        }
    }

    // --- camera -----------------------------------------------------------------
    // The camera is a zoom z (screen px per room px) and the screen position
    // of the CRT's center, m. Pulling back is a zoom from "the CRT screen
    // fills the terminal's box" to "the whole room fills the window".

    // The overlay's size: the fixed, full-window box the canvas fills.
    const vpW = () => s.overlay.clientWidth || window.innerWidth;
    const vpH = () => s.overlay.clientHeight || window.innerHeight;

    function view() {
        const vw = vpW(), vh = vpH();
        const z = Math.max(vw / W, vh / H) * LOOK_ZOOM;
        return {
            vw, vh, z,
            slackX: Math.max(0, (W - vw / z) / 2),
            slackY: Math.max(0, (H - vh / z) / 2),
        };
    }

    // Standing in the room, looking toward `look` (-1..1 on each axis).
    function roomCamera(look) {
        const v = view();
        const cx = W / 2 + look.x * v.slackX;
        const cy = H / 2 + look.y * v.slackY;
        return { z: v.z, m: { x: (MONC.x - cx) * v.z + v.vw / 2, y: (MONC.y - cy) * v.z + v.vh / 2 } };
    }

    // Sitting at the desk: the CRT's screen lands on the terminal's box.
    function seatedCamera(term) {
        return { z: term.w / MON.w, m: { x: term.x + term.w / 2, y: term.y + term.h / 2 } };
    }

    function blendCamera(a, b, k) {
        return {
            z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), k)),
            m: { x: lerp(a.m.x, b.m.x, k), y: lerp(a.m.y, b.m.y, k) },
        };
    }

    function screenRect(cam) {
        return { x: cam.m.x - (MON.w / 2) * cam.z, y: cam.m.y - (MON.h / 2) * cam.z, w: MON.w * cam.z, h: MON.h * cam.z };
    }

    // Where the terminal goes for camera `cam`: always as wide as the CRT's
    // screen and centered on it; `fit` 0 keeps the terminal's own shape,
    // 1 squares it to the 4:3 screen. With the seated camera and fit 0
    // that's exactly the terminal's own box, so nothing jumps.
    function rideScreen(cam, fit) {
        const scr = screenRect(cam);
        const own = s.term.h * (scr.w / s.term.w);
        const h = lerp(own, scr.h, fit);
        return { x: scr.x, w: scr.w, y: cam.m.y - h / 2, h };
    }

    // The terminal's box with no transform applied.
    function measureTerminal() {
        const prev = terminal.style.transform;
        terminal.style.transform = "none";
        const r = terminal.getBoundingClientRect();
        terminal.style.transform = prev;
        return { x: r.left, y: r.top, w: r.width, h: r.height };
    }

    function placeTerminal(r, opacity) {
        const t0 = s.term;
        terminal.style.transform =
            `translate(${r.x - t0.x}px, ${r.y - t0.y}px) scale(${r.w / t0.w}, ${r.h / t0.h})`;
        terminal.style.opacity = String(opacity);
    }

    function liftTerminal(on) {
        terminal.style.zIndex = on ? "11" : "";
        terminal.style.transformOrigin = "0 0";
        terminal.style.willChange = on ? "transform, opacity" : "";
        terminal.style.visibility = on ? "" : "hidden";
    }

    function releaseTerminal() {
        for (const k of ["transform", "transformOrigin", "opacity", "zIndex", "willChange", "visibility"]) terminal.style[k] = "";
    }

    // Standing up: push the chair back, rise, two steps back.
    function standingCamera(t) {
        const k = clamp((t - PAUSE) / (STAND_SECONDS - PAUSE), 0, 1);
        const e = easeInOut(k);
        const a = seatedCamera(s.term);
        a.z *= 1 - 0.03 * smoothstep(0, PAUSE, t); // leaning back
        const cam = blendCamera(a, roomCamera({ x: 0, y: 0 }), e);
        const vh = vpH();
        cam.m.y += vh * 0.045 * Math.sin(Math.PI * smoothstep(0, 0.6, k)); // rising
        const steps = clamp((k - 0.32) / 0.55, 0, 1);
        cam.m.y -= vh * 0.007 * Math.sin(steps * Math.PI * 4) * Math.sin(steps * Math.PI);
        cam.m.x += vpW() * 0.003 * Math.sin(steps * Math.PI * 2);
        return { cam, k };
    }

    // Sitting down: two steps in, lower into the chair.
    function sittingCamera(t) {
        const q = clamp(t / SIT_SECONDS, 0, 1);
        const k = easeInOut(clamp((q - 0.06) / 0.86, 0, 1));
        const cam = blendCamera(s.sitFrom, seatedCamera(s.term), k);
        const vh = vpH();
        const steps = clamp(k / 0.5, 0, 1);
        cam.m.y -= vh * 0.006 * Math.sin(steps * Math.PI * 4) * Math.sin(steps * Math.PI);
        cam.m.y -= vh * 0.035 * Math.sin(Math.PI * smoothstep(0.55, 1, k)); // lowering
        return { cam, k, q };
    }

    // Draw the room (and the chair, nearer the camera) through `cam`.
    function blit(cam, roomAlpha) {
        const g = s.screen;
        const dpr = s.dpr;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = "#000";
        g.fillRect(0, 0, s.canvas.width, s.canvas.height);
        if (roomAlpha <= 0) return;
        g.globalAlpha = roomAlpha;
        g.imageSmoothingEnabled = false;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const ox = cam.m.x - MONC.x * cam.z;
        const oy = cam.m.y - MONC.y * cam.z;
        // only the part of the room on screen, whole pixels
        const vw = vpW(), vh = vpH();
        const sx0 = clamp(Math.floor(-ox / cam.z), 0, W), sy0 = clamp(Math.floor(-oy / cam.z), 0, H);
        const sx1 = clamp(Math.ceil((vw - ox) / cam.z), 0, W), sy1 = clamp(Math.ceil((vh - oy) / cam.z), 0, H);
        if (sx1 > sx0 && sy1 > sy0)
            g.drawImage(s.fb, sx0, sy0, sx1 - sx0, sy1 - sy0, ox + sx0 * cam.z, oy + sy0 * cam.z, (sx1 - sx0) * cam.z, (sy1 - sy0) * cam.z);

        // The chair is nearer than the CRT, so it grows faster as the camera
        // closes in (and is behind you when you're sitting in it). Distances
        // are 1/depth; the room's zoom says how far the camera has moved.
        const zr = roomCamera(s.look).z;
        const M = Math.max(1, cam.z / zr);
        const dMon = 1 / MON_DEPTH, dChair = 1 / CHAIR_DEPTH;
        const moved = dMon * (1 - 1 / M);
        const left = dChair - moved;
        if (left > 0.1) {
            const C = dChair / left;
            const a = smoothstep(5.2, 3.2, C) * roomAlpha;
            if (a > 0) {
                const zc = zr * C;
                // project about the vanishing point; parallax with the look
                const vpx = ox + VP.x * cam.z, vpy = oy + VP.y * cam.z;
                const par = s.stage === "room" ? 0.18 : 0;
                const cx = vpx - VP.x * zc - s.lookShift.x * zr * par;
                const cy = vpy - VP.y * zc - s.lookShift.y * zr * par;
                g.globalAlpha = a;
                g.drawImage(s.chair, cx, cy, W * zc, H * zc);
            }
        }
        g.globalAlpha = 1;
    }

    function toRoom(clientX, clientY) {
        const cam = s.cam;
        return {
            x: (clientX - (cam.m.x - MONC.x * cam.z)) / cam.z,
            y: (clientY - (cam.m.y - MONC.y * cam.z)) / cam.z,
        };
    }

    function spotAt(clientX, clientY) {
        const r = toRoom(clientX, clientY);
        const x = Math.floor(r.x), y = Math.floor(r.y);
        if (x < 0 || y < 0 || x >= W || y >= H) return null;
        const id = s.hit[y * W + x];
        return id ? SPOTS[id - 1] : null;
    }

    // --- interaction -----------------------------------------------------------

    function labelOf(h) {
        return typeof h.label === "function" ? h.label() : h.label;
    }

    function setStatus(text, holdMs = 0) {
        s.statusText = text;
        s.statusUntil = holdMs ? performance.now() + holdMs : 0;
        renderStatus();
    }

    function renderStatus() {
        const el = s.statusEl;
        let text = "";
        if (s.statusUntil && performance.now() < s.statusUntil) text = s.statusText;
        else {
            s.statusUntil = 0;
            const hot = s.focus || s.hover;
            if (hot && s.stage === "room") text = labelOf(hot);
            else if (s.stage === "room" && performance.now() < s.hintUntil) text = s.hint;
        }
        if (el.textContent !== text) el.textContent = text;
        el.classList.toggle("on", !!text);
    }

    function activate(h) {
        if (!h || s.stage !== "room") return;
        if (h.act) return h.act();
        const text = typeof h.say === "function" ? h.say() : h.say;
        setStatus(text, 4200);
        if (s.audio) s.audio.knock(h.name);
    }

    function stepFocus(dir) {
        const i = s.focus ? SPOTS.indexOf(s.focus) : dir > 0 ? -1 : SPOTS.length;
        s.focus = SPOTS[(i + dir + SPOTS.length) % SPOTS.length];
        s.statusUntil = 0;
        // turn toward it
        const v = view();
        let x0 = W, x1 = 0;
        for (let p = 0; p < W * H; p++) {
            if (s.ids[p] !== s.focus.id) continue;
            x0 = Math.min(x0, p % W);
            x1 = Math.max(x1, p % W);
        }
        if (v.slackX && x1 >= x0) s.lookTarget.x = clamp(((x0 + x1) / 2 - W / 2) / v.slackX, -1, 1);
        renderStatus();
    }

    function startStanding() {
        s.stage = "standing";
        s.stageT = 0;
        s.term = measureTerminal();
        liftTerminal(true);
        if (s.audio) s.audio.standUp();
    }

    function sitDown() {
        if (!s || s.stage === "sitting") return;
        s.sitFrom = s.cam;
        s.stage = "sitting";
        s.stageT = 0;
        s.hover = s.focus = null;
        s.overlay.style.cursor = "";
        renderStatus();
        s.term = measureTerminal();
        liftTerminal(true);
        if (s.reduced) placeTerminal(s.term, 0);
        else placeTerminal(screenRect(s.cam), 0);
        if (s.audio) s.audio.sitDown();
    }

    // --- sound -----------------------------------------------------------------

    function toggleSound() {
        if (s.audio) {
            s.audio.stop();
            s.audio = null;
            writePref(SOUND_PREF, "off");
            updateSoundButton();
            return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ac = new AC();
        if (ac.resume) ac.resume();
        s.audio = createAudio(ac, s.volume);
        writePref(SOUND_PREF, "on");
        if (isCoarsePointer()) s.soundHintUntil = performance.now() + 5000;
        updateSoundButton();
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
        if (!s.audio) label = "sound: off";
        else if (performance.now() < s.soundHintUntil) label = "sound on · silent switch off?";
        else label = `sound: ${Math.round(s.volume * 100)}%`;
        const text = `[m] ${label}`;
        if (btn.textContent !== text) btn.textContent = text;
    }

    // Everything is synthesized: noise through filters, a few oscillators.
    function createAudio(ac, volume) {
        const now = () => ac.currentTime;
        const rand = (a, b) => a + Math.random() * (b - a);
        const out = ac.createGain();
        out.gain.value = 0;
        const limiter = ac.createDynamicsCompressor();
        limiter.threshold.value = -10;
        limiter.ratio.value = 12;
        limiter.connect(out).connect(ac.destination);
        out.gain.setValueAtTime(0, now());
        out.gain.linearRampToValueAtTime(volume, now() + 1.2);

        function noiseBuffer(seconds, brown) {
            const len = Math.floor(ac.sampleRate * seconds);
            const buf = ac.createBuffer(1, len, ac.sampleRate);
            const d = buf.getChannelData(0);
            let last = 0;
            for (let i = 0; i < len; i++) {
                const w = Math.random() * 2 - 1;
                if (brown) {
                    last = (last + 0.02 * w) / 1.02;
                    d[i] = last * 3.5;
                } else d[i] = w;
            }
            return buf;
        }
        const white = noiseBuffer(2, false);
        const brown = noiseBuffer(3, true);

        const panned = (pan) => {
            if (!ac.createStereoPanner) return limiter;
            const p = ac.createStereoPanner();
            p.pan.value = pan;
            p.connect(limiter);
            return p;
        };
        const looped = [];
        function bed(buf, type, freq, q, gain, pan = 0) {
            const src = ac.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            const f = ac.createBiquadFilter();
            f.type = type;
            f.frequency.value = freq;
            f.Q.value = q;
            const g = ac.createGain();
            g.gain.value = gain;
            src.connect(f).connect(g).connect(panned(pan));
            src.start(0, Math.random() * 2);
            looped.push(src);
            return g;
        }
        bed(brown, "lowpass", 170, 0.7, 0.32); // room tone
        const wind = bed(white, "bandpass", 420, 0.6, 0, 0.35);
        const roar = bed(brown, "lowpass", 420, 0.8, 0, 0.6);
        // CRT: the flyback whine, and mains hum
        const tone = (freq, gain, type = "sine") => {
            const o = ac.createOscillator();
            o.type = type;
            o.frequency.value = freq;
            const g = ac.createGain();
            g.gain.value = gain;
            o.connect(g).connect(limiter);
            o.start();
            looped.push(o);
            return g;
        };
        const whine = tone(15734, 0.004);
        tone(120, 0.006, "triangle");

        function burst({ type = "bandpass", freq, q = 1, dur, gain, at = now(), pan = 0, buf = white }) {
            const src = ac.createBufferSource();
            src.buffer = buf;
            const f = ac.createBiquadFilter();
            f.type = type;
            f.frequency.value = freq;
            f.Q.value = q;
            const g = ac.createGain();
            g.gain.setValueAtTime(0.0001, at);
            g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
            g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
            src.connect(f).connect(g).connect(panned(pan));
            src.start(at, Math.random() * 1.5);
            src.stop(at + dur + 0.05);
        }

        // Wood complaining: a stick-slip buzz through a resonant filter.
        function creak(at, dur, base, gain) {
            const o = ac.createOscillator();
            o.type = "sawtooth";
            const steps = Math.floor(dur / 0.011);
            for (let i = 0; i < steps; i++) o.frequency.setValueAtTime(base * rand(0.7, 1.4), at + i * 0.011);
            const f = ac.createBiquadFilter();
            f.type = "bandpass";
            f.Q.value = 7;
            f.frequency.setValueAtTime(rand(700, 900), at);
            f.frequency.linearRampToValueAtTime(rand(1100, 1500), at + dur);
            const g = ac.createGain();
            g.gain.setValueAtTime(0.0001, at);
            g.gain.exponentialRampToValueAtTime(gain, at + 0.05);
            g.gain.setValueAtTime(gain, at + dur * 0.7);
            g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
            o.connect(f).connect(g).connect(panned(-0.1));
            o.start(at);
            o.stop(at + dur + 0.05);
        }

        function roll(at, dur) {
            burst({ type: "lowpass", freq: 300, dur, gain: 0.18, at, buf: brown });
        }

        // A footstep on old boards: a low thump, a scuff, sometimes a creak.
        function step(at, pan = 0) {
            const o = ac.createOscillator();
            o.frequency.setValueAtTime(95, at);
            o.frequency.exponentialRampToValueAtTime(45, at + 0.14);
            const g = ac.createGain();
            g.gain.setValueAtTime(0.0001, at);
            g.gain.exponentialRampToValueAtTime(0.4, at + 0.008);
            g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
            o.connect(g).connect(panned(pan));
            o.start(at);
            o.stop(at + 0.25);
            burst({ type: "lowpass", freq: 900, dur: 0.06, gain: 0.14, at, pan });
            if (Math.random() < 0.6) creak(at + 0.04, rand(0.12, 0.2), rand(55, 80), 0.05);
        }

        function tick(tock) {
            burst({ freq: tock ? 2400 : 3200, q: 6, dur: 0.03, gain: 0.07, pan: -0.25 });
        }

        let crackleWait = 0;
        let lastSecond = -1;
        let t = 0;

        return {
            update(dt) {
                if (!s) return;
                t += dt;
                const at = now();
                const gust = 0.5 + 0.5 * Math.sin(t * 0.13) * Math.sin(t * 0.071 + 1);
                wind.gain.setTargetAtTime((s.winter ? 0.05 : 0.025) * (0.3 + gust), at, 0.5);
                roar.gain.setTargetAtTime(s.stoveLit ? 0.08 : 0, at, 0.5);
                whine.gain.setTargetAtTime(s.stage === "room" ? 0.003 : 0.006, at, 0.3);
                if (s.stoveLit) {
                    crackleWait -= dt;
                    if (crackleWait <= 0) {
                        crackleWait = rand(0.08, 0.6);
                        burst({ type: "highpass", freq: rand(1800, 4500), dur: rand(0.01, 0.04), gain: rand(0.03, 0.12), pan: 0.65 });
                    }
                }
                const sec = new Date().getSeconds();
                if (sec !== lastSecond) {
                    if (lastSecond !== -1) tick(sec % 2 === 1);
                    lastSecond = sec;
                }
            },
            standUp() {
                const at = now();
                creak(at + 0.02, 0.42, 70, 0.14);
                roll(at + 0.05, 0.35);
                step(at + 1.75, -0.15);
                step(at + 2.45, 0.15);
            },
            sitDown() {
                const at = now();
                step(at + 0.35, 0.15);
                step(at + 0.95, -0.15);
                roll(at + 1.5, 0.3);
                creak(at + 1.6, 0.36, 60, 0.12);
            },
            knock(name) {
                const at = now();
                if (name === "door") {
                    burst({ type: "lowpass", freq: 500, dur: 0.12, gain: 0.3, at });
                    burst({ freq: 1600, q: 3, dur: 0.05, gain: 0.08, at: at + 0.01 }); // the latch
                } else if (name === "stove" && s.stoveLit) {
                    burst({ type: "highpass", freq: 3000, dur: 0.03, gain: 0.12, at, pan: 0.65 });
                }
            },
            setVolume(v) {
                out.gain.setTargetAtTime(v, now(), 0.05);
            },
            suspend() {
                if (ac.suspend) ac.suspend();
            },
            resume() {
                if (ac.resume) ac.resume();
            },
            stop() {
                out.gain.setTargetAtTime(0, now(), 0.15);
                setTimeout(() => {
                    for (const src of looped) {
                        try {
                            src.stop();
                        } catch {
                            /* already stopped */
                        }
                    }
                    ac.close();
                }, 600);
            },
        };
    }

    // --- setup -----------------------------------------------------------------

    function ensureStyles() {
        if (document.getElementById("cabin-styles")) return;
        const style = document.createElement("style");
        style.id = "cabin-styles";
        style.textContent =
            "#cabin{position:fixed;inset:0;z-index:10;background:#000;overflow:hidden;" +
            "touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}" +
            "#cabin canvas{position:absolute;left:0;top:0;width:100%;height:100%;image-rendering:pixelated}" +
            "#cabin .cabin-vignette{position:absolute;inset:0;pointer-events:none;" +
            "background:radial-gradient(ellipse at 50% 45%,transparent 55%,rgba(0,0,0,0.5) 100%)}" +
            ".cabin-status{position:fixed;left:max(14px,env(safe-area-inset-left));" +
            "bottom:max(14px,env(safe-area-inset-bottom));z-index:30;max-width:calc(100% - 210px);" +
            `font:14px/1.4 ${MONO_STACK};color:#00ff66;text-shadow:0 0 6px rgba(0,255,102,0.35),0 1px 2px #000;` +
            "pointer-events:none;opacity:0;transition:opacity .35s}" +
            ".cabin-status.on{opacity:0.9}" +
            "@media (max-width:520px){.cabin-status{max-width:calc(100% - 28px);bottom:62px}}";
        document.head.appendChild(style);
    }

    function sizeCanvas() {
        s.dpr = Math.min(window.devicePixelRatio || 1, 2);
        s.canvas.width = Math.round(vpW() * s.dpr);
        s.canvas.height = Math.round(vpH() * s.dpr);
    }

    function attachPointer(ctx) {
        const el = ctx.overlay;
        let down = null;
        el.addEventListener("pointermove", (e) => {
            if (!s) return;
            if (down && e.pointerId === down.id) {
                const dx = e.clientX - down.x, dy = e.clientY - down.y;
                if (!down.drag && Math.hypot(dx, dy) > 8) down.drag = true;
                if (down.drag && s.stage === "room") {
                    // drag to look around (touch, or a mouse drag)
                    const v = view();
                    if (v.slackX) s.lookTarget.x = clamp(down.lx - dx / (v.z * v.slackX), -1, 1);
                    if (v.slackY) s.lookTarget.y = clamp(down.ly - dy / (v.z * v.slackY), -1, 1);
                    s.look.x = s.lookTarget.x;
                    s.look.y = s.lookTarget.y;
                }
                return;
            }
            if (e.pointerType === "mouse" && s.stage === "room") {
                // the view follows the mouse a little, like turning your head
                s.lookTarget.x = clamp((e.clientX / vpW()) * 2 - 1, -1, 1);
                s.lookTarget.y = clamp((e.clientY / vpH()) * 2 - 1, -1, 1) * 0.6;
                s.pointer = { x: e.clientX, y: e.clientY };
            }
        });
        el.addEventListener("pointerdown", (e) => {
            if (!s) return;
            down = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: s.lookTarget.x, ly: s.lookTarget.y, drag: false };
            if (e.pointerType !== "mouse") el.setPointerCapture?.(e.pointerId);
        });
        el.addEventListener("pointerup", (e) => {
            if (!s || !down || e.pointerId !== down.id) return;
            const wasDrag = down.drag;
            down = null;
            if (wasDrag || s.stage !== "room") return;
            const h = spotAt(e.clientX, e.clientY);
            s.focus = null;
            if (h) {
                s.hover = h;
                activate(h);
            }
        });
        el.addEventListener("pointercancel", () => (down = null));
        el.addEventListener("pointerleave", (e) => {
            if (e.pointerType === "mouse" && s) {
                s.pointer = null;
                s.hover = null;
            }
        });
        el.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    // --- the mode ----------------------------------------------------------------

    modes.cabin = {
        path: "cabin",
        overlay: { className: "", label: "A log cabin. The terminal sits on a desk." },

        get exitMessage() {
            const when = lastLogout
                ? lastLogout.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).toLowerCase().replace(/,/g, "")
                : "";
            return `decyphered.tech login: decyphered\nlast login: ${when} from the cabin\nwelcome back.`;
        },

        // options: { audio: AudioContext | null, words: [...] } from `logout`
        start(ctx, options = {}) {
            const words = (options.words || []).map((w) => String(w).toLowerCase());
            lastLogout = new Date();
            s = {
                ctx,
                overlay: ctx.overlay,
                reduced: ctx.reduced,
                forcedPhase: words.find((w) => PHASES[w]) || null,
                forcedSeason: words.find((w) => w === "winter" || w === "summer") || null,
                phase: null,
                winter: null,
                stoveLit: null,
                clock: null,
                t: 0,
                stage: "standing",
                stageT: 0,
                cam: null,
                term: null,
                sitFrom: null,
                look: { x: 0, y: 0 },
                lookTarget: { x: 0, y: 0 },
                lookShift: { x: 0, y: 0 },
                hover: null,
                focus: null,
                pointer: null,
                lastSkyCheck: 0,
                statusText: "",
                statusUntil: 0,
                hint: isCoarsePointer()
                    ? "tap the screen to sit back down · drag to look around"
                    : "the screen's still on. click it to sit back down.",
                hintUntil: 0,
                motes: null,
                audio: null,
                volume: clamp(Number(readPref(VOLUME_PREF, "0.7")) || 0.7, 0.1, 1),
                soundHintUntil: 0,
                onVisibility: null,
            };
            updateClock();
            paintRoom();
            ensureStyles();

            s.fb = makeCanvas();
            s.fbg = s.fb.getContext("2d");
            s.canvas = document.createElement("canvas");
            s.canvas.setAttribute("aria-hidden", "true");
            s.screen = s.canvas.getContext("2d");
            s.canvas.style.opacity = "0";
            ctx.overlay.appendChild(s.canvas);
            const vignette = document.createElement("div");
            vignette.className = "cabin-vignette";
            ctx.overlay.appendChild(vignette);
            sizeCanvas();

            // The status line names what's under the pointer.
            s.statusEl = document.createElement("div");
            s.statusEl.className = "cabin-status";
            s.statusEl.setAttribute("aria-live", "polite");
            document.body.appendChild(s.statusEl);

            // The [x] chip sits you back down (with the walk) instead of
            // cutting straight back to the terminal.
            const chip = ctx.exitChip.cloneNode(true);
            chip.textContent = "[x] sit down";
            chip.setAttribute("aria-label", "Sit back down at the terminal");
            chip.addEventListener("click", (e) => {
                e.stopPropagation();
                sitDown();
            });
            ctx.exitChip.replaceWith(chip);
            ctx.exitChip = chip;

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "mode-exit";
            btn.style.top = "auto";
            btn.style.bottom = "max(10px, env(safe-area-inset-bottom))";
            btn.setAttribute("aria-label", "Toggle room sound");
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                toggleSound();
            });
            document.body.appendChild(btn);
            s.soundBtn = btn;

            // `logout` made the AudioContext during the key press, if sound
            // was on last time (browsers only start audio from a gesture).
            if (options.audio) s.audio = createAudio(options.audio, s.volume);
            updateSoundButton();

            s.onVisibility = () => {
                if (!s || !s.audio) return;
                if (document.hidden) s.audio.suspend();
                else s.audio.resume();
            };
            document.addEventListener("visibilitychange", s.onVisibility);

            attachPointer(ctx);
            terminalTitle.textContent = "logged out";
            startStanding();
            this.frame(ctx, 0, 0);
        },

        resize() {
            if (!s) return;
            sizeCanvas();
            // Mid-walk (phones resize as the address bar slides): carry on
            // toward wherever the terminal's box is now.
            if (s.stage !== "room") s.term = measureTerminal();
        },

        frame(ctx, t, dt) {
            s.t = t;
            if (t - s.lastSkyCheck > 30) {
                s.lastSkyCheck = t;
                if (updateClock()) paintRoom();
            } else s.clock = anchorageNow();

            // ease the look toward where the pointer (or arrow keys) point
            const ease = 1 - Math.exp(-dt * 3);
            s.look.x += (s.lookTarget.x - s.look.x) * ease;
            s.look.y += (s.lookTarget.y - s.look.y) * ease;
            const v = view();
            s.lookShift = { x: s.look.x * v.slackX, y: s.look.y * v.slackY };

            updateMotes(dt);
            composeFrame(t);
            s.stageT += dt;
            let roomAlpha = 1;

            if (s.stage === "standing") {
                if (s.reduced) {
                    const q = clamp(s.stageT / 0.7, 0, 1);
                    s.cam = roomCamera(s.look);
                    roomAlpha = q;
                    terminal.style.opacity = String(1 - q);
                    if (q >= 1) arrive();
                } else {
                    const { cam, k } = standingCamera(s.stageT);
                    s.cam = cam;
                    roomAlpha = smoothstep(0, 0.35, s.stageT);
                    placeTerminal(rideScreen(cam, smoothstep(0, 0.35, k)), 1 - smoothstep(0.82, 1, k));
                    if (k >= 1) arrive();
                }
            } else if (s.stage === "sitting") {
                if (s.reduced) {
                    const q = clamp(s.stageT / 0.6, 0, 1);
                    s.cam = roomCamera(s.look);
                    roomAlpha = 1 - q;
                    terminal.style.opacity = String(q);
                    if (q >= 1) return exitMode();
                } else {
                    const { cam, k, q } = sittingCamera(s.stageT);
                    s.cam = cam;
                    placeTerminal(rideScreen(cam, 1 - smoothstep(0.62, 1, k)), smoothstep(0, 0.14, q));
                    roomAlpha = 1 - smoothstep(0.9, 1, q);
                    if (q >= 1) return exitMode();
                }
            } else {
                s.cam = roomCamera(s.look);
                if (s.pointer) {
                    const h = spotAt(s.pointer.x, s.pointer.y);
                    if (h !== s.hover) {
                        s.hover = h;
                        if (h) s.focus = null;
                    }
                }
                s.overlay.style.cursor = s.hover ? "pointer" : "";
            }

            s.canvas.style.opacity = "1";
            blit(s.cam, roomAlpha);
            if (s.audio) s.audio.update(dt);
            renderStatus();
            updateSoundButton();
        },

        keydown(ctx, e) {
            if (e.key === "Escape" || e.key === "q" || e.key === "Q") {
                e.preventDefault();
                if (s.stage === "sitting") exitMode();
                else sitDown();
                return true;
            }
            if (e.key === "m" || e.key === "M") {
                toggleSound();
                return true;
            }
            if (e.key === "-" || e.key === "_") {
                changeVolume(-0.1);
                return true;
            }
            if (e.key === "=" || e.key === "+") {
                changeVolume(0.1);
                return true;
            }
            if (s.stage !== "room") return true;
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                stepFocus(e.key === "ArrowRight" ? 1 : -1);
                return true;
            }
            if ((e.key === "Enter" || e.key === " ") && (s.focus || s.hover)) {
                e.preventDefault();
                activate(s.focus || s.hover);
                return true;
            }
            return true;
        },

        stop() {
            releaseTerminal();
            if (s.audio) s.audio.stop();
            document.removeEventListener("visibilitychange", s.onVisibility);
            s.soundBtn.remove();
            s.statusEl.remove();
            s = null;
        },
    };

    // Done walking back: the room is yours.
    function arrive() {
        s.stage = "room";
        s.hintUntil = performance.now() + 7000;
        terminal.style.opacity = "0";
        liftTerminal(false);
    }
})();
