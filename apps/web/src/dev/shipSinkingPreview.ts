import { BATTLESHIP_FLEET } from "@llmgames/game-catalog";
import type { ClientView } from "@/domain/game-state";

/** Fixed after-action fixtures for inspecting sink feedback. Never used by a live room. */
export function previewSinking(view: ClientView, count: number) {
  if (!count || view.type !== "battleship") return;
  const watching = Array.isArray(view.spectatorBoards);

  const boards = watching ? view.spectatorBoards! : [view.yourBoard, view.opponent];

  const examples = [
    { board: 1, id: "cruiser", row: 4, col: 3, rotation: 0 },
    { board: 0, id: "destroyer", row: 2, col: 7, rotation: 90 },
  ];

  const log = [...(view.shotLog ?? [])];

  for (const example of examples.slice(0, Math.min(count, 2))) {
    const sea = boards[example.board];

    if (!sea) continue;
    const spec = BATTLESHIP_FLEET.find((ship) => ship.id === example.id)!;
    const wreck = { ...spec, ...example, sunk: true };

    const cells = spec.shape.map(({ dr, dc }) => ({
      row: example.row + (example.rotation === 90 ? dc : dr),
      col: example.col + (example.rotation === 90 ? -dr : dc),
    }));

    sea.sunkShips = [wreck];
    sea.shipsRemaining = 4;
    sea.ships = sea.ships?.map((ship) => ({ ...ship, sunk: ship.id === example.id }));
    const field = !watching && example.board === 0 ? "incomingHits" : "hits";
    sea[field] = [
      ...(sea[field] ?? []).filter(
        (point) => !cells.some((cell) => cell.row === point.row && cell.col === point.col),
      ),
      ...cells,
    ];
    log.push({
      ...cells[cells.length - 1]!,
      sequence: Math.max(0, ...log.map((shot) => shot.sequence ?? 0)) + 1,
      hit: true,
      weapon: "cannon",
      sunkShipId: example.id,
      byPlayerId: view.players?.[example.board === 0 ? 1 : 0]?.id ?? "",
    });
  }

  view.shotLog = log;
  view.lastAnnouncement = count === 1 ? "Cruiser sunk. Fire again!" : "Destroyer sunk. Fire again!";
}
