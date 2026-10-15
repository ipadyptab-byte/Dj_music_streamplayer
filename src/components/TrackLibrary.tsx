import React, { useState, useRef } from 'react';
import { Music, Upload, Search, Play, Pause, Plus, Check } from 'lucide-react';
import { Track } from '../types';
import { djEngine } from '../audio/AudioEngine';
import { extractWaveformPeaks, synthesizeDJTrack } from '../audio/TrackSynthesizer';

interface TrackLibraryProps {
  tracks: Track[];
  currentTrackA: Track | null;
  currentTrackB: Track | null;
  onLoadTrack: (deckId: 'A' | 'B', track: Track) => void;
  onAddNewTrack: (track: Track) => void;
}

export const TrackLibrary: React.FC<TrackLibraryProps> = ({
  tracks,
  currentTrackA,
  currentTrackB,
  onLoadTrack,
  onAddNewTrack,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredTracks = tracks.filter((t) => {
    const matchesSearch =
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.artist.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.genre.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesGenre = selectedGenre === 'all' || t.genre === selectedGenre;
    return matchesSearch && matchesGenre;
  });

  const genres = ['all', 'tech_house', 'synthwave', 'dnb', 'trap', 'trance', 'nu_disco'];

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const audioBuffer = await djEngine.decodeAudioFile(file);
        const peaks = extractWaveformPeaks(audioBuffer, 400);

        const newTrack: Track = {
          id: `custom-${Date.now()}-${i}`,
          title: file.name.replace(/\.[^/.]+$/, ''),
          artist: 'Local Import',
          genre: 'custom',
          bpm: 124, // default estimated
          key: 'C',
          duration: audioBuffer.duration,
          audioBuffer,
          waveformPeaks: peaks,
          artworkColor: '#06b6d4',
        };

        onAddNewTrack(newTrack);
      } catch (err) {
        console.error('Failed to decode user audio file', err);
      }
    }
  };

  const handleCreateCustomTrack = async (genre: 'tech_house' | 'synthwave' | 'dnb' | 'trap' | 'trance' | 'nu_disco') => {
    setIsSynthesizing(true);
    try {
      const synth = await synthesizeDJTrack(genre);
      const newTrack: Track = {
        id: `synth-${Date.now()}`,
        title: `${synth.title} (Mix ${Math.floor(Math.random() * 90 + 10)})`,
        artist: synth.artist,
        genre: genre,
        bpm: synth.bpm,
        key: synth.key,
        duration: synth.buffer.duration,
        audioBuffer: synth.buffer,
        waveformPeaks: synth.peaks,
        artworkColor: genre === 'synthwave' ? '#f43f5e' : genre === 'dnb' ? '#eab308' : '#06b6d4',
      };
      onAddNewTrack(newTrack);
    } catch (err) {
      console.error('Failed to synthesize custom track', err);
    } finally {
      setIsSynthesizing(false);
    }
  };

  return (
    <div className="bg-neutral-900/90 rounded-xl border border-neutral-800 p-4 shadow-xl">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Music className="w-5 h-5 text-cyan-400" />
          <h3 className="text-base font-bold text-neutral-100 font-display">Crate & Track Library</h3>
          <span className="text-xs text-neutral-400 font-mono">({tracks.length} tracks available)</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* File Upload Hidden Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Upload className="w-3.5 h-3.5 text-cyan-400" />
            <span>Import Audio File</span>
          </button>

          {/* Quick Synthesize New Track Dropdown/Button */}
          <button
            type="button"
            onClick={() => handleCreateCustomTrack('tech_house')}
            disabled={isSynthesizing}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-neutral-950 flex items-center gap-1.5 transition-colors shadow-sm font-mono"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isSynthesizing ? 'Synthesizing...' : 'Generate Groove'}</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 my-3">
        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            placeholder="Search by title, artist, BPM..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-200 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Genre Tags */}
        <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          {genres.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setSelectedGenre(g)}
              className={`text-[11px] font-mono capitalize px-2.5 py-1 rounded-md transition-colors shrink-0 ${
                selectedGenre === g
                  ? 'bg-neutral-800 text-cyan-400 font-bold border border-cyan-500/40'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-850'
              }`}
            >
              {g.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Track List Table */}
      <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-lg border border-neutral-800/80">
        <table className="w-full text-left text-xs">
          <thead className="bg-neutral-950 text-neutral-400 font-mono text-[10px] sticky top-0 border-b border-neutral-800">
            <tr>
              <th className="py-2 px-3">TITLE / ARTIST</th>
              <th className="py-2 px-2">GENRE</th>
              <th className="py-2 px-2 text-right">BPM</th>
              <th className="py-2 px-2 text-center">KEY</th>
              <th className="py-2 px-2 text-right">TIME</th>
              <th className="py-2 px-3 text-right">LOAD DECK</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/50">
            {filteredTracks.map((track) => {
              const isLoadedA = currentTrackA?.id === track.id;
              const isLoadedB = currentTrackB?.id === track.id;
              const durationFormatted = `${Math.floor(track.duration / 60)}:${Math.floor(track.duration % 60)
                .toString()
                .padStart(2, '0')}`;

              return (
                <tr
                  key={track.id}
                  className="hover:bg-neutral-800/40 transition-colors group"
                >
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: track.artworkColor || '#06b6d4' }}
                      />
                      <div>
                        <div className="font-semibold text-neutral-200 group-hover:text-white truncate max-w-xs">
                          {track.title}
                        </div>
                        <div className="text-[10px] text-neutral-400">{track.artist}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-2">
                    <span className="text-[10px] font-mono text-neutral-400 uppercase">
                      {track.genre.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono font-bold text-neutral-200 tabular-nums">
                    {track.bpm.toFixed(0)}
                  </td>
                  <td className="py-2.5 px-2 text-center font-mono text-neutral-300">
                    {track.key}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono text-neutral-400 tabular-nums">
                    {durationFormatted}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onLoadTrack('A', track)}
                        className={`text-[10px] font-mono font-bold px-2 py-1 rounded transition-all ${
                          isLoadedA
                            ? 'bg-cyan-500 text-neutral-950 glow-cyan'
                            : 'bg-neutral-800 text-cyan-400 hover:bg-cyan-950 hover:border-cyan-700 border border-neutral-700'
                        }`}
                        title="Load to Deck A"
                      >
                        {isLoadedA ? '✓ DECK A' : 'TO DECK A'}
                      </button>

                      <button
                        type="button"
                        onClick={() => onLoadTrack('B', track)}
                        className={`text-[10px] font-mono font-bold px-2 py-1 rounded transition-all ${
                          isLoadedB
                            ? 'bg-amber-500 text-neutral-950 glow-amber'
                            : 'bg-neutral-800 text-amber-400 hover:bg-amber-950 hover:border-amber-700 border border-neutral-700'
                        }`}
                        title="Load to Deck B"
                      >
                        {isLoadedB ? '✓ DECK B' : 'TO DECK B'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
