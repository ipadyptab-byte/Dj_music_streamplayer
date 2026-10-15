import React from 'react';
import { Volume2, Sparkles, Sliders, Disc, Radio, Flame } from 'lucide-react';
import confetti from 'canvas-confetti';
import { CrossfaderCurve, DeckState, MasterFXState, MixerState, Track } from '../types';
import { DualScrollingWaveforms } from './WaveformDisplay';
import { EQKnob } from './EQKnob';

interface CenterMixerProps {
  mixer: MixerState;
  masterFX: MasterFXState;
  deckA: DeckState;
  deckB: DeckState;
  masterPeak: { left: number; right: number };
  onCrossfaderChange: (val: number) => void;
  onCrossfaderCurveChange: (curve: CrossfaderCurve) => void;
  onMasterVolumeChange: (vol: number) => void;
  onCueMixChange: (mix: number) => void;
  onToggleMasterFX: (key: keyof MasterFXState) => void;
  onSetFXParam: (param: 'delayTime' | 'delayFeedback' | 'reverbDecay', val: number) => void;
  onTriggerVinylBrake: (deckId: 'A' | 'B') => void;
  onAutoMix: () => void;
  isAutoMixing: boolean;
}

export const CenterMixer: React.FC<CenterMixerProps> = ({
  mixer,
  masterFX,
  deckA,
  deckB,
  masterPeak,
  onCrossfaderChange,
  onCrossfaderCurveChange,
  onMasterVolumeChange,
  onCueMixChange,
  onToggleMasterFX,
  onSetFXParam,
  onTriggerVinylBrake,
  onAutoMix,
  isAutoMixing,
}) => {
  const triggerCrowdHype = () => {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#06b6d4', '#f59e0b', '#ec4899', '#10b981'],
    });
  };

  const meterSteps = 12;
  const leftActive = Math.round(masterPeak.left * meterSteps);
  const rightActive = Math.round(masterPeak.right * meterSteps);

  return (
    <div className="w-full lg:w-96 bg-neutral-900/95 rounded-xl border border-neutral-800 p-3 sm:p-4 flex flex-col justify-between shadow-2xl shrink-0">
      {/* Top Stacked Scrolling Waveforms */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-wider">
            Beat Grid Visualizer
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={triggerCrowdHype}
              className="text-[9px] font-bold px-2 py-0.5 rounded bg-gradient-to-r from-amber-500 to-rose-500 text-neutral-950 hover:brightness-110 flex items-center gap-1 shadow-sm transition-transform active:scale-95"
              title="Trigger Crowd Confetti Drop!"
            >
              <Flame className="w-3 h-3 fill-current" />
              <span>HYPE</span>
            </button>
          </div>
        </div>

        <DualScrollingWaveforms
          trackA={deckA.track}
          trackB={deckB.track}
          timeA={deckA.currentTime}
          timeB={deckB.currentTime}
          durationA={deckA.duration}
          durationB={deckB.duration}
          isPlayingA={deckA.isPlaying}
          isPlayingB={deckB.isPlaying}
          bpmA={deckA.originalBpm * (1 + deckA.pitch * deckA.pitchRange)}
          bpmB={deckB.originalBpm * (1 + deckB.pitch * deckB.pitchRange)}
        />
      </div>

      {/* Master Volume & Dual Stereo Peak LED Meters */}
      <div className="my-3 grid grid-cols-12 gap-3 bg-neutral-950/60 p-2.5 rounded-lg border border-neutral-800/80 items-center">
        {/* Master Gain & Cue Controls */}
        <div className="col-span-8 grid grid-cols-2 gap-2">
          <EQKnob
            label="Master Vol"
            value={Math.round(mixer.masterVolume * 100)}
            min={0}
            max={120}
            defaultValue={100}
            unit="%"
            color="#10b981"
            hasKill={false}
            onChange={(val) => onMasterVolumeChange(val / 100)}
            size="sm"
          />
          <EQKnob
            label="Cue Monitor"
            value={Math.round(mixer.cueMix * 100)}
            min={-100}
            max={100}
            defaultValue={0}
            unit=""
            color="#38bdf8"
            hasKill={false}
            onChange={(val) => onCueMixChange(val / 100)}
            size="sm"
          />
        </div>

        {/* Master Stereo Peak LED Ladders (L & R) */}
        <div className="col-span-4 flex items-center justify-center gap-2">
          {/* Left Meter */}
          <div className="flex flex-col items-center">
            <span className="text-[8px] font-mono text-neutral-500 mb-0.5">L</span>
            <div className="flex flex-col-reverse gap-0.5 h-16 w-2 bg-neutral-950 p-0.5 rounded border border-neutral-800">
              {Array.from({ length: meterSteps }).map((_, i) => {
                const active = i < leftActive;
                const isPeak = i >= 10;
                const isMid = i >= 7;
                const col = isPeak ? '#ef4444' : isMid ? '#f59e0b' : '#10b981';
                return (
                  <div
                    key={i}
                    className="w-full flex-1 rounded-xs"
                    style={{ backgroundColor: active ? col : '#262626' }}
                  />
                );
              })}
            </div>
          </div>

          {/* Right Meter */}
          <div className="flex flex-col items-center">
            <span className="text-[8px] font-mono text-neutral-500 mb-0.5">R</span>
            <div className="flex flex-col-reverse gap-0.5 h-16 w-2 bg-neutral-950 p-0.5 rounded border border-neutral-800">
              {Array.from({ length: meterSteps }).map((_, i) => {
                const active = i < rightActive;
                const isPeak = i >= 10;
                const isMid = i >= 7;
                const col = isPeak ? '#ef4444' : isMid ? '#f59e0b' : '#10b981';
                return (
                  <div
                    key={i}
                    className="w-full flex-1 rounded-xs"
                    style={{ backgroundColor: active ? col : '#262626' }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Master DJ FX Panel */}
      <div className="bg-neutral-950/70 p-2.5 rounded-lg border border-neutral-800/80 my-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-wider">
            Master DJ FX Rack
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onTriggerVinylBrake(mixer.crossfader <= 0 ? 'A' : 'B')}
              className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-rose-950 border border-rose-800 text-rose-300 hover:bg-rose-900 transition-colors"
              title="Vinyl Motor Brake: Powers down current playing deck like real turntable"
            >
              VINYL BRAKE
            </button>
          </div>
        </div>

        {/* FX Buttons Grid */}
        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={() => onToggleMasterFX('delayActive')}
            className={`py-2 rounded text-xs font-mono font-bold transition-all ${
              masterFX.delayActive
                ? 'bg-cyan-500 text-neutral-950 glow-cyan ring-1 ring-cyan-400'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            DELAY
          </button>
          <button
            type="button"
            onClick={() => onToggleMasterFX('reverbActive')}
            className={`py-2 rounded text-xs font-mono font-bold transition-all ${
              masterFX.reverbActive
                ? 'bg-purple-500 text-neutral-950 glow-purple ring-1 ring-purple-400'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            REVERB
          </button>
          <button
            type="button"
            onClick={() => onToggleMasterFX('flangerActive')}
            className={`py-2 rounded text-xs font-mono font-bold transition-all ${
              masterFX.flangerActive
                ? 'bg-amber-500 text-neutral-950 glow-amber ring-1 ring-amber-400'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            FLANGER
          </button>
          <button
            type="button"
            onClick={() => onToggleMasterFX('bitcrusherActive')}
            className={`py-2 rounded text-xs font-mono font-bold transition-all ${
              masterFX.bitcrusherActive
                ? 'bg-rose-500 text-neutral-950 glow-rose ring-1 ring-rose-400'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            CRUSH
          </button>
        </div>

        {/* Delay Division Selectors when Delay is Active */}
        {masterFX.delayActive && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-neutral-800">
            <span className="text-[9px] font-mono text-neutral-400">BEAT TIME:</span>
            <div className="flex items-center gap-1">
              {[0.25, 0.5, 0.75, 1.0].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onSetFXParam('delayTime', t)}
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                    masterFX.delayTime === t
                      ? 'bg-cyan-500 text-neutral-950 font-bold'
                      : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {t === 0.25 ? '1/4' : t === 0.5 ? '1/2' : t === 0.75 ? '3/4' : '1'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Master Crossfader Section */}
      <div className="bg-neutral-950/90 p-3 rounded-lg border border-neutral-800/90 mt-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-bold text-neutral-300">CROSSFADER</span>
            {/* Curve Selector */}
            <div className="flex items-center gap-1 bg-neutral-900 p-0.5 rounded border border-neutral-800">
              {(['linear', 'smooth', 'scratch'] as CrossfaderCurve[]).map((curve) => (
                <button
                  key={curve}
                  type="button"
                  onClick={() => onCrossfaderCurveChange(curve)}
                  className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded transition-colors ${
                    mixer.crossfaderCurve === curve
                      ? 'bg-neutral-700 text-white font-bold'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {curve}
                </button>
              ))}
            </div>
          </div>

          {/* Automated Auto-Mix Transition */}
          <button
            type="button"
            onClick={onAutoMix}
            disabled={isAutoMixing}
            className={`text-[9px] font-mono font-bold px-2 py-1 rounded flex items-center gap-1 border transition-all ${
              isAutoMixing
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500 animate-pulse'
                : 'bg-neutral-800 text-cyan-400 border-cyan-800/60 hover:bg-neutral-700'
            }`}
            title="Auto-Mix: Executes a professional smooth 4-bar transition"
          >
            <Radio className="w-3 h-3" />
            <span>{isAutoMixing ? 'TRANSITIONING...' : 'AUTO-MIX'}</span>
          </button>
        </div>

        {/* Crossfader Track & Slider */}
        <div className="relative py-2">
          {/* Center Detent Line */}
          <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-0.5 bg-neutral-700 pointer-events-none" />

          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={mixer.crossfader}
            onChange={(e) => onCrossfaderChange(parseFloat(e.target.value))}
            className="w-full h-3 bg-neutral-900 rounded-lg appearance-none cursor-pointer accent-cyan-400 shadow-inner border border-neutral-700"
            title={`Crossfader: ${
              mixer.crossfader < -0.05
                ? `Deck A (${Math.round((1 - (mixer.crossfader + 1) / 2) * 100)}%)`
                : mixer.crossfader > 0.05
                ? `Deck B (${Math.round(((mixer.crossfader + 1) / 2) * 100)}%)`
                : 'Center (Equal Blend)'
            }`}
          />
        </div>

        {/* Quick Position Snap Buttons (A | Center | B) */}
        <div className="flex items-center justify-between text-[10px] font-mono mt-1">
          <button
            type="button"
            onClick={() => onCrossfaderChange(-1)}
            className="text-cyan-400 hover:text-cyan-300 font-bold px-2 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-800"
          >
            ◀ DECK A
          </button>
          <button
            type="button"
            onClick={() => onCrossfaderChange(0)}
            className="text-neutral-400 hover:text-white px-2 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-800"
          >
            CENTER
          </button>
          <button
            type="button"
            onClick={() => onCrossfaderChange(1)}
            className="text-amber-400 hover:text-amber-300 font-bold px-2 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-800"
          >
            DECK B ▶
          </button>
        </div>
      </div>
    </div>
  );
};
