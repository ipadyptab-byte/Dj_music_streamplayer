import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Track } from '../types';

interface TurntableProps {
  deckId: 'A' | 'B';
  track: Track | null;
  isPlaying: boolean;
  bpm: number;
  pitch: number;
  accentColor: string;
  onScratch: (deltaAngle: number, velocity: number) => void;
  onScratchStart: () => void;
  onScratchEnd: () => void;
}

export const Turntable: React.FC<TurntableProps> = ({
  deckId,
  track,
  isPlaying,
  bpm,
  pitch,
  accentColor,
  onScratch,
  onScratchStart,
  onScratchEnd,
}) => {
  const platterRef = useRef<HTMLDivElement>(null);
  const [rotation, setRotation] = useState<number>(0);
  const [isScratching, setIsScratching] = useState<boolean>(false);

  const prevAngleRef = useRef<number>(0);
  const prevTimeRef = useRef<number>(0);
  const animFrameRef = useRef<number>(0);

  // Normal turntable constant spin rate based on RPM & pitch
  // 33.33 RPM = ~200 deg/sec
  const effectiveBpm = bpm * (1 + pitch);
  const rotationSpeed = (effectiveBpm / 120) * 180; // degrees per second

  useEffect(() => {
    let lastStamp = performance.now();

    const loop = (now: number) => {
      const dt = (now - lastStamp) / 1000;
      lastStamp = now;

      if (isPlaying && !isScratching) {
        setRotation((prev) => (prev + rotationSpeed * dt) % 360);
      }
      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, isScratching, rotationSpeed]);

  const getPointerAngle = (clientX: number, clientY: number): number => {
    if (!platterRef.current) return 0;
    const rect = platterRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const rad = Math.atan2(clientY - centerY, clientX - centerX);
    return (rad * 180) / Math.PI;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsScratching(true);
    onScratchStart();

    const initialAngle = getPointerAngle(e.clientX, e.clientY);
    prevAngleRef.current = initialAngle;
    prevTimeRef.current = performance.now();

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isScratching) return;
    const currentAngle = getPointerAngle(e.clientX, e.clientY);
    const currentTime = performance.now();

    let deltaAngle = currentAngle - prevAngleRef.current;
    // Handle wrap-around across -180/180
    if (deltaAngle > 180) deltaAngle -= 360;
    if (deltaAngle < -180) deltaAngle += 360;

    const dt = Math.max(0.005, (currentTime - prevTimeRef.current) / 1000);
    const velocity = deltaAngle / dt; // deg per sec

    prevAngleRef.current = currentAngle;
    prevTimeRef.current = currentTime;

    setRotation((prev) => (prev + deltaAngle) % 360);
    onScratch(deltaAngle, velocity);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isScratching) {
      setIsScratching(false);
      onScratchEnd();
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  return (
    <div className="relative flex items-center justify-center p-2 sm:p-4 select-none">
      {/* Turntable Platter Deck Base Housing */}
      <div className="relative w-64 h-64 sm:w-72 sm:h-72 md:w-80 md:h-80 rounded-full bg-neutral-900 border-4 border-neutral-800 shadow-[0_10px_35px_rgba(0,0,0,0.8)] flex items-center justify-center">
        {/* Outer Strobe Dot Perimeter (Technics 1200 style) */}
        <div className="absolute inset-1 rounded-full border border-neutral-800 pointer-events-none flex items-center justify-center overflow-hidden">
          <div
            className="w-full h-full rounded-full border-4 border-dotted border-neutral-600/30"
            style={{ transform: `rotate(${rotation * 0.25}deg)` }}
          />
        </div>

        {/* Speed / Deck Badge */}
        <div className="absolute top-2 left-4 z-10 flex items-center gap-1.5 pointer-events-none">
          <span
            className="text-[11px] font-extrabold tracking-widest font-mono"
            style={{ color: accentColor }}
          >
            DECK {deckId}
          </span>
          <span className="text-[9px] font-mono text-neutral-500">33⅓ RPM</span>
        </div>

        {/* Scratch Warning / Guide */}
        {isScratching && (
          <div className="absolute top-2 right-4 z-10 pointer-events-none">
            <span className="text-[10px] font-bold font-mono tracking-wider text-rose-400 bg-rose-950/80 px-2 py-0.5 rounded border border-rose-800 animate-pulse">
              SCRATCHING
            </span>
          </div>
        )}

        {/* Rotating Vinyl Platter */}
        <div
          ref={platterRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`relative w-[90%] h-[90%] rounded-full cursor-grab active:cursor-grabbing shadow-2xl overflow-hidden transition-transform ${
            isScratching ? 'ring-2 ring-cyan-400/50' : ''
          }`}
          style={{
            touchAction: 'none',
            transform: `rotate(${rotation}deg)`,
          }}
        >
          {/* Vinyl Surface Grooves */}
          <div className="absolute inset-0 rounded-full vinyl-grooves border-2 border-neutral-800" />

          {/* Light Sheen Reflection Conic Overlay */}
          <div className="absolute inset-0 rounded-full vinyl-sheen pointer-events-none" />

          {/* Radial Position Marker Stripe for Scratch Cues */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1/2 bg-gradient-to-b from-white via-cyan-400 to-transparent pointer-events-none shadow-[0_0_8px_rgba(255,255,255,0.8)]" />

          {/* Center Label (Record Center Sticker) */}
          <div
            className="absolute inset-[30%] rounded-full flex flex-col items-center justify-center p-2 text-center shadow-lg border-2 pointer-events-none"
            style={{
              backgroundColor: '#171717',
              borderColor: accentColor,
            }}
          >
            {/* Center Spindle Hole */}
            <div className="w-5 h-5 rounded-full bg-neutral-900 border-2 border-neutral-400 shadow-inner flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-neutral-950" />
            </div>

            {/* Label Content */}
            <div className="mt-1 w-full px-1 overflow-hidden">
              <p className="text-[9px] font-bold text-neutral-100 truncate">
                {track ? track.title : 'NO TRACK LOADED'}
              </p>
              <p className="text-[8px] text-neutral-400 font-mono truncate">
                {track ? `${track.artist} · ${effectiveBpm.toFixed(1)} BPM` : 'Select from Library'}
              </p>
            </div>
          </div>
        </div>

        {/* Tonearm & Stylus Visual Element */}
        <div
          className={`absolute -top-3 -right-2 w-20 h-32 pointer-events-none transition-transform duration-500 origin-top-right ${
            isPlaying || isScratching ? 'rotate-[20deg]' : 'rotate-[-6deg]'
          }`}
        >
          {/* Tonearm Base Gimbal */}
          <div className="absolute top-0 right-4 w-7 h-7 rounded-full bg-neutral-800 border-2 border-neutral-600 shadow-md flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-neutral-950" />
          </div>
          {/* Metallic Arm Shaft */}
          <div className="absolute top-5 right-6 w-1 h-24 bg-gradient-to-r from-neutral-300 to-neutral-500 rounded-full shadow" />
          {/* Stylus Head Cartridge */}
          <div className="absolute bottom-1 right-5 w-3.5 h-6 bg-neutral-900 border border-neutral-700 rounded-sm shadow-md flex items-center justify-center">
            <div className="w-1 h-1 bg-amber-400 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
};
