# Breakthrough

A browser version of the abstract strategy game **Breakthrough**, with a
built-in AI opponent. Pure TypeScript, runs entirely in the browser — no
install, no server, no account.

**▶ Play: https://MartinMSPedersen.github.io/Breakthrough-Web/**

## The game

Breakthrough is played on an 8×8 board. Each player starts with two rows of
identical pieces.

- Move one square straight or diagonally **forward** into an empty square.
- Capture only **diagonally** forward (never straight).
- **Win** by landing any piece on the far edge of the board — or by capturing
  every enemy piece.

Dead-simple rules, genuinely deep play. White moves up the board, Black moves
down.

## Playing

- **Click** a piece to select it (legal destinations highlight green), then
  click a square to move — or **drag and drop**.
- **Mode** — play the engine as White or Black, watch it play itself
  (Two Machines), or play a friend on the same screen (Human vs Human).
- **Engine depth** — higher is stronger but slower. 4 is instant; 8–10 plays
  a tough game.
- **Vary engine play** — on by default, so the engine doesn't play the exact
  same game every time. Turn off for fully deterministic, repeatable play.
- **Themes** — Classic, Slate, High Contrast, Sepia.
- **Save / Load** — export the game to a `.game` file or load one back. The
  format is compatible with the original desktop (Java) version.
- **Undo**, **Flip board**, and an optional **engine output** log showing the
  search depth, score, and principal variation.

The AI runs in a Web Worker, so the board stays responsive while it thinks.

## Running locally

```sh
npm install
npm run dev      # builds + serves on http://localhost:8000 (live reload)
```

Static build (what gets deployed):

```sh
npm run build:web   # outputs to dist/web/
```

## Deploying to GitHub Pages

A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds and deploys
on every push to `main`. No build artifacts are committed — CI builds from
source.

First-time setup: in the repo, **Settings → Pages → Source → GitHub Actions**,
then push to `main`. The site goes live at
`https://<user>.github.io/<repo>/`.

## Tests

The engine is verified against the original Java implementation:

```sh
npm run perft         # move-generation & hashing correctness
npm run search-test   # search verification
```

`perft` counts the game tree's leaf nodes from the start position; it produces
exactly **6,182,818** at depth 5, matching the reference engine. The search
explores an *identical* node count to the Java original at every depth —
strong evidence the port is exact, not just approximately right.

## How it's built

A faithful TypeScript port of a Java engine:

- **Board** — two 64-bit bitboards (`bigint`), incremental Zobrist hashing.
- **Search** — negamax with alpha-beta, iterative deepening, a transposition
  table, killer-move ordering, principal-variation search, and a quiescence
  search tuned for Breakthrough's winning-push tactics.
- **UI** — a `<canvas>` board, the engine in a Web Worker, plain DOM controls.
  No framework.

See `ARCHITECTURE.md` for the module layout and porting notes.

## License

MIT — see `LICENSE`.
