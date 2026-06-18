# Architecture

A browser Breakthrough game: a TypeScript engine (a faithful port of an
earlier Java implementation) plus a small canvas/DOM front-end. No framework,
no runtime dependencies — the only dev dependencies are TypeScript, esbuild,
and Node type definitions.

## Layout

```
src/
  engine/        pure game logic — no DOM, runnable in Node or a Worker
    bits.ts        64-bit bitboard helpers (bigint)
    piece.ts       EMPTY / WHITE / BLACK constants
    move.ts        packed-int move encoding + algebraic notation
    zobrist.ts     Zobrist hash keys (splitmix64)
    board.ts       board state, make/unmake, FEN, winner detection
    movegen.ts     legal / capture / quiescence move generation
    evaluator.ts   position evaluation (advancement + optional defender term)
    tt.ts          transposition table (parallel typed arrays)
    search.ts      negamax + αβ + ID + TT + PVS + quiescence + PV
  web/           browser front-end
    themes.ts      four color themes
    board-view.ts  <canvas> board: rendering, click + drag-and-drop
    worker.ts      Web Worker that hosts the search
    app.ts         game flow, modes, controls, save/load, output log
    gamefile.ts    .game file read/write (desktop-compatible) + downloads
    index.html     layout + CSS
  perft.ts       correctness harness (game-tree leaf counter)
  search-test.ts search verification harness
build-web.mjs    esbuild bundler + dev server
```

The engine never imports from `web/`; the dependency arrow points one way.
That's what lets the same engine code run in Node (for the test harnesses)
and in a Web Worker (in the browser) unchanged.

## The 64-bit question

The Java engine used `long` bitboards. JavaScript has no 64-bit integer in its
`number` type — bitwise operators work on 32 bits, and integer precision runs
out at 2^53 — so bitboards are `bigint`.

The one discipline `bigint` imposes: there's no fixed width, so values can grow
past 64 bits or go negative. After every shift or NOT we mask back to 64 bits.
`bits.ts` centralizes this: `mask64`, `shl`, `shr` (logical), `not64`, plus
`ntz` (trailing-zero count) and `popcount` for iterating set bits.

Moves are *not* bigint — they pack into 12 bits (`from << 6 | to`), well within
safe integer range, so they stay plain `number` for speed. Only the boards and
hash keys need 64-bit width.

## Search

`search.ts` is negamax with alpha-beta, wrapped in iterative deepening, with:

- a **transposition table** (`tt.ts`) keyed by Zobrist hash, storing best move,
  score, depth, and bound flag, with mate-score distance adjustment on
  store/probe;
- **move ordering** — TT move first, then captures (most-advanced first), then
  killer moves, then a positional advancement bonus;
- **principal-variation search** — the first move gets a full window, the rest a
  zero-window scout, re-searched on fail-high. (A fail-high scout returns a
  *bound*, not an exact score, so the re-search is mandatory even at depth 1 —
  skipping it produced false mate scores in the Java original; the comment in
  the code preserves that warning.)
- a **quiescence search** that extends captures *and* "winning pushes" (quiet
  moves onto the opponent's home rank). In Breakthrough the winning move is
  usually quiet, so a capture-only quiescence mis-scores positions where a
  runner is one step from the goal.
- a **triangular PV table** so the full principal variation is available for
  display, rather than reconstructed from the (lossy) TT.

Optional **evaluation noise** (`noiseAmp`/`noiseSeed`) adds a small,
deterministic-per-seed jitter to leaf scores. The UI regenerates the seed each
new game so games diverge; setting amplitude to 0 makes the engine fully
deterministic.

## UI

`board-view.ts` is a custom-painted `<canvas>` — squares, overlays
(last move / selection / legal destinations), coordinate labels, four themes,
click-to-move and drag-and-drop. It's a pure view: it holds a board snapshot
and selection state handed to it, and reports clicks back as `(row, col)`.

`app.ts` owns game flow: the four modes (machine White / machine Black /
two machines / human vs human), move legality, undo history, save/load, and the
engine-output log. It talks to the engine only through the Worker.

`worker.ts` hosts the engine off the main thread so the board stays responsive
during a search. The protocol is small:

```
main → worker:  { type:'search', id, fen, depth, ttBits, noiseAmp, noiseSeed }
                { type:'cancel' }
worker → main:  { type:'iteration', id, depth, score, nodes, ms, bestMove, pv }
                { type:'done', id, ... }
                { type:'cancelled', id }
```

Every result carries the `id` of the search that produced it; the main thread
ignores results whose id is stale. This is what makes "New Game" safe mid-search
in Two Machines mode — a result from the abandoned search is dropped rather than
played.

The Worker runs each search synchronously, so a `cancel` message isn't processed
until the current search finishes (the message loop is blocked). The stale-id
guard handles correctness; the only visible effect is that interrupting a deep
search waits for it to finish before the new one starts. Truly preemptive cancel
would need a `SharedArrayBuffer` flag (and the COOP/COEP headers that requires),
which isn't worth it for a casual game.

## Verification

The engine is checked against the Java reference by two harnesses:

```sh
npm run perft         # game-tree leaf counts + hash consistency
npm run search-test   # search results
```

**perft** enumerates the game tree from the start position:

```
perft(1) =        22
perft(2) =       484
perft(3) =     11132
perft(4) =    256036
perft(5) =   6182818   ← matches the Java engine
```

This validates move generation, make/unmake, and incremental Zobrist hashing
before any search logic runs on top.

**search-test** confirms the search explores an *identical node count* to the
Java engine at every depth (3399 / 68842 / 1142121 at depths 4 / 6 / 8 from the
start). Same move, same score, same tree, same order — evidence the port is
exact, not just coincidentally agreeing on the move.

perft(5) takes a few seconds in the browser/Node versus sub-second in Java —
the expected `bigint` cost. It's irrelevant to play: a real search at the depths
used in-game explores a tiny fraction of a full depth-5 enumeration.

## Build

`build-web.mjs` uses esbuild to bundle `app.ts` and `worker.ts` separately
(the worker is referenced via `new Worker(new URL('./worker.js', import.meta.url))`,
which resolves correctly under a GitHub Pages subpath), copies `index.html`,
and drops a `.nojekyll` marker. `npm run dev` adds a watch + local server;
`npm run build:web` does a one-shot build into `dist/web/`.

## Possible future work

- A position editor (click-to-place piece palette).
- An evaluation graph (score over plies).
- An analyse mode done properly — continuous search with game navigation. The
  earlier attempt was removed; a clean rebuild would mirror the desktop app's
  snapshot/step design rather than bolt onto the play-mode flow.
- An Electron or Tauri shell for a desktop build (the web code would carry over
  with near-zero change).
