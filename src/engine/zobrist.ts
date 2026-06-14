import { FULL64, mask64 } from './bits';
import { WHITE, BLACK } from './piece';

/**
 * Zobrist hashing keys.
 *
 * PIECE_SQ[piece][sq] for piece in {WHITE=1, BLACK=2}, sq in 0..63.
 * SIDE_BLACK is XOR'd in when it's Black to move.
 *
 * The Java version used java.util.SplittableRandom for reproducible keys.
 * We don't need to match those exact values (hashes only have to be
 * internally consistent for our TT), so we use splitmix64 — a tiny, fast,
 * well-distributed 64-bit generator with a fixed seed.
 */

function splitmix64(state: { s: bigint }): bigint {
  state.s = mask64(state.s + 0x9e3779b97f4a7c15n);
  let z = state.s;
  z = mask64((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
  z = mask64((z ^ (z >> 27n)) * 0x94d049bb133111ebn);
  z = z ^ (z >> 31n);
  return z & FULL64;
}

export const PIECE_SQ: bigint[][] = [
  new Array(64).fill(0n), // index 0 (EMPTY) unused
  new Array(64).fill(0n), // WHITE
  new Array(64).fill(0n), // BLACK
];
export let SIDE_BLACK = 0n;

(function init() {
  const state = { s: 0xb12a4711d02cafebn };
  for (let p = 1; p <= 2; p++) {
    for (let sq = 0; sq < 64; sq++) {
      PIECE_SQ[p][sq] = splitmix64(state);
    }
  }
  SIDE_BLACK = splitmix64(state);
})();

/**
 * Compute the full Zobrist hash of a board from scratch.
 * (Imported lazily to avoid a circular dependency with board.ts; we accept
 * the raw bitboards + side instead of a Board object.)
 */
export function compute(white: bigint, black: bigint, side: number): bigint {
  let h = 0n;
  let bb = white;
  while (bb !== 0n) {
    const sq = ntz(bb);
    h ^= PIECE_SQ[WHITE][sq];
    bb &= bb - 1n;
  }
  bb = black;
  while (bb !== 0n) {
    const sq = ntz(bb);
    h ^= PIECE_SQ[BLACK][sq];
    bb &= bb - 1n;
  }
  if (side === BLACK) h ^= SIDE_BLACK;
  return h;
}

// Local copy of ntz to avoid an import cycle through bits→...; identical logic.
function ntz(x: bigint): number {
  let n = 0;
  let v = x & FULL64;
  if (v === 0n) return 64;
  if ((v & 0xffffffffn) === 0n) { n += 32; v >>= 32n; }
  if ((v & 0xffffn) === 0n)     { n += 16; v >>= 16n; }
  if ((v & 0xffn) === 0n)       { n += 8;  v >>= 8n; }
  if ((v & 0xfn) === 0n)        { n += 4;  v >>= 4n; }
  if ((v & 0x3n) === 0n)        { n += 2;  v >>= 2n; }
  if ((v & 0x1n) === 0n)        { n += 1; }
  return n;
}
