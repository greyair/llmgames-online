import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocale, useT } from "@/i18n";
import { Icon } from "@/components/ui/icon";
import {
  clamp,
  ease,
  f,
  lerp,
  quad,
  quadTangent,
  roughCurve,
  roughEllipse,
  roughLine,
  roughRect,
  spring,
  tw,
  type Pt,
} from "./sketch";
import "./wire-diagram.css";

type Lane = "you" | "agent";

type Actor = Lane | "room";

type Wait = "idle" | "held" | "released" | "ended";

type Ev =
  | { k: "packet"; link: Lane; dir: "in" | "out"; label: string; at: number; dur?: number }
  | { k: "disc"; lane: Lane; col: number; at: number }
  | { k: "stamp"; text: string; win?: boolean; at: number }
  | { k: "wait"; state: Wait; at: number }
  | { k: "seat"; at: number }
  | { k: "think"; text: string; at: number; until: number }
  | { k: "win"; at: number };

/** One idea per chapter. `still` is the frame shown when paused or with reduced motion. */
type Chapter = {
  title: string;
  body: string;
  code?: string;
  ms: number;
  still: number;
  focus: Actor[];
  events: Ev[];
};

const PACKET_MS = 700;

const WAIT_LIMIT_S = 30;

const COLS = 7,
  ROWS = 6;

// The rally alternates moves; the human stacks column 3, so every loop ends in a win for you.
const rally: [Lane, number][] = [
  ["you", 3],
  ["agent", 4],
  ["you", 3],
  ["agent", 2],
];

const RALLY_STEP = 1500;

const chaptersZh = [
  ["你的智能体入座。", "它通过 Claude、Cursor 或 Codex 等 MCP 应用连接，并使用你的账户登录，无需粘贴 API 密钥。"],
  ["然后等待自己的回合。", "房间会保持调用最多 30 秒；如果没有变化，智能体再发起一次请求，无需轮询循环。"],
  ["你落下一枚棋子。", "浏览器通过 WebSocket 发送行动，只提交请求，不决定结果。"],
  ["房间检查行动。", "服务器负责游戏规则、随机结果和计时。你的行动合法，棋子落下。"],
  ["每个席位获得自己的视图。", "房间向你推送新棋盘，并唤醒等待中的智能体。卡牌游戏中，每个席位只能看到自己的手牌。"],
  ["智能体选择行动。", "模型读取合法行动并选择其中一个，然后通过一次工具调用提交。"],
  ["每个席位遵守同样的规则。", "智能体的行动和你的行动一样受到检查。随后双方视图更新，智能体再次等待。"],
  ["你来我往，直到分出胜负。", "每回合都经过同样的流程：提交行动、房间检查、返回更新后的视图。"],
  ["连成四子，游戏结束。", "房间通知所有席位游戏已结束。浏览器保存完整回放，智能体停止行动。"],
] as const;

const chapters: Chapter[] = [
  {
    title: "Your agent takes a seat.",
    body: "It connects through an MCP app like Claude, Cursor or Codex and signs in with your account. There is no API key to paste.",
    code: 'room_join({ roomCode: "K7QX" })',
    ms: 3400,
    still: 700,
    focus: ["agent"],
    events: [
      { k: "packet", link: "agent", dir: "in", label: "room_join", at: 300 },
      { k: "seat", at: 1000 },
      { k: "packet", link: "agent", dir: "out", label: "seat 2 ✓", at: 1100 },
    ],
  },
  {
    title: "Then it waits for its turn.",
    body: "The room holds the call open for up to 30 seconds. If nothing happens, the agent simply asks again. There is no polling loop.",
    code: "wait_for_turn({ timeoutMs: 25000 })",
    ms: 3600,
    still: 650,
    focus: ["agent", "room"],
    events: [
      { k: "packet", link: "agent", dir: "in", label: "wait_for_turn", at: 300 },
      { k: "wait", state: "held", at: 1000 },
    ],
  },
  {
    title: "You drop a disc.",
    body: "Your browser sends the move over a WebSocket. It doesn’t decide anything. It only asks.",
    code: "drop_disc { col: 3 }",
    ms: 2800,
    still: 750,
    focus: ["you"],
    events: [{ k: "packet", link: "you", dir: "in", label: "drop_disc 3", at: 400 }],
  },
  {
    title: "The room checks it.",
    body: "One server owns the game: the rules, the dice and the clock. Your move is legal, so it lands.",
    ms: 3000,
    still: 1300,
    focus: ["room"],
    events: [
      { k: "stamp", text: "Legal ✓", at: 200 },
      { k: "disc", lane: "you", col: 3, at: 700 },
    ],
  },
  {
    title: "Every seat gets its own view.",
    body: "The room pushes the new board to you and wakes the waiting agent. In card games, each seat sees only its own hand.",
    code: '← { reason: "your_turn", state: { legalActions } }',
    ms: 3200,
    still: 650,
    focus: ["you", "agent"],
    events: [
      { k: "packet", link: "you", dir: "out", label: "new board", at: 300 },
      { k: "packet", link: "agent", dir: "out", label: "your turn", at: 300 },
      { k: "wait", state: "released", at: 1000 },
    ],
  },
  {
    title: "Your agent picks a move.",
    body: "Its model reads the legal moves and chooses one. The move is a single tool call.",
    code: 'send_action({ actionType: "drop_disc", data: { col: 4 } })',
    ms: 3400,
    still: 1850,
    focus: ["agent"],
    events: [
      { k: "wait", state: "idle", at: 0 },
      { k: "think", text: "col 4?", at: 150, until: 1500 },
      { k: "packet", link: "agent", dir: "in", label: "send_action", at: 1500 },
    ],
  },
  {
    title: "Same rules for every seat.",
    body: "The agent’s move is checked exactly like yours. Then both views update and the agent waits again.",
    ms: 3600,
    still: 1150,
    focus: ["room"],
    events: [
      { k: "stamp", text: "Legal ✓", at: 200 },
      { k: "disc", lane: "agent", col: 4, at: 600 },
      { k: "packet", link: "you", dir: "out", label: "new board", at: 1200 },
      { k: "packet", link: "agent", dir: "out", label: "ok ✓", at: 1200 },
      { k: "packet", link: "agent", dir: "in", label: "wait_for_turn", at: 2300 },
      { k: "wait", state: "held", at: 3000 },
    ],
  },
  {
    title: "Back and forth until someone wins.",
    body: "Every turn takes the same path. A move goes in, the room checks it, and fresh views come back out.",
    ms: 200 + rally.length * RALLY_STEP + 200,
    still: 5600,
    focus: [],
    events: rally.flatMap(([lane, col], i): Ev[] => {
      const t = 200 + i * RALLY_STEP,
        other: Lane = lane === "you" ? "agent" : "you";

      return [
        {
          k: "packet",
          link: lane,
          dir: "in",
          label: lane === "you" ? `drop_disc ${col}` : "send_action",
          at: t,
          dur: 500,
        },
        { k: "disc", lane, col, at: t + 550 },
        {
          k: "packet",
          link: lane,
          dir: "out",
          label: lane === "you" ? "new board" : "ok ✓",
          at: t + 650,
          dur: 500,
        },
        {
          k: "packet",
          link: other,
          dir: "out",
          label: other === "agent" ? "your turn" : "new board",
          at: t + 650,
          dur: 500,
        },
        lane === "you"
          ? { k: "wait", state: "released", at: t + 1150 }
          : { k: "wait", state: "held", at: t + 1150 },
      ];
    }),
  },
  {
    title: "Four in a row. Game over.",
    body: "The room tells every seat the game ended. Your browser saves a full replay, and the agent stops.",
    code: '← { reason: "ended" }',
    ms: 4400,
    still: 1700,
    focus: ["you"],
    events: [
      { k: "packet", link: "you", dir: "in", label: "drop_disc 3", at: 200 },
      { k: "disc", lane: "you", col: 3, at: 750 },
      { k: "win", at: 1150 },
      { k: "stamp", text: "Four in a row!", win: true, at: 1150 },
      { k: "packet", link: "you", dir: "out", label: "game over", at: 1450 },
      { k: "packet", link: "agent", dir: "out", label: "game over", at: 1450 },
      { k: "wait", state: "ended", at: 2150 },
    ],
  },
];

const starts = chapters.reduce<number[]>(
  (acc, _, i) => (acc.push(i ? acc[i - 1]! + chapters[i - 1]!.ms : 0), acc),
  [],
);

/** Events on the loop clock: `t` is absolute, `end` closes a thought bubble, `row` is where a disc lands. */
type Timed = Ev & { t: number; end?: number; row?: number };

const timeline: Timed[] = (() => {
  const heights = Array<number>(COLS).fill(0);

  return chapters
    .flatMap((c, i) =>
      c.events.map((e) => {
        const t = starts[i]! + e.at;

        if (e.k === "think") return { ...e, t, end: starts[i]! + e.until };

        if (e.k !== "disc") return { ...e, t };
        const row = ROWS - 1 - heights[e.col]!++;

        return { ...e, t, row };
      }),
    )
    .sort((a, b) => a.t - b.t);
})();

const discs = timeline.filter(
  (e): e is Extract<Timed, { k: "disc" }> & { row: number } => e.k === "disc",
);

const winDiscs = discs.filter((d) => d.lane === "you" && d.col === 3);

const seatAt = timeline.find((e) => e.k === "seat")!.t;

/** Everything on stage at loop time g (ms). */
function world(g: number) {
  const past = timeline.filter((e) => e.t <= g);

  let wait: Wait = "idle",
    waitSince = 0,
    seated = false,
    winAt: number | undefined;

  for (const e of past) {
    if (e.k === "wait") {
      wait = e.state;
      waitSince = e.t;
    }

    if (e.k === "seat") seated = true;

    if (e.k === "win") winAt = e.t;
  }

  const landed = discs.filter((d) => d.t <= g);

  const turn: Lane = landed.length
    ? landed[landed.length - 1]!.lane === "you"
      ? "agent"
      : "you"
    : "you";

  const packets = past.filter(
    (e): e is Extract<Timed, { k: "packet" }> =>
      e.k === "packet" && g - e.t < (e.dur ?? PACKET_MS) + 320,
  );

  const stamp = [...past]
    .reverse()
    .find((e): e is Extract<Timed, { k: "stamp" }> => e.k === "stamp");

  const think = past.find(
    (e): e is Extract<Timed, { k: "think" }> & { end: number } =>
      e.k === "think" && g < e.end! + 260,
  );

  return {
    wait,
    waitSeconds: (g - waitSince) / 1000,
    seated,
    winAt,
    turn,
    landed,
    packets,
    stamp: stamp && (stamp.win || g - stamp.t < 1500) ? stamp : undefined,
    think,
  };
}

type Box = { x: number; y: number; w: number; h: number };

type Track = { a: Pt; c: Pt; b: Pt };

type Link = { in: Track; out: Track };

type Geo = {
  w: number;
  h: number;
  fs: number;
  you: Box;
  agent: Box;
  room: Box;
  board: Box;
  chipH: number;
  links: Record<Lane, Link>;
  transport: Record<Lane, Pt>;
  bubble: Pt;
};

/** Two lanes per link: moves go in on one side, views come back on the other. */
function link(a: Pt, b: Pt, off: Pt, bend: Pt): Link {
  const A1: Pt = [a[0] + off[0], a[1] + off[1]],
    B1: Pt = [b[0] + off[0], b[1] + off[1]],
    A2: Pt = [a[0] - off[0], a[1] - off[1]],
    B2: Pt = [b[0] - off[0], b[1] - off[1]];

  const mid = (p: Pt, q: Pt, o: Pt): Pt => [(p[0] + q[0]) / 2 + o[0], (p[1] + q[1]) / 2 + o[1]];

  return {
    in: { a: A1, c: mid(A1, B1, bend), b: B1 },
    out: { a: B2, c: mid(B2, A2, [-bend[0], -bend[1]]), b: A2 },
  };
}

const board = (x: number, y: number, w: number): Box => ({ x, y, w, h: (w / COLS) * ROWS });

const GEO: Record<"wide" | "tall", Geo> = {
  wide: {
    w: 1280,
    h: 520,
    fs: 1,
    you: { x: 30, y: 170, w: 240, h: 150 },
    agent: { x: 1010, y: 170, w: 240, h: 150 },
    room: { x: 460, y: 40, w: 360, h: 452 },
    board: board(495, 130, 290),
    chipH: 40,
    links: {
      you: link([270, 245], [460, 245], [0, -20], [0, -30]),
      agent: link([1010, 245], [820, 245], [0, -20], [0, -30]),
    },
    transport: { you: [365, 338], agent: [915, 338] },
    bubble: [1130, 104],
  },
  tall: {
    w: 600,
    h: 1010,
    fs: 1.3,
    you: { x: 20, y: 110, w: 270, h: 150 },
    agent: { x: 310, y: 110, w: 270, h: 150 },
    room: { x: 40, y: 400, w: 520, h: 590 },
    board: board(75, 505, 450),
    chipH: 50,
    links: {
      you: link([155, 260], [200, 400], [-22, 0], [-22, 0]),
      agent: link([445, 260], [400, 400], [22, 0], [22, 0]),
    },
    transport: { you: [72, 338], agent: [528, 338] },
    bubble: [445, 54],
  },
};

const cellAt = (b: Box, col: number, row: number): Pt => {
  const s = b.w / COLS;

  return [b.x + s * (col + 0.5), b.y + s * (row + 0.5)];
};

/** Mono labels: width is predictable without measuring, so SSR and client agree. */
const monoWidth = (s: string, size: number) => s.length * size * 0.6;

function Card({
  box,
  seed,
  boil,
  className,
}: {
  box: Box;
  seed: number;
  boil: number;
  className?: string;
}) {
  return (
    <>
      <g className="wd-lift">
        <path
          className={`wd-card ${className ?? ""}`}
          d={roughRect(box.x, box.y, box.w, box.h, { seed, boil })}
        />
      </g>
    </>
  );
}

function YouFace({ c, boil }: { c: Pt; boil: number }) {
  return (
    <g>
      <path className="wd-avatar" d={roughEllipse(c[0], c[1], 24, 24, { seed: 31, boil })} />
      <path
        className="wd-ink"
        d={roughEllipse(c[0] - 8, c[1] - 4, 3, 4, { seed: 32, boil, amp: 0.4 })}
      />
      <path
        className="wd-ink"
        d={roughEllipse(c[0] + 8, c[1] - 4, 3, 4, { seed: 33, boil, amp: 0.4 })}
      />
      <path
        className="wd-stroke"
        d={`M${f(c[0] - 9)} ${f(c[1] + 7)}Q${f(c[0])} ${f(c[1] + 15)} ${f(c[0] + 9)} ${f(c[1] + 7)}`}
      />
    </g>
  );
}

function Robot({ c, boil, blink }: { c: Pt; boil: number; blink: boolean }) {
  const [x, y] = c;

  return (
    <g>
      <path
        className="wd-stroke"
        d={roughLine([x, y - 18], [x, y - 28], { seed: 41, boil, amp: 0.6 })}
      />
      <path className="wd-sun" d={roughEllipse(x, y - 30, 5, 5, { seed: 42, boil, amp: 0.4 })} />
      <path
        className="wd-avatar"
        d={roughRect(x - 24, y - 18, 48, 40, { seed: 43, boil, r: 10 })}
      />
      {blink ? (
        <>
          <path className="wd-stroke" d={`M${f(x - 14)} ${f(y)}h8M${f(x + 6)} ${f(y)}h8`} />
        </>
      ) : (
        <>
          <path
            className="wd-ink"
            d={roughEllipse(x - 10, y, 4, 5, { seed: 44, boil, amp: 0.4 })}
          />
          <path
            className="wd-ink"
            d={roughEllipse(x + 10, y, 4, 5, { seed: 45, boil, amp: 0.4 })}
          />
        </>
      )}
      <path className="wd-stroke" d={`M${f(x - 7)} ${f(y + 12)}h14`} />
    </g>
  );
}

function Ring({ c, r, progress, tone }: { c: Pt; r: number; progress: number; tone: string }) {
  return (
    <g className="wd-ring" data-tone={tone}>
      <circle cx={c[0]} cy={c[1]} r={r} className="wd-ring-track" />
      <circle
        cx={c[0]}
        cy={c[1]}
        r={r}
        pathLength={100}
        className="wd-ring-fill"
        strokeDasharray="100 100"
        strokeDashoffset={f(100 - clamp(progress) * 100)}
        transform={`rotate(-90 ${f(c[0])} ${f(c[1])})`}
      />
    </g>
  );
}

function ActorCard({
  id,
  box,
  fs,
  boil,
  focus,
  title,
  sub,
  status,
  tone,
  progress,
  blink,
}: {
  id: Lane;
  box: Box;
  fs: number;
  boil: number;
  focus: boolean;
  title: string;
  sub: string;
  status: string;
  tone: string;
  progress: number;
  blink: boolean;
}) {
  const { x, y, w, h } = box,
    av: Pt = [x + 42, y + 46];

  return (
    <g className="wd-actor" data-lane={id} data-focus={focus || undefined}>
      <Card box={box} seed={id === "you" ? 11 : 21} boil={boil} />
      <g className="wd-lift">
        {id === "you" ? <YouFace c={av} boil={boil} /> : <Robot c={av} boil={boil} blink={blink} />}
        <text x={x + 80} y={y + 50} fontSize={24 * fs} className="wd-title">
          {title}
        </text>
        <text x={x + 80} y={y + 50 + 22 * fs} fontSize={15 * fs} className="wd-sub">
          {sub}
        </text>
        <path
          className="wd-faint"
          d={roughLine([x + 16, y + h - 50], [x + w - 16, y + h - 50], {
            seed: id === "you" ? 12 : 22,
            boil,
            amp: 1,
          })}
        />
        <Ring c={[x + 30, y + h - 26]} r={10 * fs} progress={progress} tone={tone} />
        <text
          x={x + 30 + 18 * fs}
          y={y + h - 26 + 5.5 * fs}
          fontSize={16 * fs}
          className="wd-status"
          data-tone={tone}
        >
          {status}
        </text>
      </g>
    </g>
  );
}

function Arrowhead({ track, boil, seed }: { track: Track; boil: number; seed: number }) {
  const [tx, ty] = quadTangent(track.a, track.c, track.b, 1),
    [bx, by] = track.b,
    s = 11;

  const l: Pt = [bx - tx * s - ty * s * 0.6, by - ty * s + tx * s * 0.6],
    r: Pt = [bx - tx * s + ty * s * 0.6, by - ty * s - tx * s * 0.6];

  return (
    <path
      className="wd-arrow"
      d={
        roughLine(l, [bx, by], { seed, boil, amp: 0.6 }) +
        roughLine([bx, by], r, { seed: seed + 1, boil, amp: 0.6 }).replace("M", "L")
      }
    />
  );
}

function Packet({
  ev,
  g,
  track,
  fs,
}: {
  ev: Extract<Timed, { k: "packet" }>;
  g: number;
  track: Track;
  fs: number;
}) {
  const age = g - ev.t,
    dur = ev.dur ?? PACKET_MS,
    u = clamp(age / dur);

  const flow = ev.dir === "out" ? "state" : ev.link;

  if (age > dur) {
    const p = (age - dur) / 320,
      [cx, cy] = track.b;

    return (
      <g className="wd-burst" data-flow={flow}>
        {Array.from({ length: 7 }, (_, i) => {
          const a = (i / 7) * Math.PI * 2 + 0.3,
            r0 = 14 + 28 * ease.outCubic(clamp(p * 1.6 - 0.3)),
            r1 = 14 + 28 * ease.outCubic(clamp(p * 1.6));

          return (
            <path
              key={i}
              d={`M${f(cx + Math.cos(a) * r0)} ${f(cy + Math.sin(a) * r0)}L${f(cx + Math.cos(a) * r1)} ${f(cy + Math.sin(a) * r1)}`}
            />
          );
        })}
      </g>
    );
  }

  const [x, y] = quad(track.a, track.c, track.b, ease.inOutCubic(u));

  const size = 15 * fs,
    w = monoWidth(ev.label, size) + 26 * fs,
    h = 30 * fs;

  const s = ease.outBack(tw(age, 0, 200)) * (1 - 0.35 * tw(age, dur - 120, dur));
  const r = Math.sin(u * Math.PI * 2) * 4;

  return (
    <g
      transform={`translate(${f(x)} ${f(y)}) rotate(${f(r)}) scale(${s.toFixed(3)})`}
      className="wd-packet"
      data-flow={flow}
    >
      <path
        className="wd-packet-body"
        d={roughRect(-w / 2, -h / 2, w, h, { seed: 72, amp: 0.8, r: h / 2 })}
      />
      <text x={0} y={size * 0.36} fontSize={size} textAnchor="middle" className="wd-mono">
        {ev.label}
      </text>
    </g>
  );
}

/** How a match moves, told in nine short steps: one server owns the board, seats only send moves. */
export function WireDiagram() {
  const locale = useLocale();
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const [clock, setClock] = useState({ ch: 0, ms: 0 });
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [layout, setLayout] = useState<"wide" | "tall">("wide");

  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)"),
      narrow = matchMedia("(max-width: 760px)");

    if (motion.matches) {
      setReduced(true);
      setPlaying(false);
      setClock({ ch: 0, ms: chapters[0]!.still });
    }

    const syncLayout = () => setLayout(narrow.matches ? "tall" : "wide");
    syncLayout();
    narrow.addEventListener("change", syncLayout);
    const node = ref.current;

    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), {
      threshold: 0.25,
    });

    if (node) observer.observe(node);

    return () => {
      narrow.removeEventListener("change", syncLayout);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!playing || !visible) return;

    let raf = 0,
      last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;

      if (!document.hidden)
        setClock(({ ch, ms }) => {
          ms += dt;

          while (ms >= chapters[ch]!.ms) {
            ms -= chapters[ch]!.ms;
            ch = (ch + 1) % chapters.length;
          }

          return { ch, ms };
        });
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(raf);
  }, [playing, visible]);

  const go = (i: number) => {
    const ch = (i + chapters.length) % chapters.length;
    setClock({ ch, ms: playing ? 0 : chapters[ch]!.still });
  };

  const chapter = chapters[clock.ch]!;

  const chapterCopy = (index: number) => {
    const original = chapters[index]!;
    const translated = locale === "zh-CN" ? chaptersZh[index] : undefined;

    return { title: translated?.[0] ?? original.title, body: translated?.[1] ?? original.body };
  };

  const currentCopy = chapterCopy(clock.ch);
  const g = starts[clock.ch]! + clock.ms;
  const w = world(g);

  const geo = GEO[layout],
    fs = geo.fs;

  // Lines re-seed eight times a second while playing, like the video's line boil.
  const boil = playing && visible && !reduced ? Math.floor(g / 125) : 0;
  const focus = (a: Actor) => chapter.focus.includes(a);

  const youStatus =
    t(w.winAt !== undefined ? "wire.youWin" : w.turn === "you" ? "wire.yourMove" : "wire.watching");

  const agentStatus = !w.seated
    ? t("wire.joining")
    : w.wait === "held"
      ? t("wire.waiting", { seconds: w.waitSeconds.toFixed(1) })
      : w.wait === "released"
        ? t("wire.agentTurn")
        : w.wait === "ended"
          ? t("wire.gameOver")
          : w.think || w.turn === "agent"
            ? t("wire.thinking")
            : t("wire.watching");

  const agentTone =
    w.wait === "held"
      ? "wait"
      : w.wait === "released"
        ? "go"
        : w.wait === "ended"
          ? "done"
          : w.think
            ? "think"
            : "idle";

  const agentProgress =
    w.wait === "held" ? w.waitSeconds / WAIT_LIMIT_S : w.wait === "idle" ? 0 : 1;

  const blink = Math.floor(g / 90) % 34 === 0;

  const statics = useMemo(() => {
    const b = geo.board,
      cell = b.w / COLS;

    return (
      <>
        <path
          className="wd-board"
          d={roughRect(b.x - 12, b.y - 12, b.w + 24, b.h + 24, { seed: 52, boil })}
        />
        {Array.from({ length: COLS * ROWS }, (_, i) => {
          const [cx, cy] = cellAt(b, i % COLS, Math.floor(i / COLS));

          return (
            <path
              key={i}
              className="wd-hole"
              d={roughEllipse(cx, cy, cell * 0.38, cell * 0.38, { seed: 100 + i, boil, amp: 1.2 })}
            />
          );
        })}
      </>
    );
  }, [geo, boil]);

  const tracks = (["you", "agent"] as const).flatMap((lane) =>
    (["in", "out"] as const).map((dir) => {
      const track = geo.links[lane][dir];

      const live = w.packets.some(
        (p) => p.link === lane && p.dir === dir && g - p.t < (p.dur ?? PACKET_MS) + 120,
      );

      const flow = dir === "out" ? "state" : lane;
      const seed = lane === "you" ? (dir === "in" ? 61 : 63) : dir === "in" ? 65 : 67;

      return (
        <g
          key={`${lane}${dir}`}
          className="wd-track"
          data-flow={flow}
          data-live={live || undefined}
        >
          {live && (
            <path
              className="wd-track-glow"
              d={roughCurve(track.a, track.c, track.b, { seed, boil, amp: 1.5 })}
            />
          )}
          <path
            className="wd-track-line"
            d={roughCurve(track.a, track.c, track.b, { seed, boil, amp: 1.5 })}
          />
          <Arrowhead track={track} boil={boil} seed={seed + 10} />
        </g>
      );
    }),
  );

  const b = geo.board,
    cell = b.w / COLS;

  const stampAge = w.stamp ? g - w.stamp.t : 0;
  const stampScale = w.stamp ? spring(stampAge / 1000, 2.8, 0.45) : 0;

  const stampW = w.stamp ? (w.stamp.text.length * 0.62 * 26 + 40) * fs : 0,
    stampH = 56 * fs;

  const strike = w.winAt !== undefined ? tw(g, w.winAt, w.winAt + 420) : 0;
  const thinkAge = w.think ? g - w.think.t : 0;

  const thinkScale = w.think
    ? ease.outBack(tw(thinkAge, 0, 260)) * (1 - tw(g, w.think.end, w.think.end + 240))
    : 0;

  const chipW = b.w / 2 - 8,
    chipY = b.y + b.h + 30 * fs;

  const seatPop = w.seated ? spring((g - seatAt) / 1000) : 0;

  const chip = (lane: Lane, x: number, label: string, scale = 1) => {
    const cy = chipY + geo.chipH / 2,
      cx = x + chipW / 2;

    return (
      <g
        className="wd-chip"
        data-lane={lane}
        transform={
          scale === 1
            ? undefined
            : `translate(${f(cx)} ${f(cy)}) scale(${scale.toFixed(3)}) translate(${f(-cx)} ${f(-cy)})`
        }
      >
        <path
          className="wd-chip-body"
          d={roughRect(x, chipY, chipW, geo.chipH, {
            seed: lane === "you" ? 81 : 83,
            boil,
            r: geo.chipH / 2,
          })}
        />
        <path
          className="wd-disc"
          data-lane={lane}
          d={roughEllipse(x + 22 * fs, cy, 9 * fs, 9 * fs, {
            seed: lane === "you" ? 82 : 84,
            boil,
            amp: 0.6,
          })}
        />
        <text x={x + 38 * fs} y={cy + 5.5 * fs} fontSize={15 * fs} className="wd-chip-text">
          {label}
        </text>
      </g>
    );
  };

  return (
    <section ref={ref} className="landing-wire" aria-labelledby="landing-wire-title">
      <header className="landing-section-head">
        <div>
          <h2 id="landing-wire-title">{t("wire.title")}</h2>
          <p>{t("wire.lead")}</p>
        </div>
      </header>
      <div className="wd-panel" data-surface="light">
        <p className="sr-only">
          {t("wire.accessible")}
        </p>
        <svg
          className="wd-stage"
          viewBox={`0 0 ${geo.w} ${geo.h}`}
          role="img"
          aria-label={t("wire.stepTitle", { current: clock.ch + 1, title: currentCopy.title })}
        >
          <g className="wd-room" data-focus={focus("room") || undefined}>
            <Card box={geo.room} seed={1} boil={boil} />
            <g className="wd-lift">
              <text x={b.x - 12} y={geo.room.y + 46 * fs} fontSize={28 * fs} className="wd-title">
                {t("wire.room")}
              </text>
              <path
                className="wd-swash"
                d={roughLine(
                  [b.x - 10, geo.room.y + 56 * fs],
                  [b.x - 12 + 135 * fs, geo.room.y + 54 * fs],
                  { seed: 5, boil, amp: 1.5 },
                )}
              />
              <text
                x={b.x + b.w + 12}
                y={geo.room.y + 46 * fs}
                fontSize={15 * fs}
                textAnchor="end"
                className="wd-sub"
              >
                {t("wire.roomDetails")}
              </text>
              {statics}
              {w.landed.map((d) => {
                const [cx, cy] = cellAt(b, d.col, d.row),
                  age = (g - d.t) / 1000;

                const y = lerp(b.y - cell, cy, Math.min(1.04, spring(age, 2.4, 0.55)));

                return (
                  <path
                    key={`${d.t}`}
                    className="wd-disc"
                    data-lane={d.lane}
                    d={roughEllipse(cx, y, cell * 0.38, cell * 0.38, {
                      seed: 200 + (d.t % 97),
                      boil,
                      amp: 1,
                    })}
                  />
                );
              })}
              {strike > 0 &&
                (() => {
                  const top = cellAt(b, 3, winDiscs[winDiscs.length - 1]!.row),
                    bot = cellAt(b, 3, winDiscs[0]!.row);

                  return (
                    <path
                      className="wd-strike"
                      pathLength={1}
                      strokeDasharray="1 1"
                      strokeDashoffset={(1 - strike).toFixed(3)}
                      d={roughLine([bot[0], bot[1] + cell * 0.3], [top[0], top[1] - cell * 0.3], {
                        seed: 9,
                        boil,
                        amp: 2,
                      })}
                    />
                  );
                })()}
              {chip("you", b.x - 12, t("wire.you"))}
              {seatPop > 0 ? (
                chip("agent", b.x + b.w / 2 + 20, "SwiftAnchor", seatPop)
              ) : (
                <path
                  className="wd-chip-empty"
                  d={roughRect(b.x + b.w / 2 + 20, chipY, chipW, geo.chipH, {
                    seed: 85,
                    boil,
                    r: geo.chipH / 2,
                  })}
                />
              )}
              {w.stamp && (
                <g
                  transform={`translate(${f(b.x + b.w / 2)} ${f(b.y + cell * 1.1)}) rotate(-7) scale(${stampScale.toFixed(3)})`}
                  opacity={w.stamp.win ? 1 : (1 - tw(stampAge, 1200, 1500)).toFixed(3)}
                  className="wd-stamp"
                  data-win={w.stamp.win || undefined}
                >
                  <path
                    className="wd-stamp-body"
                    d={roughRect(-stampW / 2, -stampH / 2, stampW, stampH, { seed: 92, boil })}
                  />
                  <text
                    x={0}
                    y={9 * fs}
                    fontSize={26 * fs}
                    textAnchor="middle"
                    className="wd-title"
                  >
                    {locale === "zh-CN" ? (w.stamp.win ? "四子连线！" : "合法 ✓") : w.stamp.text}
                  </text>
                </g>
              )}
            </g>
          </g>

          {tracks}
          {(["you", "agent"] as const).map((lane) => (
            <text
              key={lane}
              x={geo.transport[lane][0]}
              y={geo.transport[lane][1]}
              fontSize={13 * fs}
              textAnchor="middle"
              className="wd-transport"
            >
              {lane === "you" ? "WebSocket" : "MCP"}
            </text>
          ))}

          <ActorCard
            id="you"
            box={geo.you}
            fs={fs}
            boil={boil}
            focus={focus("you")}
            title={t("wire.you")}
            sub={t("wire.browser")}
            status={youStatus}
            tone={w.winAt !== undefined ? "go" : w.turn === "you" ? "go" : "idle"}
            progress={w.turn === "you" || w.winAt !== undefined ? 1 : 0}
            blink={false}
          />
          <ActorCard
            id="agent"
            box={geo.agent}
            fs={fs}
            boil={boil}
            focus={focus("agent")}
            title={t("wire.agent")}
            sub="via MCP · Claude"
            status={agentStatus}
            tone={agentTone}
            progress={agentProgress}
            blink={blink}
          />

          {thinkScale > 0 && (
            <g
              transform={`translate(${f(geo.bubble[0])} ${f(geo.bubble[1])}) scale(${thinkScale.toFixed(3)})`}
              className="wd-think"
            >
              <path
                className="wd-bubble"
                d={roughEllipse(0, 0, 72 * fs, 30 * fs, { seed: 96, boil, amp: 2 })}
              />
              <path
                className="wd-bubble"
                d={roughEllipse(-18, 40 * fs, 8, 8, { seed: 97, boil, amp: 0.6 })}
              />
              <path
                className="wd-bubble"
                d={roughEllipse(-28, 54 * fs, 5, 5, { seed: 98, boil, amp: 0.4 })}
              />
              <text x={0} y={6 * fs} fontSize={18 * fs} textAnchor="middle" className="wd-mono">
                {w.think!.text}
              </text>
            </g>
          )}

          {w.packets.map((p) => (
            <Packet
              key={`${p.t}${p.link}${p.dir}`}
              ev={p}
              g={g}
              track={geo.links[p.link][p.dir]}
              fs={fs}
            />
          ))}
        </svg>

        <div className="wd-story">
          <div className="wd-captions">
            {/* Invisible copies of every step reserve the tallest caption's height so the panel never resizes. */}
            {chapters.map((c, i) => (
              <div key={i} className="wd-caption" data-ghost aria-hidden="true">
                <span className="wd-count">
                  {t("wire.step", { current: i + 1, total: chapters.length })}
                </span>
                <h3>{chapterCopy(i).title}</h3>
                <p>{chapterCopy(i).body}</p>
                {c.code && <code>{c.code}</code>}
              </div>
            ))}
            <div className="wd-caption" key={clock.ch}>
              <span className="wd-count">
                {t("wire.step", { current: clock.ch + 1, total: chapters.length })}
              </span>
              <h3>{currentCopy.title}</h3>
              <p>{currentCopy.body}</p>
              {chapter.code && <code>{chapter.code}</code>}
            </div>
          </div>
          <div className="wd-controls">
            <div className="wd-buttons">
              <button type="button" onClick={() => go(clock.ch - 1)} aria-label={t("wire.previous")}>
                <Icon name="back" size={16} />
              </button>
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                aria-label={t(playing ? "wire.pause" : "wire.play")}
                data-primary
              >
                {<Icon name={playing ? "pause" : "play"} size={16} />}
              </button>
              <button type="button" onClick={() => go(clock.ch + 1)} aria-label={t("wire.next")}>
                <Icon name="arrow" size={16} />
              </button>
            </div>
            <ol className="wd-steps">
              {chapters.map((c, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-label={t("wire.stepTitle", { current: i + 1, title: chapterCopy(i).title })}
                    aria-current={i === clock.ch ? "step" : undefined}
                    style={
                      {
                        "--p": i < clock.ch ? 1 : i === clock.ch ? clock.ms / c.ms : 0,
                      } satisfies CSSProperties & {
                        [property: `--${string}`]: string | number | undefined;
                      }
                    }
                  >
                    <span />
                  </button>
                </li>
              ))}
            </ol>
            <ul className="wd-legend" aria-label={t("wire.legend")}>
              <li data-flow="you">{t("wire.yourAction")}</li>
              <li data-flow="agent">{t("wire.agentAction")}</li>
              <li data-flow="state">{t("wire.view")}</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
