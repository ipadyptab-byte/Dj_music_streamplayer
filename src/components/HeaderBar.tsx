import React from 'react';
import { Mic, Disc3, Radio, HelpCircle } from 'lucide-react';

interface HeaderBarProps {
  activeView: 'mixer' | 'sampler' | 'library' | 'shortcuts';
  onSelectView: (view: 'mixer' | 'sampler' | 'library' | 'shortcuts') => void;
  isRecording: boolean;
  recordingSeconds: number;
  onToggleRecording: () => void;
  micActive: boolean;
  onToggleMic: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  activeView,
  onSelectView,
  isRecording,
  recordingSeconds,
  onToggleRecording,
  micActive,
  onToggleMic,
}) => {
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur sticky top-0 z-30">
      {/* Zone 1: Single text element wordmark */}
      <div className="flex items-center gap-2">
        <Disc3 className="w-5 h-5 text-cyan-400 animate-spin" style={{ animationDuration: '6s' }} />
        <span className="text-base sm:text-lg font-extrabold tracking-tight text-white font-display">
          DJ Studio Pro
        </span>
      </div>

      {/* Zone 2: Clean navigation links */}
      <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-neutral-400">
        <button
          type="button"
          onClick={() => onSelectView('mixer')}
          className={`transition-colors hover:text-white cursor-pointer ${
            activeView === 'mixer' ? 'text-cyan-400 font-bold' : ''
          }`}
        >
          Mixer Console
        </button>
        <button
          type="button"
          onClick={() => onSelectView('sampler')}
          className={`transition-colors hover:text-white cursor-pointer ${
            activeView === 'sampler' ? 'text-cyan-400 font-bold' : ''
          }`}
        >
          FX Sampler
        </button>
        <button
          type="button"
          onClick={() => onSelectView('library')}
          className={`transition-colors hover:text-white cursor-pointer ${
            activeView === 'library' ? 'text-cyan-400 font-bold' : ''
          }`}
        >
          Track Library
        </button>
        <button
          type="button"
          onClick={() => onSelectView('shortcuts')}
          className={`transition-colors hover:text-white cursor-pointer ${
            activeView === 'shortcuts' ? 'text-cyan-400 font-bold' : ''
          }`}
        >
          Shortcuts
        </button>
      </nav>

      {/* Zone 3: 1-2 primary actions (Recording & Mic Talkover) */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Microphone Talkover */}
        <button
          type="button"
          onClick={onToggleMic}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition-all ${
            micActive
              ? 'bg-rose-600 text-white shadow-md animate-pulse ring-2 ring-rose-400/50'
              : 'bg-neutral-850 hover:bg-neutral-800 text-neutral-300 border border-neutral-700'
          }`}
          title="Toggle DJ Live Microphone Talkover"
        >
          <Mic className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{micActive ? 'MIC LIVE' : 'MIC'}</span>
        </button>

        {/* Master Mix Recorder */}
        <button
          type="button"
          onClick={onToggleRecording}
          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition-all shadow-md ${
            isRecording
              ? 'bg-rose-600 text-white animate-pulse ring-2 ring-rose-400/60'
              : 'bg-neutral-850 hover:bg-neutral-800 text-neutral-200 border border-neutral-700'
          }`}
          title={isRecording ? 'Click to Stop & Save Mix Recording' : 'Record Live DJ Mix to Audio File'}
        >
          <div
            className={`w-2 h-2 rounded-full ${
              isRecording ? 'bg-white animate-ping' : 'bg-rose-500'
            }`}
          />
          <span>{isRecording ? `REC ${formatTime(recordingSeconds)}` : 'REC SET'}</span>
        </button>
      </div>
    </header>
  );
};
