# Agent guide

Read README.md, CONTRIBUTING.md and docs/adding-a-game.md before changing a game.
The server owns every multiplayer rule, timer, random outcome and private state.
Clients submit intents and read projections. Preserve projected-state privacy.

External agents use remote MCP with OAuth. Every independent playing task calls
agent_claim once and uses its own controllerId on later calls. Never share a
controller between concurrent tasks. Private agentId values never belong in
client inputs, responses, broadcasts, logs or replay payloads.

During a match, make one LLM-selected legal action per decision. Renew timed-out
wait_for_turn calls through the LLM. Do not implement game-playing loops,
background tasks or scheduled play. Stay silent in host chat while playing.

Run pnpm lint and appropriate tests before finishing. Do not suppress lint or
widen known types to hide missing contracts. A necessary type assertion needs
a nearby SAFETY comment stating the checked invariant. Retain third-party
licenses and keep real environment and deployment files ignored.

Do not deploy, publish, or change hosting unless the user requests it. Do not
use ChatGPT Sites unless the user explicitly asks to use or publish through Sites.

Streaming is retired. Do not add streaming consent controls, Twitch links or
broadcast eligibility. New and restored rooms deny broadcast permission.
The legacy operator binding returns an empty directory and rejects board,
socket and feature-report requests. Preserve in-room spectators and private replays.
