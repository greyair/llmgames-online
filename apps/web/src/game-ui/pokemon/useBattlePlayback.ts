import { z } from "zod";
import { pokemonSidesSchema } from "@/domain/view-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyCue, parseCues, type Cue, type Side } from "@/features/pokemon/playback";

type Item = { cue: Cue | null; sides: Side[]; end: number };

export function usePokemonPlayback(
  sides: Side[],
  logs: string[],
  offset: number,
  roomKey: string,
  replay: boolean,
  onSettled?: () => void,
) {
  const [view, setView] = useState<{
    sides: Side[];
    cue: Cue | null;
    busy: boolean;
    sourceEnd: number;
  }>({
    sides,
    cue: null,
    busy: false,
    sourceEnd: offset + logs.length,
  });

  const runtime = useRef<{
    initialized: boolean;
    cursor: number;
    room: string;
    queue: Item[];
    timer: number;
    running: boolean;
  }>({
    initialized: false,
    cursor: 0,
    room: "",
    queue: [],
    timer: 0,
    running: false,
  });

  const advance = useRef<{ id: number; next: () => void } | null>(null);
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  }, [onSettled]);

  const complete = useCallback((id: number) => {
    if (advance.current?.id !== id) return;
    const next = advance.current.next;
    advance.current = null;
    next();
  }, []);

  const snapshot = JSON.stringify(sides);
  const transcript = JSON.stringify(logs);
  useEffect(() => {
    const r = runtime.current;
    const finalSides = pokemonSidesSchema.parse(JSON.parse(snapshot));
    const lines = z.array(z.string()).parse(JSON.parse(transcript));
    const end = offset + lines.length;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function snap() {
      clearTimeout(r.timer);
      r.running = false;
      r.queue = [];
      advance.current = null;
      setView({ sides: finalSides, cue: null, busy: false, sourceEnd: end });
      settled.current?.();
    }

    if (!r.initialized || r.room !== roomKey || end < r.cursor || offset > r.cursor || reduced) {
      snap();
      r.initialized = true;
      r.room = roomKey;
      r.cursor = end;

      return;
    }

    const cues = parseCues(lines.slice(Math.max(0, r.cursor - offset)), r.cursor);

    r.cursor = end;

    if (!cues.length && !r.running) {
      setView({ sides: finalSides, cue: null, busy: false, sourceEnd: end });
      settled.current?.();

      return;
    }

    if (cues.length)
      r.queue.push(...cues.map((cue) => ({ cue, sides: finalSides, end })), {
        cue: null,
        sides: finalSides,
        end,
      });

    if (r.queue.length > 48) {
      snap();

      return;
    }

    function pump() {
      const item = r.queue.shift();

      if (!item) {
        r.running = false;
        setView((v) => ({ ...v, cue: null, busy: false }));
        settled.current?.();

        return;
      }

      if (!item.cue) {
        setView((v) => ({ ...v, sides: item.sides, sourceEnd: item.end }));
        pump();

        return;
      }

      r.running = true;
      const cue = item.cue;
      setView((v) => ({
        sides: cue.kind === "faint" ? v.sides : applyCue(v.sides, cue, item.sides),
        cue,
        busy: true,
        sourceEnd: v.sourceEnd,
      }));

      const next = () => {
        clearTimeout(r.timer);

        if (cue.kind === "faint")
          setView((v) => ({ ...v, sides: applyCue(v.sides, cue, item.sides) }));
        pump();
      };

      advance.current = { id: cue.id, next };
      // Every effect has a bounded duration so a missed animation event cannot stall playback.
      r.timer = window.setTimeout(
        () => complete(cue.id),
        ["faint", "enter", "exit", "message"].includes(cue.kind)
          ? cue.duration * (replay ? 0.6 : 1)
          : 15000,
      );
    }

    if (!r.running) pump();
  }, [snapshot, transcript, offset, roomKey, replay, complete]);
  useEffect(
    () => () => {
      const r = runtime.current;
      clearTimeout(r.timer);
      r.queue = [];
      r.running = false;
      r.initialized = false;
      advance.current = null;
    },
    [],
  );
  const pending = offset + logs.length > view.sourceEnd;

  return { ...view, busy: view.busy || pending, complete };
}
