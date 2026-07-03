"use client";

import React, { useEffect, useRef } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useEditorStore } from "../../lib/editor/store";
import { liveWindowSeconds, PLAYBACK_SPEEDS, useLiveStore } from "../../lib/live/store";

/**
 * Live-mode playback (issue #25): play/pause, time scrubber, speed, loop.
 * A transient window (often just 10ms) is stretched over LOOP_SECONDS of
 * wall-clock so the animation reads naturally.
 */
const LOOP_SECONDS = 5;

function formatTime(seconds: number): string {
  if (seconds >= 1) return `${seconds.toFixed(2)}s`;
  if (seconds >= 1e-3) return `${(seconds * 1e3).toFixed(2)}ms`;
  return `${(seconds * 1e6).toFixed(0)}µs`;
}

export function PlaybackBar() {
  const bundle = useEditorStore((s) => s.bundle);
  const liveTime = useLiveStore((s) => s.liveTime);
  const playing = useLiveStore((s) => s.playing);
  const speed = useLiveStore((s) => s.playbackSpeed);
  const loop = useLiveStore((s) => s.loop);
  const simulating = useLiveStore((s) => s.simulating);
  const setLiveTime = useLiveStore((s) => s.setLiveTime);
  const setPlaying = useLiveStore((s) => s.setPlaying);
  const setPlaybackSpeed = useLiveStore((s) => s.setPlaybackSpeed);
  const toggleLoop = useLiveStore((s) => s.toggleLoop);

  const window = liveWindowSeconds(bundle);
  const frameRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing || window <= 0) return;
    const tick = (now: number) => {
      const last = lastTickRef.current ?? now;
      lastTickRef.current = now;
      const dt = (now - last) / 1000;
      const advance = dt * speed * (window / LOOP_SECONDS);
      const state = useLiveStore.getState();
      let next = state.liveTime + advance;
      if (next >= window) {
        if (state.loop) next = next % window;
        else {
          state.setPlaying(false);
          next = window;
        }
      }
      state.setLiveTime(next);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      lastTickRef.current = null;
    };
  }, [playing, speed, window]);

  return (
    <div
      data-testid="playback-bar"
      style={{
        borderTop: "1px solid var(--ob-canvas-grid)",
        padding: "8px 16px",
        background: "var(--ob-symbol-body)",
      }}
    >
      <HStack gap={2} vAlign="center">
        <Button
          label={playing ? "Pause" : "Play"}
          variant="primary"
          size="sm"
          clickAction={() => setPlaying(!playing)}
        />
        {/* Native range input: tight canvas chrome, themed via the accent token. */}
        <StackItem size="fill">
          <input
            type="range"
            aria-label="Simulation time"
            min={0}
            max={window > 0 ? window : 1}
            step={window > 0 ? window / 500 : 0.01}
            value={Math.min(liveTime, window)}
            onChange={(e) => setLiveTime(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--ob-net-highlight)", display: "block" }}
          />
        </StackItem>
        <Text type="code" size="xsm" color="secondary">
          {formatTime(liveTime)} / {formatTime(window)}
        </Text>
        <HStack gap={0.5}>
          {PLAYBACK_SPEEDS.map((s) => (
            <Button
              key={s}
              label={`${s}x`}
              size="sm"
              variant={speed === s ? "secondary" : "ghost"}
              clickAction={() => setPlaybackSpeed(s)}
            />
          ))}
        </HStack>
        <Button
          label={loop ? "Loop: on" : "Loop: off"}
          size="sm"
          variant="ghost"
          clickAction={() => toggleLoop()}
        />
        {simulating && (
          <Text type="supporting" color="secondary">
            simulating…
          </Text>
        )}
      </HStack>
    </div>
  );
}
