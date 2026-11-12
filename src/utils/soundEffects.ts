// High-fidelity synthesized audio engine for stopwatch tick and celebratory auction victory fanfare
// Uses standard Web Audio API with zero latency, active debounce, and backlog prevention

let audioCtx: AudioContext | null = null;
let lastTickTimestamp = 0;
let activeTickOsc: OscillatorNode | null = null;
let activeTickGain: GainNode | null = null;

// Eagerly unlock / resume AudioContext on the first user interaction (touch, click, key)
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch {
      // ignore
    }
  };

  ['click', 'touchstart', 'touchend', 'keydown', 'pointerdown'].forEach((evt) => {
    window.addEventListener(evt, unlockAudio, { passive: true, capture: true });
  });
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  return audioCtx;
}

/**
 * Plays a realistic stopwatch clock tick synchronized with each passing second.
 * Includes jitter protection so delayed network packets never cause bunched, overlapping sounds.
 * @param isUrgent true when timer is at 5 seconds or below for dramatic tension
 */
export function playStopwatchTick(isUrgent: boolean = false) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // If audio context is not running yet, resume it but DO NOT schedule a backlog tick
    if (ctx.state !== 'running') {
      ctx.resume().catch(() => {});
      return;
    }

    const nowTime = performance.now();
    // Guard against network jitter or duplicate calls: minimum 650ms between ticks
    if (nowTime - lastTickTimestamp < 650) {
      return;
    }
    lastTickTimestamp = nowTime;

    // Clean up any previously active tick immediately to avoid acoustic overlap
    if (activeTickOsc) {
      try {
        activeTickOsc.stop();
        activeTickOsc.disconnect();
      } catch {
        // ignore
      }
      activeTickOsc = null;
    }

    const ctxNow = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    activeTickOsc = osc;
    activeTickGain = gain;

    // High precision mechanical auction clock tick
    const baseFreq = isUrgent ? 1150 : 880;
    osc.type = isUrgent ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(baseFreq, ctxNow);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.45, ctxNow + 0.03);

    // Bandpass filter for clean acoustic click with no muddy low-end
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(baseFreq, ctxNow);
    filter.Q.setValueAtTime(3.5, ctxNow);

    // Tight percussive decay envelope
    const peakVolume = isUrgent ? 0.20 : 0.12;
    gain.gain.setValueAtTime(0.0001, ctxNow);
    gain.gain.exponentialRampToValueAtTime(peakVolume, ctxNow + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctxNow + 0.03);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctxNow);
    osc.stop(ctxNow + 0.035);

    osc.onended = () => {
      try {
        osc.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
      if (activeTickOsc === osc) {
        activeTickOsc = null;
        activeTickGain = null;
      }
    };
  } catch {
    // Graceful fallback
  }
}

/**
 * Plays a victorious celebration fanfare when an auction is won
 */
export function playWinningSoundtrack() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const playFanfare = () => {
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;

      // Victory fanfare notes: C5, E5, G5, C6
      const notes = [
        { freq: 523.25, time: 0.00, duration: 0.14 }, // C5
        { freq: 659.25, time: 0.12, duration: 0.14 }, // E5
        { freq: 783.99, time: 0.24, duration: 0.16 }, // G5
        { freq: 1046.50, time: 0.38, duration: 0.30 }, // C6
      ];

      notes.forEach((note) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(note.freq, now + note.time);

        gain.gain.setValueAtTime(0.0001, now + note.time);
        gain.gain.exponentialRampToValueAtTime(0.18, now + note.time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + note.time + note.duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + note.time);
        osc.stop(now + note.time + note.duration);
      });

      // Sustained triumphant major chord (C5, G5, C6, E6)
      const chordTime = now + 0.65;
      const chordDuration = 1.35;
      const chordFreqs = [523.25, 659.25, 783.99, 1046.50];

      chordFreqs.forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, chordTime);

        gain.gain.setValueAtTime(0.0001, chordTime);
        gain.gain.exponentialRampToValueAtTime(0.10, chordTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, chordTime + chordDuration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(chordTime);
        osc.stop(chordTime + chordDuration);
      });
    };

    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        playFanfare();
      }).catch(() => {});
    } else if (ctx.state === 'running') {
      playFanfare();
    }
  } catch {
    // Graceful fallback
  }
}
