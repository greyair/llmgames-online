/**
 * Frozen transcript of the pre-plugin CheckersRoom.
 *
 * Captured before the M3.4 migration: opening board, six natural moves, a
 * forced two-jump chain, crowning, a match ending with no legal move, the
 * 80-quiet-move draw, the threefold-repetition draw, the turn-timeout forfeit
 * and the match-clock draw, plus every refusal.
 *
 * Internal bookkeeping (`positionCounts`) is deliberately absent: it must never
 * reach a projection or a replay frame.
 */

export interface CheckersTranscriptCell {
  row: number;
  col: number;
}

export interface CheckersTranscriptMove {
  fromRow: number;
  fromCol: number;
  row: number;
  col: number;
  capture: CheckersTranscriptCell | null;
}

export interface CheckersTranscriptStep {
  label: string;
  note?: { from: [number, number]; to: [number, number] } | null;
  board: readonly string[];
  scores: Record<string, number>;
  status: string;
  phase: string;
  turnNumber: number;
  currentSeat: number | null;
  winner: number | "draw" | null;
  legalMoves: readonly CheckersTranscriptMove[];
  forcedPiece: CheckersTranscriptCell | null;
  lastMove:
    | (CheckersTranscriptMove & { playerId: string; crowned: boolean })
    | null;
  quietTurns: number;
  views: ReadonlyArray<{
    seat: number | null;
    color: string | null;
    role: string | null;
    legalActions: readonly string[];
  }>;
}

export interface CheckersTranscriptRejection {
  label: string;
  status: number;
  ok: boolean | undefined;
  error?: { message: string; code?: string; category?: string; actionType?: string; recovery?: string };
}

export interface CheckersTranscript {
  steps: CheckersTranscriptStep[];
  rejections: CheckersTranscriptRejection[];
}

export const CHECKERS_GOLDEN: CheckersTranscript = {
  "steps": [
    {
      "label": "start",
      "board": [
        "02020202",
        "20202020",
        "02020202",
        "00000000",
        "00000000",
        "10101010",
        "01010101",
        "10101010"
      ],
      "scores": {
        "1": 12,
        "2": 12
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 1,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 5,
          "fromCol": 0,
          "row": 4,
          "col": 1,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 2,
          "row": 4,
          "col": 1,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 2,
          "row": 4,
          "col": 3,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 4,
          "row": 4,
          "col": 3,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 4,
          "row": 4,
          "col": 5,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 6,
          "row": 4,
          "col": 5,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 6,
          "row": 4,
          "col": 7,
          "capture": null
        }
      ],
      "forcedPiece": null,
      "lastMove": null,
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game",
            "move_checker"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "natural:0",
      "note": {
        "from": [
          5,
          0
        ],
        "to": [
          4,
          1
        ]
      },
      "board": [
        "02020202",
        "20202020",
        "02020202",
        "00000000",
        "01000000",
        "00101010",
        "01010101",
        "10101010"
      ],
      "scores": {
        "1": 12,
        "2": 12
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 2,
      "currentSeat": 2,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 2,
          "fromCol": 1,
          "row": 3,
          "col": 0,
          "capture": null
        },
        {
          "fromRow": 2,
          "fromCol": 1,
          "row": 3,
          "col": 2,
          "capture": null
        },
        {
          "fromRow": 2,
          "fromCol": 3,
          "row": 3,
          "col": 2,
          "capture": null
        },
        {
          "fromRow": 2,
          "fromCol": 3,
          "row": 3,
          "col": 4,
          "capture": null
        },
        {
          "fromRow": 2,
          "fromCol": 5,
          "row": 3,
          "col": 4,
          "capture": null
        },
        {
          "fromRow": 2,
          "fromCol": 5,
          "row": 3,
          "col": 6,
          "capture": null
        },
        {
          "fromRow": 2,
          "fromCol": 7,
          "row": 3,
          "col": 6,
          "capture": null
        }
      ],
      "forcedPiece": null,
      "lastMove": {
        "fromRow": 5,
        "fromCol": 0,
        "row": 4,
        "col": 1,
        "capture": null,
        "playerId": "chk-player-1",
        "crowned": false
      },
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave",
            "move_checker"
          ]
        }
      ]
    },
    {
      "label": "natural:1",
      "note": {
        "from": [
          2,
          1
        ],
        "to": [
          3,
          0
        ]
      },
      "board": [
        "02020202",
        "20202020",
        "00020202",
        "20000000",
        "01000000",
        "00101010",
        "01010101",
        "10101010"
      ],
      "scores": {
        "1": 12,
        "2": 12
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 3,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 4,
          "fromCol": 1,
          "row": 3,
          "col": 2,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 2,
          "row": 4,
          "col": 3,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 4,
          "row": 4,
          "col": 3,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 4,
          "row": 4,
          "col": 5,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 6,
          "row": 4,
          "col": 5,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 6,
          "row": 4,
          "col": 7,
          "capture": null
        },
        {
          "fromRow": 6,
          "fromCol": 1,
          "row": 5,
          "col": 0,
          "capture": null
        }
      ],
      "forcedPiece": null,
      "lastMove": {
        "fromRow": 2,
        "fromCol": 1,
        "row": 3,
        "col": 0,
        "capture": null,
        "playerId": "chk-player-2",
        "crowned": false
      },
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game",
            "move_checker"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "natural:2",
      "note": {
        "from": [
          4,
          1
        ],
        "to": [
          3,
          2
        ]
      },
      "board": [
        "02020202",
        "20202020",
        "00020202",
        "20100000",
        "00000000",
        "00101010",
        "01010101",
        "10101010"
      ],
      "scores": {
        "1": 12,
        "2": 12
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 4,
      "currentSeat": 2,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 2,
          "fromCol": 3,
          "row": 4,
          "col": 1,
          "capture": {
            "row": 3,
            "col": 2
          }
        }
      ],
      "forcedPiece": null,
      "lastMove": {
        "fromRow": 4,
        "fromCol": 1,
        "row": 3,
        "col": 2,
        "capture": null,
        "playerId": "chk-player-1",
        "crowned": false
      },
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave",
            "move_checker"
          ]
        }
      ]
    },
    {
      "label": "natural:3",
      "note": {
        "from": [
          2,
          3
        ],
        "to": [
          4,
          1
        ]
      },
      "board": [
        "02020202",
        "20202020",
        "00000202",
        "20000000",
        "02000000",
        "00101010",
        "01010101",
        "10101010"
      ],
      "scores": {
        "1": 11,
        "2": 12
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 5,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 5,
          "fromCol": 2,
          "row": 4,
          "col": 3,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 4,
          "row": 4,
          "col": 3,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 4,
          "row": 4,
          "col": 5,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 6,
          "row": 4,
          "col": 5,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 6,
          "row": 4,
          "col": 7,
          "capture": null
        },
        {
          "fromRow": 6,
          "fromCol": 1,
          "row": 5,
          "col": 0,
          "capture": null
        }
      ],
      "forcedPiece": null,
      "lastMove": {
        "fromRow": 2,
        "fromCol": 3,
        "row": 4,
        "col": 1,
        "capture": {
          "row": 3,
          "col": 2
        },
        "playerId": "chk-player-2",
        "crowned": false
      },
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game",
            "move_checker"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "natural:4",
      "note": {
        "from": [
          5,
          2
        ],
        "to": [
          4,
          3
        ]
      },
      "board": [
        "02020202",
        "20202020",
        "00000202",
        "20000000",
        "02010000",
        "00001010",
        "01010101",
        "10101010"
      ],
      "scores": {
        "1": 11,
        "2": 12
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 6,
      "currentSeat": 2,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 1,
          "fromCol": 0,
          "row": 2,
          "col": 1,
          "capture": null
        },
        {
          "fromRow": 1,
          "fromCol": 2,
          "row": 2,
          "col": 1,
          "capture": null
        },
        {
          "fromRow": 1,
          "fromCol": 2,
          "row": 2,
          "col": 3,
          "capture": null
        },
        {
          "fromRow": 1,
          "fromCol": 4,
          "row": 2,
          "col": 3,
          "capture": null
        },
        {
          "fromRow": 2,
          "fromCol": 5,
          "row": 3,
          "col": 4,
          "capture": null
        },
        {
          "fromRow": 2,
          "fromCol": 5,
          "row": 3,
          "col": 6,
          "capture": null
        },
        {
          "fromRow": 2,
          "fromCol": 7,
          "row": 3,
          "col": 6,
          "capture": null
        },
        {
          "fromRow": 4,
          "fromCol": 1,
          "row": 5,
          "col": 0,
          "capture": null
        },
        {
          "fromRow": 4,
          "fromCol": 1,
          "row": 5,
          "col": 2,
          "capture": null
        }
      ],
      "forcedPiece": null,
      "lastMove": {
        "fromRow": 5,
        "fromCol": 2,
        "row": 4,
        "col": 3,
        "capture": null,
        "playerId": "chk-player-1",
        "crowned": false
      },
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave",
            "move_checker"
          ]
        }
      ]
    },
    {
      "label": "natural:5",
      "note": {
        "from": [
          1,
          0
        ],
        "to": [
          2,
          1
        ]
      },
      "board": [
        "02020202",
        "00202020",
        "02000202",
        "20000000",
        "02010000",
        "00001010",
        "01010101",
        "10101010"
      ],
      "scores": {
        "1": 11,
        "2": 12
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 7,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 4,
          "fromCol": 3,
          "row": 3,
          "col": 2,
          "capture": null
        },
        {
          "fromRow": 4,
          "fromCol": 3,
          "row": 3,
          "col": 4,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 4,
          "row": 4,
          "col": 5,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 6,
          "row": 4,
          "col": 5,
          "capture": null
        },
        {
          "fromRow": 5,
          "fromCol": 6,
          "row": 4,
          "col": 7,
          "capture": null
        },
        {
          "fromRow": 6,
          "fromCol": 1,
          "row": 5,
          "col": 0,
          "capture": null
        },
        {
          "fromRow": 6,
          "fromCol": 1,
          "row": 5,
          "col": 2,
          "capture": null
        },
        {
          "fromRow": 6,
          "fromCol": 3,
          "row": 5,
          "col": 2,
          "capture": null
        }
      ],
      "forcedPiece": null,
      "lastMove": {
        "fromRow": 1,
        "fromCol": 0,
        "row": 2,
        "col": 1,
        "capture": null,
        "playerId": "chk-player-2",
        "crowned": false
      },
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game",
            "move_checker"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "chain:start",
      "board": [
        "00000002",
        "00000000",
        "00020000",
        "00000000",
        "00020000",
        "00100000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 1,
        "2": 3
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 1,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 5,
          "fromCol": 2,
          "row": 3,
          "col": 4,
          "capture": {
            "row": 4,
            "col": 3
          }
        }
      ],
      "forcedPiece": null,
      "lastMove": null,
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game",
            "move_checker"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "chain:first-jump",
      "board": [
        "00000002",
        "00000000",
        "00020000",
        "00001000",
        "00000000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 1,
        "2": 2
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 1,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 3,
          "fromCol": 4,
          "row": 1,
          "col": 2,
          "capture": {
            "row": 2,
            "col": 3
          }
        }
      ],
      "forcedPiece": {
        "row": 3,
        "col": 4
      },
      "lastMove": {
        "fromRow": 5,
        "fromCol": 2,
        "row": 3,
        "col": 4,
        "capture": {
          "row": 4,
          "col": 3
        },
        "playerId": "chk-player-1",
        "crowned": false
      },
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game",
            "move_checker"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "chain:second-jump",
      "board": [
        "00000002",
        "00100000",
        "00000000",
        "00000000",
        "00000000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 1,
        "2": 1
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 2,
      "currentSeat": 2,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 0,
          "fromCol": 7,
          "row": 1,
          "col": 6,
          "capture": null
        }
      ],
      "forcedPiece": null,
      "lastMove": {
        "fromRow": 3,
        "fromCol": 4,
        "row": 1,
        "col": 2,
        "capture": {
          "row": 2,
          "col": 3
        },
        "playerId": "chk-player-1",
        "crowned": false
      },
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave",
            "move_checker"
          ]
        }
      ]
    },
    {
      "label": "crown:start",
      "board": [
        "00000002",
        "00100000",
        "00000000",
        "00000000",
        "00000000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 1,
        "2": 1
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 1,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 1,
          "fromCol": 2,
          "row": 0,
          "col": 1,
          "capture": null
        },
        {
          "fromRow": 1,
          "fromCol": 2,
          "row": 0,
          "col": 3,
          "capture": null
        }
      ],
      "forcedPiece": null,
      "lastMove": null,
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game",
            "move_checker"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "crown:promoted",
      "board": [
        "03000002",
        "00000000",
        "00000000",
        "00000000",
        "00000000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 1,
        "2": 1
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 2,
      "currentSeat": 2,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 0,
          "fromCol": 7,
          "row": 1,
          "col": 6,
          "capture": null
        }
      ],
      "forcedPiece": null,
      "lastMove": {
        "fromRow": 1,
        "fromCol": 2,
        "row": 0,
        "col": 1,
        "capture": null,
        "playerId": "chk-player-1",
        "crowned": true
      },
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave",
            "move_checker"
          ]
        }
      ]
    },
    {
      "label": "stuck:start",
      "board": [
        "00000000",
        "00000000",
        "00000000",
        "00010000",
        "00000000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 1,
        "2": 0
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 1,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 3,
          "fromCol": 3,
          "row": 2,
          "col": 2,
          "capture": null
        },
        {
          "fromRow": 3,
          "fromCol": 3,
          "row": 2,
          "col": 4,
          "capture": null
        }
      ],
      "forcedPiece": null,
      "lastMove": null,
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game",
            "move_checker"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "stuck:ended",
      "board": [
        "00000000",
        "00000000",
        "00100000",
        "00000000",
        "00000000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 1,
        "2": 0
      },
      "status": "ended",
      "phase": "ended",
      "turnNumber": 1,
      "currentSeat": null,
      "winner": 1,
      "legalMoves": [],
      "forcedPiece": null,
      "lastMove": {
        "fromRow": 3,
        "fromCol": 3,
        "row": 2,
        "col": 2,
        "capture": null,
        "playerId": "chk-player-1",
        "crowned": false
      },
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "quiet:start",
      "board": [
        "00000004",
        "00000000",
        "00000000",
        "00030000",
        "00000000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 1,
        "2": 1
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 1,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 3,
          "fromCol": 3,
          "row": 2,
          "col": 2,
          "capture": null
        },
        {
          "fromRow": 3,
          "fromCol": 3,
          "row": 2,
          "col": 4,
          "capture": null
        },
        {
          "fromRow": 3,
          "fromCol": 3,
          "row": 4,
          "col": 2,
          "capture": null
        },
        {
          "fromRow": 3,
          "fromCol": 3,
          "row": 4,
          "col": 4,
          "capture": null
        }
      ],
      "forcedPiece": null,
      "lastMove": null,
      "quietTurns": 79,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game",
            "move_checker"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "quiet:draw",
      "board": [
        "00000004",
        "00000000",
        "00000000",
        "00000000",
        "00003000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 1,
        "2": 1
      },
      "status": "ended",
      "phase": "ended",
      "turnNumber": 1,
      "currentSeat": null,
      "winner": "draw",
      "legalMoves": [],
      "forcedPiece": null,
      "lastMove": {
        "fromRow": 3,
        "fromCol": 3,
        "row": 4,
        "col": 4,
        "capture": null,
        "playerId": "chk-player-1",
        "crowned": false
      },
      "quietTurns": 80,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "repeat:start",
      "board": [
        "00000004",
        "00000000",
        "00000000",
        "00000000",
        "00000000",
        "10000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 1,
        "2": 1
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 1,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "fromRow": 5,
          "fromCol": 0,
          "row": 4,
          "col": 1,
          "capture": null
        }
      ],
      "forcedPiece": null,
      "lastMove": null,
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave",
            "end_game",
            "move_checker"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "repeat:draw",
      "board": [
        "00000004",
        "00000000",
        "00000000",
        "00000000",
        "01000000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 1,
        "2": 1
      },
      "status": "ended",
      "phase": "ended",
      "turnNumber": 1,
      "currentSeat": null,
      "winner": "draw",
      "legalMoves": [],
      "forcedPiece": null,
      "lastMove": {
        "fromRow": 5,
        "fromCol": 0,
        "row": 4,
        "col": 1,
        "capture": null,
        "playerId": "chk-player-1",
        "crowned": false
      },
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "turn-timeout",
      "board": [
        "02020202",
        "20202020",
        "02020202",
        "00000000",
        "00000000",
        "10101010",
        "01010101",
        "10101010"
      ],
      "scores": {
        "1": 12,
        "2": 12
      },
      "status": "ended",
      "phase": "ended",
      "turnNumber": 1,
      "currentSeat": null,
      "winner": 2,
      "legalMoves": [],
      "forcedPiece": null,
      "lastMove": null,
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "match-timeout",
      "board": [
        "02020202",
        "20202020",
        "02020202",
        "00000000",
        "00000000",
        "10101010",
        "01010101",
        "10101010"
      ],
      "scores": {
        "1": 12,
        "2": 12
      },
      "status": "ended",
      "phase": "ended",
      "turnNumber": 1,
      "currentSeat": null,
      "winner": "draw",
      "legalMoves": [],
      "forcedPiece": null,
      "lastMove": null,
      "quietTurns": 0,
      "views": [
        {
          "seat": 1,
          "color": "black",
          "role": null,
          "legalActions": [
            "leave"
          ]
        },
        {
          "seat": 2,
          "color": "white",
          "role": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    }
  ],
  "rejections": [
    {
      "label": "out-of-turn",
      "status": 409,
      "ok": false,
      "error": {
        "message": "Not your turn",
        "actionType": "move_checker",
        "code": "NOT_YOUR_TURN",
        "category": "state",
        "recovery": "wait_for_turn"
      }
    },
    {
      "label": "off-board",
      "status": 400,
      "ok": false,
      "error": {
        "message": "Coordinates must be integers 0–7",
        "actionType": "move_checker",
        "code": "INVALID_ACTION_DATA",
        "category": "input",
        "recovery": "correct_input"
      }
    },
    {
      "label": "negative",
      "status": 400,
      "ok": false,
      "error": {
        "message": "Coordinates must be integers 0–7",
        "actionType": "move_checker",
        "code": "INVALID_ACTION_DATA",
        "category": "input",
        "recovery": "correct_input"
      }
    },
    {
      "label": "fraction",
      "status": 400,
      "ok": false,
      "error": {
        "message": "Coordinates must be integers 0–7",
        "actionType": "move_checker",
        "code": "INVALID_ACTION_DATA",
        "category": "input",
        "recovery": "correct_input"
      }
    },
    {
      "label": "missing",
      "status": 400,
      "ok": false,
      "error": {
        "message": "Coordinates must be integers 0–7",
        "actionType": "move_checker",
        "code": "INVALID_ACTION_DATA",
        "category": "input",
        "recovery": "correct_input"
      }
    },
    {
      "label": "not-legal",
      "status": 422,
      "ok": false,
      "error": {
        "message": "Illegal move. Captures are mandatory; finish a jump chain with the same piece.",
        "actionType": "move_checker",
        "code": "ILLEGAL_MOVE",
        "category": "rule",
        "recovery": "correct_input"
      }
    },
    {
      "label": "unknown-action",
      "status": 400,
      "ok": false,
      "error": {
        "message": "Unknown action: teleport",
        "actionType": "teleport",
        "code": "UNSUPPORTED_ACTION",
        "category": "scope",
        "recovery": "correct_action"
      }
    }
  ]
};
