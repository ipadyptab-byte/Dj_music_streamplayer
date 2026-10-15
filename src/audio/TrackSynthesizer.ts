import { Track, SamplerPad } from '../types';

/**
 * Procedural Audio Synthesizer for DJ Studio Pro
 * Generates full studio-grade electronic tracks and performance sampler FX
 * completely client-side with zero external assets or network dependencies.
 */

// Helper to calculate waveform peaks from an AudioBuffer
export function extractWaveformPeaks(buffer: AudioBuffer, peakCount = 400): number[] {
  const channelData = buffer.getChannelData(0);
  const step = Math.floor(channelData.length / peakCount);
  const peaks: number[] = [];

  for (let i = 0; i < peakCount; i++) {
    const start = i * step;
    const end = Math.min(start + step, channelData.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      const val = Math.abs(channelData[j]);
      if (val > max) max = val;
    }
    peaks.push(max);
  }
  return peaks;
}

/**
 * Generate 8 Essential Sampler Performance FX
 */
export async function generateSamplerBuffers(ctx: AudioContext): Promise<Map<string, AudioBuffer>> {
  const sampleMap = new Map<string, AudioBuffer>();
  const sampleRate = ctx.sampleRate;

  // 1. Airhorn (Classic Dancehall/EDM Triple Blast)
  {
    const duration = 1.2;
    const offline = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
    const pitches = [466.16, 466.16, 523.25, 622.25]; // Bb4, Bb4, C5, Eb5
    const times = [0.0, 0.22, 0.44, 0.66];
    
    times.forEach((t, idx) => {
      const osc = offline.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(pitches[idx % pitches.length], t);
      
      const filter = offline.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1400, t);
      filter.Q.setValueAtTime(3.5, t);

      const gain = offline.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.5, t + 0.03);
      gain.gain.setValueAtTime(0.45, t + 0.16);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(offline.destination);
      osc.start(t);
      osc.stop(t + 0.21);
    });

    const rendered = await offline.startRendering();
    sampleMap.set('airhorn', rendered);
  }

  // 2. Siren Riser
  {
    const duration = 2.0;
    const offline = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
    const osc = offline.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, 0);
    osc.frequency.exponentialRampToValueAtTime(1800, duration * 0.9);

    const filter = offline.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, 0);
    filter.frequency.exponentialRampToValueAtTime(6000, duration * 0.85);
    filter.Q.setValueAtTime(8, 0);

    const gain = offline.createGain();
    gain.gain.setValueAtTime(0.01, 0);
    gain.gain.linearRampToValueAtTime(0.5, 0.4);
    gain.gain.setValueAtTime(0.5, duration - 0.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(offline.destination);

    osc.start(0);
    osc.stop(duration);
    sampleMap.set('siren', await offline.startRendering());
  }

  // 3. Laser Zap
  {
    const duration = 0.5;
    const offline = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
    const osc = offline.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2400, 0);
    osc.frequency.exponentialRampToValueAtTime(80, 0.35);

    const gain = offline.createGain();
    gain.gain.setValueAtTime(0.6, 0);
    gain.gain.exponentialRampToValueAtTime(0.001, 0.4);

    osc.connect(gain);
    gain.connect(offline.destination);
    osc.start(0);
    osc.stop(0.45);
    sampleMap.set('laser', await offline.startRendering());
  }

  // 4. 808 Sub Boom Drop
  {
    const duration = 1.6;
    const offline = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
    const osc = offline.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, 0);
    osc.frequency.exponentialRampToValueAtTime(36, 0.45);
    osc.frequency.setValueAtTime(36, 0.45);

    const gain = offline.createGain();
    gain.gain.setValueAtTime(0.9, 0);
    gain.gain.exponentialRampToValueAtTime(0.001, duration - 0.05);

    osc.connect(gain);
    gain.connect(offline.destination);
    osc.start(0);
    osc.stop(duration);
    sampleMap.set('sub_drop', await offline.startRendering());
  }

  // 5. Scratch Chirp FX
  {
    const duration = 0.4;
    const offline = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
    // Mix bandpassed noise + frequency swept sine
    const osc = offline.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1200, 0);
    osc.frequency.linearRampToValueAtTime(450, 0.12);
    osc.frequency.linearRampToValueAtTime(1600, 0.28);
    osc.frequency.linearRampToValueAtTime(300, 0.38);

    const filter = offline.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, 0);
    filter.Q.setValueAtTime(6, 0);

    const gain = offline.createGain();
    gain.gain.setValueAtTime(0.6, 0);
    gain.gain.exponentialRampToValueAtTime(0.01, duration - 0.02);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(offline.destination);
    osc.start(0);
    osc.stop(duration);
    sampleMap.set('scratch_fx', await offline.startRendering());
  }

  // 6. Club Clap Reverb
  {
    const duration = 0.8;
    const offline = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
    const bufferSize = sampleRate * duration;
    const noiseBuffer = offline.createBuffer(1, bufferSize, sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = offline.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const filter = offline.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1100, 0);
    filter.Q.setValueAtTime(2.5, 0);

    const gain = offline.createGain();
    // multiple burst attacks like real clap
    [0.0, 0.012, 0.024, 0.036].forEach(t => {
      gain.gain.setValueAtTime(0.7, t);
      gain.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
    });
    gain.gain.setValueAtTime(0.8, 0.048);
    gain.gain.exponentialRampToValueAtTime(0.001, 0.7);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(offline.destination);

    whiteNoise.start(0);
    sampleMap.set('club_clap', await offline.startRendering());
  }

  // 7. Rewind Tape Backspin
  {
    const duration = 1.0;
    const offline = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
    const osc = offline.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, 0);
    osc.frequency.exponentialRampToValueAtTime(1800, 0.5);
    osc.frequency.exponentialRampToValueAtTime(60, 0.95);

    const filter = offline.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, 0);
    filter.frequency.exponentialRampToValueAtTime(3000, 0.5);
    filter.frequency.exponentialRampToValueAtTime(400, 0.95);
    filter.Q.setValueAtTime(4, 0);

    const gain = offline.createGain();
    gain.gain.setValueAtTime(0.5, 0);
    gain.gain.exponentialRampToValueAtTime(0.001, 0.98);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(offline.destination);
    osc.start(0);
    osc.stop(duration);
    sampleMap.set('rewind', await offline.startRendering());
  }

  // 8. Hype Drop "Let's Go!" Vocal formant shot
  {
    const duration = 0.7;
    const offline = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
    const osc = offline.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, 0);
    osc.frequency.linearRampToValueAtTime(220, 0.25);
    osc.frequency.linearRampToValueAtTime(140, 0.6);

    const f1 = offline.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.setValueAtTime(700, 0);
    f1.frequency.linearRampToValueAtTime(1200, 0.3);
    f1.Q.setValueAtTime(5, 0);

    const gain = offline.createGain();
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(0.8, 0.05);
    gain.gain.setValueAtTime(0.7, 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, 0.65);

    osc.connect(f1);
    f1.connect(gain);
    gain.connect(offline.destination);
    osc.start(0);
    osc.stop(0.68);
    sampleMap.set('vocal_drop', await offline.startRendering());
  }

  return sampleMap;
}

/**
 * Synthesizes a full musical track with drums, bass, leads and percussion
 */
export async function synthesizeDJTrack(
  genre: 'tech_house' | 'synthwave' | 'dnb' | 'trap' | 'trance' | 'nu_disco',
  sampleRate = 44100
): Promise<{ buffer: AudioBuffer; peaks: number[]; bpm: number; title: string; artist: string; key: string }> {
  let bpm = 126;
  let title = 'Midnight Pulse';
  let artist = 'Studio Resident';
  let key = 'Fm';
  let bars = 16;

  if (genre === 'synthwave') {
    bpm = 118;
    title = 'Neon Velocity';
    artist = 'Cyber Runner';
    key = 'Am';
  } else if (genre === 'dnb') {
    bpm = 174;
    title = 'Bassline Protocol';
    artist = 'Sub Distortion';
    key = 'Dm';
  } else if (genre === 'trap') {
    bpm = 140;
    title = 'Metro Obsidian';
    artist = '808 Phantom';
    key = 'C#m';
  } else if (genre === 'trance') {
    bpm = 132;
    title = 'Solaris Horizon';
    artist = 'Aura Flight';
    key = 'Em';
  } else if (genre === 'nu_disco') {
    bpm = 124;
    title = 'Sunset Boulevard';
    artist = 'Groove Syndicate';
    key = 'Gm';
  }

  const beatsPerBar = 4;
  const totalBeats = bars * beatsPerBar;
  const secondsPerBeat = 60 / bpm;
  const duration = totalBeats * secondsPerBeat;

  const offline = new OfflineAudioContext(2, Math.floor(sampleRate * duration), sampleRate);

  // Reverb bus for space
  const convolver = offline.createConvolver();
  const revTime = 1.4;
  const revBuf = offline.createBuffer(2, sampleRate * revTime, sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = revBuf.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.4));
    }
  }
  convolver.buffer = revBuf;

  const revSend = offline.createGain();
  revSend.gain.value = 0.22;
  revSend.connect(convolver);
  convolver.connect(offline.destination);

  // 1. Kick Drum Generation
  const scheduleKick = (time: number, velocity = 1.0) => {
    const osc = offline.createOscillator();
    const gain = offline.createGain();
    osc.type = 'sine';
    
    // Punchy pitch drop
    const startFreq = genre === 'dnb' ? 180 : genre === 'trap' ? 140 : 160;
    const endFreq = genre === 'trap' ? 38 : 48;
    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + 0.08);

    gain.gain.setValueAtTime(0.9 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + (genre === 'trap' ? 0.45 : 0.28));

    // Transient click
    const click = offline.createOscillator();
    const clickGain = offline.createGain();
    click.type = 'triangle';
    click.frequency.setValueAtTime(800, time);
    click.frequency.exponentialRampToValueAtTime(80, time + 0.02);
    clickGain.gain.setValueAtTime(0.3 * velocity, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);

    click.connect(clickGain);
    clickGain.connect(offline.destination);
    click.start(time);
    click.stop(time + 0.03);

    osc.connect(gain);
    gain.connect(offline.destination);
    osc.start(time);
    osc.stop(time + (genre === 'trap' ? 0.48 : 0.3));
  };

  // 2. Snare / Clap Generation
  const scheduleSnare = (time: number, velocity = 1.0) => {
    // Noise component
    const noiseLength = 0.25;
    const noiseBuffer = offline.createBuffer(1, Math.floor(sampleRate * noiseLength), sampleRate);
    const out = noiseBuffer.getChannelData(0);
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.random() * 2 - 1;
    }
    const noise = offline.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = offline.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(genre === 'synthwave' ? 1200 : 2000, time);
    noiseFilter.Q.setValueAtTime(1.5, time);

    const noiseGain = offline.createGain();
    noiseGain.gain.setValueAtTime(0.55 * velocity, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(offline.destination);
    noiseGain.connect(revSend);
    noise.start(time);

    // Tonal body
    const body = offline.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(220, time);
    body.frequency.exponentialRampToValueAtTime(110, time + 0.08);

    const bodyGain = offline.createGain();
    bodyGain.gain.setValueAtTime(0.4 * velocity, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

    body.connect(bodyGain);
    bodyGain.connect(offline.destination);
    body.start(time);
    body.stop(time + 0.15);
  };

  // 3. Hi-Hat Generation
  const scheduleHiHat = (time: number, open = false, velocity = 0.8) => {
    const len = open ? 0.35 : 0.06;
    const hatBuf = offline.createBuffer(1, Math.floor(sampleRate * len), sampleRate);
    const data = hatBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * (open ? 0.09 : 0.015)));
    }
    const hat = offline.createBufferSource();
    hat.buffer = hatBuf;

    const filter = offline.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(8000, time);

    const gain = offline.createGain();
    gain.gain.setValueAtTime((open ? 0.35 : 0.22) * velocity, time);

    hat.connect(filter);
    filter.connect(gain);
    gain.connect(offline.destination);
    if (open) gain.connect(revSend);
    hat.start(time);
  };

  // 4. Bass Note Generator
  const scheduleBass = (time: number, dur: number, freq: number, velocity = 0.8) => {
    const osc = offline.createOscillator();
    const oscSub = offline.createOscillator();
    osc.type = genre === 'synthwave' || genre === 'nu_disco' ? 'sawtooth' : 'triangle';
    oscSub.type = 'sine';
    
    osc.frequency.setValueAtTime(freq, time);
    oscSub.frequency.setValueAtTime(freq / 2, time);

    const filter = offline.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(genre === 'dnb' ? 600 : 350, time);
    filter.frequency.exponentialRampToValueAtTime(140, time + dur * 0.8);
    filter.Q.setValueAtTime(4, time);

    const gain = offline.createGain();
    gain.gain.setValueAtTime(0.01, time);
    gain.gain.linearRampToValueAtTime(0.6 * velocity, time + 0.02);
    gain.gain.setValueAtTime(0.55 * velocity, time + dur - 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(filter);
    oscSub.connect(filter);
    filter.connect(gain);
    gain.connect(offline.destination);

    osc.start(time);
    oscSub.start(time);
    osc.stop(time + dur);
    oscSub.stop(time + dur);
  };

  // 5. Synth Chords / Arpeggio Generator
  const scheduleChord = (time: number, dur: number, frequencies: number[], velocity = 0.5) => {
    frequencies.forEach(freq => {
      const osc = offline.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, time);

      const filter = offline.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, time);
      filter.frequency.exponentialRampToValueAtTime(2800, time + 0.08);
      filter.frequency.exponentialRampToValueAtTime(600, time + dur);
      filter.Q.setValueAtTime(2, time);

      const gain = offline.createGain();
      gain.gain.setValueAtTime(0.01, time);
      gain.gain.linearRampToValueAtTime(0.18 * velocity, time + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(offline.destination);
      gain.connect(revSend);

      osc.start(time);
      osc.stop(time + dur);
    });
  };

  // Base frequencies for root notes
  const rootMap: Record<string, number[]> = {
    tech_house: [87.31, 87.31, 103.83, 77.78], // Fm, Ab, Eb
    synthwave: [110, 87.31, 130.81, 98.0], // Am, F, C, G
    dnb: [73.42, 73.42, 87.31, 65.41], // Dm, F, C
    trap: [69.3, 69.3, 82.41, 61.74], // C#m, E, B
    trance: [82.41, 98.0, 110.0, 73.42], // Em, G, Am, D
    nu_disco: [98.0, 87.31, 116.54, 130.81] // Gm, F, Bb, C
  };
  const chordMap: Record<string, number[][]> = {
    tech_house: [
      [349.23, 415.3, 523.25], // F4, Ab4, C5
      [349.23, 415.3, 622.25],
      [415.3, 523.25, 622.25],
      [311.13, 392.0, 466.16]
    ],
    synthwave: [
      [440.0, 523.25, 659.25], // Am
      [349.23, 440.0, 523.25], // F
      [523.25, 659.25, 783.99], // C
      [392.0, 493.88, 587.33]  // G
    ],
    dnb: [
      [293.66, 349.23, 440.0], // Dm
      [349.23, 440.0, 523.25],
      [440.0, 523.25, 659.25]
    ],
    trap: [
      [277.18, 329.63, 415.3], // C#m
      [329.63, 415.3, 493.88]
    ],
    trance: [
      [329.63, 392.0, 493.88], // Em
      [392.0, 493.88, 587.33], // G
      [440.0, 523.25, 659.25], // Am
      [293.66, 369.99, 440.0]  // D
    ],
    nu_disco: [
      [392.0, 466.16, 587.33], // Gm
      [349.23, 440.0, 523.25], // F
      [466.16, 587.33, 698.46], // Bb
      [523.25, 659.25, 783.99]  // C
    ]
  };

  const roots = rootMap[genre];
  const chords = chordMap[genre];

  // Schedule beats across bars
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * beatsPerBar * secondsPerBeat;
    const root = roots[bar % roots.length];
    const currentChord = chords[bar % chords.length];

    if (genre === 'dnb') {
      // Drum and bass 174 bpm break pattern:
      // Beat 1: Kick
      // Beat 2.5: Snare
      // Beat 3.5: Kick
      // Beat 4: Snare
      scheduleKick(barStart);
      scheduleSnare(barStart + 1.5 * secondsPerBeat);
      scheduleKick(barStart + 2.5 * secondsPerBeat);
      scheduleSnare(barStart + 3.5 * secondsPerBeat);

      // Fast 16th hats
      for (let s = 0; s < 16; s++) {
        const ht = barStart + s * (secondsPerBeat / 4);
        scheduleHiHat(ht, s % 4 === 2, s % 2 === 0 ? 0.8 : 0.4);
      }

      // Reese / Sub Bass glide
      scheduleBass(barStart, secondsPerBeat * 2, root, 0.9);
      scheduleBass(barStart + secondsPerBeat * 2.25, secondsPerBeat * 1.5, root * 1.25, 0.85);

      // Lead stab
      if (bar % 2 === 1) {
        scheduleChord(barStart + secondsPerBeat * 1.5, 0.25, currentChord, 0.6);
      }
    } else if (genre === 'trap') {
      // Trap 140 bpm half-time:
      // Kick on 1 and varied
      scheduleKick(barStart, 1.0);
      if (bar % 2 === 1) {
        scheduleKick(barStart + 2.25 * secondsPerBeat, 0.85);
      }
      // Snare on beat 3
      scheduleSnare(barStart + 2 * secondsPerBeat, 1.0);

      // Rapid rolling trap hats
      for (let s = 0; s < 16; s++) {
        const ht = barStart + s * (secondsPerBeat / 4);
        // Triplets on beat 4
        if (s >= 12 && bar % 2 === 1) {
          scheduleHiHat(ht, false, 0.9);
          scheduleHiHat(ht + (secondsPerBeat / 8), false, 0.7);
        } else {
          scheduleHiHat(ht, false, s % 2 === 0 ? 0.7 : 0.35);
        }
      }

      // Long booming 808
      scheduleBass(barStart, secondsPerBeat * 3.5, root * 0.75, 1.0);

      // Dark chord stab
      scheduleChord(barStart + 0.1, 0.6, currentChord, 0.5);
    } else {
      // Four-on-the-floor (House, Synthwave, Trance, Nu-Disco)
      for (let beat = 0; beat < 4; beat++) {
        const beatTime = barStart + beat * secondsPerBeat;
        scheduleKick(beatTime, 1.0);

        // Claps/Snares on 2 and 4
        if (beat === 1 || beat === 3) {
          scheduleSnare(beatTime, 0.9);
        }

        // Off-beat open hi-hat (standard dance groove)
        scheduleHiHat(beatTime + secondsPerBeat * 0.5, true, 0.85);
        // Closed hats on 16ths
        scheduleHiHat(beatTime + secondsPerBeat * 0.25, false, 0.4);
        scheduleHiHat(beatTime + secondsPerBeat * 0.75, false, 0.5);
      }

      // Rolling 16th bassline for House / Synthwave
      for (let step = 0; step < 16; step++) {
        const stepTime = barStart + step * (secondsPerBeat / 4);
        if (genre === 'synthwave') {
          // 8th note driving bass
          if (step % 2 === 0) {
            scheduleBass(stepTime, secondsPerBeat * 0.45, step % 4 === 0 ? root : root * 2, 0.8);
          }
        } else if (genre === 'tech_house') {
          // Syncopated groove
          if (step === 2 || step === 5 || step === 8 || step === 11 || step === 14) {
            scheduleBass(stepTime, secondsPerBeat * 0.25, root, 0.9);
          }
        } else if (genre === 'nu_disco') {
          // Funk slap bass on upbeat
          if (step % 4 === 2 || step === 7 || step === 15) {
            scheduleBass(stepTime, secondsPerBeat * 0.22, root * 1.5, 0.85);
          }
        } else {
          // Trance rolling bassline
          if (step % 4 !== 0) {
            scheduleBass(stepTime, secondsPerBeat * 0.22, root, 0.75);
          }
        }
      }

      // Harmonic chords & synth stabs
      if (genre === 'tech_house') {
        // Offbeat funky chord stabs
        scheduleChord(barStart + secondsPerBeat * 1.75, 0.25, currentChord, 0.55);
        scheduleChord(barStart + secondsPerBeat * 3.75, 0.2, currentChord, 0.6);
      } else if (genre === 'synthwave') {
        // Arpeggio
        for (let i = 0; i < 8; i++) {
          const noteTime = barStart + i * (secondsPerBeat / 2);
          const arpFreq = currentChord[i % currentChord.length];
          scheduleChord(noteTime, 0.35, [arpFreq], 0.45);
        }
      } else if (genre === 'trance') {
        // Uplifting supersaw sustained
        scheduleChord(barStart, secondsPerBeat * 3.8, currentChord, 0.65);
      } else if (genre === 'nu_disco') {
        // Rhythmic disco chops on 2 & 4 offbeats
        scheduleChord(barStart + secondsPerBeat * 0.5, 0.2, currentChord, 0.5);
        scheduleChord(barStart + secondsPerBeat * 2.5, 0.2, currentChord, 0.55);
      }
    }
  }

  const renderedBuffer = await offline.startRendering();
  const peaks = extractWaveformPeaks(renderedBuffer, 400);

  return {
    buffer: renderedBuffer,
    peaks,
    bpm,
    title,
    artist,
    key
  };
}

export const INITIAL_TRACK_DEFS = [
  { id: 'track-1', genre: 'tech_house', color: '#06b6d4' },
  { id: 'track-2', genre: 'synthwave', color: '#f43f5e' },
  { id: 'track-3', genre: 'dnb', color: '#eab308' },
  { id: 'track-4', genre: 'trap', color: '#a855f7' },
  { id: 'track-5', genre: 'trance', color: '#3b82f6' },
  { id: 'track-6', genre: 'nu_disco', color: '#10b981' },
] as const;

export const SAMPLER_PAD_DEFINITIONS: SamplerPad[] = [
  { id: 1, name: 'Airhorn', category: 'fx', keyBinding: '1', color: '#f59e0b' },
  { id: 2, name: 'Siren Riser', category: 'fx', keyBinding: '2', color: '#ef4444' },
  { id: 3, name: 'Laser Zap', category: 'fx', keyBinding: '3', color: '#06b6d4' },
  { id: 4, name: '808 Sub Drop', category: 'drum', keyBinding: '4', color: '#8b5cf6' },
  { id: 5, name: 'Vinyl Scratch', category: 'fx', keyBinding: '5', color: '#ec4899' },
  { id: 6, name: 'Club Whip', category: 'drum', keyBinding: '6', color: '#10b981' },
  { id: 7, name: 'Rewind Spin', category: 'fx', keyBinding: '7', color: '#6366f1' },
  { id: 8, name: 'Hype Drop', category: 'voice', keyBinding: '8', color: '#f97316' },
];
