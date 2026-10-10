import { roomTestEnv } from "./room-env";
import { Battle, Teams, toID } from "@pkmn/sim";
import { createGameRoomFixture } from "./game-room";
import { Connect4Room } from "../../durable-objects/Connect4Room";
import { CheckersRoom } from "../../durable-objects/CheckersRoom";
import { ReversiRoom } from "../../durable-objects/ReversiRoom";
import { CodenamesGameRoom } from "../../durable-objects/CodenamesGameRoom";
import { PokerRoom } from "../../durable-objects/PokerRoom";
import { PokemonRoom } from "../../durable-objects/PokemonRoom";
import { ContextoRoom } from "../../durable-objects/ContextoRoom";
import { createContextoRanking } from "../../lib/contextoRanks";

/** Deterministic examples passed through each real room's private-seat projection. */
export async function otherGameExamples() {
  const originalNow = Date.now;
  Date.now = () => 1_800_000_000_000;

  try {
    const environment = roomTestEnv();
    const connect4 = await createGameRoomFixture(Connect4Room, "connect4", 2, environment);
    const checkers = await createGameRoomFixture(CheckersRoom, "checkers", 2, environment);
    const reversi = await createGameRoomFixture(ReversiRoom, "reversi", 2, environment);

    for (const game of [connect4, checkers, reversi]) {
      game.state().seats = { [game.ids[0]!]: 1, [game.ids[1]!]: 2 };
      game.state().turnState.currentPlayerId = game.ids[0]!;
    }

    for (const col of [0, 1, 2, 1, 3, 4])
      await connect4.action(connect4.state().turnState.currentPlayerId!, "drop_disc", { col });

    const pokemon = await createGameRoomFixture(PokemonRoom, "pokemon", 2, environment);
    const battle = new Battle({ formatid: toID("gen1randombattle"), seed: "1,2,3,4" });

    for (const [index, seat] of (["p1", "p2"] as const).entries()) {
      battle.setPlayer(seat, {
        name: seat,
        team: Teams.generate("gen1randombattle", { seed: `${11 + index},22,33,44` }),
      });
    }

    pokemon.state().battleSnapshot = JSON.stringify(battle.toJSON());

    const codenames = await createGameRoomFixture(CodenamesGameRoom, "codenames", 4, environment);
    const code = codenames.state();

    const words = [
      "ANCHOR",
      "MOON",
      "BRIDGE",
      "PAPER",
      "RING",
      "WAVE",
      "LION",
      "GLASS",
      "TRAIN",
      "LEAF",
      "STAR",
      "BANK",
      "PLANE",
      "SNOW",
      "MOUSE",
      "BELL",
      "CROWN",
      "FISH",
      "WALL",
      "ROOT",
      "LIGHT",
      "KEY",
      "ROSE",
      "SHIP",
      "CLOCK",
    ];

    code.board = words.map((word, index) => ({
      index,
      word,
      revealed: false,
      revealedBy: null,
      affiliation: index === 24 ? "assassin" : index < 9 ? "red" : index < 17 ? "blue" : "neutral",
    }));
    code.assignments = {
      [codenames.ids[0]!]: { team: "red", role: "operative" },
      [codenames.ids[1]!]: { team: "red", role: "spymaster" },
      [codenames.ids[2]!]: { team: "blue", role: "operative" },
      [codenames.ids[3]!]: { team: "blue", role: "spymaster" },
    };
    code.activeTeam = code.startingTeam = "red";
    code.remaining = { red: 9, blue: 8 };
    code.turnState.currentPlayerId = codenames.ids[1]!;
    code.turnState.phase = "clue";
    await codenames.action(codenames.ids[1]!, "give_clue", { word: "space", count: 1 });

    const poker = await createGameRoomFixture(PokerRoom, "poker", 2, environment);
    await poker.action(poker.state().actionPlayerId!, "call");
    await poker.action(poker.state().actionPlayerId!, "check");
    const cards = poker.state();
    cards.community = [
      { rank: "K", suit: "H" },
      { rank: "7", suit: "C" },
      { rank: "2", suit: "D" },
    ];
    cards.seats[0]!.hole = [
      { rank: "A", suit: "S" },
      { rank: "K", suit: "S" },
    ];
    cards.seats[1]!.hole = [
      { rank: "Q", suit: "D" },
      { rank: "J", suit: "C" },
    ];

    const contexto = await createGameRoomFixture(ContextoRoom, "contexto", 2, environment);
    contexto.state().secret = "dog";
    contexto.state().rankTable = createContextoRanking("dog")!;

    for (const word of ["animal", "cat", "pet"])
      await contexto.action(contexto.ids[0]!, "guess_word", { word });

    return {
      connect4: await connect4.view(),
      checkers: await checkers.view(),
      reversi: await reversi.view(),
      pokemon: await pokemon.view(),
      codenames: await codenames.view(),
      poker: await poker.view(cards.actionPlayerId!),
      contexto: await contexto.view(),
    };
  } finally {
    Date.now = originalNow;
  }
}
