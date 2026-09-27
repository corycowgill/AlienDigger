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
  let alarmTimer = null;
  let noiseBuf = null;

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

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);

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

    return true;
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

  function tone(freq, dur, peak, type = 'square', to = null) {
    if (!ensure()) return;
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime;
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
      if (master) master.gain.value = muted ? 0 : 0.5;
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
      droneGain.gain.setTargetAtTime(0.055 + d * 0.07, t, 0.6);
      droneFilter.frequency.setTargetAtTime(320 - d * 190, t, 0.6);
      // the planet is armed and unhappy about it
      droneOscs[0].frequency.setTargetAtTime(escaping ? 54 : 42 - d * 6, t, 0.8);
      droneOscs[1].frequency.setTargetAtTime(escaping ? 81 : 63 - d * 9, t, 0.8);
    },

    breakTile(hardness = 1) { noise(0.16, 900 - hardness * 180, 0.36); },
    // Pitch climbs with the tier, and the top two get a third note, so a pulse
    // crystal sounds like a find and copper sounds like copper.
    ore(tier = 0) {
      const root = 660 * Math.pow(1.16, tier);
      tone(root, 0.1, 0.16, 'square');
      tone(root * 1.5, 0.16, 0.13, 'square');
      if (tier >= 3) setTimeout(() => tone(root * 2, 0.22, 0.12, 'square'), 70);
    },
    fuel() { tone(420, 0.2, 0.2, 'triangle', 900); },
    repair() { tone(300, 0.22, 0.18, 'sine', 620); },
    hurt() { noise(0.22, 420, 0.5); tone(150, 0.16, 0.2, 'sawtooth', 70); },
    plant() { tone(560, 0.1, 0.22, 'square'); tone(760, 0.16, 0.18, 'square'); },
    kill() { noise(0.26, 620, 0.34); tone(200, 0.2, 0.16, 'sawtooth', 90); },
    explode() { noise(1.1, 260, 0.75); tone(90, 0.8, 0.3, 'sawtooth', 35); },
    win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.26, 0.2, 'square'), i * 130)); },
    lose() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.3, 0.2, 'sawtooth'), i * 160)); },
    warn() { tone(1000, 0.08, 0.12, 'square'); },

    // The escape countdown gets its own pulse so the clock is audible while the
    // player is watching the shaft rather than the HUD.
    alarm(on) {
      if (on && !alarmTimer) {
        alarmTimer = setInterval(() => { tone(620, 0.09, 0.14, 'square'); }, 900);
      } else if (!on && alarmTimer) {
        clearInterval(alarmTimer);
        alarmTimer = null;
      }
    },
  };
}
