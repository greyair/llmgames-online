import { BATTLESHIP_FLEET } from "@llmgames/game-catalog";
import type { ClientView } from "@/domain/game-state";

export function previewSeat(index: number, name: string) {
  const id = `preview-${index}`;

  if (index !== 1) return { id, name, ownerGamertag: name };

  return {
    id,
    name: "BrightRook",
    isAgent: true as const,
    codename: "BrightRook",
    environmentLabel: "Codex",
    ownerGamertag: name,
  };
}

const players = ["Alex", "Mika", "Jules", "Sam", "Casey", "Robin"].map((name, i) =>
  previewSeat(i, name),
);

export function fixture(type: string): ClientView {
  const base: ClientView = {
    type,
    status: "playing",
    players: players.slice(0, 2),
    gameTimeRemaining: 1180000,
    turnState: {
      phase: "play",
      turnNumber: 4,
      currentPlayerId: "preview-0",
      turnTimeRemaining: 45000,
    },
    you: { playerId: "preview-0", isYourTurn: true, seat: 1, legalActions: [] },
    seats: { "preview-0": 1, "preview-1": 2 },
  };

  if (type === "battleship" || type === "placement") {
    base.fleet = BATTLESHIP_FLEET;
    base.munitionEconomy = { turnReward: 2, costs: { mine: 2, radar: 3, bomb: 5, torpedo: 7 } };
  }

  if (type === "connect4")
    return {
      ...base,
      board: [
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 2, 0, 0, 0],
        [0, 0, 1, 2, 0, 0, 0],
        [0, 1, 2, 1, 0, 0, 0],
      ],
      you: { ...base.you, legalActions: ["drop_disc"] },
    };

  if (type === "checkers") {
    const board = Array.from({ length: 8 }, (_, r) =>
      Array.from({ length: 8 }, (_, c) => ((r + c) % 2 === 0 ? 0 : r < 3 ? 2 : r > 4 ? 1 : 0)),
    );

    return {
      ...base,
      board,
      scores: { 1: 12, 2: 12 },
      forcedPiece: null,
      legalMoves: [
        { fromRow: 5, fromCol: 0, row: 4, col: 1, capture: null },
        { fromRow: 5, fromCol: 2, row: 4, col: 1, capture: null },
        { fromRow: 5, fromCol: 2, row: 4, col: 3, capture: null },
        { fromRow: 5, fromCol: 4, row: 4, col: 3, capture: null },
        { fromRow: 5, fromCol: 4, row: 4, col: 5, capture: null },
        { fromRow: 5, fromCol: 6, row: 4, col: 5, capture: null },
        { fromRow: 5, fromCol: 6, row: 4, col: 7, capture: null },
      ],
      you: { ...base.you, legalActions: ["move_checker"] },
    };
  }

  if (type === "reversi") {
    const board = Array.from({ length: 8 }, () => Array<number>(8).fill(0));
    board[3]![3] = 2;
    board[4]![4] = 2;
    board[3]![4] = 1;
    board[4]![3] = 1;

    return {
      ...base,
      board,
      scores: { 1: 2, 2: 2 },
      legalMoves: [
        { row: 2, col: 3, flipCount: 1 },
        { row: 3, col: 2, flipCount: 1 },
        { row: 4, col: 5, flipCount: 1 },
        { row: 5, col: 4, flipCount: 1 },
      ],
      you: { ...base.you, legalActions: ["place_disc"] },
    };
  }

  if (type === "codenames")
    return {
      ...base,
      players: players.slice(0, 4),
      seats: undefined,
      turnState: { ...base.turnState!, phase: "guess" },
      activeTeam: "red",
      clue: { word: "Orbit", count: 2, givenBy: "preview-1" },
      remaining: { red: 8, blue: 8 },
      guessesRemaining: 3,
      assignments: {
        "preview-0": { team: "red", role: "operative" },
        "preview-1": { team: "red", role: "spymaster" },
        "preview-2": { team: "blue", role: "operative" },
        "preview-3": { team: "blue", role: "spymaster" },
      },
      board:
        "MOON GLASS SHIP NIGHT KEY BIRD WAVE PAPER STAR KING RING SNOW LIGHT GOLD LEAF TRAIN FIRE BRIDGE FISH CLOUD SATELLITE MOUNTAIN CLOCK SPACE FIELD"
          .split(" ")
          .map((word, index) => ({
            index,
            word,
            affiliation: index === 4 ? "red" : null,
            revealed: index === 4,
          })),
      you: { ...base.you, team: "red", role: "operative", legalActions: ["guess_word"] },
    };

  if (type === "poker")
    return {
      ...base,
      players,
      turnState: { ...base.turnState!, phase: "flop" },
      maxPlayers: 6,
      ...{ currentBet: 25, minRaise: 10 },
      pot: 150,
      bigBlind: 10,
      toCall: 10,
      community: [
        { rank: "A", suit: "S" },
        { rank: "8", suit: "H" },
        { rank: "K", suit: "D" },
      ],
      seats: players.map((p, i) => ({
        playerId: p.id,
        name: p.name,
        stack: 975,
        streetBet: i === 0 ? 15 : 25,
        hole:
          i === 0
            ? [
                { rank: "A", suit: "H" },
                { rank: "Q", suit: "S" },
              ]
            : [
                { rank: "?", suit: "S", hidden: true },
                { rank: "?", suit: "S", hidden: true },
              ],
        folded: false,
        allIn: false,
      })),
      you: { ...base.you, legalActions: ["fold", "call", "raise"], stack: 975 },
    };

  if (type === "pokemon")
    return {
      ...base,
      battleLog: [
        "|switch|p1a: Charizard|Charizard, L80|300/300",
        "|switch|p2a: Blastoise|Blastoise, L80|100/100",
        "|turn|3",
        "|move|p1a: Charizard|Slash|p2a: Blastoise",
        "|-damage|p2a: Blastoise|70/100",
        "|move|p2a: Blastoise|Surf|p1a: Charizard",
        "|-damage|p1a: Charizard|240/300",
        "|turn|4",
      ],
      battleTurn: 4,
      turnState: { ...base.turnState!, phase: "battle" },
      sides: [
        {
          seat: "p1",
          pokemon: ["charizard", "snorlax", "lapras", "alakazam", "gengar", "tauros"].map(
            (sprite, i) => ({
              sprite,
              name: sprite[0]!.toUpperCase() + sprite.slice(1),
              active: i === 0,
              level: 80,
              condition: ["240/300", "410/460", "130/360", "200/220", "0 fnt", "275/300"][i],
              fainted: i === 4,
              stats: i === 0 ? { atk: 210, def: 190, spa: 240, spe: 250 } : undefined,
              boosts: i === 0 ? { atk: 2 } : undefined,
              types: [
                ["Fire", "Flying"],
                ["Normal"],
                ["Water", "Ice"],
                ["Psychic"],
                ["Ghost", "Poison"],
                ["Normal"],
              ][i],
              moves: [
                { name: i === 0 ? "Flamethrower" : "Body Slam", pp: 15, maxpp: 15 },
                { name: i === 0 ? "Slash" : "Rest", pp: 10, maxpp: 10 },
              ],
              revealedMoves: i === 0 ? ["Slash"] : [],
            }),
          ),
        },
        {
          seat: "p2",
          pokemon: [
            {
              sprite: "blastoise",
              name: "Blastoise",
              active: true,
              level: 80,
              condition: "70/100",
              types: ["Water"],
              revealedMoves: ["Surf"],
            },
            ...Array.from({ length: 5 }, () => ({ hidden: true })),
          ],
        },
      ],
      decision: {
        forceSwitch: false,
        moves: [
          {
            slot: 1,
            name: "Flamethrower",
            sameTypeBonus: true,
            typeMatchup: 0.5,
            matchupTarget: "Blastoise",
            category: "Special",
            power: 95,
            accuracy: 100,
            description: "10% chance to burn the target.",
            type: "Fire",
            pp: 15,
            maxpp: 15,
            disabled: false,
          },
          {
            slot: 2,
            name: "Slash",
            sameTypeBonus: false,
            typeMatchup: 1,
            matchupTarget: "Blastoise",
            category: "Physical",
            power: 70,
            accuracy: 100,
            description: "High critical hit ratio.",
            type: "Normal",
            pp: 20,
            maxpp: 20,
            disabled: false,
          },
          {
            slot: 3,
            name: "Earthquake",
            sameTypeBonus: false,
            typeMatchup: 1,
            matchupTarget: "Blastoise",
            category: "Physical",
            power: 100,
            accuracy: 100,
            description: "No additional effect.",
            type: "Ground",
            pp: 10,
            maxpp: 10,
            disabled: false,
          },
          {
            slot: 4,
            name: "Swords Dance",
            category: "Status",
            power: 0,
            accuracy: true,
            description: "Raises the user's Attack by 2.",
            type: "Normal",
            pp: 20,
            maxpp: 20,
            disabled: false,
          },
        ],
        switches: ["Snorlax", "Lapras", "Alakazam", "Gengar", "Tauros"].flatMap((name, i) =>
          name === "Gengar" ? [] : [{ name, slot: i + 2 }],
        ),
      },
      you: { ...base.you, legalActions: ["pokemon_move", "pokemon_switch"] },
    };

  if (type === "placement")
    return {
      ...base,
      type: "battleship",
      turnState: { ...base.turnState!, phase: "placement", turnTimeRemaining: 285000 },
      yourBoard: { ready: false, ships: [] },
      opponent: { ready: false },
      you: { ...base.you, legalActions: ["place_fleet"] },
    };

  if (type === "battleship")
    return {
      ...base,
      radarScans: [
        { row: 0, col: 0, shipCells: 0, cellsScanned: 4 },
        { row: 4, col: 4, shipCells: 2, cellsScanned: 9 },
        { row: 5, col: 5, shipCells: 1, cellsScanned: 9 },
      ],
      shotLog: [
        { sequence: 1, row: 2, col: 2, hit: false, byPlayerId: "preview-0", weapon: "cannon" },
        { sequence: 2, row: 0, col: 0, hit: false, byPlayerId: "preview-1", weapon: "cannon" },
        { sequence: 3, row: 4, col: 3, hit: true, byPlayerId: "preview-0", weapon: "cannon" },
        { sequence: 4, row: 6, col: 6, hit: false, byPlayerId: "preview-0", weapon: "cannon" },
      ],
      turnState: { ...base.turnState!, phase: "battle" },
      yourBoard: {
        ready: true,
        mines: [{ row: 9, col: 8 }],
        cells: previewShipCells(),
        munitionPoints: 3,
        ships: [
          { id: "carrier", row: 1, col: 1, rotation: 0 },
          { id: "dreadnought", row: 4, col: 2, rotation: 0 },
          { id: "cruiser", row: 7, col: 0, rotation: 0 },
          { id: "submarine", row: 7, col: 5, rotation: 0 },
          { id: "destroyer", row: 2, col: 7, rotation: 90 },
        ],
        incomingHits: [],
        incomingMisses: [{ row: 0, col: 0 }],
        shipsRemaining: 5,
      },
      opponent: {
        playerId: "preview-1",
        ready: true,
        hits: [{ row: 4, col: 3 }],
        misses: [
          { row: 2, col: 2 },
          { row: 6, col: 6 },
        ],
        shipsRemaining: 5,
      },
      you: { ...base.you, legalActions: ["cannon", "mine", "bomb", "radar"] },
    };

  if (type === "contexto") {
    const contextoPlayers = players.slice(0, 6);

    return {
      ...base,
      players: contextoPlayers,
      maxPlayers: 6,
      guessLimit: 50,
      vocabularySize: 12000,
      totalGuesses: 47,
      turnState: {
        ...base.turnState!,
        phase: "guessing",
        currentPlayerId: null,
        turnNumber: 47,
        turnTimeRemaining: 530000,
      },
      timerConfig: { gameTotalTime: 900000, turnTime: 900000 },
      progress: Object.fromEntries(
        contextoPlayers.map((player, index) => [
          player.id,
          index === 0
            ? {
                playerId: player.id,
                guessCount: 9,
                guessesRemaining: 41,
                bestRank: 18,
                exhausted: false,
                guesses: [
                  { word: "water", rank: 18, sequence: 9 },
                  { word: "boat", rank: 137, sequence: 8 },
                  { word: "river", rank: 824, sequence: 7 },
                  { word: "mountain", rank: 4820, sequence: 6 },
                  { word: "computer", rank: 10341, sequence: 5 },
                ],
              }
            : {
                playerId: player.id,
                guessCount: [12, 7, 10, 4, 5][index - 1]!,
                guessesRemaining: 50 - [12, 7, 10, 4, 5][index - 1]!,
                bestRank: [9, 64, 221, 1402, 3310][index - 1]!,
                exhausted: false,
                guesses: [9, 64, 221, 1402, 3310]
                  .slice(index - 1, index + 2)
                  .map((rank) => ({ rank, masked: true })),
              },
        ]),
      ),
      you: { ...base.you, isYourTurn: true, legalActions: ["guess_word"] },
    };
  }

  return base;
}

function previewShipCells() {
  const board = Array.from({ length: 10 }, () => Array<string | null>(10).fill(null));

  const placements = [
    { id: "carrier", row: 1, col: 1, rotation: 0 },
    { id: "dreadnought", row: 4, col: 2, rotation: 0 },
    { id: "cruiser", row: 7, col: 0, rotation: 0 },
    { id: "submarine", row: 7, col: 5, rotation: 0 },
    { id: "destroyer", row: 2, col: 7, rotation: 90 },
  ];

  for (const ship of placements)
    for (const { dr, dc } of BATTLESHIP_FLEET.find((spec) => spec.id === ship.id)!.shape) {
      const row = ship.row + (ship.rotation === 90 ? dc : dr),
        col = ship.col + (ship.rotation === 90 ? -dr : dc);

      board[row]![col] = ship.id;
    }

  return board;
}
