import type { MouseEvent, RefObject } from "react";
import { useMemo } from "react";
import { HelpTooltip } from "./HelpTooltip";
import { localFilePathToMediaUrl } from "./media-url";

export type QcPlayerAnalysis = {
  releaseTitle: string;
  releaseArtist: string;
  trackFilePath: string;
  durationMs: number;
  peakData: number[];
  loudnessLufs: number;
  sampleRateHz: number;
  channels: number;
  mediaFingerprint: string;
};

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatClockFromMs(ms: number): string {
  return formatClock(ms / 1000);
}

function formatLufs(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${value.toFixed(1)} LUFS`;
}

function formatDbfs(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(1)} dBFS`;
}

function maxPeakDbfs(peaks: number[]): number | null {
  if (!peaks.length) return null;
  let out = Number.NEGATIVE_INFINITY;
  for (const peak of peaks) {
    if (peak > out) out = peak;
  }
  return Number.isFinite(out) ? out : null;
}

function summarizePeaksForDisplay(peaks: number[], targetBars = 160): number[] {
  if (peaks.length <= targetBars) return peaks;
  const chunkSize = Math.ceil(peaks.length / targetBars);
  const bars: number[] = [];
  for (let i = 0; i < peaks.length; i += chunkSize) {
    let chunkMax = -96;
    for (let j = i; j < Math.min(i + chunkSize, peaks.length); j += 1) {
      if (peaks[j] > chunkMax) chunkMax = peaks[j];
    }
    bars.push(chunkMax);
  }
  return bars;
}

function peakDbfsToHeightScale(peakDbfs: number): number {
  const floor = -96;
  const clamped = Math.min(0, Math.max(floor, Number.isFinite(peakDbfs) ? peakDbfs : floor));
  const normalized = (clamped - floor) / Math.abs(floor);
  return 0.08 + normalized * 0.92;
}

function WaveformOverview({
  peaks,
  progress,
  onSeek
}: {
  peaks: number[];
  progress: number;
  onSeek: (ratio: number) => void;
}) {
  const bars = useMemo(() => summarizePeaksForDisplay(peaks), [peaks]);
  const clampedProgress = Math.max(0, Math.min(1, progress));

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    onSeek(ratio);
  };

  return (
    <HelpTooltip
      content="Click anywhere on the waveform to seek. Use Left/Right arrow keys while focused for small seek steps."
      side="bottom"
    >
      <div
        className="waveform-shell"
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onSeek(Math.max(0, progress - 0.02));
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            onSeek(Math.min(1, progress + 0.02));
          }
        }}
        aria-label="Waveform seek bar"
        data-testid="qc-waveform"
      >
        <div className="waveform-progress" style={{ width: `${clampedProgress * 100}%` }} />
        <div className="waveform-bars" aria-hidden="true">
          {bars.map((peak, index) => (
            <span
              key={`${index}-${peak}`}
              className="waveform-bar"
              style={{ height: `${peakDbfsToHeightScale(peak) * 100}%` }}
            />
          ))}
        </div>
        <div className="waveform-playhead" style={{ left: `${clampedProgress * 100}%` }} />
      </div>
    </HelpTooltip>
  );
}

export function QcPlayer({
  analysis,
  currentTimeSec,
  isPlaying,
  onTogglePlay,
  onSeek,
  onTimeUpdate,
  onPlay,
  onPause,
  audioRef,
  renderAudioElement = true,
  audioSrc,
  showPlayToggle = true
}: {
  analysis: QcPlayerAnalysis;
  currentTimeSec: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (ratio: number) => void;
  onTimeUpdate: (value: number) => void;
  onPlay: () => void;
  onPause: () => void;
  audioRef: RefObject<HTMLAudioElement>;
  renderAudioElement?: boolean;
  audioSrc?: string;
  showPlayToggle?: boolean;
}) {
  const durationSec = Math.max(analysis.durationMs / 1000, 0.001);
  const progress = Math.max(0, Math.min(1, currentTimeSec / durationSec));
  const peak = maxPeakDbfs(analysis.peakData);

  return (
    <div className="qc-player-card">
      <div className="qc-player-head">
        <div>
          <p className="eyebrow">Verify / QC</p>
          <h3 className="qc-track-title">{analysis.releaseTitle}</h3>
          <p className="qc-track-subtitle">{analysis.releaseArtist}</p>
        </div>
        <div className="qc-badge-stack">
          <span className="qc-pill">{analysis.channels} ch</span>
          <span className="qc-pill">{analysis.sampleRateHz.toLocaleString()} Hz</span>
          <span className="qc-pill">Duration {formatClockFromMs(analysis.durationMs)}</span>
        </div>
      </div>

      <div className="qc-wave-panel">
        <WaveformOverview peaks={analysis.peakData} progress={progress} onSeek={onSeek} />
        <div className="qc-time-row">
          <span>{formatClock(currentTimeSec)}</span>
          <span>{formatClockFromMs(analysis.durationMs)}</span>
        </div>
        <HelpTooltip content="Fine playback position control. Drag to seek precisely within the track." side="bottom">
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(progress * 1000)}
            onChange={(event) => onSeek(Number(event.target.value) / 1000)}
            className="qc-range"
            aria-label="Playback position"
            data-testid="qc-seek-range"
          />
        </HelpTooltip>
      </div>

      <div className="qc-controls">
        {showPlayToggle ? (
          <HelpTooltip content={isPlaying ? "Pauses local playback for QC listening." : "Plays the selected local audio file for QC listening."}>
            <button type="button" className="media-button" onClick={onTogglePlay} data-testid="qc-play-toggle">
              {isPlaying ? "Pause" : "Play"}
            </button>
          </HelpTooltip>
        ) : (
          <span className="qc-controls-note">Playback is controlled by the global transport.</span>
        )}
        <HelpTooltip content="Moves playback backward by 5% of the track length." side="bottom">
          <button type="button" className="media-button ghost" onClick={() => onSeek(Math.max(0, progress - 0.05))}>
            -5%
          </button>
        </HelpTooltip>
        <HelpTooltip content="Moves playback forward by 5% of the track length." side="bottom">
          <button type="button" className="media-button ghost" onClick={() => onSeek(Math.min(1, progress + 0.05))}>
            +5%
          </button>
        </HelpTooltip>
      </div>

      <div className="qc-metrics-head">
        <span className="qc-metrics-heading">QC Metrics</span>
        <HelpTooltip
          variant="popover"
          iconLabel="How QC metrics are calculated"
          title="QC Metrics"
          side="bottom"
          content={
            <>
              <p>Integrated Loudness is computed in Rust using EBU R128 analysis (LUFS).</p>
              <p>Waveform Peak is the highest displayed dBFS peak bin from the precomputed QC waveform envelope.</p>
              <p>Peak Bins are downsampled amplitude windows used for fast rendering and visual seeking.</p>
            </>
          }
        />
      </div>

      <div className="qc-metrics-grid">
        <div className="qc-metric-card">
          <span className="qc-metric-label">Integrated Loudness</span>
          <strong data-testid="qc-lufs">{formatLufs(analysis.loudnessLufs)}</strong>
        </div>
        <div className="qc-metric-card">
          <span className="qc-metric-label">Peak (Waveform)</span>
          <strong data-testid="qc-peak">{formatDbfs(peak)}</strong>
        </div>
        <div className="qc-metric-card">
          <span className="qc-metric-label">Peak Bins</span>
          <strong>{analysis.peakData.length.toLocaleString()}</strong>
        </div>
        <div className="qc-metric-card">
          <span className="qc-metric-label">Media Fingerprint</span>
          <strong className="truncate">{analysis.mediaFingerprint.slice(0, 16)}...</strong>
        </div>
      </div>

      {renderAudioElement ? (
        <audio
          ref={audioRef}
          src={audioSrc ?? localFilePathToMediaUrl(analysis.trackFilePath)}
          preload="metadata"
          onTimeUpdate={() => onTimeUpdate(audioRef.current?.currentTime ?? 0)}
          onPlay={onPlay}
          onPause={onPause}
          onEnded={() => {
            onPause();
            onTimeUpdate(0);
          }}
        />
      ) : null}
    </div>
  );
}
