import { Board } from '../engine/board';
import * as Move from '../engine/move';

/**
 * Read/write the `.game` text format, byte-compatible with the Java
 * GameWriter/GameReplay so files move freely between the desktop and web
 * versions.
 *
 * Format: a header of `#` comment lines, a blank line, then numbered move
 * pairs:
 *
 *   # Breakthrough game (8x8)
 *   # Saved:     2026-06-14 21:03:11
 *   # Plies:     12
 *   # Result:    White wins on move 7
 *   # Final FEN: .../... W
 *
 *     1. b2b3 g7g6
 *     2. c2c3 ...
 *
 * Parsing ignores everything after `#` on a line and pulls out every
 * `[a-h][1-8][a-h][1-8]` token as a move, in order.
 */

const MOVE_RE = /[a-h][1-8][a-h][1-8]/g;

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

function timestamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

/** Filename stamp: breakthrough-YYYY-MM-DD_HH-MM-SS.game */
export function defaultFilename(d: Date = new Date()): string {
  const s =
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_` +
    `${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
  return `breakthrough-${s}.game`;
}

/**
 * Serialize a game to the `.game` text format.
 * @param moves packed moves in play order
 * @param resultLine e.g. "White wins on move 7" or "in progress"
 * @param finalFen   FEN of the final position (or null to omit)
 */
export function writeGame(moves: number[], resultLine: string, finalFen: string | null): string {
  let s = '';
  s += '# Breakthrough game (8x8)\n';
  s += `# Saved:     ${timestamp(new Date())}\n`;
  s += `# Plies:     ${moves.length}\n`;
  s += `# Result:    ${resultLine}\n`;
  if (finalFen) s += `# Final FEN: ${finalFen}\n`;
  s += '\n';
  for (let i = 0; i < moves.length; i += 2) {
    const moveNum = i / 2 + 1;
    let line = `${String(moveNum).padStart(3, ' ')}. ${Move.toAlgebraic(moves[i])}`;
    if (i + 1 < moves.length) line += ' ' + Move.toAlgebraic(moves[i + 1]);
    s += line + '\n';
  }
  return s;
}

/** Parse a `.game` file's text into a list of packed moves. */
export function parseGame(text: string): number[] {
  const moves: number[] = [];
  for (let line of text.split('\n')) {
    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash);
    const matches = line.match(MOVE_RE);
    if (matches) for (const tok of matches) moves.push(Move.parse(tok));
  }
  return moves;
}

/**
 * Replay a move list from the initial position, validating each move is
 * legal at its turn. Returns the final board and the applied move list
 * (truncated if an illegal move is hit, which shouldn't happen for files
 * we wrote ourselves). Throws only on malformed move tokens.
 */
export function replayGame(moves: number[]): { board: Board; applied: { move: number; cap: number }[] } {
  const board = Board.initial();
  const applied: { move: number; cap: number }[] = [];
  for (const m of moves) {
    let legal = false;
    const buf = legalMovesQuick(board);
    for (const lm of buf) if (lm === m) { legal = true; break; }
    if (!legal) break;
    const cap = board.applyPacked(m);
    applied.push({ move: m, cap });
    if (board.winner() !== 0) break;
  }
  return { board, applied };
}

// Local import kept lazy-ish to avoid a heavy top import; movegen is light.
import { legalMoves as legalMovesQuick } from '../engine/movegen';

/** Trigger a browser download of text content as a file. */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Open a file picker and resolve with the chosen file's text. */
export function pickTextFile(accept = '.game,.fen,.txt'): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result) });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
    // Some browsers need the input in the DOM.
    document.body.appendChild(input);
    input.click();
    setTimeout(() => document.body.removeChild(input), 0);
  });
}
