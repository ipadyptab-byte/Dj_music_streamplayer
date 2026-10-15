import React, { useState } from 'react';
import { Volume2, Sparkles } from 'lucide-react';
import { SamplerPad } from '../types';

interface PerformanceSamplerProps {
  samplerPads: SamplerPad[];
  onTriggerSample: (sampleId: string) => void;
}

export const PerformanceSampler: React.FC<PerformanceSamplerProps> = ({
  samplerPads,
  onTriggerSample,
}) => {
  const [activePadId, setActivePadId] = useState<number | null>(null);

  const handlePadPress = (pad: SamplerPad) => {
    setActivePadId(pad.id);
    // map pad name to sample key in synthesizer
    const keyMap: Record<string, string> = {
      'Airhorn': 'airhorn',
      'Siren Riser': 'siren',
      'Laser Zap': 'laser',
      '808 Sub Drop': 'sub_drop',
      'Vinyl Scratch': 'scratch_fx',
      'Club Whip': 'club_clap',
      'Rewind Spin': 'rewind',
      'Hype Drop': 'vocal_drop',
    };
    const sampleKey = keyMap[pad.name] || 'airhorn';
    onTriggerSample(sampleKey);

    setTimeout(() => {
      setActivePadId((curr) => (curr === pad.id ? null : curr));
    }, 180);
  };

  return (
    <div className="bg-neutral-900/90 rounded-xl border border-neutral-800 p-4 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-neutral-100 uppercase tracking-wider font-mono">
            Performance FX Sampler
          </h3>
        </div>
        <span className="text-xs text-neutral-400 font-mono">
          Press Keys <span className="text-amber-400 font-bold">1–8</span>
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {samplerPads.map((pad) => {
          const isActive = activePadId === pad.id;
          return (
            <button
              key={pad.id}
              type="button"
              onClick={() => handlePadPress(pad)}
              className={`relative h-20 rounded-lg p-2 flex flex-col justify-between items-start transition-all transform active:scale-95 shadow-md border ${
                isActive
                  ? 'brightness-125 scale-[0.98] ring-2 ring-white/60'
                  : 'bg-neutral-950/80 hover:bg-neutral-800/80 border-neutral-800 hover:border-neutral-700'
              }`}
              style={
                isActive
                  ? { backgroundColor: pad.color, borderColor: pad.color }
                  : { borderLeftWidth: '4px', borderLeftColor: pad.color }
              }
            >
              <div className="flex items-center justify-between w-full">
                <span
                  className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    isActive ? 'bg-black text-white' : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  [{pad.keyBinding}]
                </span>
                <span className={`text-[9px] font-mono uppercase ${isActive ? 'text-neutral-900 font-bold' : 'text-neutral-500'}`}>
                  {pad.category}
                </span>
              </div>

              <div>
                <p className={`text-xs font-bold text-left ${isActive ? 'text-neutral-950' : 'text-neutral-200'}`}>
                  {pad.name}
                </p>
              </div>

              {/* Glowing Bottom Accent Strip */}
              <div
                className="absolute bottom-0 left-0 right-0 h-1 rounded-b"
                style={{ backgroundColor: pad.color, opacity: isActive ? 1 : 0.4 }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};
