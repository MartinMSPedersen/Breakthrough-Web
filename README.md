# Breakthrough

A browser version of the abstract strategy game **Breakthrough**, with a
built-in AI opponent. Pure TypeScript, no install needed — just open the page
and play.

**▶ Play: https://MartinMSPedersen.github.io/Breakthrough-Web/**

## The game

Breakthrough is played on an 8×8 board. Each side starts with two rows of
pieces. Pieces move one square straight or diagonally **forward** to an empty
square, and capture **diagonally** forward. You win by getting any piece to
the far side of the board — or by capturing all enemy pieces.

Simple rules, surprisingly deep play.

## Features

- Play against the engine as White or Black, watch engine-vs-engine, or play
  a friend hot-seat.
- **Analyse mode** — the engine evaluates the current position continuously
  and shows its best line.
- Adjustable search depth, four color themes, board flip, undo.
- The AI runs in a Web Worker, so the interface never freezes while it thinks.

## Running locally

```sh
npm install
npm run dev      # http://localhost:8000 with live reload
```

Static build (what gets deployed):

```sh
npm run build:web   # outputs to dist/web/
```

## Deploying to GitHub Pages

This repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`)
that builds and deploys on every push to `main`.

1. Push the repo to GitHub.
2. In the repo: **Settings -> Pages -> Source -> GitHub Actions**.
3. Push to `main` (or run the workflow manually from the Actions tab).
4. Your game goes live at `https://USERNAME.github.io/REPO/`.

No build artifacts are committed — CI builds from source.

## Tests

```sh
npm run perft         # move-generation / hashing correctness
npm run search-test   # search verification
```

## How it's built

A faithful TypeScript port of a Java engine. The board uses 64-bit bitboards
(`bigint`); the search is negamax with alpha-beta, iterative deepening, a
transposition table, killer-move ordering, principal-variation search, and a
quiescence search tuned for Breakthrough's winning-push tactics.

Correctness is anchored on **perft**: the move generator produces exactly
6,182,818 leaf nodes at depth 5 from the start position, and the search
explores an identical node count to the original Java engine at every depth —
strong evidence the port is exact, not just approximately right.

See `ARCHITECTURE.md` for the module layout and the porting notes.

## License

MIT
