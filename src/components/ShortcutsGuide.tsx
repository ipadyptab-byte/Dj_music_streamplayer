import React from 'react';
import { Keyboard, X } from 'lucide-react';

interface ShortcutsGuideProps {
  onClose: () => void;
}

export const ShortcutsGuide: React.FC<ShortcutsGuideProps> = ({ onClose }) => {
  const deckAShortcuts = [
    { key: 'Space', desc: 'Play / Pause Deck A' },
    { key: 'C', desc: 'Cue Deck A' },
    { key: 'S', desc: 'Sync Deck A BPM to Deck B' },
    { key: 'Q / W / E / R', desc: 'Hot Cues 1, 2, 3, 4' },
    { key: 'Z / X', desc: 'Pitch Bend Down / Up' },
  ];

  const deckBShortcuts = [
    { key: 'Enter', desc: 'Play / Pause Deck B' },
    { key: 'N', desc: 'Cue Deck B' },
    { key: 'B', desc: 'Sync Deck B BPM to Deck A' },
    { key: 'U / I / O / P', desc: 'Hot Cues 1, 2, 3, 4' },
    { key: 'K / L', desc: 'Pitch Bend Down / Up' },
  ];

  const mixerShortcuts = [
    { key: '← / →', desc: 'Crossfader Left (A) / Right (B)' },
    { key: '↓', desc: 'Crossfader Center' },
    { key: '1 – 8', desc: 'Trigger Performance FX Pads 1–8' },
    { key: 'V', desc: 'Turntable Vinyl Motor Brake' },
    { key: 'M', desc: 'Auto-Mix Transition' },
  ];

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-2xl max-w-2xl mx-auto my-4">
      <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Keyboard className="w-5 h-5 text-cyan-400" />
          <h3 className="text-base font-bold text-white font-display">DJ Console Hotkeys & Shortcuts</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 text-xs">
        {/* Deck A */}
        <div className="bg-neutral-950/60 p-3 rounded-lg border border-neutral-800">
          <h4 className="text-cyan-400 font-mono font-bold mb-2">DECK A CONTROLS</h4>
          <div className="space-y-2">
            {deckAShortcuts.map((s, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="font-mono bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-200">
                  {s.key}
                </span>
                <span className="text-neutral-400 text-[11px] text-right">{s.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Deck B */}
        <div className="bg-neutral-950/60 p-3 rounded-lg border border-neutral-800">
          <h4 className="text-amber-400 font-mono font-bold mb-2">DECK B CONTROLS</h4>
          <div className="space-y-2">
            {deckBShortcuts.map((s, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="font-mono bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-200">
                  {s.key}
                </span>
                <span className="text-neutral-400 text-[11px] text-right">{s.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Mixer & Sampler */}
        <div className="bg-neutral-950/60 p-3 rounded-lg border border-neutral-800">
          <h4 className="text-emerald-400 font-mono font-bold mb-2">MIXER & SAMPLER</h4>
          <div className="space-y-2">
            {mixerShortcuts.map((s, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="font-mono bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-200">
                  {s.key}
                </span>
                <span className="text-neutral-400 text-[11px] text-right">{s.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
