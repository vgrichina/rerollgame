// Audio command executor
// 8 channels, Web Audio API synth + sample playback

let audioCtx = null;
let masterGain = null;
const channels = new Array(8).fill(null); // active sound per channel
const sampleBuffers = {}; // preloaded AudioBuffers

const NOTE_FREQ = {};
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
for (let oct = 0; oct <= 8; oct++) {
  for (let i = 0; i < 12; i++) {
    const noteNum = oct * 12 + i;
    NOTE_FREQ[NOTES[i] + oct] = 440 * Math.pow(2, (noteNum - 57) / 12);
  }
}

const ENVELOPES = {
  sharp: { a: 0.01, d: 0.05, s: 0.3, r: 0.05 },
  soft: { a: 0.05, d: 0.1, s: 0.6, r: 0.1 },
  fade: { a: 0.02, d: 0.3, s: 0.2, r: 0.2 },
  sustain: { a: 0.01, d: 0.02, s: 0.8, r: 0.1 },
};

function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function getEnvelope(env) {
  if (!env) return ENVELOPES.sharp;
  if (typeof env === 'string') return ENVELOPES[env] || ENVELOPES.sharp;
  return env;
}

function stopChannel(ch) {
  if (channels[ch]) {
    try { channels[ch].stop(); } catch (_) {}
    channels[ch] = null;
  }
}

function playTone(cmd) {
  const ctx = ensureAudioCtx();
  const ch = cmd.ch || 0;
  stopChannel(ch);

  const freq = cmd.freq || NOTE_FREQ[cmd.note] || 440;
  const vol = cmd.vol != null ? cmd.vol : 0.5;
  const dur = cmd.dur || 0.2;
  const env = getEnvelope(cmd.env);
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = cmd.wave || 'square';
  osc.frequency.setValueAtTime(freq, now);

  if (cmd.sweep) {
    osc.frequency.linearRampToValueAtTime(cmd.sweep, now + dur);
  }

  // ADSR envelope
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + env.a);
  gain.gain.linearRampToValueAtTime(vol * env.s, now + env.a + env.d);
  gain.gain.setValueAtTime(vol * env.s, now + dur - env.r);
  gain.gain.linearRampToValueAtTime(0, now + dur);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + dur + 0.01);

  channels[ch] = osc;
}

function playNoise(cmd) {
  const ctx = ensureAudioCtx();
  const ch = cmd.ch || 0;
  stopChannel(ch);

  const dur = cmd.dur || 0.2;
  const vol = cmd.vol != null ? cmd.vol : 0.3;
  const env = getEnvelope(cmd.env);
  const now = ctx.currentTime;

  // Generate noise buffer
  const bufferSize = ctx.sampleRate * dur;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (cmd.type === 'brown') {
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  } else if (cmd.type === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else {
    // white
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + env.a);
  gain.gain.linearRampToValueAtTime(vol * env.s, now + env.a + env.d);
  gain.gain.setValueAtTime(vol * env.s, now + dur - env.r);
  gain.gain.linearRampToValueAtTime(0, now + dur);

  source.connect(gain);
  gain.connect(masterGain);
  source.start(now);

  channels[ch] = source;
}

function playSample(cmd) {
  const ctx = ensureAudioCtx();
  const buffer = sampleBuffers[cmd.id];
  if (!buffer) return;

  const ch = cmd.ch != null ? cmd.ch : 6; // default to sample channels
  stopChannel(ch);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = cmd.rate || 1;
  source.loop = cmd.loop || false;

  const gain = ctx.createGain();
  gain.gain.value = cmd.vol != null ? cmd.vol : 1;

  source.connect(gain);
  gain.connect(masterGain);
  source.start();

  channels[ch] = source;
}

export function processAudioCommands(commands) {
  for (const cmd of commands) {
    switch (cmd.op) {
      case 'tone': playTone(cmd); break;
      case 'noise': playNoise(cmd); break;
      case 'sample': playSample(cmd); break;
      case 'stop': stopChannel(cmd.ch); break;
      case 'stopAll':
        for (let i = 0; i < 8; i++) stopChannel(i);
        break;
      case 'volume':
        ensureAudioCtx();
        masterGain.gain.value = cmd.value;
        break;
    }
  }
}

// Preload sound resources into AudioBuffers
export async function preloadSounds(sounds) {
  if (!sounds) return;
  const ctx = ensureAudioCtx();

  for (const [id, res] of Object.entries(sounds)) {
    if (res.type === 'pcm') {
      const buffer = ctx.createBuffer(1, res.data.length, res.rate || 22050);
      buffer.getChannelData(0).set(res.data);
      sampleBuffers[id] = buffer;
    } else if (res.type === 'generate') {
      // Synthesize a sound buffer from description
      const dur = res.dur || 0.5;
      const rate = 44100;
      const len = Math.ceil(rate * dur);
      const buffer = ctx.createBuffer(1, len, rate);
      const data = buffer.getChannelData(0);
      const env = res.env || { a: 0.01, d: 0.1, s: 0.5, r: 0.1 };

      if (res.wave === 'noise') {
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      } else if (res.notes && res.notes.length) {
        // Play notes sequentially
        const noteDur = dur / res.notes.length;
        for (let n = 0; n < res.notes.length; n++) {
          const freq = NOTE_FREQ[res.notes[n]] || 440;
          const start = Math.floor(n * noteDur * rate);
          const end = Math.floor((n + 1) * noteDur * rate);
          for (let i = start; i < end && i < len; i++) {
            const t = (i - start) / rate;
            data[i] = Math.sin(2 * Math.PI * freq * t) * 0.5;
          }
        }
      } else {
        const freq = res.sweep ? res.sweep.from : 440;
        const freqEnd = res.sweep ? res.sweep.to : freq;
        for (let i = 0; i < len; i++) {
          const t = i / rate;
          const frac = i / len;
          const f = freq + (freqEnd - freq) * frac;
          const phase = 2 * Math.PI * f * t;
          switch (res.wave) {
            case 'sine': data[i] = Math.sin(phase); break;
            case 'square': data[i] = Math.sin(phase) > 0 ? 0.5 : -0.5; break;
            case 'sawtooth': data[i] = ((f * t) % 1) * 2 - 1; break;
            case 'triangle': data[i] = Math.abs(((f * t) % 1) * 4 - 2) - 1; break;
            default: data[i] = Math.sin(phase); break;
          }
          // Apply envelope
          let envGain = 1;
          if (t < env.a) envGain = t / env.a;
          else if (t < env.a + env.d) envGain = 1 - (1 - env.s) * ((t - env.a) / env.d);
          else if (t > dur - env.r) envGain = env.s * ((dur - t) / env.r);
          else envGain = env.s;
          data[i] *= envGain * 0.5;
        }
      }
      sampleBuffers[id] = buffer;
    }
  }
}

// Resume audio context on user gesture
export function tryResumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}
