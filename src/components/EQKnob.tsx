import React, { useRef, useState, useCallback, useEffect } from 'react';

interface EQKnobProps {
  label: string;
  value: number; // -1 to +1 (or custom range)
  min?: number;
  max?: number;
  defaultValue?: number;
  unit?: string;
  color?: string; // hex or tailwind class
  killActive?: boolean;
  onKillToggle?: () => void;
  hasKill?: boolean;
  onChange: (value: number) => void;
  size?: 'sm' | 'md' | 'lg';
}

export const EQKnob: React.FC<EQKnobProps> = ({
  label,
  value,
  min = -24,
  max = 6,
  defaultValue = 0,
  unit = 'dB',
  color = '#06b6d4',
  killActive = false,
  onKillToggle,
  hasKill = true,
  onChange,
  size = 'md',
}) => {
  const knobRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef<number>(0);
  const startValRef = useRef<number>(0);

  // Normalize value to 0..1
  const normalized = (value - min) / (max - min);
  // Angle: -135deg to +135deg (total 270deg rotation)
  const angle = -135 + normalized * 270;

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    startYRef.current = e.clientY;
    startValRef.current = value;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const deltaY = startYRef.current - e.clientY;
    const sensitivity = (max - min) / 140; // 140px drag for full sweep
    let newVal = startValRef.current + deltaY * sensitivity;
    newVal = Math.max(min, Math.min(max, newVal));

    // Snap to 0 within small threshold
    if (Math.abs(newVal) < (max - min) * 0.02) {
      newVal = 0;
    }
    onChange(Number(newVal.toFixed(1)));
  }, [isDragging, max, min, onChange]);

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleDoubleClick = () => {
    onChange(defaultValue);
  };

  const dimensions = size === 'sm' ? 'w-10 h-10' : size === 'lg' ? 'w-16 h-16' : 'w-12 h-12';
  const indicatorHeight = size === 'sm' ? 'h-3.5' : size === 'lg' ? 'h-5' : 'h-4';

  return (
    <div className="flex flex-col items-center select-none group">
      {/* Knob Header Label */}
      <span className="text-[10px] font-bold tracking-wider text-neutral-400 uppercase mb-1">
        {label}
      </span>

      {/* Rotary Dial */}
      <div
        ref={knobRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        className={`relative ${dimensions} rounded-full bg-neutral-900 border-2 border-neutral-700/80 shadow-inner flex items-center justify-center cursor-ns-resize transition-shadow hover:border-neutral-500 ${
          isDragging ? 'border-neutral-400 ring-2 ring-neutral-500/20' : ''
        }`}
        style={{ touchAction: 'none' }}
        title={`${label}: ${value > 0 ? '+' : ''}${value} ${unit} (Drag up/down, double click to reset)`}
      >
        {/* Outer tick marks */}
        <div className="absolute inset-0 rounded-full border border-neutral-800 pointer-events-none" />

        {/* Center metallic cap */}
        <div className="w-3/4 h-3/4 rounded-full bg-gradient-to-b from-neutral-800 to-neutral-950 flex items-center justify-center shadow">
          {/* Pointer needle indicator */}
          <div
            className="absolute inset-0 flex items-start justify-center pointer-events-none"
            style={{ transform: `rotate(${angle}deg)` }}
          >
            <div
              className={`w-1 ${indicatorHeight} rounded-full mt-1`}
              style={{ backgroundColor: killActive ? '#737373' : color }}
            />
          </div>
        </div>
      </div>

      {/* Value Readout */}
      <div className="mt-1 flex items-center justify-center">
        <span className="text-[10px] font-mono tabular-nums text-neutral-300">
          {killActive ? 'MUTED' : `${value > 0 ? '+' : ''}${value}${unit}`}
        </span>
      </div>

      {/* Kill Switch Toggle */}
      {hasKill && onKillToggle && (
        <button
          type="button"
          onClick={onKillToggle}
          className={`mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded transition-colors uppercase tracking-wider ${
            killActive
              ? 'bg-rose-950 text-rose-300 border border-rose-700 font-extrabold shadow-sm'
              : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700'
          }`}
          title={`Kill / Isolate ${label}`}
        >
          Kill
        </button>
      )}
    </div>
  );
};
