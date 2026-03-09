import type { RefObject } from "react";

import { HelpTooltip } from "../../shared/ui/HelpTooltip";

type PlayerSource = {
  title: string;
  artist: string;
  durationMs: number;
};

type SharedPlayerBarProps = {
  playerSource: PlayerSource | null;
  playerIsPlaying: boolean;
  playerTimeSec: number;
  queueIndex: number;
  queueLength: number;
  queueVisible: boolean;
  volumePercent: number;
  isMuted: boolean;
  outputMode: "shared" | "exclusive";
  outputModeSwitching: boolean;
  bitPerfectEligible: boolean;
  bitPerfectReasons: string[];
  onOutputModeChange: (mode: "shared" | "exclusive") => void;
  onPrev: () => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onNext: () => void;
  onToggleQueueVisibility: () => void;
  onToggleMute: () => void;
  onVolumePercentChange: (value: number) => void;
  onSeekRatio: (ratio: number) => void;
  formatClock: (seconds: number) => string;
  renderAudioElement?: boolean;
  audioRef?: RefObject<HTMLAudioElement>;
  audioSrc?: string;
  onAudioTimeUpdate?: () => void;
  onAudioPlay?: () => void;
  onAudioPause?: () => void;
  onAudioEnded?: () => void;
};

function outputModeLabel(mode: "shared" | "exclusive"): string {
  return mode === "exclusive" ? "Exclusive" : "Shared";
}

export default function SharedPlayerBar(props: SharedPlayerBarProps) {
  const primaryOutputReason = props.bitPerfectReasons[0] ?? "Output status is unavailable.";

  return (
    <div className="persistent-player-bar" role="region" aria-label="Shared transport">
      <div className="persistent-player-main">
        <div className="persistent-player-meta">
          <p className="eyebrow">Shared Player</p>
          <strong>{props.playerSource?.title ?? "No track loaded"}</strong>
          <p className="persistent-player-subtitle">
            {props.playerSource?.artist || "Queue a track to start playback"}
          </p>
          <p className="persistent-player-output-status">
            Output: {outputModeLabel(props.outputMode)} | Bit-perfect path: {props.bitPerfectEligible ? "Eligible" : "Not eligible"}
          </p>
          <p className="persistent-player-output-reason">{primaryOutputReason}</p>
          {props.outputMode === "exclusive" ? (
            <p className="persistent-player-output-warning">
              Exclusive mode may take ownership of this Windows audio endpoint and mute other apps.
            </p>
          ) : null}
        </div>
        <div className="persistent-player-actions">
          <div className="output-mode-toggle" role="group" aria-label="Playback output mode">
            <button
              type="button"
              className={`media-button ghost${props.outputMode === "shared" ? " active" : ""}`}
              onClick={() => props.onOutputModeChange("shared")}
              disabled={props.outputModeSwitching}
            >
              Shared
            </button>
            <button
              type="button"
              className={`media-button ghost${props.outputMode === "exclusive" ? " active" : ""}`}
              onClick={() => props.onOutputModeChange("exclusive")}
              disabled={props.outputModeSwitching}
            >
              Exclusive
            </button>
          </div>
          <HelpTooltip content={props.queueVisible ? "Show playlist results." : "Show queue order."}>
            <button
              type="button"
              className={`media-button ghost${props.queueVisible ? " active" : ""}`}
              onClick={props.onToggleQueueVisibility}
            >
              {props.queueVisible ? "Playlist" : "Queue"}
            </button>
          </HelpTooltip>
          <HelpTooltip content="Play the previous track in the current queue order.">
            <button
              type="button"
              className="media-button ghost"
              onClick={props.onPrev}
              disabled={props.queueIndex <= 0}
            >
              Prev
            </button>
          </HelpTooltip>
          <HelpTooltip content={props.playerIsPlaying ? "Pause local playback." : "Play local audio from the shared player."}>
            <button
              type="button"
              className="media-button"
              onClick={props.onTogglePlay}
              disabled={!props.playerSource && props.queueLength === 0}
            >
              {props.playerIsPlaying ? "Pause" : "Play"}
            </button>
          </HelpTooltip>
          <HelpTooltip content="Stop playback and return to the beginning of the track.">
            <button
              type="button"
              className="media-button ghost"
              onClick={props.onStop}
              disabled={!props.playerSource && props.queueLength === 0}
              data-testid="player-stop"
            >
              Stop
            </button>
          </HelpTooltip>
          <HelpTooltip content="Play the next track in the current queue order.">
            <button
              type="button"
              className="media-button ghost"
              onClick={props.onNext}
              disabled={props.queueIndex < 0 || props.queueIndex >= props.queueLength - 1}
            >
              Next
            </button>
          </HelpTooltip>
        </div>
      </div>

      <div className="persistent-player-utility">
        <label htmlFor="shared-player-volume">Volume</label>
        <input
          id="shared-player-volume"
          type="range"
          min={0}
          max={100}
          value={Math.max(0, Math.min(100, Math.round(props.volumePercent)))}
          onChange={(event) => props.onVolumePercentChange(Number(event.target.value))}
          aria-label="Playback volume"
        />
        <button type="button" className="media-button ghost" onClick={props.onToggleMute}>
          {props.isMuted ? "Unmute" : "Mute"}
        </button>
        <span>{Math.max(0, Math.min(100, Math.round(props.volumePercent)))}%</span>
      </div>

      <div className="persistent-player-timeline">
        <span>{props.formatClock(props.playerTimeSec)}</span>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(
            props.playerSource && props.playerSource.durationMs > 0
              ? (props.playerTimeSec / (props.playerSource.durationMs / 1000)) * 1000
              : 0
          )}
          onChange={(event) => props.onSeekRatio(Number(event.target.value) / 1000)}
          aria-label="Shared player seek"
          disabled={!props.playerSource}
        />
        <span>{props.formatClock((props.playerSource?.durationMs ?? 0) / 1000)}</span>
      </div>

      {props.renderAudioElement !== false && props.audioRef ? (
        <audio
          ref={props.audioRef}
          src={props.audioSrc}
          preload="metadata"
          onTimeUpdate={props.onAudioTimeUpdate}
          onPlay={props.onAudioPlay}
          onPause={props.onAudioPause}
          onEnded={props.onAudioEnded}
        />
      ) : null}
    </div>
  );
}
