import { CrossfaderCurve, DeckState, MasterFXState, MixerState, Track } from '../types';

export class DJAudioEngine {
  private ctx: AudioContext | null = null;
  private isInitialized = false;

  // Deck Audio Nodes
  private deckNodes: {
    [key in 'A' | 'B']: {
      source: AudioBufferSourceNode | null;
      startTime: number;
      pauseOffset: number;
      playbackRate: number;
      lowFilter: BiquadFilterNode | null;
      midFilter: BiquadFilterNode | null;
      highFilter: BiquadFilterNode | null;
      djFilter: BiquadFilterNode | null;
      volumeGain: GainNode | null;
      crossfadeGain: GainNode | null;
      analyser: AnalyserNode | null;
      cueGain: GainNode | null;
    };
  } = {
    A: {
      source: null,
      startTime: 0,
      pauseOffset: 0,
      playbackRate: 1.0,
      lowFilter: null,
      midFilter: null,
      highFilter: null,
      djFilter: null,
      volumeGain: null,
      crossfadeGain: null,
      analyser: null,
      cueGain: null,
    },
    B: {
      source: null,
      startTime: 0,
      pauseOffset: 0,
      playbackRate: 1.0,
      lowFilter: null,
      midFilter: null,
      highFilter: null,
      djFilter: null,
      volumeGain: null,
      crossfadeGain: null,
      analyser: null,
      cueGain: null,
    },
  };

  // Master Nodes
  private masterBus: GainNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private samplerBus: GainNode | null = null;

  // FX Nodes
  private fxDelayNode: DelayNode | null = null;
  private fxDelayFeedback: GainNode | null = null;
  private fxDelayDryGain: GainNode | null = null;
  private fxDelayWetGain: GainNode | null = null;

  private fxReverbConvolver: ConvolverNode | null = null;
  private fxReverbWetGain: GainNode | null = null;

  private fxFlangerDelay: DelayNode | null = null;
  private fxFlangerLFO: OscillatorNode | null = null;
  private fxFlangerLFOGain: GainNode | null = null;
  private fxFlangerWetGain: GainNode | null = null;

  private fxDistortion: WaveShaperNode | null = null;
  private fxDistortionWetGain: GainNode | null = null;

  // Recording
  private mediaDest: MediaStreamAudioDestinationNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  // Mic
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micGainNode: GainNode | null = null;

  // Sampler buffers
  private samplerBuffers: Map<string, AudioBuffer> = new Map();

  constructor() {
    // Lazy initialized on first user interaction to satisfy browser autoplay policy
  }

  public async init(): Promise<void> {
    if (this.isInitialized && this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioContextClass();

    // Master bus & Limiter
    this.masterBus = this.ctx.createGain();
    this.masterLimiter = this.ctx.createDynamicsCompressor();
    this.masterLimiter.threshold.setValueAtTime(-1.0, this.ctx.currentTime);
    this.masterLimiter.knee.setValueAtTime(3.0, this.ctx.currentTime);
    this.masterLimiter.ratio.setValueAtTime(12.0, this.ctx.currentTime);
    this.masterLimiter.attack.setValueAtTime(0.003, this.ctx.currentTime);
    this.masterLimiter.release.setValueAtTime(0.15, this.ctx.currentTime);

    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 256;

    this.samplerBus = this.ctx.createGain();
    this.samplerBus.gain.setValueAtTime(0.9, this.ctx.currentTime);
    this.samplerBus.connect(this.masterBus);

    // Setup Master FX routing
    this.setupMasterFX();

    // Setup Decks A and B audio processing chains
    this.setupDeckChain('A');
    this.setupDeckChain('B');

    // Master to Destination & Recorder
    this.masterBus.connect(this.masterLimiter);
    this.masterLimiter.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.ctx.destination);

    // Recording node
    try {
      this.mediaDest = this.ctx.createMediaStreamDestination();
      this.masterLimiter.connect(this.mediaDest);
    } catch {
      // MediaStreamDestination not supported in some test envs
    }

    this.isInitialized = true;
  }

  private setupMasterFX(): void {
    if (!this.ctx || !this.masterBus) return;

    // Delay FX
    this.fxDelayNode = this.ctx.createDelay(2.0);
    this.fxDelayNode.delayTime.setValueAtTime(0.35, this.ctx.currentTime);
    this.fxDelayFeedback = this.ctx.createGain();
    this.fxDelayFeedback.gain.setValueAtTime(0.45, this.ctx.currentTime);
    this.fxDelayWetGain = this.ctx.createGain();
    this.fxDelayWetGain.gain.setValueAtTime(0, this.ctx.currentTime);

    this.fxDelayNode.connect(this.fxDelayFeedback);
    this.fxDelayFeedback.connect(this.fxDelayNode);
    this.fxDelayNode.connect(this.fxDelayWetGain);
    this.fxDelayWetGain.connect(this.masterBus);

    // Reverb FX
    this.fxReverbConvolver = this.ctx.createConvolver();
    const rate = this.ctx.sampleRate;
    const len = rate * 2.0;
    const impBuf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const data = impBuf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (rate * 0.5));
      }
    }
    this.fxReverbConvolver.buffer = impBuf;
    this.fxReverbWetGain = this.ctx.createGain();
    this.fxReverbWetGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.fxReverbConvolver.connect(this.fxReverbWetGain);
    this.fxReverbWetGain.connect(this.masterBus);

    // Flanger FX
    this.fxFlangerDelay = this.ctx.createDelay(0.02);
    this.fxFlangerDelay.delayTime.setValueAtTime(0.003, this.ctx.currentTime);
    this.fxFlangerLFOGain = this.ctx.createGain();
    this.fxFlangerLFOGain.gain.setValueAtTime(0.002, this.ctx.currentTime);
    this.fxFlangerLFO = this.ctx.createOscillator();
    this.fxFlangerLFO.frequency.setValueAtTime(0.4, this.ctx.currentTime);
    this.fxFlangerLFO.connect(this.fxFlangerLFOGain);
    this.fxFlangerLFOGain.connect(this.fxFlangerDelay.delayTime);
    this.fxFlangerLFO.start();

    this.fxFlangerWetGain = this.ctx.createGain();
    this.fxFlangerWetGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.fxFlangerDelay.connect(this.fxFlangerWetGain);
    this.fxFlangerWetGain.connect(this.masterBus);

    // Distortion FX (WaveShaper)
    this.fxDistortion = this.ctx.createWaveShaper();
    const n = 256;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    const k = 40;
    for (let i = 0; i < n; ++i) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    this.fxDistortion.curve = curve;
    this.fxDistortion.oversample = '2x';
    this.fxDistortionWetGain = this.ctx.createGain();
    this.fxDistortionWetGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.fxDistortion.connect(this.fxDistortionWetGain);
    this.fxDistortionWetGain.connect(this.masterBus);
  }

  private setupDeckChain(deckId: 'A' | 'B'): void {
    if (!this.ctx || !this.masterBus) return;

    const deck = this.deckNodes[deckId];

    // EQ Low (Low-shelf 120Hz)
    deck.lowFilter = this.ctx.createBiquadFilter();
    deck.lowFilter.type = 'lowshelf';
    deck.lowFilter.frequency.setValueAtTime(120, this.ctx.currentTime);
    deck.lowFilter.gain.setValueAtTime(0, this.ctx.currentTime);

    // EQ Mid (Peaking 1000Hz, Q=1.0)
    deck.midFilter = this.ctx.createBiquadFilter();
    deck.midFilter.type = 'peaking';
    deck.midFilter.frequency.setValueAtTime(1000, this.ctx.currentTime);
    deck.midFilter.Q.setValueAtTime(1.0, this.ctx.currentTime);
    deck.midFilter.gain.setValueAtTime(0, this.ctx.currentTime);

    // EQ High (High-shelf 3500Hz)
    deck.highFilter = this.ctx.createBiquadFilter();
    deck.highFilter.type = 'highshelf';
    deck.highFilter.frequency.setValueAtTime(3500, this.ctx.currentTime);
    deck.highFilter.gain.setValueAtTime(0, this.ctx.currentTime);

    // DJ Filter (Dual HPF / LPF)
    deck.djFilter = this.ctx.createBiquadFilter();
    deck.djFilter.type = 'allpass';
    deck.djFilter.frequency.setValueAtTime(1000, this.ctx.currentTime);

    // Channel Volume
    deck.volumeGain = this.ctx.createGain();
    deck.volumeGain.gain.setValueAtTime(1.0, this.ctx.currentTime);

    // Crossfader Gain
    deck.crossfadeGain = this.ctx.createGain();
    deck.crossfadeGain.gain.setValueAtTime(deckId === 'A' ? 1.0 : 1.0, this.ctx.currentTime);

    // Channel Analyser (for LED meters & visualizer)
    deck.analyser = this.ctx.createAnalyser();
    deck.analyser.fftSize = 256;

    // Connect chain:
    // Source -> LowFilter -> MidFilter -> HighFilter -> DJFilter -> VolumeGain -> Analyser -> CrossfadeGain -> MasterBus + FX Sends
    deck.lowFilter.connect(deck.midFilter);
    deck.midFilter.connect(deck.highFilter);
    deck.highFilter.connect(deck.djFilter);
    deck.djFilter.connect(deck.volumeGain);
    deck.volumeGain.connect(deck.analyser);
    deck.analyser.connect(deck.crossfadeGain);
    deck.crossfadeGain.connect(this.masterBus);

    // Connect to Master FX sends
    if (this.fxDelayNode) deck.crossfadeGain.connect(this.fxDelayNode);
    if (this.fxReverbConvolver) deck.crossfadeGain.connect(this.fxReverbConvolver);
    if (this.fxFlangerDelay) deck.crossfadeGain.connect(this.fxFlangerDelay);
    if (this.fxDistortion) deck.crossfadeGain.connect(this.fxDistortion);
  }

  public setSamplerBuffers(buffers: Map<string, AudioBuffer>): void {
    this.samplerBuffers = buffers;
  }

  public playSample(sampleId: string): void {
    if (!this.ctx || !this.samplerBus) return;
    const buffer = this.samplerBuffers.get(sampleId);
    if (!buffer) return;

    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.samplerBus);
      src.start();
    } catch (e) {
      console.warn('Error playing sample', e);
    }
  }

  public playDeck(deckId: 'A' | 'B', track: Track, startOffset = 0, playbackRate = 1.0): void {
    if (!this.ctx || !track.audioBuffer) return;

    const deck = this.deckNodes[deckId];

    // Stop existing source if playing
    if (deck.source) {
      try {
        deck.source.stop();
        deck.source.disconnect();
      } catch {
        // ignore if already stopped
      }
      deck.source = null;
    }

    const duration = track.audioBuffer.duration;
    const offset = Math.max(0, Math.min(startOffset, duration));

    const source = this.ctx.createBufferSource();
    source.buffer = track.audioBuffer;
    source.playbackRate.setValueAtTime(playbackRate, this.ctx.currentTime);
    source.loop = true; // Deck tracks loop continuously for performance mixing

    if (deck.lowFilter) {
      source.connect(deck.lowFilter);
    }

    deck.source = source;
    deck.startTime = this.ctx.currentTime - (offset / playbackRate);
    deck.pauseOffset = offset;
    deck.playbackRate = playbackRate;

    source.start(0, offset);
  }

  public pauseDeck(deckId: 'A' | 'B'): number {
    const deck = this.deckNodes[deckId];
    let currentPosition = deck.pauseOffset;

    if (this.ctx && deck.source) {
      const elapsed = (this.ctx.currentTime - deck.startTime) * deck.playbackRate;
      currentPosition = Math.max(0, elapsed);
      try {
        deck.source.stop();
        deck.source.disconnect();
      } catch {
        // ignore
      }
      deck.source = null;
    }
    deck.pauseOffset = currentPosition;
    return currentPosition;
  }

  public setDeckPlaybackRate(deckId: 'A' | 'B', rate: number): void {
    const deck = this.deckNodes[deckId];
    deck.playbackRate = Math.max(0.1, Math.min(rate, 2.5));
    if (deck.source && this.ctx) {
      deck.source.playbackRate.setValueAtTime(deck.playbackRate, this.ctx.currentTime);
    }
  }

  /**
   * Scratching physics audio simulation
   * When dragging vinyl, update playback position and rate according to velocity
   */
  public scratchScrub(deckId: 'A' | 'B', track: Track, targetTime: number, velocity: number): void {
    if (!this.ctx || !track.audioBuffer) return;

    const deck = this.deckNodes[deckId];
    const duration = track.audioBuffer.duration;
    const clampedTime = ((targetTime % duration) + duration) % duration;

    // Pitch multiplier proportional to drag velocity
    const scratchRate = Math.max(-2.5, Math.min(velocity * 0.05, 2.5));

    // Play quick granular micro-slice for realistic needle scrub
    if (Math.abs(scratchRate) > 0.05) {
      try {
        const scrubSource = this.ctx.createBufferSource();
        scrubSource.buffer = track.audioBuffer;
        scrubSource.playbackRate.setValueAtTime(Math.abs(scratchRate), this.ctx.currentTime);

        const scrubGain = this.ctx.createGain();
        const sliceDuration = 0.08;
        scrubGain.gain.setValueAtTime(Math.min(1.0, Math.abs(scratchRate) * 0.7), this.ctx.currentTime);
        scrubGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + sliceDuration);

        if (deck.lowFilter) {
          scrubSource.connect(scrubGain);
          scrubGain.connect(deck.lowFilter);
        }

        scrubSource.start(0, clampedTime, sliceDuration);
      } catch {
        // ignore transient scrub exceptions
      }
    }

    deck.pauseOffset = clampedTime;
  }

  public setDeckEQ(deckId: 'A' | 'B', lowDb: number, midDb: number, highDb: number, killL = false, killM = false, killH = false): void {
    if (!this.ctx) return;
    const deck = this.deckNodes[deckId];
    const t = this.ctx.currentTime;

    if (deck.lowFilter) {
      deck.lowFilter.gain.setValueAtTime(killL ? -70 : lowDb, t);
    }
    if (deck.midFilter) {
      deck.midFilter.gain.setValueAtTime(killM ? -70 : midDb, t);
    }
    if (deck.highFilter) {
      deck.highFilter.gain.setValueAtTime(killH ? -70 : highDb, t);
    }
  }

  /**
   * DJ Filter: -1.0 (Low-pass) to 0.0 (Off) to +1.0 (High-pass)
   */
  public setDeckFilter(deckId: 'A' | 'B', filterValue: number): void {
    if (!this.ctx) return;
    const deck = this.deckNodes[deckId];
    if (!deck.djFilter) return;

    const t = this.ctx.currentTime;
    if (Math.abs(filterValue) < 0.04) {
      // Neutral bypass
      deck.djFilter.type = 'allpass';
      deck.djFilter.frequency.setValueAtTime(1000, t);
    } else if (filterValue < 0) {
      // Low-pass filter (turning left)
      deck.djFilter.type = 'lowpass';
      // From 20000Hz at 0 down to 200Hz at -1.0
      const freq = 20000 * Math.pow(0.01, -filterValue);
      deck.djFilter.frequency.setValueAtTime(Math.max(180, freq), t);
      deck.djFilter.Q.setValueAtTime(1.0 + Math.abs(filterValue) * 3.5, t);
    } else {
      // High-pass filter (turning right)
      deck.djFilter.type = 'highpass';
      // From 20Hz at 0 up to 6000Hz at +1.0
      const freq = 20 * Math.pow(300, filterValue);
      deck.djFilter.frequency.setValueAtTime(Math.min(7500, freq), t);
      deck.djFilter.Q.setValueAtTime(1.0 + filterValue * 3.5, t);
    }
  }

  public setDeckVolume(deckId: 'A' | 'B', vol: number): void {
    if (!this.ctx) return;
    const deck = this.deckNodes[deckId];
    if (deck.volumeGain) {
      deck.volumeGain.gain.setValueAtTime(Math.max(0, Math.min(vol, 1)), this.ctx.currentTime);
    }
  }

  public updateCrossfader(crossfader: number, curve: CrossfaderCurve): void {
    if (!this.ctx) return;
    const pos = Math.max(-1, Math.min(crossfader, 1));
    const deckA = this.deckNodes.A;
    const deckB = this.deckNodes.B;
    if (!deckA.crossfadeGain || !deckB.crossfadeGain) return;

    let gainA = 1.0;
    let gainB = 1.0;

    if (curve === 'linear') {
      gainA = (1 - pos) / 2;
      gainB = (1 + pos) / 2;
    } else if (curve === 'smooth') {
      // Equal power curve
      const angle = ((pos + 1) / 2) * 0.5 * Math.PI;
      gainA = Math.cos(angle);
      gainB = Math.sin(angle);
    } else if (curve === 'scratch') {
      // Sharp scratch curve: full volume until extreme ends
      gainA = pos > 0.85 ? Math.max(0, (1 - pos) / 0.15) : 1.0;
      gainB = pos < -0.85 ? Math.max(0, (1 + pos) / 0.15) : 1.0;
    }

    const t = this.ctx.currentTime;
    deckA.crossfadeGain.gain.setValueAtTime(gainA, t);
    deckB.crossfadeGain.gain.setValueAtTime(gainB, t);
  }

  public setMasterVolume(vol: number): void {
    if (!this.ctx || !this.masterBus) return;
    this.masterBus.gain.setValueAtTime(Math.max(0, Math.min(vol, 1.2)), this.ctx.currentTime);
  }

  public updateMasterFX(fx: MasterFXState): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // Delay
    if (this.fxDelayWetGain && this.fxDelayNode && this.fxDelayFeedback) {
      this.fxDelayWetGain.gain.setValueAtTime(fx.delayActive ? 0.6 : 0, t);
      this.fxDelayNode.delayTime.setValueAtTime(fx.delayTime * 0.5, t);
      this.fxDelayFeedback.gain.setValueAtTime(fx.delayFeedback, t);
    }

    // Reverb
    if (this.fxReverbWetGain) {
      this.fxReverbWetGain.gain.setValueAtTime(fx.reverbActive ? fx.reverbDecay * 0.7 : 0, t);
    }

    // Flanger
    if (this.fxFlangerWetGain) {
      this.fxFlangerWetGain.gain.setValueAtTime(fx.flangerActive ? 0.75 : 0, t);
    }

    // Bitcrusher / Distortion
    if (this.fxDistortionWetGain) {
      this.fxDistortionWetGain.gain.setValueAtTime(fx.bitcrusherActive ? 0.65 : 0, t);
    }
  }

  /**
   * Turntable Vinyl Brake / Power-Off slow-down effect
   */
  public triggerVinylBrake(deckId: 'A' | 'B', callback?: () => void): void {
    if (!this.ctx) return;
    const deck = this.deckNodes[deckId];
    if (!deck.source) return;

    const t = this.ctx.currentTime;
    const currentRate = deck.playbackRate;
    deck.source.playbackRate.setValueAtTime(currentRate, t);
    deck.source.playbackRate.exponentialRampToValueAtTime(0.001, t + 1.2);

    setTimeout(() => {
      this.pauseDeck(deckId);
      if (callback) callback();
    }, 1250);
  }

  public getCurrentPlayheadTime(deckId: 'A' | 'B', duration: number): number {
    const deck = this.deckNodes[deckId];
    if (!this.ctx || !deck.source) {
      return deck.pauseOffset % duration;
    }
    const elapsed = (this.ctx.currentTime - deck.startTime) * deck.playbackRate;
    return ((elapsed % duration) + duration) % duration;
  }

  public getDeckPeak(deckId: 'A' | 'B'): number {
    const deck = this.deckNodes[deckId];
    if (!deck.analyser) return 0;

    const data = new Uint8Array(deck.analyser.frequencyBinCount);
    deck.analyser.getByteTimeDomainData(data);
    let max = 0;
    for (let i = 0; i < data.length; i++) {
      const val = Math.abs(data[i] - 128) / 128;
      if (val > max) max = val;
    }
    return max;
  }

  public getMasterPeak(): { left: number; right: number } {
    if (!this.masterAnalyser) return { left: 0, right: 0 };
    const data = new Uint8Array(this.masterAnalyser.frequencyBinCount);
    this.masterAnalyser.getByteTimeDomainData(data);
    let max = 0;
    for (let i = 0; i < data.length; i++) {
      const val = Math.abs(data[i] - 128) / 128;
      if (val > max) max = val;
    }
    // Slight stereo variation
    return {
      left: max,
      right: max * (0.92 + Math.random() * 0.15)
    };
  }

  public getDeckFrequencyData(deckId: 'A' | 'B'): Uint8Array | null {
    const deck = this.deckNodes[deckId];
    if (!deck.analyser) return null;
    const data = new Uint8Array(deck.analyser.frequencyBinCount);
    deck.analyser.getByteFrequencyData(data);
    return data;
  }

  // Live Mix Recording API
  public startRecording(): boolean {
    if (!this.mediaDest) return false;
    this.recordedChunks = [];

    try {
      const options = { mimeType: 'audio/webm;codecs=opus' };
      this.mediaRecorder = new MediaRecorder(this.mediaDest.stream, options);
    } catch {
      try {
        this.mediaRecorder = new MediaRecorder(this.mediaDest.stream);
      } catch (err) {
        console.error('Recording initialization failed', err);
        return false;
      }
    }

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.recordedChunks.push(e.data);
      }
    };

    this.mediaRecorder.start(250);
    return true;
  }

  public stopRecording(): Blob | null {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return null;

    this.mediaRecorder.stop();
    const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
    this.recordedChunks = [];
    return blob;
  }

  // Microphone Talkover
  public async toggleMicrophone(active: boolean, onDucking?: (ducked: boolean) => void): Promise<boolean> {
    if (!this.ctx || !this.masterBus) return false;

    if (!active) {
      if (this.micStream) {
        this.micStream.getTracks().forEach(t => t.stop());
        this.micStream = null;
      }
      if (this.micSource) {
        this.micSource.disconnect();
        this.micSource = null;
      }
      if (onDucking) onDucking(false);
      return false;
    }

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.micSource = this.ctx.createMediaStreamSource(this.micStream);
      this.micGainNode = this.ctx.createGain();
      this.micGainNode.gain.setValueAtTime(1.2, this.ctx.currentTime);

      this.micSource.connect(this.micGainNode);
      this.micGainNode.connect(this.masterBus);

      // Duck background music slightly for clear broadcast talkover
      if (onDucking) onDucking(true);
      return true;
    } catch (err) {
      console.warn('Microphone permission denied or unavailable', err);
      return false;
    }
  }

  public decodeAudioFile(file: File): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        if (!this.ctx) {
          const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          this.ctx = new AudioContextClass();
        }
        try {
          const buffer = await this.ctx.decodeAudioData(reader.result as ArrayBuffer);
          resolve(buffer);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
}

// Global Audio Engine Instance
export const djEngine = new DJAudioEngine();
