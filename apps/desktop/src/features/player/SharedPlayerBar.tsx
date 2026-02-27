import type { RefObject } from "react";

import { HelpTooltip } from "../../HelpTooltip";

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
  onPrev: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onSeekRatio: (ratio: number) => void;
  formatClock: (seconds: number) => string;
  audioRef: RefObject<HTMLAudioElement>;
  audioSrc?: string;
  onAudioTimeUpdate: () => void;
  onAudioPlay: () => void;
  onAudioPause: () => void;
  onAudioEnded: () => void;
};

export default function SharedPlayerBar(props: SharedPlayerBarProps) {
  return (
    <div className="persistent-player-bar" role="region" aria-label="Shared transport">
      <div className="persistent-player-main">
        <div className="persistent-player-meta">
          <p className="eyebrow">Shared Player</p>
          <strong>{props.playerSource?.title ?? "No track loaded"}</strong>
          <p className="persistent-player-subtitle">
            {props.playerSource?.artist || "Queue a track to start playback"}
          </p>
        </div>
        <div className="persistent-player-actions">
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

      <audio
        ref={props.audioRef}
        src={props.audioSrc}
        preload="metadata"
        onTimeUpdate={props.onAudioTimeUpdate}
        onPlay={props.onAudioPlay}
        onPause={props.onAudioPause}
        onEnded={props.onAudioEnded}
      />
    </div>
  );
}
