// Procedural sound. Everything is synthesised at runtime from oscillators and
// filtered noise, so the game stays a no-build, no-asset deploy and nothing has
// to be downloaded before it can be heard.
//
// Browsers will not start an AudioContext without a user gesture, and the game
// already begins on one (a key, a tap, or a controller button at the title), so
// resume() is called there rather than on load.

const MUTE_KEY = 'alien-digger:muted';

export function createAudio() {
  let ctx = null;
  let master = null;
  let drillGain = null;
  let droneGain = null;
  let droneFilter = null;
  let droneOscs = null;
  let alarmOn = false;
  let alarmT = 0;
  let noiseBuf = null;
  let musicGain = null;
  let musicStep = 0;
  let musicNext = 0;        // audio-clock time of the next sixteenth
  let intensity = 0;        // 0..1, driven by depth
  let escapeMode = false;

  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* blocked storage */ }

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
    } catch {
      return false;
    }

    // Everything sums into one bus, and an explosion peaks nearly five times
    // higher than an ore chime, so layering the drill, the ambience, an alarm
    // and a hit clipped. The compressor is the cheapest honest fix.
    const squash = ctx.createDynamicsCompressor();
    squash.threshold.value = -16;
    squash.knee.value = 24;
    squash.ratio.value = 6;
    squash.attack.value = 0.004;
    squash.release.value = 0.18;
    squash.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(squash);

    // One second of noise, reused for every percussive sound.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // The drill is a continuous voice whose gain is ducked rather than a sound
    // retriggered per frame, which would machine-gun and click.
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 780;
    band.Q.value = 1.4;
    drillGain = ctx.createGain();
    drillGain.gain.value = 0;
    src.connect(band).connect(drillGain).connect(master);
    src.start();
    drillGain.band = band;

    // Ambience: two detuned low oscillators through a lowpass that closes as
    // you descend, so the world gets heavier underfoot rather than the game
    // playing in silence. Deliberately near-subsonic and quiet -- it should be
    // noticed on the way out, not on the way in.
    droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 300;
    droneFilter.Q.value = 0.7;
    droneOscs = [ctx.createOscillator(), ctx.createOscillator()];
    droneOscs[0].type = 'sawtooth';
    droneOscs[1].type = 'triangle';
    droneOscs[0].frequency.value = 42;
    droneOscs[1].frequency.value = 63;
    for (const o of droneOscs) { o.connect(droneFilter); o.start(); }
    droneFilter.connect(droneGain).connect(master);

    // Music gets its own bus so it can sit well under the effects. It is the
    // only thing here that plays continuously whether or not anything is
    // happening, so it has to be the quietest thing in the mix.
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.34;
    musicGain.connect(master);

    return true;
  }

  // -------------------------------------------------------------------- music
  // A generative score rather than a loop. There is no audio file to download,
  // so the music is built from the same oscillators as every other sound, and
  // because it is generated it can read the run instead of repeating: depth
  // drives tempo and density, and arming the charges switches it to the escape
  // figure. Four bars of D minor -- i, VI, III, VII -- which is enough harmony
  // to sit under a game for twenty minutes without announcing itself.
  const PROG = [
    { root: 73.42, third: 87.31, fifth: 110.00 },   // Dm   D  F  A
    { root: 58.27, third: 73.42, fifth: 87.31 },    // Bb   Bb D  F
    { root: 87.31, third: 110.00, fifth: 130.81 },  // F    F  A  C
    { root: 65.41, third: 82.41, fifth: 98.00 },    // C    C  E  G
  ];
  const BPM_CALM = 84, BPM_DEEP = 116, BPM_RUN = 148;
  const LOOKAHEAD = 0.25;   // seconds of notes queued ahead of the clock

  function mvoice(freq, dur, peak, type, at) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(musicGain);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  function mperc(at, peak, freq) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    src.connect(f).connect(g).connect(musicGain);
    src.start(at);
    src.stop(at + 0.12);
  }

  function playStep(i, at, dur) {
    const chord = PROG[(i >> 4) & 3];
    const s = i & 15;
    const lvl = escapeMode ? 1 : intensity;

    // The spine. Always there, so even the surface has something underfoot.
    if (s === 0 || s === 6 || s === 11) {
      mvoice(chord.root, dur * (s === 0 ? 5 : 3), 0.16, 'triangle', at);
    }
    // A held fifth that swells with depth.
    if (s === 0) mvoice(chord.fifth / 2, dur * 14, 0.05 + lvl * 0.05, 'sawtooth', at);

    // Lead: silent near the surface, busier the deeper it gets, so the music
    // thickens on the way down without ever being announced.
    if (lvl > 0.22 && (s === 0 || s === 4 || s === 7 || s === 10 || s === 14)) {
      const pick = [chord.third, chord.fifth, chord.root * 2, chord.fifth][(i >> 1) & 3];
      mvoice(pick * 2, dur * 2.2, 0.05 + lvl * 0.03, 'square', at);
    }

    // Percussion only once the world is heavy.
    if (lvl > 0.42 && (s === 4 || s === 12)) mperc(at, 0.09 + lvl * 0.05, 1800);

    // Escape: a driving pulse and an urgent semitone figure over the top. The
    // alarm is already beeping, so this leans on rhythm rather than pitch.
    if (escapeMode) {
      if (s % 2 === 0) mperc(at, 0.06, 3200);
      if (s === 2 || s === 9) mvoice(chord.root * 4 * (s === 2 ? 1 : 1.06), dur * 1.6, 0.07, 'square', at);
    }
  }

  // Queues whatever falls inside the lookahead window. Scheduling against the
  // audio clock rather than the frame clock is what keeps the pulse steady when
  // a frame runs long -- and the whole file already learned that lesson once,
  // when the escape alarm drifted on a setInterval.
  function scheduleMusic() {
    if (!ctx || !musicGain) return;
    const bpm = escapeMode ? BPM_RUN : BPM_CALM + (BPM_DEEP - BPM_CALM) * intensity;
    const dur = 60 / bpm / 4;
    const now = ctx.currentTime;
    // A backgrounded tab suspends the clock; catching up by playing every
    // missed note at once would be a burst of noise, so the cursor resets.
    if (musicNext < now) musicNext = now + 0.05;
    while (musicNext < now + LOOKAHEAD) {
      if (!muted) playStep(musicStep, musicNext, dur);
      musicNext += dur;
      musicStep = (musicStep + 1) & 63;
    }
  }

  function noise(dur, freq, peak, type = 'lowpass') {
    if (!ensure()) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur);
  }

  // `when` is an offset in seconds on the audio clock. Sequences used to be
  // chained with setTimeout, which drifts against the audio, keeps firing while
  // the tab is backgrounded, and plays the tail of a lost run over the start of
  // the next one if the player restarts quickly.
  function tone(freq, dur, peak, type = 'square', to = null, when = 0) {
    if (!ensure()) return;
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime + when;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  return {
    // Called from the first real gesture, which the title screen already owns.
    resume() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    },

    get muted() { return muted; },

    toggleMute() {
      muted = !muted;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
      if (master) master.gain.value = muted ? 0 : 0.6;
      return muted;
    },

    // Harder rock grinds lower and louder, so the strata are audible.
    drill(active, hardness = 1) {
      if (!ensure() || !drillGain) return;
      const t = ctx.currentTime;
      drillGain.band.frequency.setTargetAtTime(1150 - Math.min(hardness, 2.5) * 260, t, 0.08);
      drillGain.gain.setTargetAtTime(active ? 0.09 : 0, t, 0.04);
    },

    // Called with 0..1 depth. Cheap enough to hit every frame: it only ever
    // nudges targets, and the ramps do the work on the audio thread.
    ambience(depth, escaping) {
      if (!ensure() || !droneGain) return;
      const t = ctx.currentTime;
      const d = Math.max(0, Math.min(1, depth));
      // The music reads the same two numbers the drone does, so it needs no
      // call sites of its own -- the game already tells us how deep it is and
      // whether the charges are armed.
      intensity = d;
      escapeMode = !!escaping;
      droneGain.gain.setTargetAtTime(0.055 + d * 0.07, t, 0.6);
      droneFilter.frequency.setTargetAtTime(320 - d * 190, t, 0.6);
      // the planet is armed and unhappy about it
      droneOscs[0].frequency.setTargetAtTime(escaping ? 54 : 42 - d * 6, t, 0.8);
      droneOscs[1].frequency.setTargetAtTime(escaping ? 81 : 63 - d * 9, t, 0.8);
    },

    breakTile(hardness = 1) { noise(0.16, 900 - hardness * 180, 0.36); },
    // Ore going over the side: a dull thud, deliberately unmusical, so it can
    // never be mistaken for the chime that means ore coming aboard.
    dump() { noise(0.14, 420, 0.26); tone(150, 0.13, 0.15, 'triangle', 90); },
    // Pitch climbs with the tier, and the top two get a third note, so a pulse
    // crystal sounds like a find and copper sounds like copper.
    ore(tier = 0) {
      const root = 660 * Math.pow(1.16, tier);
      tone(root, 0.1, 0.16, 'square');
      tone(root * 1.5, 0.16, 0.13, 'square');
      if (tier >= 3) tone(root * 2, 0.22, 0.12, 'square', null, 0.07);
    },
    fuel() { tone(420, 0.2, 0.2, 'triangle', 900); },
    repair() { tone(300, 0.22, 0.18, 'sine', 620); },
    hurt() { noise(0.22, 420, 0.5); tone(150, 0.16, 0.2, 'sawtooth', 70); },
    plant() { tone(560, 0.1, 0.22, 'square'); tone(760, 0.16, 0.18, 'square'); },
    kill() { noise(0.26, 620, 0.34); tone(200, 0.2, 0.16, 'sawtooth', 90); },
    explode() { noise(1.1, 260, 0.75); tone(90, 0.8, 0.3, 'sawtooth', 35); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.26, 0.2, 'square', null, i * 0.13)); },
    lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 0.2, 'sawtooth', null, i * 0.16)); },
    warn() { tone(1000, 0.08, 0.12, 'square'); },
    // a falling zap with a little grit under it
    laser() { tone(1500, 0.18, 0.16, 'sawtooth', 220); noise(0.12, 2400, 0.14); },

    // The escape countdown gets its own pulse so the clock is audible while the
    // player is watching the shaft rather than the HUD. Driven from the game
    // loop rather than setInterval: an interval kept beeping after a restart
    // because nothing cleared it, and it drifted against the audio clock.
    alarm(on) { alarmOn = on; if (!on) alarmT = 0; },

    // Called once a frame with the frame's delta.
    tick(dt) {
      scheduleMusic();
      if (!alarmOn) return;
      alarmT -= dt;
      if (alarmT <= 0) {
        alarmT = 0.9;
        tone(620, 0.09, 0.15, 'square');
      }
    },

    // Quietens the score without stopping it, for the title and the Foundry --
    // places where the player is reading rather than playing.
    musicCalm(calm) {
      if (!ensure() || !musicGain) return;
      musicGain.gain.setTargetAtTime(calm ? 0.2 : 0.34, ctx.currentTime, 0.4);
      if (calm) { intensity = 0; escapeMode = false; }
    },

    // Rubble coming down is not the player being hit, and it was borrowing the
    // damage sound, which told them the wrong thing.
    rumble() { noise(0.7, 180, 0.5); tone(58, 0.6, 0.22, 'sawtooth', 34); },

    // Distinct from the low-fuel chirp: this one is already hurting you.
    redline() { tone(240, 0.16, 0.2, 'sawtooth', 180); tone(360, 0.12, 0.12, 'square'); },
  };
}
