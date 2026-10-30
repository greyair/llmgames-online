/**
 * Frozen transcript of the pre-plugin ReversiRoom.
 *
 * Captured before the M3.3 migration so the plugin-driven room can be compared
 * step by step: board, disc counts, turn order, legal moves, forced passes, the
 * scoring finish, the match-clock result, per-seat role and every refusal.
 *
 * Timestamps, timer remainders and room ids are platform-owned and excluded.
 */

export interface ReversiTranscriptMove {
  row: number;
  col: number;
  flipCount: number;
}

export interface ReversiTranscriptCell {
  row: number;
  col: number;
}

export interface ReversiTranscriptStep {
  label: string;
  note?: { row: number; col: number } | { playedBy: number | null } | null;
  board: readonly string[];
  scores: Record<string, number>;
  status: string;
  phase: string;
  turnNumber: number;
  currentSeat: number | null;
  winner: number | "draw" | null;
  legalMoves: readonly ReversiTranscriptMove[];
  lastMove:
    | { playerId: string; row: number; col: number; seat: number; flipped: ReversiTranscriptCell[] }
    | null;
  lastPass: { seat: number; turn: number } | null;
  views: ReadonlyArray<{ role: string | null; color: string | null; legalActions: readonly string[] }>;
}

export interface ReversiTranscriptRejection {
  label: string;
  status: number;
  ok: boolean | undefined;
  error?: { message: string; code?: string; category?: string; actionType?: string; recovery?: string };
}

export interface ReversiTranscript {
  steps: ReversiTranscriptStep[];
  rejections: ReversiTranscriptRejection[];
}

export const REVERSI_GOLDEN: ReversiTranscript = {
  "steps": [
    {
      "label": "start",
      "board": [
        "00000000",
        "00000000",
        "00000000",
        "00021000",
        "00012000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 2,
        "2": 2
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 1,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "row": 2,
          "col": 3,
          "flipCount": 1
        },
        {
          "row": 3,
          "col": 2,
          "flipCount": 1
        },
        {
          "row": 4,
          "col": 5,
          "flipCount": 1
        },
        {
          "row": 5,
          "col": 4,
          "flipCount": 1
        }
      ],
      "lastMove": null,
      "lastPass": null,
      "views": [
        {
          "role": "black",
          "color": null,
          "legalActions": [
            "leave",
            "end_game",
            "place_disc"
          ]
        },
        {
          "role": "white",
          "color": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "natural:0:seat1",
      "note": {
        "row": 2,
        "col": 3
      },
      "board": [
        "00000000",
        "00000000",
        "00010000",
        "00011000",
        "00012000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 4,
        "2": 1
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 2,
      "currentSeat": 2,
      "winner": null,
      "legalMoves": [
        {
          "row": 2,
          "col": 2,
          "flipCount": 1
        },
        {
          "row": 2,
          "col": 4,
          "flipCount": 1
        },
        {
          "row": 4,
          "col": 2,
          "flipCount": 1
        }
      ],
      "lastMove": {
        "playerId": "rev-player-1",
        "row": 2,
        "col": 3,
        "seat": 1,
        "flipped": [
          {
            "row": 3,
            "col": 3
          }
        ]
      },
      "lastPass": null,
      "views": [
        {
          "role": "black",
          "color": null,
          "legalActions": [
            "leave",
            "end_game"
          ]
        },
        {
          "role": "white",
          "color": null,
          "legalActions": [
            "leave",
            "place_disc"
          ]
        }
      ]
    },
    {
      "label": "natural:1:seat2",
      "note": {
        "row": 2,
        "col": 2
      },
      "board": [
        "00000000",
        "00000000",
        "00210000",
        "00021000",
        "00012000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 3,
        "2": 3
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 3,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "row": 2,
          "col": 1,
          "flipCount": 1
        },
        {
          "row": 3,
          "col": 2,
          "flipCount": 1
        },
        {
          "row": 4,
          "col": 5,
          "flipCount": 1
        },
        {
          "row": 5,
          "col": 4,
          "flipCount": 1
        }
      ],
      "lastMove": {
        "playerId": "rev-player-2",
        "row": 2,
        "col": 2,
        "seat": 2,
        "flipped": [
          {
            "row": 3,
            "col": 3
          }
        ]
      },
      "lastPass": null,
      "views": [
        {
          "role": "black",
          "color": null,
          "legalActions": [
            "leave",
            "end_game",
            "place_disc"
          ]
        },
        {
          "role": "white",
          "color": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "natural:2:seat1",
      "note": {
        "row": 2,
        "col": 1
      },
      "board": [
        "00000000",
        "00000000",
        "01110000",
        "00021000",
        "00012000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 5,
        "2": 2
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 4,
      "currentSeat": 2,
      "winner": null,
      "legalMoves": [
        {
          "row": 1,
          "col": 1,
          "flipCount": 1
        },
        {
          "row": 1,
          "col": 3,
          "flipCount": 1
        },
        {
          "row": 2,
          "col": 4,
          "flipCount": 1
        },
        {
          "row": 3,
          "col": 5,
          "flipCount": 1
        },
        {
          "row": 4,
          "col": 2,
          "flipCount": 1
        },
        {
          "row": 5,
          "col": 3,
          "flipCount": 1
        }
      ],
      "lastMove": {
        "playerId": "rev-player-1",
        "row": 2,
        "col": 1,
        "seat": 1,
        "flipped": [
          {
            "row": 2,
            "col": 2
          }
        ]
      },
      "lastPass": null,
      "views": [
        {
          "role": "black",
          "color": null,
          "legalActions": [
            "leave",
            "end_game"
          ]
        },
        {
          "role": "white",
          "color": null,
          "legalActions": [
            "leave",
            "place_disc"
          ]
        }
      ]
    },
    {
      "label": "natural:3:seat2",
      "note": {
        "row": 1,
        "col": 1
      },
      "board": [
        "00000000",
        "02000000",
        "01210000",
        "00021000",
        "00012000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 4,
        "2": 4
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 5,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "row": 0,
          "col": 1,
          "flipCount": 1
        },
        {
          "row": 3,
          "col": 2,
          "flipCount": 1
        },
        {
          "row": 4,
          "col": 5,
          "flipCount": 1
        },
        {
          "row": 5,
          "col": 4,
          "flipCount": 1
        }
      ],
      "lastMove": {
        "playerId": "rev-player-2",
        "row": 1,
        "col": 1,
        "seat": 2,
        "flipped": [
          {
            "row": 2,
            "col": 2
          }
        ]
      },
      "lastPass": null,
      "views": [
        {
          "role": "black",
          "color": null,
          "legalActions": [
            "leave",
            "end_game",
            "place_disc"
          ]
        },
        {
          "role": "white",
          "color": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "natural:4:seat1",
      "note": {
        "row": 0,
        "col": 1
      },
      "board": [
        "01000000",
        "01000000",
        "01210000",
        "00021000",
        "00012000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 6,
        "2": 3
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 6,
      "currentSeat": 2,
      "winner": null,
      "legalMoves": [
        {
          "row": 0,
          "col": 0,
          "flipCount": 1
        },
        {
          "row": 1,
          "col": 3,
          "flipCount": 1
        },
        {
          "row": 2,
          "col": 0,
          "flipCount": 1
        },
        {
          "row": 2,
          "col": 4,
          "flipCount": 2
        },
        {
          "row": 3,
          "col": 5,
          "flipCount": 1
        },
        {
          "row": 4,
          "col": 2,
          "flipCount": 1
        },
        {
          "row": 5,
          "col": 3,
          "flipCount": 1
        }
      ],
      "lastMove": {
        "playerId": "rev-player-1",
        "row": 0,
        "col": 1,
        "seat": 1,
        "flipped": [
          {
            "row": 1,
            "col": 1
          }
        ]
      },
      "lastPass": null,
      "views": [
        {
          "role": "black",
          "color": null,
          "legalActions": [
            "leave",
            "end_game"
          ]
        },
        {
          "role": "white",
          "color": null,
          "legalActions": [
            "leave",
            "place_disc"
          ]
        }
      ]
    },
    {
      "label": "natural:5:seat2",
      "note": {
        "row": 0,
        "col": 0
      },
      "board": [
        "21000000",
        "02000000",
        "01210000",
        "00021000",
        "00012000",
        "00000000",
        "00000000",
        "00000000"
      ],
      "scores": {
        "1": 5,
        "2": 5
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 7,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "row": 3,
          "col": 2,
          "flipCount": 1
        },
        {
          "row": 4,
          "col": 5,
          "flipCount": 1
        },
        {
          "row": 5,
          "col": 4,
          "flipCount": 1
        }
      ],
      "lastMove": {
        "playerId": "rev-player-2",
        "row": 0,
        "col": 0,
        "seat": 2,
        "flipped": [
          {
            "row": 1,
            "col": 1
          }
        ]
      },
      "lastPass": null,
      "views": [
        {
          "role": "black",
          "color": null,
          "legalActions": [
            "leave",
            "end_game",
            "place_disc"
          ]
        },
        {
          "role": "white",
          "color": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "crafted:pass",
      "note": {
        "playedBy": 1
      },
      "board": [
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111120"
      ],
      "scores": {
        "1": 62,
        "2": 1
      },
      "status": "playing",
      "phase": "play",
      "turnNumber": 8,
      "currentSeat": 1,
      "winner": null,
      "legalMoves": [
        {
          "row": 7,
          "col": 7,
          "flipCount": 1
        }
      ],
      "lastMove": {
        "playerId": "rev-player-1",
        "row": 0,
        "col": 0,
        "seat": 1,
        "flipped": [
          {
            "row": 0,
            "col": 1
          }
        ]
      },
      "lastPass": {
        "seat": 2,
        "turn": 8
      },
      "views": [
        {
          "role": "black",
          "color": null,
          "legalActions": [
            "leave",
            "end_game",
            "place_disc"
          ]
        },
        {
          "role": "white",
          "color": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "crafted:finish",
      "note": {
        "playedBy": 1
      },
      "board": [
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111"
      ],
      "scores": {
        "1": 64,
        "2": 0
      },
      "status": "ended",
      "phase": "ended",
      "turnNumber": 9,
      "currentSeat": null,
      "winner": 1,
      "legalMoves": [],
      "lastMove": {
        "playerId": "rev-player-1",
        "row": 7,
        "col": 7,
        "seat": 1,
        "flipped": [
          {
            "row": 7,
            "col": 6
          }
        ]
      },
      "lastPass": null,
      "views": [
        {
          "role": "black",
          "color": null,
          "legalActions": [
            "leave"
          ]
        },
        {
          "role": "white",
          "color": null,
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "match-timeout",
      "note": null,
      "board": [
        "11111111",
        "11111111",
        "11111112",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111"
      ],
      "scores": {
        "1": 63,
        "2": 1
      },
      "status": "ended",
      "phase": "ended",
      "turnNumber": 1,
      "currentSeat": null,
      "winner": 1,
      "legalMoves": [],
      "lastMove": null,
      "lastPass": null,
      "views": []
    }
  ],
  "rejections": [
    {
      "label": "out-of-turn",
      "status": 409,
      "ok": false,
      "error": {
        "message": "Not your turn",
        "actionType": "place_disc",
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
        "message": "Row and col must be integers 0–7",
        "actionType": "place_disc",
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
        "message": "Row and col must be integers 0–7",
        "actionType": "place_disc",
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
        "message": "Row and col must be integers 0–7",
        "actionType": "place_disc",
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
        "message": "Row and col must be integers 0–7",
        "actionType": "place_disc",
        "code": "INVALID_ACTION_DATA",
        "category": "input",
        "recovery": "correct_input"
      }
    },
    {
      "label": "occupied",
      "status": 422,
      "ok": false,
      "error": {
        "message": "Illegal move: placement must bracket opponent discs",
        "actionType": "place_disc",
        "code": "ILLEGAL_MOVE",
        "category": "rule",
        "recovery": "correct_input"
      }
    },
    {
      "label": "not-bracketing",
      "status": 422,
      "ok": false,
      "error": {
        "message": "Illegal move: placement must bracket opponent discs",
        "actionType": "place_disc",
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
