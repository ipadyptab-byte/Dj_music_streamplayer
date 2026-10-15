/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { djEngine } from './audio/AudioEngine';
import {
  INITIAL_TRACK_DEFS,
  SAMPLER_PAD_DEFINITIONS,
  generateSamplerBuffers,
  synthesizeDJTrack,
} from './audio/TrackSynthesizer';
import {
  CrossfaderCurve,
  DeckState,
  MasterFXState,
  MixerState,
  SamplerPad,
  Track,
} from './types';
import { HeaderBar } from './components/HeaderBar';
import { Deck } from './components/Deck';
import { CenterMixer } from './components/CenterMixer';
import { PerformanceSampler } from './components/PerformanceSampler';
import { TrackLibrary } from './components/TrackLibrary';
import { ShortcutsGuide } from './components/ShortcutsGuide';

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [activeView, setActiveView] = useState<'mixer' | 'sampler' | 'library' | 'shortcuts'>('mixer');
  const [isInitializing, setIsInitializing] = useState(true);

  // Deck A State
  const [deckA, setDeckA] = useState<DeckState>({
    id: 'A',
    track: null,
    isPlaying: false,
    isCueing: false,
    currentTime: 0,
    duration: 0,
    bpm: 126,
    originalBpm: 126,
    pitch: 0,
    pitchRange: 0.08,
    pitchBend: 0,
    volume: 1.0,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0,
    killLow: false,
    killMid: false,
    killHigh: false,
    filter: 0,
    loopActive: false,
    loopLengthBeats: 4,
    loopStart: 0,
    loopEnd: 0,
    hotCues: [null, null, null, null],
    isScratching: false,
    rotationAngle: 0,
    isSynced: false,
    cuePoint: 0,
  });

  // Deck B State
  const [deckB, setDeckB] = useState<DeckState>({
    id: 'B',
    track: null,
    isPlaying: false,
    isCueing: false,
    currentTime: 0,
    duration: 0,
    bpm: 118,
    originalBpm: 118,
    pitch: 0,
    pitchRange: 0.08,
    pitchBend: 0,
    volume: 1.0,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0,
    killLow: false,
    killMid: false,
    killHigh: false,
    filter: 0,
    loopActive: false,
    loopLengthBeats: 4,
    loopStart: 0,
    loopEnd: 0,
    hotCues: [null, null, null, null],
    isScratching: false,
    rotationAngle: 0,
    isSynced: false,
    cuePoint: 0,
  });

  // Mixer State
  const [mixer, setMixer] = useState<MixerState>({
    crossfader: 0,
    crossfaderCurve: 'smooth',
    masterVolume: 1.0,
    cueMix: 0,
    cueVolume: 1.0,
    micActive: false,
    micGain: 1.0,
    isRecording: false,
    recordingDuration: 0,
  });

  // Master FX State
  const [masterFX, setMasterFX] = useState<MasterFXState>({
    delayActive: false,
    delayTime: 0.5,
    delayFeedback: 0.45,
    reverbActive: false,
    reverbDecay: 0.5,
    flangerActive: false,
    bitcrusherActive: false,
    brakeActive: false,
  });

  // Peak Meters (Deck A, Deck B, Master L/R)
  const [deckAPeak, setDeckAPeak] = useState<number>(0);
  const [deckBPeak, setDeckBPeak] = useState<number>(0);
  const [masterPeak, setMasterPeak] = useState<{ left: number; right: number }>({ left: 0, right: 0 });

  // Recording State
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-Mix Transition State
  const [isAutoMixing, setIsAutoMixing] = useState(false);

  // Sampler Pads
  const [samplerPads] = useState<SamplerPad[]>(SAMPLER_PAD_DEFINITIONS);

  // Initialize Audio Engine & Synthesize Default Tracks on Mount
  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      try {
        await djEngine.init();

        // Synthesize initial tracks in background
        const houseSynth = await synthesizeDJTrack('tech_house');
        const synthwaveSynth = await synthesizeDJTrack('synthwave');
        const dnbSynth = await synthesizeDJTrack('dnb');
        const trapSynth = await synthesizeDJTrack('trap');
        const tranceSynth = await synthesizeDJTrack('trance');
        const discoSynth = await synthesizeDJTrack('nu_disco');

        if (!isMounted) return;

        const loadedTracks: Track[] = [
          {
            id: 'track-1',
            title: houseSynth.title,
            artist: houseSynth.artist,
            genre: 'tech_house',
            bpm: houseSynth.bpm,
            key: houseSynth.key,
            duration: houseSynth.buffer.duration,
            audioBuffer: houseSynth.buffer,
            waveformPeaks: houseSynth.peaks,
            artworkColor: '#06b6d4',
          },
          {
            id: 'track-2',
            title: synthwaveSynth.title,
            artist: synthwaveSynth.artist,
            genre: 'synthwave',
            bpm: synthwaveSynth.bpm,
            key: synthwaveSynth.key,
            duration: synthwaveSynth.buffer.duration,
            audioBuffer: synthwaveSynth.buffer,
            waveformPeaks: synthwaveSynth.peaks,
            artworkColor: '#f43f5e',
          },
          {
            id: 'track-3',
            title: dnbSynth.title,
            artist: dnbSynth.artist,
            genre: 'dnb',
            bpm: dnbSynth.bpm,
            key: dnbSynth.key,
            duration: dnbSynth.buffer.duration,
            audioBuffer: dnbSynth.buffer,
            waveformPeaks: dnbSynth.peaks,
            artworkColor: '#eab308',
          },
          {
            id: 'track-4',
            title: trapSynth.title,
            artist: trapSynth.artist,
            genre: 'trap',
            bpm: trapSynth.bpm,
            key: trapSynth.key,
            duration: trapSynth.buffer.duration,
            audioBuffer: trapSynth.buffer,
            waveformPeaks: trapSynth.peaks,
            artworkColor: '#a855f7',
          },
          {
            id: 'track-5',
            title: tranceSynth.title,
            artist: tranceSynth.artist,
            genre: 'trance',
            bpm: tranceSynth.bpm,
            key: tranceSynth.key,
            duration: tranceSynth.buffer.duration,
            audioBuffer: tranceSynth.buffer,
            waveformPeaks: tranceSynth.peaks,
            artworkColor: '#3b82f6',
          },
          {
            id: 'track-6',
            title: discoSynth.title,
            artist: discoSynth.artist,
            genre: 'nu_disco',
            bpm: discoSynth.bpm,
            key: discoSynth.key,
            duration: discoSynth.buffer.duration,
            audioBuffer: discoSynth.buffer,
            waveformPeaks: discoSynth.peaks,
            artworkColor: '#10b981',
          },
        ];

        setTracks(loadedTracks);

        // Preload Track 1 into Deck A & Track 2 into Deck B
        setDeckA((prev) => ({
          ...prev,
          track: loadedTracks[0],
          duration: loadedTracks[0].duration,
          bpm: loadedTracks[0].bpm,
          originalBpm: loadedTracks[0].bpm,
        }));

        setDeckB((prev) => ({
          ...prev,
          track: loadedTracks[1],
          duration: loadedTracks[1].duration,
          bpm: loadedTracks[1].bpm,
          originalBpm: loadedTracks[1].bpm,
        }));

        // Generate Sampler Buffers
        const dummyCtx = new AudioContext();
        const samplerBuffers = await generateSamplerBuffers(dummyCtx);
        djEngine.setSamplerBuffers(samplerBuffers);
        dummyCtx.close();

        setIsInitializing(false);
      } catch (err) {
        console.error('Audio initialization error:', err);
        setIsInitializing(false);
      }
    }

    bootstrap();

    return () => {
      isMounted = false;
    };
  }, []);

  // Real-time Playhead & Meter Update Loop (60 FPS)
  useEffect(() => {
    let animId: number;

    const tick = () => {
      // Update Deck A playhead & meters
      if (deckA.track && deckA.isPlaying && !deckA.isScratching) {
        const curA = djEngine.getCurrentPlayheadTime('A', deckA.duration);
        
        // Handle Loop wrap
        if (deckA.loopActive && curA >= deckA.loopEnd) {
          const effectiveRate = (1 + deckA.pitch * deckA.pitchRange + deckA.pitchBend);
          djEngine.playDeck('A', deckA.track, deckA.loopStart, effectiveRate);
          setDeckA((prev) => ({ ...prev, currentTime: deckA.loopStart }));
        } else {
          setDeckA((prev) => ({ ...prev, currentTime: curA }));
        }
      }

      // Update Deck B playhead & meters
      if (deckB.track && deckB.isPlaying && !deckB.isScratching) {
        const curB = djEngine.getCurrentPlayheadTime('B', deckB.duration);
        
        // Handle Loop wrap
        if (deckB.loopActive && curB >= deckB.loopEnd) {
          const effectiveRate = (1 + deckB.pitch * deckB.pitchRange + deckB.pitchBend);
          djEngine.playDeck('B', deckB.track, deckB.loopStart, effectiveRate);
          setDeckB((prev) => ({ ...prev, currentTime: deckB.loopStart }));
        } else {
          setDeckB((prev) => ({ ...prev, currentTime: curB }));
        }
      }

      // Audio Peak Meters
      setDeckAPeak(djEngine.getDeckPeak('A'));
      setDeckBPeak(djEngine.getDeckPeak('B'));
      setMasterPeak(djEngine.getMasterPeak());

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [
    deckA.track,
    deckA.isPlaying,
    deckA.isScratching,
    deckA.duration,
    deckA.loopActive,
    deckA.loopStart,
    deckA.loopEnd,
    deckA.pitch,
    deckA.pitchRange,
    deckA.pitchBend,
    deckB.track,
    deckB.isPlaying,
    deckB.isScratching,
    deckB.duration,
    deckB.loopActive,
    deckB.loopStart,
    deckB.loopEnd,
    deckB.pitch,
    deckB.pitchRange,
    deckB.pitchBend,
  ]);

  // Deck Transport Controls
  const handlePlayPause = async (deckId: 'A' | 'B') => {
    await djEngine.init();
    const isA = deckId === 'A';
    const deck = isA ? deckA : deckB;
    const setDeck = isA ? setDeckA : setDeckB;

    if (!deck.track) return;

    if (deck.isPlaying) {
      const pos = djEngine.pauseDeck(deckId);
      setDeck((prev) => ({ ...prev, isPlaying: false, currentTime: pos }));
    } else {
      const effectiveRate = (1 + deck.pitch * deck.pitchRange + deck.pitchBend);
      djEngine.playDeck(deckId, deck.track, deck.currentTime, effectiveRate);
      setDeck((prev) => ({ ...prev, isPlaying: true, isCueing: false }));
    }
  };

  const handleCue = async (deckId: 'A' | 'B') => {
    await djEngine.init();
    const isA = deckId === 'A';
    const deck = isA ? deckA : deckB;
    const setDeck = isA ? setDeckA : setDeckB;

    if (!deck.track) return;

    if (deck.isPlaying) {
      // Pause and return to cue point
      djEngine.pauseDeck(deckId);
      setDeck((prev) => ({
        ...prev,
        isPlaying: false,
        currentTime: prev.cuePoint,
        isCueing: true,
      }));
    } else {
      // If paused, stutter play from cue point
      const effectiveRate = (1 + deck.pitch * deck.pitchRange + deck.pitchBend);
      djEngine.playDeck(deckId, deck.track, deck.cuePoint, effectiveRate);
      setDeck((prev) => ({ ...prev, isPlaying: true, isCueing: true }));
    }
  };

  // Beat Sync: Sync Deck BPM and match beat phase
  const handleSync = (deckId: 'A' | 'B') => {
    const isA = deckId === 'A';
    const targetDeck = isA ? deckB : deckA;
    const targetBpm = targetDeck.originalBpm * (1 + targetDeck.pitch * targetDeck.pitchRange);

    if (isA) {
      const newPitch = (targetBpm / deckA.originalBpm - 1) / deckA.pitchRange;
      setDeckA((prev) => ({
        ...prev,
        pitch: Math.max(-1, Math.min(1, newPitch)),
        isSynced: true,
      }));
      djEngine.setDeckPlaybackRate('A', 1 + newPitch * deckA.pitchRange);
    } else {
      const newPitch = (targetBpm / deckB.originalBpm - 1) / deckB.pitchRange;
      setDeckB((prev) => ({
        ...prev,
        pitch: Math.max(-1, Math.min(1, newPitch)),
        isSynced: true,
      }));
      djEngine.setDeckPlaybackRate('B', 1 + newPitch * deckB.pitchRange);
    }
  };

  // Pitch Fader & Range
  const handlePitchChange = (deckId: 'A' | 'B', pitchVal: number) => {
    const isA = deckId === 'A';
    const deck = isA ? deckA : deckB;
    const setDeck = isA ? setDeckA : setDeckB;

    setDeck((prev) => ({ ...prev, pitch: pitchVal, isSynced: false }));
    const effectiveRate = 1 + pitchVal * deck.pitchRange + deck.pitchBend;
    djEngine.setDeckPlaybackRate(deckId, effectiveRate);
  };

  const handlePitchBend = (deckId: 'A' | 'B', bendVal: number) => {
    const isA = deckId === 'A';
    const deck = isA ? deckA : deckB;
    const setDeck = isA ? setDeckA : setDeckB;

    setDeck((prev) => ({ ...prev, pitchBend: bendVal }));
    const effectiveRate = 1 + deck.pitch * deck.pitchRange + bendVal;
    djEngine.setDeckPlaybackRate(deckId, effectiveRate);
  };

  const handlePitchRangeToggle = (deckId: 'A' | 'B') => {
    const isA = deckId === 'A';
    const deck = isA ? deckA : deckB;
    const setDeck = isA ? setDeckA : setDeckB;

    const ranges = [0.08, 0.16, 0.5];
    const nextIdx = (ranges.indexOf(deck.pitchRange) + 1) % ranges.length;
    const nextRange = ranges[nextIdx];

    setDeck((prev) => ({ ...prev, pitchRange: nextRange }));
    const effectiveRate = 1 + deck.pitch * nextRange + deck.pitchBend;
    djEngine.setDeckPlaybackRate(deckId, effectiveRate);
  };

  // Needle Search / Timeline Seek
  const handleSeek = (deckId: 'A' | 'B', time: number) => {
    const isA = deckId === 'A';
    const deck = isA ? deckA : deckB;
    const setDeck = isA ? setDeckA : setDeckB;

    if (!deck.track) return;
    setDeck((prev) => ({ ...prev, currentTime: time }));

    if (deck.isPlaying) {
      const effectiveRate = 1 + deck.pitch * deck.pitchRange + deck.pitchBend;
      djEngine.playDeck(deckId, deck.track, time, effectiveRate);
    }
  };

  // Scratch Interactions
  const handleScratchStart = (deckId: 'A' | 'B') => {
    const isA = deckId === 'A';
    const deck = isA ? deckA : deckB;
    const setDeck = isA ? setDeckA : setDeckB;

    setDeck((prev) => ({ ...prev, isScratching: true }));
    if (deck.isPlaying) {
      djEngine.pauseDeck(deckId);
    }
  };

  const handleScratch = (deckId: 'A' | 'B', deltaAngle: number, velocity: number) => {
    const isA = deckId === 'A';
    const deck = isA ? deckA : deckB;
    const setDeck = isA ? setDeckA : setDeckB;

    if (!deck.track) return;

    // Convert degrees to time: ~360 deg = 1.8 seconds of audio
    const deltaTime = (deltaAngle / 360) * 1.8;
    const newTime = Math.max(0, (deck.currentTime + deltaTime) % deck.duration);

    setDeck((prev) => ({ ...prev, currentTime: newTime }));
    djEngine.scratchScrub(deckId, deck.track, newTime, velocity);
  };

  const handleScratchEnd = (deckId: 'A' | 'B') => {
    const isA = deckId === 'A';
    const deck = isA ? deckA : deckB;
    const setDeck = isA ? setDeckA : setDeckB;

    setDeck((prev) => ({ ...prev, isScratching: false }));
    if (deck.isPlaying && deck.track) {
      const effectiveRate = 1 + deck.pitch * deck.pitchRange + deck.pitchBend;
      djEngine.playDeck(deckId, deck.track, deck.currentTime, effectiveRate);
    }
  };

  // Equalizer & Filter
  const handleSetEQ = (deckId: 'A' | 'B', band: 'low' | 'mid' | 'high', val: number) => {
    const isA = deckId === 'A';
    const deck = isA ? deckA : deckB;
    const setDeck = isA ? setDeckA : setDeckB;

    const low = band === 'low' ? val : deck.eqLow;
    const mid = band === 'mid' ? val : deck.eqMid;
    const high = band === 'high' ? val : deck.eqHigh;

    setDeck((prev) => ({
      ...prev,
      eqLow: low,
      eqMid: mid,
      eqHigh: high,
    }));
    djEngine.setDeckEQ(deckId, low, mid, high, deck.killLow, deck.killMid, deck.killHigh);
  };

  const handleToggleKill = (deckId: 'A' | 'B', band: 'low' | 'mid' | 'high') => {
    const isA = deckId === 'A';
    const deck = isA ? deckA : deckB;
    const setDeck = isA ? setDeckA : setDeckB;

    const killL = band === 'low' ? !deck.killLow : deck.killLow;
    const killM = band === 'mid' ? !deck.killMid : deck.killMid;
    const killH = band === 'high' ? !deck.killHigh : deck.killHigh;

    setDeck((prev) => ({
      ...prev,
      killLow: killL,
      killMid: killM,
      killHigh: killH,
    }));
    djEngine.setDeckEQ(deckId, deck.eqLow, deck.eqMid, deck.eqHigh, killL, killM, killH);
  };

  const handleSetFilter = (deckId: 'A' | 'B', val: number) => {
    const isA = deckId === 'A';
    const setDeck = isA ? setDeckA : setDeckB;
    setDeck((prev) => ({ ...prev, filter: val }));
    djEngine.setDeckFilter(deckId, val);
  };

  const handleSetVolume = (deckId: 'A' | 'B', vol: number) => {
    const isA = deckId === 'A';
    const setDeck = isA ? setDeckA : setDeckB;
    setDeck((prev) => ({ ...prev, volume: vol }));
    djEngine.setDeckVolume(deckId, vol);
  };

  // Hot Cues
  const handleTriggerHotCue = (deckId: 'A' | 'B', idx: number) => {
    const isA = deckId === 'A';
    const deck = isA ? deckA : deckB;
    const setDeck = isA ? setDeckA : setDeckB;

    const cue = deck.hotCues[idx];
    if (cue) {
      // Jump to cue point
      handleSeek(deckId, cue.time);
    } else {
      // Set new cue point at current playhead
      const colors = ['#06b6d4', '#f59e0b', '#10b981', '#ec4899'];
      const newCue = { id: idx, time: deck.currentTime, color: colors[idx] };
      const updated = [...deck.hotCues];
      updated[idx] = newCue;
      setDeck((prev) => ({ ...prev, hotCues: updated }));
    }
  };

  const handleClearHotCue = (deckId: 'A' | 'B', idx: number) => {
    const isA = deckId === 'A';
    const setDeck = isA ? setDeckA : setDeckB;
    setDeck((prev) => {
      const updated = [...prev.hotCues];
      updated[idx] = null;
      return { ...prev, hotCues: updated };
    });
  };

  // Beat Loops
  const handleSetLoopLength = (deckId: 'A' | 'B', beats: number) => {
    const isA = deckId === 'A';
    const deck = isA ? deckA : deckB;
    const setDeck = isA ? setDeckA : setDeckB;

    const secondsPerBeat = 60 / (deck.originalBpm * (1 + deck.pitch * deck.pitchRange));
    const loopDuration = beats * secondsPerBeat;
    const start = deck.currentTime;
    const end = start + loopDuration;

    setDeck((prev) => ({
      ...prev,
      loopActive: true,
      loopLengthBeats: beats,
      loopStart: start,
      loopEnd: end,
    }));
  };

  const handleToggleLoop = (deckId: 'A' | 'B') => {
    const isA = deckId === 'A';
    const setDeck = isA ? setDeckA : setDeckB;
    setDeck((prev) => ({ ...prev, loopActive: !prev.loopActive }));
  };

  // Track Loading
  const handleLoadTrack = (deckId: 'A' | 'B', track: Track) => {
    const isA = deckId === 'A';
    const setDeck = isA ? setDeckA : setDeckB;

    // Stop current playback before loading
    djEngine.pauseDeck(deckId);

    setDeck((prev) => ({
      ...prev,
      track,
      isPlaying: false,
      currentTime: 0,
      duration: track.duration,
      bpm: track.bpm,
      originalBpm: track.bpm,
      pitch: 0,
      hotCues: [null, null, null, null],
      loopActive: false,
    }));
  };

  // Crossfader & Mixer
  const handleCrossfaderChange = (val: number) => {
    setMixer((prev) => ({ ...prev, crossfader: val }));
    djEngine.updateCrossfader(val, mixer.crossfaderCurve);
  };

  const handleCrossfaderCurveChange = (curve: CrossfaderCurve) => {
    setMixer((prev) => ({ ...prev, crossfaderCurve: curve }));
    djEngine.updateCrossfader(mixer.crossfader, curve);
  };

  const handleMasterVolumeChange = (vol: number) => {
    setMixer((prev) => ({ ...prev, masterVolume: vol }));
    djEngine.setMasterVolume(vol);
  };

  const handleCueMixChange = (mix: number) => {
    setMixer((prev) => ({ ...prev, cueMix: mix }));
  };

  // Master FX
  const handleToggleMasterFX = (key: keyof MasterFXState) => {
    setMasterFX((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      djEngine.updateMasterFX(next);
      return next;
    });
  };

  const handleSetFXParam = (param: 'delayTime' | 'delayFeedback' | 'reverbDecay', val: number) => {
    setMasterFX((prev) => {
      const next = { ...prev, [param]: val };
      djEngine.updateMasterFX(next);
      return next;
    });
  };

  const handleTriggerVinylBrake = (deckId: 'A' | 'B') => {
    djEngine.triggerVinylBrake(deckId, () => {
      if (deckId === 'A') {
        setDeckA((prev) => ({ ...prev, isPlaying: false }));
      } else {
        setDeckB((prev) => ({ ...prev, isPlaying: false }));
      }
    });
  };

  // Auto-Mix Automated Transition
  const handleAutoMix = () => {
    if (isAutoMixing) return;
    setIsAutoMixing(true);

    const fromDeckA = mixer.crossfader <= 0;
    const startVal = mixer.crossfader;
    const targetVal = fromDeckA ? 1 : -1;
    const durationMs = 6000; // 6 second transition
    const startTime = performance.now();

    // Start playing incoming deck if not playing
    if (fromDeckA && !deckB.isPlaying && deckB.track) {
      handlePlayPause('B');
    } else if (!fromDeckA && !deckA.isPlaying && deckA.track) {
      handlePlayPause('A');
    }

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const currentCrossfade = startVal + (targetVal - startVal) * progress;

      handleCrossfaderChange(currentCrossfade);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        setIsAutoMixing(false);
        // Pause outgoing deck
        if (fromDeckA && deckA.isPlaying) {
          handlePlayPause('A');
        } else if (!fromDeckA && deckB.isPlaying) {
          handlePlayPause('B');
        }
      }
    };

    requestAnimationFrame(step);
  };

  // Sampler
  const handleTriggerSample = (sampleId: string) => {
    djEngine.playSample(sampleId);
  };

  // Mix Recording
  const handleToggleRecording = () => {
    if (mixer.isRecording) {
      const blob = djEngine.stopRecording();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      setMixer((prev) => ({ ...prev, isRecording: false }));
      setRecordingSeconds(0);

      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `DJ_Studio_Pro_Mix_${new Date().toISOString().slice(0, 10)}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } else {
      const started = djEngine.startRecording();
      if (started) {
        setMixer((prev) => ({ ...prev, isRecording: true }));
        setRecordingSeconds(0);
        recordingTimerRef.current = setInterval(() => {
          setRecordingSeconds((prev) => prev + 1);
        }, 1000);
      }
    }
  };

  // Microphone Talkover
  const handleToggleMic = async () => {
    const nextState = !mixer.micActive;
    const ok = await djEngine.toggleMicrophone(nextState, (ducked) => {
      // Duck music slightly during talkover
      if (ducked) {
        djEngine.setMasterVolume(mixer.masterVolume * 0.45);
      } else {
        djEngine.setMasterVolume(mixer.masterVolume);
      }
    });

    if (ok || !nextState) {
      setMixer((prev) => ({ ...prev, micActive: nextState }));
    }
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          handlePlayPause('A');
          break;
        case 'Enter':
          e.preventDefault();
          handlePlayPause('B');
          break;
        case 'KeyC':
          e.preventDefault();
          handleCue('A');
          break;
        case 'KeyN':
          e.preventDefault();
          handleCue('B');
          break;
        case 'KeyS':
          e.preventDefault();
          handleSync('A');
          break;
        case 'KeyB':
          e.preventDefault();
          handleSync('B');
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleCrossfaderChange(Math.max(-1, mixer.crossfader - 0.2));
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleCrossfaderChange(Math.min(1, mixer.crossfader + 0.2));
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleCrossfaderChange(0);
          break;
        case 'KeyV':
          e.preventDefault();
          handleTriggerVinylBrake(mixer.crossfader <= 0 ? 'A' : 'B');
          break;
        case 'KeyM':
          e.preventDefault();
          handleAutoMix();
          break;
        // Sampler keys 1-8
        case 'Digit1':
          handleTriggerSample('airhorn');
          break;
        case 'Digit2':
          handleTriggerSample('siren');
          break;
        case 'Digit3':
          handleTriggerSample('laser');
          break;
        case 'Digit4':
          handleTriggerSample('sub_drop');
          break;
        case 'Digit5':
          handleTriggerSample('scratch_fx');
          break;
        case 'Digit6':
          handleTriggerSample('club_clap');
          break;
        case 'Digit7':
          handleTriggerSample('rewind');
          break;
        case 'Digit8':
          handleTriggerSample('vocal_drop');
          break;
        // Hot cues Deck A (Q, W, E, R)
        case 'KeyQ':
          handleTriggerHotCue('A', 0);
          break;
        case 'KeyW':
          handleTriggerHotCue('A', 1);
          break;
        case 'KeyE':
          handleTriggerHotCue('A', 2);
          break;
        case 'KeyR':
          handleTriggerHotCue('A', 3);
          break;
        // Hot cues Deck B (U, I, O, P)
        case 'KeyU':
          handleTriggerHotCue('B', 0);
          break;
        case 'KeyI':
          handleTriggerHotCue('B', 1);
          break;
        case 'KeyO':
          handleTriggerHotCue('B', 2);
          break;
        case 'KeyP':
          handleTriggerHotCue('B', 3);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans select-none">
      {/* Top Bar Contract Header */}
      <HeaderBar
        activeView={activeView}
        onSelectView={setActiveView}
        isRecording={mixer.isRecording}
        recordingSeconds={recordingSeconds}
        onToggleRecording={handleToggleRecording}
        micActive={mixer.micActive}
        onToggleMic={handleToggleMic}
      />

      {/* Main DJ Console Viewport */}
      <main className="flex-1 p-3 sm:p-4 max-w-[1720px] w-full mx-auto flex flex-col gap-4">
        {/* Shortcuts Modal Guide when active */}
        {activeView === 'shortcuts' && (
          <ShortcutsGuide onClose={() => setActiveView('mixer')} />
        )}

        {/* DJ Mixer Main Console (Deck A | Center Mixer | Deck B) */}
        <div className="flex flex-col lg:flex-row gap-4 items-stretch">
          {/* Deck A (Cyan Accent) */}
          <Deck
            deck={deckA}
            otherDeck={deckB}
            accentColor="#06b6d4"
            peakLevel={deckAPeak}
            onPlayPause={() => handlePlayPause('A')}
            onCue={() => handleCue('A')}
            onSync={() => handleSync('A')}
            onPitchChange={(val) => handlePitchChange('A', val)}
            onPitchBend={(val) => handlePitchBend('A', val)}
            onPitchRangeToggle={() => handlePitchRangeToggle('A')}
            onSeek={(val) => handleSeek('A', val)}
            onScratch={(delta, vel) => handleScratch('A', delta, vel)}
            onScratchStart={() => handleScratchStart('A')}
            onScratchEnd={() => handleScratchEnd('A')}
            onSetEQ={(band, val) => handleSetEQ('A', band, val)}
            onToggleKill={(band) => handleToggleKill('A', band)}
            onSetFilter={(val) => handleSetFilter('A', val)}
            onSetVolume={(val) => handleSetVolume('A', val)}
            onTriggerHotCue={(idx) => handleTriggerHotCue('A', idx)}
            onClearHotCue={(idx) => handleClearHotCue('A', idx)}
            onSetLoopLength={(beats) => handleSetLoopLength('A', beats)}
            onToggleLoop={() => handleToggleLoop('A')}
            onLoadTrackClick={() => setActiveView('library')}
          />

          {/* Center Mixer Console */}
          <CenterMixer
            mixer={mixer}
            masterFX={masterFX}
            deckA={deckA}
            deckB={deckB}
            masterPeak={masterPeak}
            onCrossfaderChange={handleCrossfaderChange}
            onCrossfaderCurveChange={handleCrossfaderCurveChange}
            onMasterVolumeChange={handleMasterVolumeChange}
            onCueMixChange={handleCueMixChange}
            onToggleMasterFX={handleToggleMasterFX}
            onSetFXParam={handleSetFXParam}
            onTriggerVinylBrake={handleTriggerVinylBrake}
            onAutoMix={handleAutoMix}
            isAutoMixing={isAutoMixing}
          />

          {/* Deck B (Amber/Orange Accent) */}
          <Deck
            deck={deckB}
            otherDeck={deckA}
            accentColor="#f59e0b"
            peakLevel={deckBPeak}
            onPlayPause={() => handlePlayPause('B')}
            onCue={() => handleCue('B')}
            onSync={() => handleSync('B')}
            onPitchChange={(val) => handlePitchChange('B', val)}
            onPitchBend={(val) => handlePitchBend('B', val)}
            onPitchRangeToggle={() => handlePitchRangeToggle('B')}
            onSeek={(val) => handleSeek('B', val)}
            onScratch={(delta, vel) => handleScratch('B', delta, vel)}
            onScratchStart={() => handleScratchStart('B')}
            onScratchEnd={() => handleScratchEnd('B')}
            onSetEQ={(band, val) => handleSetEQ('B', band, val)}
            onToggleKill={(band) => handleToggleKill('B', band)}
            onSetFilter={(val) => handleSetFilter('B', val)}
            onSetVolume={(val) => handleSetVolume('B', val)}
            onTriggerHotCue={(idx) => handleTriggerHotCue('B', idx)}
            onClearHotCue={(idx) => handleClearHotCue('B', idx)}
            onSetLoopLength={(beats) => handleSetLoopLength('B', beats)}
            onToggleLoop={() => handleToggleLoop('B')}
            onLoadTrackClick={() => setActiveView('library')}
          />
        </div>

        {/* Lower Studio Panels: Performance Sampler & Track Library */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Performance FX Sampler (Pads 1 to 8) */}
          <div className="lg:col-span-5">
            <PerformanceSampler
              samplerPads={samplerPads}
              onTriggerSample={handleTriggerSample}
            />
          </div>

          {/* Crate Track Library & Audio File Importer */}
          <div className="lg:col-span-7">
            <TrackLibrary
              tracks={tracks}
              currentTrackA={deckA.track}
              currentTrackB={deckB.track}
              onLoadTrack={handleLoadTrack}
              onAddNewTrack={(t) => setTracks((prev) => [t, ...prev])}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
