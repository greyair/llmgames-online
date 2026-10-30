/**
 * Frozen transcript of the pre-plugin Connect4Room.
 *
 * Captured from the M2 implementation (base commit 7ba5c8b) before the M3.2
 * migration so the plugin-driven room can be compared action by action:
 * identical board, turn order, legal actions, result and refusal message for
 * the same intent sequence. Timestamps, timer remainders and room ids are not
 * part of the transcript because they are platform-owned, not rule output.
 */

export interface Connect4TranscriptStep {
  label: string;
  board: readonly string[];
  status: string;
  phase: string;
  turnNumber: number;
  currentSeat: number | null;
  winner: number | "draw" | null;
  lastMove: { col: number; row: number; seat: number } | null;
  views: ReadonlyArray<{ role: string | null; legalActions: readonly string[] }>;
}

export interface Connect4TranscriptRejection {
  label: string;
  status: number;
  ok: boolean | undefined;
  /** Full public error envelope: the browser localizes `code`, MCP clients read `message`. */
  error?: { message: string; code?: string; actionType?: string; category?: string; recovery?: string };
}

export interface Connect4Transcript {
  steps: Connect4TranscriptStep[];
  rejections: Connect4TranscriptRejection[];
}

export const CONNECT4_GOLDEN: Connect4Transcript = {
  "steps": [
    {
      "label": "start",
      "board": [
        "0000000",
        "0000000",
        "0000000",
        "0000000",
        "0000000",
        "0000000"
      ],
      "status": "playing",
      "phase": "play",
      "turnNumber": 1,
      "currentSeat": 1,
      "winner": null,
      "lastMove": null,
      "views": [
        {
          "role": "player1",
          "legalActions": [
            "leave",
            "end_game",
            "drop_disc"
          ]
        },
        {
          "role": "player2",
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "seat1:col0",
      "board": [
        "0000000",
        "0000000",
        "0000000",
        "0000000",
        "0000000",
        "1000000"
      ],
      "status": "playing",
      "phase": "play",
      "turnNumber": 2,
      "currentSeat": 2,
      "winner": null,
      "lastMove": {
        "col": 0,
        "row": 5,
        "seat": 1
      },
      "views": [
        {
          "role": "player1",
          "legalActions": [
            "leave",
            "end_game"
          ]
        },
        {
          "role": "player2",
          "legalActions": [
            "leave",
            "drop_disc"
          ]
        }
      ]
    },
    {
      "label": "seat2:col0",
      "board": [
        "0000000",
        "0000000",
        "0000000",
        "0000000",
        "2000000",
        "1000000"
      ],
      "status": "playing",
      "phase": "play",
      "turnNumber": 3,
      "currentSeat": 1,
      "winner": null,
      "lastMove": {
        "col": 0,
        "row": 4,
        "seat": 2
      },
      "views": [
        {
          "role": "player1",
          "legalActions": [
            "leave",
            "end_game",
            "drop_disc"
          ]
        },
        {
          "role": "player2",
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "seat1:col1",
      "board": [
        "0000000",
        "0000000",
        "0000000",
        "0000000",
        "2000000",
        "1100000"
      ],
      "status": "playing",
      "phase": "play",
      "turnNumber": 4,
      "currentSeat": 2,
      "winner": null,
      "lastMove": {
        "col": 1,
        "row": 5,
        "seat": 1
      },
      "views": [
        {
          "role": "player1",
          "legalActions": [
            "leave",
            "end_game"
          ]
        },
        {
          "role": "player2",
          "legalActions": [
            "leave",
            "drop_disc"
          ]
        }
      ]
    },
    {
      "label": "seat2:col1",
      "board": [
        "0000000",
        "0000000",
        "0000000",
        "0000000",
        "2200000",
        "1100000"
      ],
      "status": "playing",
      "phase": "play",
      "turnNumber": 5,
      "currentSeat": 1,
      "winner": null,
      "lastMove": {
        "col": 1,
        "row": 4,
        "seat": 2
      },
      "views": [
        {
          "role": "player1",
          "legalActions": [
            "leave",
            "end_game",
            "drop_disc"
          ]
        },
        {
          "role": "player2",
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "seat1:col2",
      "board": [
        "0000000",
        "0000000",
        "0000000",
        "0000000",
        "2200000",
        "1110000"
      ],
      "status": "playing",
      "phase": "play",
      "turnNumber": 6,
      "currentSeat": 2,
      "winner": null,
      "lastMove": {
        "col": 2,
        "row": 5,
        "seat": 1
      },
      "views": [
        {
          "role": "player1",
          "legalActions": [
            "leave",
            "end_game"
          ]
        },
        {
          "role": "player2",
          "legalActions": [
            "leave",
            "drop_disc"
          ]
        }
      ]
    },
    {
      "label": "seat2:col2",
      "board": [
        "0000000",
        "0000000",
        "0000000",
        "0000000",
        "2220000",
        "1110000"
      ],
      "status": "playing",
      "phase": "play",
      "turnNumber": 7,
      "currentSeat": 1,
      "winner": null,
      "lastMove": {
        "col": 2,
        "row": 4,
        "seat": 2
      },
      "views": [
        {
          "role": "player1",
          "legalActions": [
            "leave",
            "end_game",
            "drop_disc"
          ]
        },
        {
          "role": "player2",
          "legalActions": [
            "leave"
          ]
        }
      ]
    },
    {
      "label": "seat1:col3",
      "board": [
        "0000000",
        "0000000",
        "0000000",
        "0000000",
        "2220000",
        "1111000"
      ],
      "status": "ended",
      "phase": "ended",
      "turnNumber": 7,
      "currentSeat": 1,
      "winner": 1,
      "lastMove": {
        "col": 3,
        "row": 5,
        "seat": 1
      },
      "views": [
        {
          "role": "player1",
          "legalActions": [
            "leave"
          ]
        },
        {
          "role": "player2",
          "legalActions": [
            "leave"
          ]
        }
      ]
    }
  ],
  "rejections": [
    {
      "label": "ended:extra-move",
      "status": 409,
      "ok": false,
      "error": {
        "message": "Game is not playing",
        "actionType": "drop_disc",
        "code": "WRONG_PHASE",
        "category": "state",
        "recovery": "wait_for_phase"
      }
    },
    {
      "label": "legacy:out-of-turn",
      "status": 409,
      "ok": false,
      "error": {
        "message": "Not your turn",
        "actionType": "drop_disc",
        "code": "NOT_YOUR_TURN",
        "category": "state",
        "recovery": "wait_for_turn"
      }
    },
    {
      "label": "legacy:column-7",
      "status": 400,
      "ok": false,
      "error": {
        "message": "Column must be integer 0–6",
        "actionType": "drop_disc",
        "code": "INVALID_ACTION_DATA",
        "category": "input",
        "recovery": "correct_input"
      }
    },
    {
      "label": "legacy:column-99",
      "status": 400,
      "ok": false,
      "error": {
        "message": "Column must be integer 0–6",
        "actionType": "drop_disc",
        "code": "INVALID_ACTION_DATA",
        "category": "input",
        "recovery": "correct_input"
      }
    },
    {
      "label": "legacy:float",
      "status": 400,
      "ok": false,
      "error": {
        "message": "Column must be integer 0–6",
        "actionType": "drop_disc",
        "code": "INVALID_ACTION_DATA",
        "category": "input",
        "recovery": "correct_input"
      }
    },
    {
      "label": "legacy:missing-data",
      "status": 400,
      "ok": false,
      "error": {
        "message": "Column must be integer 0–6",
        "actionType": "drop_disc",
        "code": "INVALID_ACTION_DATA",
        "category": "input",
        "recovery": "correct_input"
      }
    },
    {
      "label": "legacy:unknown-action",
      "status": 400,
      "ok": false,
      "error": {
        "message": "Unknown action: teleport",
        "actionType": "teleport",
        "code": "UNSUPPORTED_ACTION",
        "category": "scope",
        "recovery": "correct_action"
      }
    },
    {
      "label": "legacy:alias-drop",
      "status": 200,
      "ok": true
    },
    {
      "label": "legacy:alias-column",
      "status": 409,
      "ok": false,
      "error": {
        "message": "Not your turn",
        "actionType": "drop_disc",
        "code": "NOT_YOUR_TURN",
        "category": "state",
        "recovery": "wait_for_turn"
      }
    },
    {
      "label": "legacy:full-column",
      "status": 409,
      "ok": false,
      "error": {
        "message": "Column is full",
        "actionType": "drop_disc",
        "code": "ALREADY_RESOLVED",
        "category": "state",
        "recovery": "refresh_state"
      }
    }
  ]
};
