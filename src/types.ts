export interface Track {
  id: string;
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  key: string;
  duration: number; // in seconds
  audioBuffer?: AudioBuffer;
  waveformPeaks?: number[]; // precomputed normalized peaks for overview
  artworkColor?: string;
}

export interface HotCue {
  id: number;
  time: number; // in seconds
  color: string;
}

export interface DeckState {
  id: 'A' | 'B';
  track: Track | null;
  isPlaying: boolean;
  isCueing: boolean;
  currentTime: number;
  duration: number;
  bpm: number;
  originalBpm: number;
  pitch: number; // -1 to +1 (corresponds to -8% to +8% or selected range)
  pitchRange: number; // 0.08, 0.16, 0.50
  pitchBend: number; // momentary temporary speed shift
  volume: number; // 0 to 1
  eqLow: number; // -24 to +6 dB (0 is neutral)
  eqMid: number; // -24 to +6 dB
  eqHigh: number; // -24 to +6 dB
  killLow: boolean;
  killMid: boolean;
  killHigh: boolean;
  filter: number; // -1 (LPF) to 0 (off) to +1 (HPF)
  loopActive: boolean;
  loopLengthBeats: number; // 0.25, 0.5, 1, 2, 4, 8, 16
  loopStart: number;
  loopEnd: number;
  hotCues: (HotCue | null)[]; // 4 slots
  isScratching: boolean;
  rotationAngle: number; // in degrees for turntable animation
  isSynced: boolean;
  cuePoint: number;
}

export type CrossfaderCurve = 'linear' | 'smooth' | 'scratch';

export interface MasterFXState {
  delayActive: boolean;
  delayTime: number; // in beats (0.25, 0.5, 0.75, 1.0)
  delayFeedback: number; // 0 to 0.8
  reverbActive: boolean;
  reverbDecay: number; // 0 to 1
  flangerActive: boolean;
  bitcrusherActive: boolean;
  brakeActive: boolean; // turntable power down brake effect
}

export interface MixerState {
  crossfader: number; // -1 (Deck A) to 0 (Center) to +1 (Deck B)
  crossfaderCurve: CrossfaderCurve;
  masterVolume: number; // 0 to 1
  cueMix: number; // -1 (Deck A) to 0 (Both) to +1 (Deck B)
  cueVolume: number;
  micActive: boolean;
  micGain: number;
  isRecording: boolean;
  recordingDuration: number;
}

export interface SamplerPad {
  id: number;
  name: string;
  category: 'fx' | 'drum' | 'voice';
  keyBinding: string;
  color: string;
  audioBuffer?: AudioBuffer;
}
