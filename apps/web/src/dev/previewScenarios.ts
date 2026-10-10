import { wordBoardSchema, numericBoardSchema, cardSeatsSchema } from "@/domain/view-contracts";
import { previewSinking } from "./shipSinkingPreview";
import type { ClientView } from "@/domain/game-state";

import { previewSeat } from "./previewFixtures";

type Card = { rank: string; suit: string; hidden?: boolean };

const card = (rank: string, suit = "H"): Card => ({ rank, suit });

const key = [
  "blue",
  "neutral",
  "red",
  "blue",
  "red",
  "neutral",
  "blue",
  "neutral",
  "red",
  "assassin",
  "red",
  "neutral",
  "blue",
  "red",
  "neutral",
  "blue",
  "red",
  "neutral",
  "blue",
  "red",
  "blue",
  "neutral",
  "red",
  "blue",
  "red",
];

const now = 1788804000000;

/** Each branch is a fixed UI example, never a client implementation of game rules. */
export function applyPreviewScenario(
  input: ClientView,
  screen: string,
  scenario: string,
): ClientView {
  if (screen === "battleship" && scenario === "replay") {
    const replay = applyPreviewScenario(input, screen, "win");

    return {
      ...replay,
      status: "playing",
      replayReadOnly: true,
      turnState: { ...replay.turnState!, phase: "battle" },
    };
  }

  const watching =
    scenario === "spectator" || scenario.startsWith("spectator-") || scenario === "lobby-spectator";

  if (scenario === "spectator-sunk-ship") scenario = "sunk-ship";

  if (scenario === "spectator-ended") scenario = "win";
  const s = structuredClone(input);
  const you = s.you!;
  const turn = s.turnState!;

  const phase = (value: string, legalActions: string[] = []) => {
    turn.phase = value;
    you.phase = value;
    you.legalActions = legalActions;
  };

  s.roomCode = "DEMO42";
  s.hostId = "preview-0";
  you.isHost = true;
  s.maxPlayers = screen === "codenames" ? 8 : ["poker", "contexto"].includes(screen) ? 6 : 2;
  s.timerConfig = { gameTotalTime: 1200000, turnTime: 60000 };

  if (screen === "setup") s.status = "waiting";

  if (scenario === "opening" && screen === "connect4")
    s.board = Array.from({ length: 6 }, () => Array(7).fill(0));

  if (scenario === "full-column")
    s.board = [
      [0, 0, 0, 2, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 2, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0],
      [0, 0, 1, 2, 0, 0, 0],
      [0, 1, 2, 1, 0, 0, 0],
    ];

  if (screen === "reversi") {
    s.scores = { 1: 2, 2: 2 };

    if (scenario === "forced-pass") {
      s.lastPass = { playerId: "preview-1" };
      s.lastAnnouncement = "Mika has no legal moves. Alex plays again.";
    }

    if (scenario === "endgame") {
      s.board = Array.from({ length: 8 }, (_, r) =>
        Array.from({ length: 8 }, (_, c) => (r === 0 && c < 2 ? 0 : (r + c) % 3 ? 1 : 2)),
      );
      s.scores = { 1: 42, 2: 20 };
      s.legalMoves = [
        { row: 0, col: 0, flipCount: 3 },
        { row: 0, col: 1, flipCount: 2 },
      ];
    }
  }

  if (screen === "codenames") {
    const blue = scenario.startsWith("blue-");
    s.activeTeam = blue ? "blue" : "red";
    const spy = ["clue", "blue-clue", "spymaster-waiting"].includes(scenario);

    if (spy || ["win", "loss", "draw", "assassin"].includes(scenario))
      s.board = wordBoardSchema.parse(s.board).map((c) => ({
        ...c,
        affiliation: key[c.index],
      }));

    if (spy) {
      you.playerId = blue ? "preview-3" : "preview-1";
      you.team = blue ? "blue" : "red";
      you.role = "spymaster";
      you.canSeeKey = true;
    }

    if (["clue", "blue-clue"].includes(scenario)) {
      s.clue = null;
      phase("clue", ["give_clue"]);
    }

    if (scenario === "spymaster-waiting") {
      you.legalActions = [];
      you.isYourTurn = false;
    }

    if (scenario === "blue-guess") {
      you.playerId = "preview-2";
      you.team = "blue";
      you.role = "operative";
    }

    if (scenario === "clue-zero" || scenario === "clue-unlimited") {
      s.clue = {
        word: "Ocean",
        count: scenario === "clue-zero" ? 0 : "unlimited",
        givenBy: "preview-1",
      };
      s.guessesRemaining = null;
    }

    if (scenario === "guess-used") {
      s.guessesMade = 1;
      s.guessesRemaining = 2;
      you.legalActions = ["guess_word", "end_turn"];
    }

    s.activityLog = [
      {
        at: now,
        type: "clue",
        team: "red",
        playerId: "preview-1",
        word: "Orbit",
        count: 2,
      },
      {
        at: now + 10000,
        type: "guess",
        team: "red",
        playerId: "preview-0",
        word: "KEY",
        affiliation: "red",
      },
    ];

    if (scenario === "full-teams") {
      s.players = ["Alex", "Mika", "Jules", "Sam", "Casey", "Robin", "Morgan", "Taylor"].map(
        (name, i) => previewSeat(i, name),
      );
      s.assignments = {
        ...s.assignments,
        "preview-4": { team: "red", role: "operative" },
        "preview-5": { team: "red", role: "operative" },
        "preview-6": { team: "blue", role: "operative" },
        "preview-7": { team: "blue", role: "operative" },
      };
    }
  }

  if (screen === "poker") {
    const seats = cardSeatsSchema.parse(s.seats);
    s.seats = seats;
    const hero = seats[0]!;
    s.buttonPlayerId = "preview-0";
    s.smallBlindPlayerId = "preview-1";
    s.bigBlindPlayerId = "preview-2";

    if (scenario === "preflop") {
      phase("preflop", ["fold", "call", "raise"]);
      s.community = [];
      s.pot = 15;
    }

    if (["turn", "river", "showdown", "split-pot"].includes(scenario)) {
      s.community = [
        card("A", "S"),
        card("8"),
        card("K", "D"),
        card("2", "C"),
        ...(scenario === "turn" ? [] : [card("Q", "D")]),
      ];
      phase(scenario === "turn" ? "turn" : "river", ["fold", "call", "raise"]);
    }

    if (scenario === "check-bet") {
      s.toCall = 0;
      phase("flop", ["check", "bet"]);
    }

    if (scenario === "all-in" || scenario === "folded") {
      hero.allIn = scenario === "all-in";
      hero.folded = scenario === "folded";

      if (hero.allIn) hero.stack = 0;
      you.isYourTurn = false;
      you.legalActions = [];
    }

    if (/^[2-6]-players$/.test(scenario)) {
      const count = Number(scenario[0]);

      if (count === 6 && seats.length === 5) {
        const player = previewSeat(5, "Robin");
        s.players!.push(player);
        seats.push({
          ...structuredClone(seats[1]!),
          playerId: player.id,
          name: player.name,
        });
      }

      s.seats = seats.slice(0, count);
      s.players = s.players!.slice(0, count);
      s.maxPlayers = count;

      if (count === 2) {
        s.smallBlindPlayerId = "preview-0";
        s.bigBlindPlayerId = "preview-1";
      }
    }

    if (scenario === "heads-up") {
      s.smallBlindPlayerId = "preview-0";
      s.bigBlindPlayerId = "preview-1";
      s.seats = seats.slice(0, 2);
      s.players = s.players!.slice(0, 2);
      s.maxPlayers = 2;
    }

    if (scenario === "showdown" || scenario === "split-pot") {
      phase("hand_over", ["next_hand"]);

      for (const seat of seats) seat.hole = [card("A"), card("Q", "S")];
      s.lastHandResult = {
        reason: scenario === "split-pot" ? "Split pot" : "Showdown",
        showdown: true,
        winners: scenario === "split-pot" ? ["preview-0", "preview-1"] : ["preview-0"],
        hands: seats.slice(0, 2).map((seat) => ({
          playerId: seat.playerId,
          label: "Two pair",
          hole: seat.hole,
        })),
        payouts:
          scenario === "split-pot"
            ? [
                { playerId: "preview-0", amount: 75 },
                { playerId: "preview-1", amount: 75 },
              ]
            : [{ playerId: "preview-0", amount: 150 }],
      };
    }
  }

  if (screen === "battleship" || screen === "placement") {
    const board = s.yourBoard!;

    if (scenario === "placement-empty") {
      phase("placement", ["place_fleet"]);
      board.ready = false;
      board.ships = [];
    }

    if (scenario === "placement-ready") {
      phase("placement", []);
      board.ready = true;

      if (!board.ships?.length)
        board.ships = [
          { id: "carrier", row: 1, col: 1, rotation: 0 },
          { id: "dreadnought", row: 4, col: 2, rotation: 0 },
          { id: "cruiser", row: 7, col: 0, rotation: 0 },
          { id: "submarine", row: 7, col: 5, rotation: 0 },
          { id: "destroyer", row: 2, col: 7, rotation: 90 },
        ];
      you.isYourTurn = false;
    }

    if (scenario === "no-energy") {
      board.munitionPoints = 0;
      you.legalActions = ["cannon"];
    }

    if (scenario === "all-weapons" || scenario === "high-energy") {
      board.munitionPoints = scenario === "high-energy" ? 23 : 8;
      you.legalActions = ["cannon", "mine", "bomb", "radar", "torpedo"];
      board.radarScans = [{ row: 2, col: 2, shipCells: 1, cellsScanned: 9 }];
      const opponent = s.opponent!;
      s.opponent = {
        ...opponent,
        hits: [...(opponent.hits ?? []), { row: 7, col: 7 }, { row: 9, col: 4 }],
        triggeredMines: [{ row: 6, col: 6 }],
        torpedoPaths: [{ row: 7, col: 9, endRow: 7, endCol: 7, direction: "w" }],
        mineShots: [
          { row: 8, col: 2 },
          { row: 9, col: 4 },
          { row: 3, col: 8 },
        ],
        mineHits: [{ row: 9, col: 4 }],
      };
    }

    if (scenario === "sunk-ship") previewSinking(s, 2);
  }

  if (screen === "pokemon") {
    const sides = s.sides!;
    const hero = sides[0]!.pokemon[0]!;

    const decision = s.decision!;

    if (scenario === "forced-switch") {
      hero.condition = "0 fnt";
      hero.fainted = true;
      decision.forceSwitch = true;
      decision.moves = [];
      you.legalActions = ["pokemon_switch"];
    }

    if (scenario === "choice-locked") {
      s.decision = null;
      you.isYourTurn = false;
      you.legalActions = [];
    }

    if (scenario === "low-hp") {
      hero.condition = "28/300";
      sides[1]!.pokemon[0]!.condition = "12/100";
    }

    if (scenario === "status-effects") {
      hero.condition = "150/300 par";
      hero.effects = ["confusion", "reflect"];
      hero.boosts = { atk: 2, def: -1 };
      sides[1]!.pokemon[0]!.effects = ["leechseed"];
      sides[1]!.pokemon[0]!.boosts = { spa: 1 };
    }

    if (scenario === "disabled-moves")
      decision.moves = decision.moves.map((m, i) => ({
        ...m,
        disabled: i < 3,
        pp: i < 2 ? 0 : m.pp,
      }));

    if (scenario === "last-pokemon")
      for (const side of sides)
        side.pokemon = side.pokemon.map((p, i) =>
          i === 0
            ? p
            : {
                ...p,
                hidden: false,
                name: p.name ?? "Fainted Pokémon",
                condition: "0 fnt",
                fainted: true,
              },
        );
  }

  if (screen === "contexto" && scenario === "near-limit" && s.progress && you.playerId) {
    const progress = s.progress!;

    const own = progress[you.playerId];

    if (own) {
      own.guessCount = 49;
      own.guessesRemaining = 1;
      own.exhausted = false;
      s.totalGuesses = 87;
    }
  }

  if (
    screen === "contexto" &&
    ["aliased-guess", "not-in-pool"].includes(scenario) &&
    s.progress &&
    you.playerId
  ) {
    const progress = s.progress!;
    const own = progress[you.playerId];

    if (own)
      own.lastAttempt =
        scenario === "aliased-guess"
          ? {
              submittedWord: "examination",
              canonicalWord: "exam",
              status: "aliased",
              rank: 42,
            }
          : { submittedWord: "neighborhood", status: "not_in_pool" };
  }

  if (
    screen === "contexto" &&
    (scenario === "replay" || scenario === "replay-ended") &&
    s.progress
  ) {
    s.replayReadOnly = true;
    s.players = s.players!.slice(0, 2);
    s.totalGuesses = 8;
    s.progress = {
      "preview-0": {
        playerId: "preview-0",
        guessCount: 4,
        guessesRemaining: 46,
        bestRank: 18,
        exhausted: false,
        guesses: [
          { word: "water", rank: 18, sequence: 8 },
          { word: "river", rank: 824, sequence: 6 },
          { word: "boat", rank: 137, sequence: 3 },
          { word: "mountain", rank: 4820, sequence: 1 },
        ],
      },
      "preview-1": {
        playerId: "preview-1",
        guessCount: 4,
        guessesRemaining: 46,
        bestRank: 9,
        exhausted: false,
        guesses: [
          { word: "sea", rank: 9, sequence: 7 },
          { word: "beach", rank: 64, sequence: 5 },
          { word: "fish", rank: 221, sequence: 4 },
          { word: "rain", rank: 1402, sequence: 2 },
        ],
      },
    };
    you.isYourTurn = false;
    you.legalActions = [];

    if (scenario === "replay-ended") {
      s.status = "ended";
      s.secret = "ocean";
      s.turnState = { ...s.turnState!, phase: "ended", currentPlayerId: null };
    }
  }

  if (screen === "contexto" && scenario === "broadcast" && s.progress) {
    const words = [
      "water",
      "sea",
      "river",
      "beach",
      "boat",
      "fish",
      "rain",
      "mountain",
      "storm",
      "lake",
    ];

    s.broadcastPublic = true;
    s.progress = Object.fromEntries(
      Object.entries(s.progress).map(([playerId, entry], playerIndex) => [
        playerId,
        {
          ...entry,
          guesses: (entry.guesses ?? []).map((guess, index, guesses) => ({
            ...guess,
            word: words[(playerIndex * 2 + index) % words.length]!,
            sequence:
              index === guesses.length - 1
                ? (s.totalGuesses ?? 47)
                : (s.totalGuesses ?? 47) - index - 1,
          })),
        },
      ]),
    );
  }

  if (["win", "loss", "draw", "assassin"].includes(scenario)) {
    s.status = "ended";
    s.winner = scenario === "draw" ? "draw" : scenario === "loss" ? "preview-1" : "preview-0";
    phase("ended", []);
    you.isYourTurn = false;

    if (screen === "codenames") {
      s.winnerTeam = scenario === "loss" || scenario === "assassin" ? "blue" : "red";

      if (scenario === "draw") s.winnerTeam = null;
    }

    if (screen === "connect4" && scenario !== "draw")
      s.board = [
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [2, 2, 2, 0, 0, 0, 0],
        [1, 1, 1, 1, 0, 0, 0],
      ];

    if (screen === "connect4" && scenario === "draw")
      s.board = [
        [1, 1, 2, 2, 1, 1, 2],
        [2, 2, 1, 1, 2, 2, 1],
        [1, 1, 2, 2, 1, 1, 2],
        [2, 2, 1, 1, 2, 2, 1],
        [1, 1, 2, 2, 1, 1, 2],
        [2, 2, 1, 1, 2, 2, 1],
      ];

    if (screen === "connect4" && scenario === "loss")
      s.board = numericBoardSchema
        .parse(s.board)
        .map((row) => row.map((x) => (x === 1 ? 2 : x === 2 ? 1 : 0)));

    if (screen === "reversi") {
      const first = scenario === "draw" ? 32 : scenario === "loss" ? 24 : 40;
      s.board = Array.from({ length: 8 }, (_, r) =>
        Array.from({ length: 8 }, (_, c) => (r * 8 + c < first ? 1 : 2)),
      );
      s.scores = { 1: first, 2: 64 - first };
      s.legalMoves = [];
    }

    if (screen === "pokemon") {
      const opponentTeam = ["blastoise", "dragonite", "jolteon", "exeggutor", "rhydon", "chansey"];

      for (const side of s.sides ?? []) {
        side.pokemon = side.pokemon.map((mon, index) => {
          const sprite = opponentTeam[index]!;

          const revealed = mon.hidden
            ? {
                sprite,
                name: sprite[0]!.toUpperCase() + sprite.slice(1),
                level: 80,
                active: false,
                condition: "100/100",
                fainted: false,
              }
            : mon;

          return scenario !== "draw" && side.seat === (scenario === "loss" ? "p1" : "p2")
            ? { ...revealed, condition: "0 fnt", fainted: true }
            : revealed;
        });
      }
    }

    if (screen === "contexto") {
      s.secret = "ocean";

      const finalWords = [
        ["water", "boat", "river", "mountain", "computer"],
        ["tide", "wave", "harbor", "island", "sail"],
        ["shore", "coast", "beach", "sand", "bay"],
        ["lake", "stream", "rain", "cloud", "storm"],
        ["fish", "coral", "reef", "shell", "whale"],
        ["deep", "blue"],
      ];

      const progress = s.progress!;

      s.players?.forEach((player, index) => {
        const entry = progress[player.id];

        if (!entry) return;
        const winner = player.id === s.winner;
        const base = entry.bestRank ?? 100;
        entry.guesses = (finalWords[index] ?? []).map((word, position) => ({
          word,
          rank: base + position * (position + 1) * 17,
          sequence: 20 - position,
        }));

        if (winner) {
          entry.guesses[0] = { word: "ocean", rank: 1, sequence: 21 };
          entry.bestRank = 1;
        }
      });
    }

    if (screen === "battleship") {
      const own = s.yourBoard!;

      const placements = [
        { id: "carrier", row: 1, col: 6 },
        { id: "dreadnought", row: 4, col: 3 },
        { id: "cruiser", row: 7, col: 6 },
        { id: "submarine", row: 5, col: 0 },
        { id: "destroyer", row: 1, col: 1 },
      ];

      const revealedShips = placements.map((ship) => ({
        ...ship,
        rotation: 0,
        cells: (s.fleet?.find((spec) => spec.id === ship.id)?.shape ?? []).map(({ dr, dc }) => ({
          row: ship.row + dr,
          col: ship.col + dc,
        })),
      }));

      s.yourBoard = {
        ...own,
        radarScans: [{ row: 5, col: 3, shipCells: 2, cellsScanned: 9 }],
        bombedAreas: [{ row: 3, col: 6 }],
        torpedoPaths: [{ row: 7, col: 0, endRow: 7, endCol: 0, direction: "e" }],
      };
      s.opponent = {
        ...s.opponent,
        revealedShips,
        revealedMines: [{ row: 8, col: 8 }],
        radarScans: s.radarScans,
        bombedAreas: [{ row: 4, col: 3 }],
        torpedoPaths: [{ row: 7, col: 9, endRow: 7, endCol: 8, direction: "w" }],
        triggeredMines: [{ row: 6, col: 6 }],
        mineShots: [{ row: 5, col: 7 }],
      };
    }
  }

  if (
    [
      "lobby-host",
      "lobby-player",
      "lobby-waiting",
      "lobby-jev",
      "jev-trial-used",
      "host-spectating",
      "lobby-unassigned",
      "lobby-spectator",
      "room-setup",
    ].includes(scenario)
  ) {
    s.status = "waiting";
    phase("waiting", []);

    if (scenario === "lobby-waiting" || scenario === "lobby-jev")
      s.players = s.players!.slice(0, 1);

    if (
      ["connect4", "pokemon", "reversi", "battleship", "poker", "contexto"].includes(s.type ?? "")
    )
      s.jev = { available: true, status: "ready" };

    if (scenario === "lobby-player") {
      you.isHost = false;
      you.playerId = "preview-1";
    }

    if (scenario === "host-spectating") {
      you.isSpectator = true;
      s.players = s.players!.filter((p) => p.id !== you.playerId);
      s.spectators = [{ id: you.playerId!, name: "Alex" }];
    }

    if (scenario === "lobby-unassigned") s.assignments = {};
  }

  if (scenario === "waiting") {
    you.isYourTurn = false;
    you.legalActions = [];
    turn.currentPlayerId = "preview-1";
  }

  if (scenario === "urgent") turn.turnTimeRemaining = 7000;

  if (watching) {
    you.isSpectator = true;
    you.isYourTurn = false;
    you.isHost = false;
    you.playerId = "preview-spectator";
    you.team = null;
    you.role = "spectator";
    you.seat = null;
    you.legalActions = [];
    s.spectators = [{ id: "preview-spectator", name: "Taylor" }];
    s.spectatorCount = 1;

    if (screen === "battleship" || screen === "placement") {
      const own = s.yourBoard!;

      s.spectatorBoards = [
        {
          playerId: "preview-0",
          ready: own.ready,
          hits: own.incomingHits ?? [],
          misses: own.incomingMisses ?? [],
          shipsRemaining: own.shipsRemaining ?? 5,
          sunkShips: own.sunkShips ?? [],
        },
        { ...s.opponent, playerId: "preview-1" },
      ];
      s.yourBoard = null;
    }

    if (screen === "pokemon") {
      s.decision = null;

      for (const side of s.sides ?? [])
        for (const mon of side.pokemon) {
          delete mon.stats;
        }
    }

    if (screen === "contexto" && s.progress) {
      s.progress = Object.fromEntries(
        Object.entries(s.progress).map(([playerId, entry]) => [
          playerId,
          {
            ...entry,
            guesses: (entry.guesses ?? []).map((guess) => ({
              rank: guess.rank,
              masked: true,
            })),
          },
        ]),
      );
    }

    if (screen === "poker" && Array.isArray(s.seats))
      for (const seat of s.seats) {
        if (seat.hole)
          seat.hole = seat.hole.map(() => ({
            rank: "?",
            suit: "S",
            hidden: true,
          }));
      }
  }

  return s;
}
