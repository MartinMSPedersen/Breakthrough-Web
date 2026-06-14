import { Board } from './board';
import { WHITE } from './piece';
import {
  FULL64, NOT_FILE_A, NOT_FILE_H, ntz, shl, shr, not64,
} from './bits';

/**
 * Bitboard move generator. Mirrors the Java version.
 *
 * For each move type (forward, diag-left, diag-right) we compute a destination
 * bitboard with a shift + mask, then iterate set bits, packing (from,to).
 */

export const MAX_MOVES = 64;

const GOAL_WHITE = 0xff00000000000000n; // rank 8
const GOAL_BLACK = 0xffn; // rank 1

/** Fill `out` (Int32Array) with packed legal moves; returns the count. */
export function generate(b: Board, out: Int32Array): number {
  return generateInner(b, out, 0, false);
}

/** Captures only. */
export function generateCaptures(b: Board, out: Int32Array): number {
  return generateInner(b, out, 0, true);
}

/**
 * Quiescence set: captures plus quiet "winning pushes" (non-capture moves
 * landing on the opponent home rank). See the Java comment for why this
 * matters — capture-only quiescence is unsound in Breakthrough.
 */
export function generateQuiescence(b: Board, out: Int32Array): number {
  let idx = generateInner(b, out, 0, true);
  const own = b.side === WHITE ? b.white : b.black;
  const opp = b.side === WHITE ? b.black : b.white;
  const empty = not64(own | opp);
  if (b.side === WHITE) {
    const fwd = shl(own, 8n) & empty & GOAL_WHITE;
    const diagL = shl(own & NOT_FILE_A, 7n) & empty & GOAL_WHITE;
    const diagR = shl(own & NOT_FILE_H, 9n) & empty & GOAL_WHITE;
    idx = emit(out, idx, fwd, -8);
    idx = emit(out, idx, diagL, -7);
    idx = emit(out, idx, diagR, -9);
  } else {
    const fwd = shr(own, 8n) & empty & GOAL_BLACK;
    const diagL = shr(own & NOT_FILE_H, 7n) & empty & GOAL_BLACK;
    const diagR = shr(own & NOT_FILE_A, 9n) & empty & GOAL_BLACK;
    idx = emit(out, idx, fwd, 8);
    idx = emit(out, idx, diagL, 7);
    idx = emit(out, idx, diagR, 9);
  }
  return idx;
}

function generateInner(b: Board, out: Int32Array, offset: number, capturesOnly: boolean): number {
  const own = b.side === WHITE ? b.white : b.black;
  const opp = b.side === WHITE ? b.black : b.white;
  const empty = not64(own | opp);

  let idx = offset;
  if (b.side === WHITE) {
    const diagTargets = capturesOnly ? opp : empty | opp;
    if (!capturesOnly) {
      const fwd = shl(own, 8n) & empty;
      idx = emit(out, idx, fwd, -8);
    }
    const diagL = shl(own & NOT_FILE_A, 7n) & diagTargets;
    const diagR = shl(own & NOT_FILE_H, 9n) & diagTargets;
    idx = emit(out, idx, diagL, -7);
    idx = emit(out, idx, diagR, -9);
  } else {
    const diagTargets = capturesOnly ? opp : empty | opp;
    if (!capturesOnly) {
      const fwd = shr(own, 8n) & empty;
      idx = emit(out, idx, fwd, 8);
    }
    const diagL = shr(own & NOT_FILE_H, 7n) & diagTargets;
    const diagR = shr(own & NOT_FILE_A, 9n) & diagTargets;
    idx = emit(out, idx, diagL, 7);
    idx = emit(out, idx, diagR, 9);
  }
  return idx - offset;
}

/** Emit a packed move for each set bit; from = to + fromOffset. */
function emit(out: Int32Array, idx: number, destinations: bigint, fromOffset: number): number {
  let d = destinations & FULL64;
  while (d !== 0n) {
    const toSq = ntz(d);
    const fromSq = toSq + fromOffset;
    out[idx++] = (fromSq << 6) | toSq;
    d &= d - 1n;
  }
  return idx;
}

/** Allocating convenience: array of packed legal moves. */
export function legalMoves(b: Board): number[] {
  const buf = new Int32Array(MAX_MOVES);
  const n = generate(b, buf);
  const moves: number[] = [];
  for (let i = 0; i < n; i++) moves.push(buf[i]);
  return moves;
}
