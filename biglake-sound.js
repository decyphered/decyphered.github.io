// biglake-sound: the campfire soundscape, fully synthesized with Web Audio.
//
// Loaded by biglake.js only when someone turns sound on. It defines one
// global, createBiglakeAudio(ac, getState, options), which returns an engine
// that biglake.js drives every frame. Nothing is recorded: every sound is
// built from noise and oscillators, shaped by filters and envelopes.
//
//   fire     low roar that follows the flames; snaps, sap hisses and log
//            thumps; a whoosh + burst when stoked
//   water    waves lapping the shore and small gurgles (open lake);
//            rain hiss and drops plinking on the water
//   ice      frozen lake: "singing" ice (dispersive chirps) and deep booms
//   wind     a gusting breath through the spruce, from the live wind
//   thunder  rumble a few seconds after each lightning flash
//   wildlife loons on summer evenings (May-Sep), a great horned owl on
//            winter nights (Oct-Mar)
//
// Everything is placed in stereo and fed through a synthesized lake reverb,
// a snow muffle filter, and a limiter so stacked sounds never clip.
//
// Optional: set LOON_SAMPLE_URL to a public-domain loon recording (e.g. from
// the National Park Service) to use it instead of the synthesized loon.

(() => {
    const LOON_SAMPLE_URL = ""; // e.g. "sounds/loon.mp3"

    window.createBiglakeAudio = function createBiglakeAudio(ac, getState, options = {}) {
        let volume = options.volume ?? 0.7;
        const now = () => ac.currentTime;
        const rand = (a, b) => a + Math.random() * (b - a);

        // --- output chain: busses -> muffle -> limiter -> fade -> speakers --
        const out = ac.createGain();
        out.gain.value = 0;
        const limiter = ac.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 6;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.25;
        const muffle = ac.createBiquadFilter(); // closes down in snow
        muffle.type = "lowpass";
        muffle.frequency.value = 18000;
        muffle.connect(limiter).connect(out).connect(ac.destination);

        const dry = ac.createGain();
        dry.connect(muffle);
        const reverb = ac.createConvolver();
        reverb.buffer = lakeImpulse(3.4);
        const wet = ac.createGain();
        wet.gain.value = 0.4;
        reverb.connect(wet).connect(muffle);

        // fade in
        out.gain.setValueAtTime(0, now());
        out.gain.linearRampToValueAtTime(volume, now() + 1.5);

        // --- noise sources ----------------------------------------------
        const white = noiseBuffer(3, "white");
        const brown = noiseBuffer(4, "brown");

        function noiseBuffer(seconds, kind) {
            const len = Math.floor(ac.sampleRate * seconds);
            const buf = ac.createBuffer(1, len, ac.sampleRate);
            const d = buf.getChannelData(0);
            let last = 0;
            for (let i = 0; i < len; i++) {
                const w = Math.random() * 2 - 1;
                if (kind === "brown") {
                    last = (last + 0.02 * w) / 1.02;
                    d[i] = last * 3.5;
                } else {
                    d[i] = w;
                }
            }
            return buf;
        }

        // A wide, dark decay: sound carrying across open water.
        function lakeImpulse(seconds) {
            const len = Math.floor(ac.sampleRate * seconds);
            const buf = ac.createBuffer(2, len, ac.sampleRate);
            for (let ch = 0; ch < 2; ch++) {
                const d = buf.getChannelData(ch);
                let lp = 0;
                for (let i = 0; i < len; i++) {
                    const t = i / len;
                    lp += (Math.random() * 2 - 1 - lp) * 0.35; // darker tail
                    d[i] = lp * Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1);
                }
            }
            return buf;
        }

        // --- routing ------------------------------------------------------
        // Returns an input node placed at `pan` (-1..1), with `send` going
        // to the reverb.
        function route(pan = 0, send = 0.1) {
            const input = ac.createGain();
            let tail = input;
            if (ac.createStereoPanner) {
                const p = ac.createStereoPanner();
                p.pan.value = Math.max(-1, Math.min(1, pan));
                input.connect(p);
                tail = p;
            }
            tail.connect(dry);
            if (send > 0) {
                const s = ac.createGain();
                s.gain.value = send;
                tail.connect(s).connect(reverb);
            }
            return input;
        }

        function loop(buffer) {
            const src = ac.createBufferSource();
            src.buffer = buffer;
            src.loop = true;
            src.start(now(), Math.random() * buffer.duration);
            return src;
        }

        function filter(type, freq, q = 0.7) {
            const f = ac.createBiquadFilter();
            f.type = type;
            f.frequency.value = freq;
            f.Q.value = q;
            return f;
        }

        // Attack/decay envelope on a gain node.
        function envelope(gain, t, peak, attack, dur) {
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(peak, t + attack);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        }

        // A one-shot burst of filtered noise.
        function burst(t, { buffer = white, type = "bandpass", freq = 2000, q = 1, peak = 0.2, attack = 0.002, dur = 0.05, pan = 0, send = 0.05, sweepTo = null }) {
            const src = ac.createBufferSource();
            src.buffer = buffer;
            const f = filter(type, freq, q);
            if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
            const g = ac.createGain();
            envelope(g, t, peak, attack, dur);
            src.connect(f).connect(g).connect(route(pan, send));
            src.start(t, Math.random() * (buffer.duration - dur - 0.1));
            src.stop(t + dur + 0.05);
        }

        // A one-shot tone with a frequency path [[time offset, freq], ...].
        function tone(t, { path, peak = 0.05, attack = 0.02, dur = 0.3, type = "sine", pan = 0, send = 0.2, harmonic = 0, lowpass = 0, vibrato = null, tremolo = null }) {
            const g = ac.createGain();
            envelope(g, t, peak, attack, dur);
            let head = g;
            if (lowpass) {
                const f = filter("lowpass", lowpass);
                g.connect(f);
                head = f;
            }
            head.connect(route(pan, send));
            const voices = [[1, 1]];
            if (harmonic) voices.push([2, harmonic]);
            for (const [mult, level] of voices) {
                const o = ac.createOscillator();
                o.type = type;
                o.frequency.setValueAtTime(path[0][1] * mult, t);
                for (const [dt, f] of path.slice(1)) o.frequency.exponentialRampToValueAtTime(f * mult, t + dt);
                if (vibrato) {
                    const lfo = ac.createOscillator();
                    const depth = ac.createGain();
                    lfo.frequency.value = vibrato.rate;
                    depth.gain.value = vibrato.depth * mult;
                    lfo.connect(depth).connect(o.frequency);
                    lfo.start(t);
                    lfo.stop(t + dur);
                }
                const lv = ac.createGain();
                lv.gain.value = level;
                if (tremolo) {
                    // amplitude wobble: gain swings around 1 - depth/2
                    const lfo = ac.createOscillator();
                    const depth = ac.createGain();
                    lfo.frequency.value = tremolo.rate;
                    depth.gain.value = (tremolo.depth / 2) * level;
                    lv.gain.value = level * (1 - tremolo.depth / 2);
                    lfo.connect(depth).connect(lv.gain);
                    lfo.start(t);
                    lfo.stop(t + dur);
                }
                o.connect(lv).connect(g);
                o.start(t);
                o.stop(t + dur + 0.05);
            }
        }

        // --- continuous beds ------------------------------------------------
        const st0 = getState();

        // Fire roar: deep brown noise that swells with the flames.
        const roarGain = ac.createGain();
        roarGain.gain.value = 0;
        loop(brown).connect(filter("lowpass", 300)).connect(roarGain).connect(route(st0.firePan, 0.05));
        // Flame breath: a soft mid-range rush on top of the roar.
        const breathGain = ac.createGain();
        breathGain.gain.value = 0;
        loop(white).connect(filter("bandpass", 700, 0.5)).connect(breathGain).connect(route(st0.firePan, 0.05));

        // Wind: a band of noise that moves with the gusts, plus a high hiss
        // through the spruce needles. Panned toward where it comes from.
        const windBand = filter("bandpass", 450, 0.8);
        const windGain = ac.createGain();
        windGain.gain.value = 0;
        const windPanNode = ac.createStereoPanner ? ac.createStereoPanner() : null;
        const windOut = route(0, 0.15);
        const windChain = loop(white).connect(windBand).connect(windGain);
        if (windPanNode) windChain.connect(windPanNode).connect(windOut);
        else windChain.connect(windOut);
        const needleGain = ac.createGain();
        needleGain.gain.value = 0;
        const needleChain = loop(white).connect(filter("highpass", 3000)).connect(needleGain);
        if (windPanNode) needleChain.connect(windPanNode);
        else needleChain.connect(windOut);

        // Rain: a steady hiss on the water.
        const rainGain = ac.createGain();
        rainGain.gain.value = 0;
        loop(white).connect(filter("highpass", 1200)).connect(filter("lowpass", 8000)).connect(rainGain).connect(route(0, 0.1));

        // Lake: a very low murmur under everything when the water is open.
        const lakeGain = ac.createGain();
        lakeGain.gain.value = 0;
        loop(brown).connect(filter("lowpass", 450)).connect(lakeGain).connect(route(0, 0.2));

        // --- one-shots: fire ------------------------------------------------

        function snap(t, pan, strength = 1) {
            burst(t, { freq: rand(1500, 6000), q: 0.9, peak: rand(0.2, 0.55) * strength, attack: 0.001, dur: rand(0.004, 0.02), pan });
            // a second, tiny crack right after makes it sound like wood
            if (Math.random() < 0.5)
                burst(t + rand(0.003, 0.015), { type: "highpass", freq: 5000, peak: rand(0.08, 0.2) * strength, attack: 0.001, dur: 0.004, pan });
        }

        function sapHiss(t, pan) {
            burst(t, { freq: rand(5000, 8000), q: 2, peak: rand(0.02, 0.04), attack: 0.06, dur: rand(0.15, 0.5), pan });
        }

        function thump(t, pan, strength = 1) {
            tone(t, { path: [[0, 70], [0.25, 38]], peak: 0.3 * strength, attack: 0.005, dur: 0.3, pan, send: 0.05 });
            burst(t, { buffer: brown, type: "lowpass", freq: 220, peak: 0.25 * strength, attack: 0.005, dur: 0.22, pan });
        }

        function whoosh(t, pan) {
            burst(t, { freq: 300, sweepTo: 1600, q: 0.6, peak: 0.16, attack: 0.25, dur: 0.8, pan, send: 0.1 });
        }

        // --- one-shots: water -----------------------------------------------

        function lap(t, pan, size) {
            // the wave rolling in: a falling band of noise
            burst(t, { freq: 800, sweepTo: 260, q: 0.8, peak: 0.07 * size, attack: 0.35, dur: 1.3, pan, send: 0.15 });
            // and slapping the stones
            burst(t + rand(0.4, 0.6), { type: "lowpass", freq: 650, peak: 0.05 * size, attack: 0.01, dur: 0.14, pan, send: 0.1 });
        }

        function gurgle(t, pan) {
            const blips = 2 + Math.floor(Math.random() * 3);
            let at = t;
            for (let i = 0; i < blips; i++) {
                const f = rand(320, 750);
                tone(at, { path: [[0, f], [0.05, f * rand(0.7, 1.4)]], peak: 0.018, attack: 0.005, dur: 0.06, pan, send: 0.2, lowpass: 1500 });
                at += rand(0.04, 0.12);
            }
        }

        // A raindrop on water: a tiny bubble that rises in pitch.
        function plink(t, pan) {
            const f = rand(1400, 3800);
            tone(t, { path: [[0, f], [0.025, f * 1.6]], peak: rand(0.01, 0.03), attack: 0.002, dur: 0.045, pan, send: 0.15 });
        }

        // --- one-shots: ice -------------------------------------------------

        // "Singing" ice: a crack travels through the sheet and arrives as a
        // falling, laser-like chirp (high frequencies outrun low ones),
        // echoing back off the far shore.
        function iceSing(t, pan) {
            const top = rand(2500, 4500);
            const dur = rand(0.5, 1.3);
            for (let echo = 0; echo < 3; echo++) {
                tone(t + echo * rand(0.22, 0.35), {
                    path: [[0, top * (1 - echo * 0.08)], [dur, rand(180, 320)]],
                    peak: 0.05 * Math.pow(0.45, echo),
                    attack: 0.004,
                    dur,
                    pan: pan * (1 - echo * 0.3),
                    send: 0.5,
                });
            }
        }

        function iceBoom(t, pan) {
            if (Math.random() < 0.6) burst(t, { freq: 2200, q: 1.5, peak: 0.05, attack: 0.001, dur: 0.05, pan, send: 0.4 });
            tone(t + 0.02, { path: [[0, 60], [1.2, 32]], peak: 0.28, attack: 0.01, dur: 1.4, pan, send: 0.45 });
            burst(t + 0.02, { buffer: brown, type: "lowpass", freq: 160, peak: 0.2, attack: 0.01, dur: 0.9, pan, send: 0.4 });
        }

        // --- one-shots: weather -------------------------------------------

        // Distance 0 (close: a sharp crack) .. 1 (far: low rolling rumble).
        function thunder(t, distance) {
            if (distance < 0.4) burst(t, { type: "highpass", freq: 1000, peak: 0.3, attack: 0.002, dur: 0.18, send: 0.4 });
            const parts = 4 + Math.floor(Math.random() * 3);
            let at = t;
            for (let i = 0; i < parts; i++) {
                burst(at, {
                    buffer: brown, type: "lowpass", freq: rand(120, 320 - distance * 150),
                    peak: rand(0.25, 0.5) * (1 - distance * 0.5), attack: rand(0.08, 0.4),
                    dur: rand(1.5, 3.2), pan: rand(-0.5, 0.5), send: 0.6,
                });
                at += rand(0.25, 0.8);
            }
        }

        // --- one-shots: wildlife ------------------------------------------

        // Great horned owl: "hoo, hoo-hoo, hoooo, hoo", far off in the spruce.
        function owl(t, pan) {
            const notes = [[0.32, 0.12], [0.13, 0.05], [0.13, 0.18], [0.55, 0.22], [0.36, 0]];
            const base = rand(300, 345);
            let at = t;
            for (const [dur, gap] of notes) {
                tone(at, { path: [[0, base], [dur, base * 0.9]], peak: 0.06, attack: 0.04, dur, pan, send: 0.55, harmonic: 0.08, lowpass: 900 });
                at += dur + gap;
            }
        }

        let loonBuffer = null;
        if (LOON_SAMPLE_URL) {
            fetch(LOON_SAMPLE_URL)
                .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
                .then((b) => ac.decodeAudioData(b))
                .then((buf) => (loonBuffer = buf))
                .catch(() => {});
        }

        // Common loon, calling across the water: the rising "wail" or the
        // quavering "tremolo". Lots of reverb: it should sound far away.
        function loon(t, pan) {
            if (loonBuffer) {
                const src = ac.createBufferSource();
                src.buffer = loonBuffer;
                src.playbackRate.value = rand(0.97, 1.03);
                const g = ac.createGain();
                g.gain.value = 0.5;
                src.connect(g).connect(route(pan, 0.5));
                src.start(t);
                return;
            }
            if (Math.random() < 0.7) {
                // wail: oooo-AHH-ooo, two long sliding notes
                const f = rand(560, 640);
                tone(t, {
                    path: [[0, f], [0.45, f * 1.6], [1.7, f * 1.58], [2.0, f * 1.33], [2.6, f * 1.33]],
                    peak: 0.06, attack: 0.3, dur: 2.9, pan, send: 0.6, harmonic: 0.18, lowpass: 2600,
                    vibrato: { rate: 5.5, depth: 7 },
                });
                if (Math.random() < 0.5)
                    tone(t + 3.3, {
                        path: [[0, f * 1.33], [0.4, f * 1.8], [1.5, f * 1.75]],
                        peak: 0.045, attack: 0.25, dur: 1.8, pan, send: 0.6, harmonic: 0.18, lowpass: 2600,
                        vibrato: { rate: 5.5, depth: 7 },
                    });
            } else {
                // tremolo: a fast, laughing quaver
                const f = rand(900, 1050);
                tone(t, {
                    path: [[0, f], [0.6, f * 1.08], [1.4, f * 0.97], [2.0, f * 1.04]],
                    peak: 0.05, attack: 0.08, dur: 2.0, pan, send: 0.55, harmonic: 0.15, lowpass: 2800,
                    tremolo: { rate: 9, depth: 0.9 },
                });
            }
        }

        // --- scheduling -----------------------------------------------------
        // Poisson-ish: on average `rate` events per second.
        function chance(rate, dt) {
            let n = 0;
            let expected = rate * dt;
            while (expected > 0) {
                if (Math.random() < Math.min(1, expected)) n++;
                expected -= 1;
            }
            return n;
        }

        let nextLap = now() + rand(1, 3);
        let nextAnimal = now() + rand(8, 20);
        let gust = 0.5;
        let gustTarget = 0.5;
        let nextGust = 0;
        let stopped = false;

        function update(dt) {
            if (stopped) return;
            const st = getState();
            const t = now();
            const smooth = (param, value, tc = 0.3) => param.setTargetAtTime(value, t, tc);

            // fire
            const heat = st.energy * st.intensity;
            smooth(roarGain.gain, 0.03 + 0.06 * heat);
            smooth(breathGain.gain, 0.006 + 0.012 * heat, 0.15);
            for (let i = chance(5 * heat, dt); i > 0; i--) snap(t + rand(0, dt), st.firePan + rand(-0.12, 0.12), rand(0.6, 1));
            for (let i = chance(0.3 * heat, dt); i > 0; i--) sapHiss(t + rand(0, dt), st.firePan + rand(-0.1, 0.1));
            for (let i = chance(0.05, dt); i > 0; i--) thump(t + rand(0, dt), st.firePan, rand(0.5, 1));

            // wind: gusts wander toward a new target every 1-3 seconds
            if (t > nextGust) {
                gustTarget = rand(0.2, 1);
                nextGust = t + rand(1, 3);
            }
            gust += (gustTarget - gust) * Math.min(1, dt * 0.8);
            const w = st.windStrength * gust;
            smooth(windGain.gain, w * 0.11, 0.4);
            smooth(needleGain.gain, w * 0.025, 0.4);
            smooth(windBand.frequency, 260 + 520 * gust, 0.5);
            if (windPanNode) smooth(windPanNode.pan, Math.max(-0.8, Math.min(0.8, -st.wind * 0.35)), 1);

            // water or ice
            if (!st.frozen) {
                smooth(lakeGain.gain, 0.012, 1);
                if (t > nextLap) {
                    lap(t, rand(-0.7, 0.7), 0.7 + st.windStrength * 0.6);
                    nextLap = t + rand(2.5, 5.5) / (1 + st.windStrength);
                }
                for (let i = chance(0.15, dt); i > 0; i--) gurgle(t + rand(0, dt), rand(-0.6, 0.6));
            } else {
                smooth(lakeGain.gain, 0, 1);
                const cold = st.tempF != null && st.tempF < 10 ? 1.6 : 1;
                for (let i = chance((1 / 14) * cold, dt); i > 0; i--) {
                    const pan = rand(-0.9, 0.9);
                    if (Math.random() < 0.75) iceSing(t + rand(0, dt), pan);
                    else iceBoom(t + rand(0, dt), pan);
                }
            }

            // rain and snow
            smooth(rainGain.gain, st.rain * 0.09, 0.8);
            for (let i = chance(st.rain * 30, dt); i > 0; i--) plink(t + rand(0, dt), rand(-0.8, 0.8));
            smooth(muffle.frequency, st.snow > 0 || st.fog ? 2400 : 18000, 2);

            // wildlife, now and then
            if (t > nextAnimal) {
                const summer = st.month >= 4 && st.month <= 8;
                const winter = st.month >= 9 || st.month <= 2;
                const evening = st.phase !== "day";
                if (summer && evening && !st.frozen) loon(t, rand(-0.8, 0.8));
                else if (winter && st.phase === "night") owl(t, Math.random() < 0.5 ? rand(-0.85, -0.4) : rand(0.4, 0.85));
                nextAnimal = t + (summer ? rand(30, 80) : rand(45, 110));
            }
        }

        return {
            update,
            stoke() {
                const st = getState();
                const t = now();
                whoosh(t, st.firePan);
                thump(t + 0.05, st.firePan, 0.8);
                for (let i = 0; i < 6; i++) snap(t + rand(0.05, 0.6), st.firePan + rand(-0.15, 0.15));
            },
            // Called on a lightning flash; the rumble arrives later, as if
            // from a few kilometres away.
            thunder() {
                const distance = Math.random();
                thunder(now() + 0.3 + distance * 4, distance);
            },
            // Trigger one sound by name now (handy for testing / curiosity):
            // "loon", "owl", "ice", "boom", "thunder", "lap", "stoke".
            play(name) {
                const t = now();
                const st = getState();
                const sounds = {
                    loon: () => loon(t, rand(-0.6, 0.6)),
                    owl: () => owl(t, rand(-0.8, 0.8)),
                    ice: () => iceSing(t, rand(-0.8, 0.8)),
                    boom: () => iceBoom(t, rand(-0.5, 0.5)),
                    thunder: () => thunder(t, Math.random()),
                    lap: () => lap(t, rand(-0.6, 0.6), 1),
                    stoke: () => this.stoke(),
                };
                if (sounds[name]) sounds[name]();
                return st && !!sounds[name];
            },
            setVolume(v) {
                volume = v;
                out.gain.setTargetAtTime(v, now(), 0.1);
            },
            suspend() {
                if (ac.state === "running") ac.suspend();
            },
            resume() {
                if (ac.state === "suspended") ac.resume();
            },
            // Fade out, then release the audio device.
            stop() {
                stopped = true;
                out.gain.cancelScheduledValues(now());
                out.gain.setTargetAtTime(0, now(), 0.12);
                setTimeout(() => ac.close(), 600);
            },
        };
    };
})();
