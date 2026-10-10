import { useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { Chrome } from "@/interface/Chrome";
import { GameMark } from "@/interface/GameMark";
import { visibleGames } from "@/interface/catalog";
import { PlayerRow } from "@/game-ui/MatchDesk";
import { HoleyLoader } from "@/components/ui/holey-loader";
import "./preview.css";

const greys = [
  "--palette-white",
  "--palette-g50",
  "--palette-g100",
  "--palette-g150",
  "--palette-g300",
  "--palette-g550",
  "--palette-g800",
  "--palette-g950",
] as const;

const hazes = [
  ["--palette-tangerine", "Tangerine"],
  ["--palette-pink", "Pink"],
  ["--palette-sky", "Sky"],
  ["--palette-grass", "Grass"],
  ["--palette-sun", "Sun"],
] as const;

export function ComponentsPreview() {
  const [result, setResult] = useState("Ready for your move."),
    [code, setCode] = useState(""),
    [error, setError] = useState(false),
    [sound, setSound] = useState(true),
    [pace, setPace] = useState("60s");

  return (
    <Chrome>
      <header className="component-heading">
        <div>
          <h1>Game essentials</h1>
          <p>
            Ink controls with soft pastel accents. Strong color comes from the games and the people
            playing them.
          </p>
        </div>
        <Badge>Component preview</Badge>
      </header>
      <div className="component-grid">
        <Card>
          <CardContent>
            <CardTitle>Actions</CardTitle>
            <div className="component-row">
              <Button onClick={() => setResult("Play selected")}>
                <Icon name="play" size={17} />
                Play
              </Button>
              <Button variant="secondary" onClick={() => setResult("Watch selected")}>
                <Icon name="watch" size={18} />
                Watch
              </Button>
              <Button variant="outline" onClick={() => setResult("Invite selected")}>
                Invite <Icon name="arrow" size={16} />
              </Button>
            </div>
            <div className="component-row">
              <Button variant="success" onClick={() => setResult("Ready selected")}>
                <Icon name="check" size={17} />
                Ready
              </Button>
              <Button variant="destructive" onClick={() => setResult("Leave selected")}>
                Leave
              </Button>
              <Button variant="ghost" onClick={() => setResult("Back selected")}>
                Back
              </Button>
            </div>
            <div className="component-row">
              <Button disabled>Unavailable</Button>
              <Button disabled aria-busy="true">
                <Icon name="clock" size={16} />
                Joining
              </Button>
            </div>
            <output className="component-result" aria-live="polite">
              {result}
            </output>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CardTitle>Sizes</CardTitle>
            <div className="component-row">
              <Button size="sm" onClick={() => setResult("Small selected")}>
                Small
              </Button>
              <Button onClick={() => setResult("Medium selected")}>Medium</Button>
              <Button size="lg" onClick={() => setResult("Large selected")}>
                Large <Icon name="arrow" size={16} />
              </Button>
            </div>
            <div className="component-row">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setResult("Small secondary selected")}
              >
                Small
              </Button>
              <Button variant="secondary" onClick={() => setResult("Medium secondary selected")}>
                Medium
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => setResult("Large secondary selected")}
              >
                Large
              </Button>
            </div>
            <div className="component-row">
              {(["back", "watch", "agent", "players", "expand", "sound"] as const).map((name) => (
                <Button
                  key={name}
                  variant="secondary"
                  size="icon"
                  aria-label={`Preview ${name}`}
                  onClick={() => setResult(`${name} selected`)}
                >
                  <Icon name={name} />
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CardTitle>Join a room</CardTitle>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setError(!/^[A-Z0-9]{6}$/.test(code));

                if (/^[A-Z0-9]{6}$/.test(code)) setResult("Room code accepted in demo");
              }}
            >
              <label className="component-field">
                Room code
                <Input
                  value={code}
                  maxLength={6}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase());
                    setError(false);
                  }}
                  placeholder="e.g. ABC123"
                  aria-invalid={error}
                  aria-describedby="code-help"
                />
              </label>
              <p id="code-help" className={error ? "component-error" : "component-hint"}>
                {error
                  ? "Enter the six-character room code."
                  : "Ask the host for their six-character code."}
              </p>
              <div className="component-row component-row-separated">
                <Button type="submit">
                  Join room <Icon name="arrow" size={16} />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CardTitle>Match status</CardTitle>
            <div className="component-row">
              <Badge>Waiting</Badge>
              <Badge tone="live">Live</Badge>
              <Badge tone="warning">Your turn</Badge>
              <Badge tone="danger">Disconnected</Badge>
            </div>
            <div className="component-row">
              <span className="component-result-pill" data-result="win">
                Win
              </span>
              <span className="component-result-pill" data-result="loss">
                Loss
              </span>
              <span className="component-result-pill" data-result="draw">
                Draw
              </span>
            </div>
            <PlayerRow player={{ id: "demo-human", name: "Alex" }} index={0} active={true} />
            <PlayerRow
              player={{
                id: "demo-agent",
                name: "BrightRook",
                isAgent: true,
                codename: "BrightRook",
                environmentLabel: "Codex",
                ownerGamertag: "Mika",
              }}
              index={1}
              active={false}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CardTitle>Navigation</CardTitle>
            <Tabs defaultValue="play">
              <TabsList aria-label="Game sections">
                <TabsTrigger value="play">Play</TabsTrigger>
                <TabsTrigger value="watch">Watch</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="play">
                <p className="component-hint">Choose a game and invite your players.</p>
              </TabsContent>
              <TabsContent value="watch">
                <p className="component-hint">Follow a match as a spectator.</p>
              </TabsContent>
              <TabsContent value="history">
                <p className="component-hint">Your completed games appear here.</p>
              </TabsContent>
            </Tabs>
            <label className="component-switch-row">
              Sound effects
              <Switch
                checked={sound}
                onCheckedChange={setSound}
                aria-label="Preview sound effects"
              />
            </label>
            <fieldset className="segmented">
              <legend>Turn time</legend>
              {["30s", "60s", "90s", "150s"].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={pace === value}
                  onClick={() => setPace(value)}
                >
                  {value}
                </button>
              ))}
            </fieldset>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CardTitle>Confirm an action</CardTitle>
            <p className="component-hint">
              A focused dialog for leaving a match, with keyboard focus kept inside.
            </p>
            <div className="component-row component-row-separated">
              <Dialog>
                <DialogTrigger render={<Button variant="secondary" />}>Leave match</DialogTrigger>
                <DialogContent>
                  <DialogTitle>Leave this match?</DialogTitle>
                  <DialogDescription>
                    You can return while the room is still open.
                  </DialogDescription>
                  <div className="ui-dialog-actions">
                    <DialogClose render={<Button variant="secondary" />}>Stay</DialogClose>
                    <DialogClose
                      render={<Button variant="destructive" />}
                      onClick={() => setResult("Left the demo match")}
                    >
                      Leave
                    </DialogClose>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CardTitle>Notices &amp; loading</CardTitle>
            <p className="notice" data-tone="success">
              Saved. Your agent can join now.
            </p>
            <p className="notice">The room closes after five quiet minutes.</p>
            <p className="notice" data-tone="danger">
              That room code has expired.
            </p>
            <div className="component-row">
              <HoleyLoader label="Checking your account…" showLabel />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CardTitle>Players</CardTitle>
            <div className="component-row component-avatars">
              {["Alex", "BrightRook", "Mika", "SwiftAnchor", "Jev", "Sam"].map((name) => (
                <PlayerAvatar key={name} name={name} size={40} label={`${name} avatar`} />
              ))}
            </div>
            <div className="component-row component-marks">
              {visibleGames.map((game) => (
                <GameMark key={game.id} id={game.id} size={40} />
              ))}
            </div>
            <p className="component-hint">
              Avatars and game marks carry the strong color. Controls only borrow soft pastels.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CardTitle>Greys &amp; hazes</CardTitle>
            <div className="component-greys" aria-hidden="true">
              {greys.map((token) => (
                <i key={token} style={{ background: `var(${token})` }} />
              ))}
            </div>
            <div className="component-hazes">
              {hazes.map(([token, label]) => (
                <span
                  key={token}
                  className="component-haze"
                  style={
                    { "--haze": `var(${token})` } satisfies CSSProperties & {
                      [property: `--${string}`]: string | number | undefined;
                    }
                  }
                >
                  <i aria-hidden="true" />
                  {label}
                </span>
              ))}
            </div>
            <p className="component-numerals" aria-label="Pixel numerals">
              0123456789
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CardTitle>Text &amp; symbols</CardTitle>
            <div className="font-symbol-preview">
              <p>Pokémon · POKÉMON</p>
              <p>Nidoran♀ · Nidoran♂</p>
              <p>2× damage · −20 HP</p>
              <p>← → ↑ ↓</p>
            </div>
          </CardContent>
        </Card>
        <div className="empty-state component-empty">
          <Icon name="watch" size={28} />
          <h2>No games yet</h2>
          <p>Finished matches and replays will collect here.</p>
          <Button variant="secondary" onClick={() => setResult("Empty state action selected")}>
            Start a game
          </Button>
        </div>
      </div>
    </Chrome>
  );
}
