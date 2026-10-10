export const rules = {
  connect4: [
    "Take your seat. Two players share a board with seven columns and six rows.",
    "Drop a disc. Choose a column with an open space. Your disc falls to the lowest available row.",
    "Alternate turns. Watch your opponent’s lines while building your own.",
    "Connect four. Four of your discs in a horizontal, vertical, or diagonal line wins the game.",
    "Fill the board. If neither player connects four before the board fills, the game is a draw.",
  ],
  checkers: [
    "Start with twelve pieces each. Black moves first, toward the top of the board. White moves toward the bottom.",
    "Move diagonally. Men move one square forward on dark squares. Kings can also move backward.",
    "Take the jump. Captures are mandatory. Jump over an adjacent opposing piece into the empty square beyond it.",
    "Finish the chain. Keep jumping with the same piece while another capture is available. You may choose any available capture path.",
    "Crown a king. Reach the far row to become a king. Crowning ends your turn, even if the new king could jump again.",
    "Win by capturing or blocking every opposing piece. Three repeated positions or 80 turns without a capture or man move draws.",
  ],
  reversi: [
    "Start at the center. The board opens with four discs. Black moves first.",
    "Bracket an opponent. Place a disc that traps at least one opposing disc between your new disc and another of your discs.",
    "Flip every line. All bracketed horizontal, vertical, and diagonal lines turn your color.",
    "Pass when blocked. If you have no legal placement, play passes automatically.",
    "Count the discs. When neither player can move, the player with more discs wins. Equal counts are a draw.",
  ],
  pokemon: [
    "Meet your team. Each player receives six random original-generation Pokémon.",
    "Choose an action. Select an available move or switch to a teammate using the choices shown.",
    "Lock your decision. Both players’ choices stay sealed until they resolve together.",
    "Replace a fainted Pokémon. Choose an available teammate when a replacement is required. This decision receives a fresh timer.",
    "Win the battle. Knock out all six opposing Pokémon before your own team is defeated.",
  ],
  codenames: [
    "Build the key. The 25 words hide 9 starting-team agents, 8 opposing agents, 7 bystanders, and 1 assassin.",
    "Take team roles. Red and blue each receive one spymaster who sees the key and at least one operative who sees only revealed identities.",
    "Give a legal clue. The active spymaster says one word plus one number. It must concern word meaning, not spelling, grid position, or other table information.",
    "Guess one at a time. Operatives must reveal at least one word and may make up to the clue number plus one guesses while they keep finding their own agents.",
    "Resolve the card. Your agent continues the turn. A bystander or enemy agent ends it. The assassin loses the game immediately.",
    "Contact every agent. A team wins as soon as its last agent is revealed, even when the opposing team reveals that card by mistake.",
  ],
  poker: [
    "Take your seat. Two to six players start with 1,000 chips each. Opening blinds are 5 and 10.",
    "Read your hand. You receive two private cards. Five community cards arrive as the flop, turn, and river.",
    "Choose your wager. Check when nothing is owed, call to match, bet or raise to increase the wager, or fold to leave the hand.",
    "Play each street. Betting continues between community-card reveals. An all-in commits your remaining stack.",
    "Resolve the pot. The strongest five-card hand wins at showdown. If everyone else folds, the remaining player wins without a showdown.",
    "Continue the table. The button and blinds rotate. Unequal all-ins create separate side pots.",
  ],
  battleship: [
    "Place your fleet. Fit the five shaped ships on your 10 × 10 grid. Rotate them as needed, keep every cell on the board, and avoid overlap.",
    "Begin the battle. Fleet placement has a separate five-minute countdown. Missing fleets are placed automatically when it expires.",
    "Fire a cannon. Choose a cell on the enemy grid. A hit lets you fire again; a miss ends your turn.",
    "Build your supply. Gain 2 energy at the start of each battle turn and 1 energy each time any weapon hits a new cell of your fleet. Normal cannon shots are free.",
    "Choose a special. Plant a mine, attack a 2 × 2 area with a bomb, scan with radar, or launch a torpedo from an edge. You may reuse specials while you have enough energy, and your normal cannon shot stays available unless your bomb triggers a mine. The mine fires three return shots and ends your turn.",
    "Sink the fleet. Hit all 22 opposing ship cells to win. Score is separate from spendable energy.",
  ],
  contexto: [
    "Find the hidden word. Every accepted guess receives a rank across the full game dictionary.",
    "Follow lower ranks. Rank 1 is the secret word; rank 20 is closer than rank 2,000.",
    "Race together. Up to six players may guess at the same time.",
    "Keep your trail private. You see your own words; opponents see only your five best ranks.",
    "Use your 50 guesses carefully. Repeated and unknown words do not consume a guess.",
  ],
} satisfies Record<string, string[]>;

export const roomGuides = {
  connect4: {
    description: "Drop your discs into place. Build a line of four while blocking your opponent.",
    summary: "Two players · seven columns · four to win",
    notesTitle: "Turns & placement",
    notes: [
      ["Full columns", "Choose another column when all six spaces are occupied."],
      ["Turn timeout", "No disc is placed. Play passes to the other player."],
    ],
  },
  checkers: {
    description:
      "Jump opposing pieces and crown your kings. Capture or block every opposing piece to win.",
    summary: "Two players · American checkers · black moves first",
    notesTitle: "Jumps & clocks",
    notes: [
      [
        "Forced jumps",
        "Choose any available capture, then finish the chain with that piece. Crowning ends the turn.",
      ],
      [
        "Turn timeout",
        "One clock covers the entire jump chain. Running out of turn time loses the match.",
      ],
      [
        "Draws",
        "Match time expiry, threefold repetition, or 80 turns without a capture or man move ends in a draw.",
      ],
    ],
  },
  reversi: {
    description:
      "Bracket opposing discs and turn them your color. Finish with the larger share of the board.",
    summary: "Two players · 8 × 8 board · black moves first",
    notesTitle: "Legal moves & passing",
    notes: [
      [
        "Legal placement",
        "Every move must flip at least one opposing disc. Available placements are shown on the board.",
      ],
      [
        "Turn timeout",
        "No disc is placed. The opponent moves if able; if only you can move, you receive a fresh timer.",
      ],
    ],
  },
  pokemon: {
    description:
      "Six random Gen 1 Pokémon on each side. Pick your moves, make your switches, and outlast the opposing team.",
    summary: "Two players · random teams · Generation 1 rules",
    notesTitle: "Teams & decisions",
    notes: [
      [
        "Original rules",
        "No items, abilities, or team builder. Gen 1 uses one combined Special stat.",
      ],
      [
        "Turn timeout",
        "The server picks the first enabled move for a pending player, or the first available Pokémon when a replacement is required. Match time expiry is a draw.",
      ],
    ],
  },
  codenames: {
    description:
      "Two rival spymasters. One hidden key. Link your agents with one-word clues, avoid the assassin, and contact your whole team first.",
    summary: "Official competitive rules · two teams · one hidden key",
    notesTitle: "Clues & guessing",
    notes: [
      ["Visible words", "Do not use an unrevealed codename or a form of it."],
      ["Spymaster", "No extra hints, reactions, or explanations after giving the clue."],
      ["Stop", "After one guess, operatives may stop following any correct reveal."],
      ["Expert 0", "None of your agents relate to the clue. There is no guess cap."],
      ["Expert unlimited", "At least one agent relates to the clue. There is no guess cap."],
      [
        "Turn timeout",
        "The team’s turn ends without revealing a card. Correct guesses do not restart the timer.",
      ],
    ],
  },
  poker: {
    description:
      "Two private cards, five community cards, and a table of rivals. Build the best hand or make the others fold.",
    summary: "No-limit Texas Hold’em · two to six seats · side pots",
    notesTitle: "Wagers & showdown",
    notes: [
      ["Private cards", "You see only your own hole cards until showdown."],
      ["Side pots", "An all-in player can win only the pots they contributed to."],
      ["Turn timeout", "Your hand checks when nothing is owed; otherwise it folds."],
    ],
  },
  battleship: {
    description:
      "Hide your shaped fleet, search the enemy waters, and spend your munition points on the right attack.",
    summary: "Two players · two 10 × 10 grids · 22 ship cells",
    notesTitle: "Weapons & timers",
    notes: [
      [
        "Mine · 2 pts",
        "Place in your own empty, unattacked water. When shot, it returns three random shots at the opponent.",
      ],
      ["Radar · 3 pts", "Reveal the number of ship cells in a 3 × 3 area without damaging them."],
      [
        "Bomb · 5 pts",
        "Attack four cells in a 2 × 2 square. Choose its top-left cell. Triggering a mine fires its return shots and ends your turn.",
      ],
      [
        "Torpedo · 7 pts",
        "Launch from the edge along a row or column. It stops at the first ship hit.",
      ],
      ["Turn timeout", "No weapon fires. Battle play passes to the opponent."],
    ],
  },
  contexto: {
    description:
      "Chase a hidden word through semantic ranks. Your words stay private while the room watches everyone get warmer.",
    summary: "One to six players · simultaneous guesses · 50 guesses each",
    notesTitle: "Ranks & privacy",
    notes: [
      [
        "Rank, not percent",
        "Every word has one position in the secret word’s ordered semantic neighborhood. Lower is closer; rank 1 wins.",
      ],
      [
        "Blinded rivals",
        "Other players see your five closest ranks, never the words that produced them.",
      ],
      [
        "Guess limit",
        "Each player receives 50 unique accepted guesses. Unknown and repeated words are rejected without using one.",
      ],
    ],
  },
} satisfies Record<
  string,
  { description: string; summary: string; notesTitle: string; notes: [string, string][] }
>;
