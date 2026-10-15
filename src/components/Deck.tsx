import React from 'react';
import { Play, Pause, RotateCcw, Zap, Volume2, Headphones } from 'lucide-react';
import { DeckState, Track } from '../types';
import { Turntable } from './Turntable';
import { EQKnob } from './EQKnob';
import { WaveformOverview } from './WaveformDisplay';

interface DeckProps {
  deck: DeckState;
  otherDeck: DeckState;
  accentColor: string;
  peakLevel: number;
  onPlayPause: () => void;
  onCue: () => void;
  onSync: () => void;
  onPitchChange: (pitch: number) => void;
  onPitchBend: (bend: number) => void;
  onPitchRangeToggle: () => void;
  onSeek: (time: number) => void;
  onScratch: (deltaAngle: number, velocity: number) => void;
  onScratchStart: () => void;
  onScratchEnd: () => void;
  onSetEQ: (band: 'low' | 'mid' | 'high', value: number) => void;
  onToggleKill: (band: 'low' | 'mid' | 'high') => void;
  onSetFilter: (val: number) => void;
  onSetVolume: (vol: number) => void;
  onTriggerHotCue: (index: number) => void;
  onClearHotCue: (index: number) => void;
  onSetLoopLength: (beats: number) => void;
  onToggleLoop: () => void;
  onLoadTrackClick: () => void;
}

export const Deck: React.FC<DeckProps> = ({
  deck,
  otherDeck,
  accentColor,
  peakLevel,
  onPlayPause,
  onCue,
  onSync,
  onPitchChange,
  onPitchBend,
  onPitchRangeToggle,
  onSeek,
  onScratch,
  onScratchStart,
  onScratchEnd,
  onSetEQ,
  onToggleKill,
  onSetFilter,
  onSetVolume,
  onTriggerHotCue,
  onClearHotCue,
  onSetLoopLength,
  onToggleLoop,
  onLoadTrackClick,
}) => {
  const currentBpm = deck.originalBpm * (1 + deck.pitch * deck.pitchRange);
  const pitchPercent = (deck.pitch * deck.pitchRange * 100).toFixed(2);

  // 10-segment LED ladder
  const meterSegments = 10;
  const activeSegments = Math.round(peakLevel * meterSegments);

  return (
    <div className="flex-1 bg-neutral-900/90 rounded-xl border border-neutral-800 p-3 sm:p-4 flex flex-col justify-between shadow-2xl relative">
      {/* Top Track Header Banner */}
      <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-3 overflow-hidden">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center font-display font-extrabold text-sm text-neutral-950 shrink-0 shadow"
            style={{ backgroundColor: accentColor }}
          >
            {deck.id}
          </div>
          <div className="overflow-hidden">
            <h3 className="text-sm font-bold text-neutral-100 truncate">
              {deck.track ? deck.track.title : 'Empty Deck'}
            </h3>
            <p className="text-xs text-neutral-400 truncate">
              {deck.track ? `${deck.track.artist} · ${deck.track.genre.replace('_', ' ')}` : 'Click Load Track'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Key and BPM Info */}
          <div className="text-right">
            <div className="text-xs font-mono font-bold text-neutral-200">
              {currentBpm.toFixed(1)} <span className="text-[10px] text-neutral-500">BPM</span>
            </div>
            <div className="text-[10px] font-mono text-neutral-400">
              KEY {deck.track ? deck.track.key : '--'} · {pitchPercent > '0' ? `+${pitchPercent}` : pitchPercent}%
            </div>
          </div>

          {/* Quick Track Load button */}
          <button
            type="button"
            onClick={onLoadTrackClick}
            className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 transition-colors"
          >
            Load
          </button>
        </div>
      </div>

      {/* Main Deck Center Section: Turntable + Scratch + Waveform Overview */}
      <div className="my-2">
        <WaveformOverview
          track={deck.track}
          currentTime={deck.currentTime}
          duration={deck.duration}
          hotCues={deck.hotCues}
          accentColor={accentColor}
          onSeek={onSeek}
        />

        <div className="flex flex-col xl:flex-row items-center justify-center gap-4 mt-2">
          {/* Vinyl Scratch Platter */}
          <Turntable
            deckId={deck.id}
            track={deck.track}
            isPlaying={deck.isPlaying}
            bpm={currentBpm}
            pitch={deck.pitch * deck.pitchRange}
            accentColor={accentColor}
            onScratch={onScratch}
            onScratchStart={onScratchStart}
            onScratchEnd={onScratchEnd}
          />

          {/* Vertical Pitch Fader Section */}
          <div className="flex flex-col items-center justify-between bg-neutral-950/70 p-2.5 rounded-lg border border-neutral-800/80 h-64 w-28 shrink-0">
            <div className="flex items-center justify-between w-full">
              <span className="text-[10px] font-mono font-bold text-neutral-400">TEMPO</span>
              <button
                type="button"
                onClick={onPitchRangeToggle}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-cyan-300 hover:bg-neutral-700"
                title="Toggle pitch slider range (±8%, ±16%, ±50%)"
              >
                ±{Math.round(deck.pitchRange * 100)}%
              </button>
            </div>

            {/* Vertical Range Slider */}
            <div className="relative flex-1 flex items-center justify-center my-2">
              {/* Zero Detent Marker */}
              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-neutral-700 pointer-events-none" />
              <input
                type="range"
                min={-1}
                max={1}
                step={0.001}
                value={deck.pitch}
                onChange={(e) => onPitchChange(parseFloat(e.target.value))}
                className="vertical-slider h-40 cursor-pointer accent-cyan-400"
                title={`Pitch: ${pitchPercent}% (Center is 0%)`}
              />
            </div>

            {/* Pitch Bend Buttons */}
            <div className="flex items-center gap-1 w-full justify-between mt-1">
              <button
                type="button"
                onPointerDown={() => onPitchBend(-0.04)}
                onPointerUp={() => onPitchBend(0)}
                className="flex-1 py-1 text-[10px] font-mono font-bold rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 active:bg-neutral-600"
                title="Momentary Pitch Bend Down"
              >
                -
              </button>
              <button
                type="button"
                onClick={() => onPitchChange(0)}
                className="px-1.5 py-1 text-[9px] font-mono rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400"
                title="Reset pitch to 0%"
              >
                RESET
              </button>
              <button
                type="button"
                onPointerDown={() => onPitchBend(0.04)}
                onPointerUp={() => onPitchBend(0)}
                className="flex-1 py-1 text-[10px] font-mono font-bold rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 active:bg-neutral-600"
                title="Momentary Pitch Bend Up"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Hot Cues & Beat Loop Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 my-2 bg-neutral-950/60 p-2.5 rounded-lg border border-neutral-800/80">
        {/* Hot Cues (1 - 4) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase">Hot Cues</span>
            <span className="text-[9px] text-neutral-500 font-mono">Click to Set / Jump</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[0, 1, 2, 3].map((idx) => {
              const cue = deck.hotCues[idx];
              const cueColors = ['#06b6d4', '#f59e0b', '#10b981', '#ec4899'];
              return (
                <div key={idx} className="relative group">
                  <button
                    type="button"
                    onClick={() => onTriggerHotCue(idx)}
                    className={`w-full py-2 rounded text-xs font-mono font-bold transition-all shadow-sm flex flex-col items-center justify-center ${
                      cue
                        ? 'text-neutral-950 hover:brightness-110 active:scale-95'
                        : 'bg-neutral-800/80 text-neutral-400 hover:bg-neutral-750 hover:text-neutral-200 border border-neutral-700/60'
                    }`}
                    style={cue ? { backgroundColor: cueColors[idx] } : {}}
                    title={cue ? `Jump to Cue ${idx + 1} (${cue.time.toFixed(1)}s)` : `Set Cue ${idx + 1} at current playhead`}
                  >
                    <span>{idx + 1}</span>
                    {cue && <span className="text-[8px] font-normal">{cue.time.toFixed(1)}s</span>}
                  </button>
                  {cue && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClearHotCue(idx);
                      }}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Clear Hot Cue"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Auto Beat Loop */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase">Beat Loop</span>
            <button
              type="button"
              onClick={onToggleLoop}
              className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded transition-colors ${
                deck.loopActive
                  ? 'bg-amber-500 text-neutral-950 animate-pulse'
                  : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {deck.loopActive ? 'LOOP ACTIVE' : 'LOOP OFF'}
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[1, 2, 4, 8].map((beats) => (
              <button
                key={beats}
                type="button"
                onClick={() => onSetLoopLength(beats)}
                className={`py-2 rounded text-xs font-mono font-bold transition-all ${
                  deck.loopActive && deck.loopLengthBeats === beats
                    ? 'bg-amber-500 text-neutral-950 ring-2 ring-amber-400/50'
                    : 'bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700 hover:text-white border border-neutral-700/60'
                }`}
              >
                {beats}B
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Controls: CDJ Transport Buttons + Volume Fader + 3-Band EQ */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-3 border-t border-neutral-800 items-center">
        {/* CDJ Pioneer Style Transport: CUE, PLAY/PAUSE, SYNC */}
        <div className="md:col-span-5 flex items-center gap-2">
          {/* Large CDJ Play/Pause Button */}
          <button
            type="button"
            onClick={onPlayPause}
            className={`w-14 h-14 rounded-full border-2 flex items-center justify-center font-bold shadow-lg transition-all active:scale-95 ${
              deck.isPlaying
                ? 'bg-emerald-500 border-emerald-400 text-neutral-950 glow-emerald'
                : 'bg-neutral-800 border-neutral-600 text-neutral-200 hover:border-neutral-400 hover:text-white'
            }`}
            title="Play / Pause"
          >
            {deck.isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
          </button>

          {/* CDJ CUE Button */}
          <button
            type="button"
            onClick={onCue}
            className={`w-12 h-12 rounded-full border-2 flex flex-col items-center justify-center font-mono text-xs font-bold transition-all active:scale-95 ${
              deck.isCueing
                ? 'bg-amber-500 border-amber-400 text-neutral-950 glow-amber'
                : 'bg-neutral-800 border-neutral-600 text-neutral-300 hover:border-neutral-400 hover:text-white'
            }`}
            title="Cue: Jump to start or temporary cue point"
          >
            <RotateCcw className="w-4 h-4 mb-0.5" />
            <span className="text-[9px]">CUE</span>
          </button>

          {/* BEAT SYNC Button */}
          <button
            type="button"
            onClick={onSync}
            className={`px-3 py-3 rounded-lg border flex flex-col items-center justify-center font-mono text-xs font-bold transition-all active:scale-95 ${
              deck.isSynced
                ? 'bg-cyan-500 border-cyan-400 text-neutral-950 glow-cyan'
                : 'bg-neutral-800 border-neutral-700 text-cyan-400 hover:border-cyan-600'
            }`}
            title={`Sync BPM to Deck ${otherDeck.id} (${otherDeck.originalBpm.toFixed(1)} BPM)`}
          >
            <Zap className="w-4 h-4 mb-0.5 fill-current" />
            <span className="text-[9px]">SYNC</span>
          </button>
        </div>

        {/* 3-Band Equalizer & Filter */}
        <div className="md:col-span-5 grid grid-cols-4 gap-1 items-center bg-neutral-950/50 p-1.5 rounded-lg border border-neutral-800/80">
          <EQKnob
            label="High"
            value={deck.eqHigh}
            min={-24}
            max={6}
            defaultValue={0}
            color={accentColor}
            killActive={deck.killHigh}
            onKillToggle={() => onToggleKill('high')}
            onChange={(val) => onSetEQ('high', val)}
            size="sm"
          />
          <EQKnob
            label="Mid"
            value={deck.eqMid}
            min={-24}
            max={6}
            defaultValue={0}
            color={accentColor}
            killActive={deck.killMid}
            onKillToggle={() => onToggleKill('mid')}
            onChange={(val) => onSetEQ('mid', val)}
            size="sm"
          />
          <EQKnob
            label="Low"
            value={deck.eqLow}
            min={-24}
            max={6}
            defaultValue={0}
            color={accentColor}
            killActive={deck.killLow}
            onKillToggle={() => onToggleKill('low')}
            onChange={(val) => onSetEQ('low', val)}
            size="sm"
          />
          <EQKnob
            label="Filter"
            value={deck.filter}
            min={-1}
            max={1}
            defaultValue={0}
            unit=""
            color="#f59e0b"
            hasKill={false}
            onChange={onSetFilter}
            size="sm"
          />
        </div>

        {/* Volume Channel Fader & 10-Segment Stereo LED Meter */}
        <div className="md:col-span-2 flex items-center justify-center gap-2">
          {/* LED Meter Strip */}
          <div className="flex flex-col-reverse gap-0.5 h-20 w-2.5 bg-neutral-950 p-0.5 rounded border border-neutral-800">
            {Array.from({ length: meterSegments }).map((_, i) => {
              const active = i < activeSegments;
              const isPeak = i >= 8;
              const isMid = i >= 5;
              const barColor = isPeak ? '#ef4444' : isMid ? '#f59e0b' : '#10b981';
              return (
                <div
                  key={i}
                  className="w-full flex-1 rounded-xs transition-opacity duration-75"
                  style={{
                    backgroundColor: active ? barColor : '#262626',
                    opacity: active ? 1 : 0.4,
                  }}
                />
              );
            })}
          </div>

          {/* Vertical Channel Volume Fader */}
          <div className="flex flex-col items-center">
            <span className="text-[9px] font-mono text-neutral-400 mb-1">VOL</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={deck.volume}
              onChange={(e) => onSetVolume(parseFloat(e.target.value))}
              className="vertical-slider h-20 cursor-pointer accent-white"
              title={`Deck ${deck.id} Volume: ${Math.round(deck.volume * 100)}%`}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
