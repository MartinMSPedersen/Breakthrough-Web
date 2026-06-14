import { Board } from './engine/board';
import { EMPTY } from './engine/piece';
import { generate, MAX_MOVES } from './engine/movegen';
import * as Zobrist from './engine/zobrist';

/** Count leaves of the game tree to the given depth. Terminal = leaf. */
function perft(b: Board, depth: number): number {
  if (depth === 0) return 1;
  if (b.winner() !== EMPTY) return 1;
  let total = 0;
  const buf = new Int32Array(MAX_MOVES);
  const n = generate(b, buf);
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const cap = b.applyPacked(m);
    total += perft(b, depth - 1);
    b.undoPacked(m, cap);
  }
  return total;
}

/** Verify the incremental hash matches a from-scratch recompute after a walk. */
function hashConsistencyCheck(): boolean {
  const b = Board.initial();
  const buf = new Int32Array(MAX_MOVES);
  // Walk a pseudo-random line, checking the hash at each step.
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  for (let i = 0; i < 30; i++) {
    if (b.winner() !== EMPTY) break;
    const n = generate(b, buf);
    if (n === 0) break;
    const m = buf[rnd() % n];
    b.applyPacked(m);
    const recomputed = Zobrist.compute(b.white, b.black, b.side);
    if (b.hash !== recomputed) {
      console.error(`Hash mismatch after move ${i}: incremental=${b.hash} recompute=${recomputed}`);
      return false;
    }
  }
  return true;
}

const EXPECTED = [
  { depth: 1, leaves: 22 },
  { depth: 2, leaves: 484 },
  { depth: 3, leaves: 11132 },
  { depth: 4, leaves: 256036 },
  { depth: 5, leaves: 6182818 },
];

console.log('Perft from the initial position:');
let allOk = true;
for (const { depth, leaves } of EXPECTED) {
  const t0 = Date.now();
  const got = perft(Board.initial(), depth);
  const ms = Date.now() - t0;
  const ok = got === leaves;
  allOk = allOk && ok;
  console.log(
    `  perft(${depth}) = ${got.toString().padStart(9)}  ` +
      `expected ${leaves.toString().padStart(9)}  ${ok ? 'OK' : 'FAIL'}  (${ms} ms)`
  );
}

console.log();
console.log('Hash consistency: ' + (hashConsistencyCheck() ? 'OK' : 'FAIL'));

console.log();
console.log(allOk ? 'ALL PERFT OK' : 'PERFT MISMATCH');
process.exit(allOk ? 0 : 1);
