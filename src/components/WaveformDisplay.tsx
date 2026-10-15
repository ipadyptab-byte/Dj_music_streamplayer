import React, { useRef, useEffect } from 'react';
import { HotCue, Track } from '../types';

interface WaveformOverviewProps {
  track: Track | null;
  currentTime: number;
  duration: number;
  hotCues: (HotCue | null)[];
  accentColor: string;
  onSeek: (time: number) => void;
}

export const WaveformOverview: React.FC<WaveformOverviewProps> = ({
  track,
  currentTime,
  duration,
  hotCues,
  accentColor,
  onSeek,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Dark background
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, width, height);

    if (!track || !track.waveformPeaks || track.waveformPeaks.length === 0) {
      // Empty waveform placeholder line
      ctx.strokeStyle = '#262626';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      return;
    }

    const peaks = track.waveformPeaks;
    const barWidth = width / peaks.length;
    const midY = height / 2;

    // Draw peaks
    for (let i = 0; i < peaks.length; i++) {
      const peak = peaks[i];
      const barH = Math.max(2, peak * (height / 2 - 2));
      const x = i * barWidth;
      const progress = (currentTime / (duration || 1));
      const isPast = (i / peaks.length) <= progress;

      ctx.fillStyle = isPast ? accentColor : '#525252';
      ctx.fillRect(x, midY - barH, Math.max(1, barWidth - 0.5), barH * 2);
    }

    // Draw playhead position line
    if (duration > 0) {
      const playheadX = (currentTime / duration) * width;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
    }
  }, [track, currentTime, duration, accentColor]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  return (
    <div
      onClick={handleClick}
      className="relative w-full h-8 bg-neutral-900 rounded border border-neutral-800 overflow-hidden cursor-pointer group"
      title="Click anywhere to needle search position"
    >
      <canvas
        ref={canvasRef}
        width={360}
        height={32}
        className="w-full h-full block"
      />
      {/* Hot Cue Markers */}
      {hotCues.map((cue, idx) => {
        if (!cue || !duration) return null;
        const leftPercent = (cue.time / duration) * 100;
        return (
          <div
            key={idx}
            className="absolute top-0 bottom-0 w-1 pointer-events-none flex flex-col items-center"
            style={{ left: `${leftPercent}%`, transform: 'translateX(-50%)' }}
          >
            <div
              className="w-3 h-2 text-[8px] font-bold text-black flex items-center justify-center rounded-b"
              style={{ backgroundColor: cue.color }}
            >
              {idx + 1}
            </div>
            <div className="w-0.5 flex-1" style={{ backgroundColor: cue.color }} />
          </div>
        );
      })}
    </div>
  );
};

interface DualScrollingWaveformsProps {
  trackA: Track | null;
  trackB: Track | null;
  timeA: number;
  timeB: number;
  durationA: number;
  durationB: number;
  isPlayingA: boolean;
  isPlayingB: boolean;
  bpmA: number;
  bpmB: number;
}

export const DualScrollingWaveforms: React.FC<DualScrollingWaveformsProps> = ({
  trackA,
  trackB,
  timeA,
  timeB,
  durationA,
  durationB,
  bpmA,
  bpmB,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    const midY = height / 2;
    const centerX = width / 2;
    const pixelsPerSecond = 50; // Zoom factor

    // Draw grid lines
    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    // Helper to render deck waveform stream
    const drawStream = (
      track: Track | null,
      currentTime: number,
      duration: number,
      bpm: number,
      isTop: boolean,
      primaryColor: string
    ) => {
      const centerY = isTop ? midY * 0.5 : midY + midY * 0.5;
      const streamHeight = midY * 0.45;

      if (!track || !track.waveformPeaks || duration <= 0) {
        ctx.fillStyle = '#404040';
        ctx.font = '10px JetBrains Mono';
        ctx.fillText(isTop ? 'DECK A EMPTY' : 'DECK B EMPTY', centerX - 40, centerY + 4);
        return;
      }

      const peaks = track.waveformPeaks;
      const secondsPerBeat = 60 / (bpm || 120);

      // Render beats & bars
      const visibleStartSec = currentTime - centerX / pixelsPerSecond;
      const visibleEndSec = currentTime + centerX / pixelsPerSecond;

      // Draw beat grid ticks
      const startBeat = Math.floor(visibleStartSec / secondsPerBeat);
      const endBeat = Math.ceil(visibleEndSec / secondsPerBeat);

      ctx.lineWidth = 1;
      for (let b = startBeat; b <= endBeat; b++) {
        const beatSec = b * secondsPerBeat;
        const beatX = centerX + (beatSec - currentTime) * pixelsPerSecond;
        const isBar = b % 4 === 0;

        ctx.strokeStyle = isBar ? '#e5e5e5' : '#404040';
        ctx.beginPath();
        ctx.moveTo(beatX, centerY - (isBar ? streamHeight : streamHeight * 0.6));
        ctx.lineTo(beatX, centerY + (isBar ? streamHeight : streamHeight * 0.6));
        ctx.stroke();
      }

      // Draw audio waveform blocks
      const step = 2; // draw every 2px
      for (let x = 0; x < width; x += step) {
        const sec = currentTime + (x - centerX) / pixelsPerSecond;
        if (sec >= 0 && sec < duration) {
          const peakIdx = Math.floor((sec / duration) * peaks.length);
          const peak = peaks[peakIdx] || 0.05;
          const h = Math.max(2, peak * streamHeight);

          // 3-color frequency shading (lower = red, mid = green, upper = blue)
          ctx.fillStyle = primaryColor;
          ctx.fillRect(x, centerY - h, step, h * 2);
        }
      }
    };

    // Draw Deck A (top half, cyan)
    drawStream(trackA, timeA, durationA, bpmA, true, '#06b6d4');

    // Draw Deck B (bottom half, amber/orange)
    drawStream(trackB, timeB, durationB, bpmB, false, '#f59e0b');

    // Draw Center Red Playhead Line
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, height);
    ctx.stroke();

    // Small triangular playhead pointers
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(centerX - 5, 0);
    ctx.lineTo(centerX + 5, 0);
    ctx.lineTo(centerX, 8);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(centerX - 5, height);
    ctx.lineTo(centerX + 5, height);
    ctx.lineTo(centerX, height - 8);
    ctx.fill();
  }, [trackA, trackB, timeA, timeB, durationA, durationB, bpmA, bpmB]);

  return (
    <div className="relative w-full h-28 bg-black rounded-lg border border-neutral-800 overflow-hidden shadow-inner flex flex-col justify-between">
      {/* Top Deck Tag */}
      <div className="absolute top-1 left-2 z-10 flex items-center gap-2 pointer-events-none">
        <span className="text-[10px] font-mono font-bold text-cyan-400">DECK A</span>
        <span className="text-[9px] font-mono text-neutral-400">{bpmA.toFixed(1)} BPM</span>
      </div>

      {/* Bottom Deck Tag */}
      <div className="absolute bottom-1 left-2 z-10 flex items-center gap-2 pointer-events-none">
        <span className="text-[10px] font-mono font-bold text-amber-400">DECK B</span>
        <span className="text-[9px] font-mono text-neutral-400">{bpmB.toFixed(1)} BPM</span>
      </div>

      <canvas
        ref={canvasRef}
        width={720}
        height={112}
        className="w-full h-full block"
      />
    </div>
  );
};
