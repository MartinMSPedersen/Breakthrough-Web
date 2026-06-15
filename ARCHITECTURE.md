# Breakthrough — TypeScript port (work in progress)

A browser-targetable TypeScript rewrite of the Java Breakthrough engine + GUI.

## Status

**Engine: complete and verified against the Java reference.**

| Module            | Java source        | Status |
|-------------------|--------------------|--------|
| `engine/bits.ts`  | `Bitboards.java`   | ✅ 64-bit helpers (bigint) |
| `engine/piece.ts` | constants          | ✅ |
| `engine/move.ts`  | `Move.java`        | ✅ packed-int moves |
| `engine/zobrist.ts`| `Zobrist.java`    | ✅ splitmix64 keys |
| `engine/board.ts` | `Board.java`       | ✅ apply/undo/FEN/winner |
| `engine/movegen.ts`| `MoveGenerator.java`| ✅ legal/captures/quiescence |
| `engine/evaluator.ts`| `Evaluator.java`| ✅ advancement + defender |
| `engine/tt.ts`    | `TT.java`          | ✅ typed-array transposition table |
| `engine/search.ts`| `Search.java`      | ✅ negamax+αβ+ID+TT+PVS+quiescence+PV |
| `perft.ts`        | `Main.perft`       | ✅ correctness harness |
| `search-test.ts`  | —                  | ✅ search verification harness |

**Not yet ported:** annotate-mode UI, evaluation-graph panel, position
editor, game save/load (the engine supports FEN; the UI just doesn't expose
file I/O yet).

## Web UI (playable)

A browser front-end is in `src/web/`:

| File              | Role |
|-------------------|------|
| `web/themes.ts`   | the four color themes (ported from Theme.java) |
| `web/board-view.ts`| canvas board: render + click + drag-and-drop |
| `web/worker.ts`   | Web Worker hosting the search (off the main thread) |
| `web/app.ts`      | game flow, modes, controls, engine-output log |
| `web/index.html`  | layout + CSS |

Modes: Machine plays White, Machine plays Black (default), Two Machines,
Human vs Human, Analyse. Plus depth selector, theme picker, flip board,
new game, undo. The engine runs in a Worker so the UI never freezes.

### Run it

```sh
npm install
npm run dev      # builds + serves on http://localhost:8000 with live reload
# or
npm run build:web && npx serve dist/web   # static build
```

### Verified headlessly

The engine and worker pipeline are tested without a browser:
- `npm run perft` — move-gen/hashing match Java exactly.
- `npm run search-test` — search node counts identical to Java.
- The bundled worker, driven through its message protocol, returns
  best=a2a3 nodes=68842 at depth 6 — same as the direct engine. The
  canvas/DOM code typechecks against the DOM libs.

## Verification

Two harnesses, both green:

**`npm run perft`** — move-gen / make-unmake / hashing:
```
perft(1..5) all match Java exactly; hash consistency OK
```

**`npm run search-test`** — the full search:
```
Initial position, depth 4/6/8: best=a2a3 score=0
  node counts 3399 / 68842 / 1142121 — IDENTICAL to the Java engine
Critical bug-fix position: best=h8g7 at every depth (the bug does not exist here)
Self-play: 60 legal plies, no errors
```

Identical node counts mean the TS engine explores the same tree in the same
order as Java — the strongest evidence the port is faithful, not just
coincidentally returning the same move.

## The 64-bit question, resolved

Java `long` bitboards became `bigint` in TS. JS bitwise ops are 32-bit and
JS numbers lose precision past 2^53, so bigint is the correct choice. The
discipline: mask back to 64 bits after shifts/NOT (`bits.ts` has helpers
`mask64`, `shl`, `shr`, `not64`). Moves stay as plain `number` (12-bit
packed) — only the boards need 64-bit width.

## Correctness gate

perft from the initial position matches the Java engine exactly:

```
perft(1) =        22   OK
perft(2) =       484   OK
perft(3) =     11132   OK
perft(4) =    256036   OK
perft(5) =   6182818   OK
Hash consistency: OK
```

This proves move generation, make/unmake, and incremental Zobrist hashing
are all correct before any search is built on top.

## Performance note

perft(5) takes ~3s in TS vs sub-second in Java — the expected bigint cost.
Irrelevant for gameplay: a real search is far shallower per move than a
full depth-5 tree enumeration, and the target is a casual browser game.

## Running

```sh
npm install
npm run perft        # build + run the correctness harness
npm run typecheck    # tsc --noEmit
```
