import { FULL64 } from './bits';
import { NONE } from './move';

/**
 * Transposition table indexed by Zobrist hash. Fixed-size, power-of-two,
 * single-slot ("always replace"). The full 64-bit key is stored and checked,
 * so index collisions just look like a miss.
 *
 * Backed by parallel typed arrays rather than an array of objects:
 *   keys:    BigInt64Array (the 64-bit Zobrist key, as a signed bigint)
 *   data:    Int32Array packed as [bestMove, score] per slot
 *   meta:    Int32Array packed as [depth, flag] per slot
 * A slot is empty iff its `used` bit is clear.
 */

export const EXACT = 0;
export const LOWER = 1;
export const UPPER = 2;

export interface Entry {
  key: bigint;
  bestMove: number;
  score: number;
  depth: number;
  flag: number;
}

export class TT {
  private readonly keys: BigInt64Array;
  private readonly used: Uint8Array;
  private readonly bestMoveArr: Int32Array;
  private readonly scoreArr: Int32Array;
  private readonly depthArr: Int32Array;
  private readonly flagArr: Uint8Array;
  private readonly mask: bigint;
  private readonly sizeVal: number;
  private filledCount = 0;

  // Scratch entry reused by probe() to avoid per-call allocation.
  private scratch: Entry = { key: 0n, bestMove: NONE, score: 0, depth: 0, flag: 0 };

  /** @param sizeBits log2 of slot count. 20 => 2^20 ≈ 1M slots. */
  constructor(sizeBits: number) {
    const size = 1 << sizeBits;
    this.sizeVal = size;
    this.keys = new BigInt64Array(size);
    this.used = new Uint8Array(size);
    this.bestMoveArr = new Int32Array(size);
    this.scoreArr = new Int32Array(size);
    this.depthArr = new Int32Array(size);
    this.flagArr = new Uint8Array(size);
    this.mask = BigInt(size - 1);
  }

  /**
   * Returns the matching entry or null. The returned object is a shared
   * scratch instance — copy fields out before the next probe() if needed.
   * (The search reads fields immediately, so sharing is safe and saves GC.)
   */
  probe(hash: bigint): Entry | null {
    const idx = Number(hash & this.mask);
    if (this.used[idx] === 0) return null;
    // Stored key is the signed reinterpretation; compare in that space.
    const storedKey = BigInt.asUintN(64, this.keys[idx]);
    if (storedKey !== (hash & FULL64)) return null;
    const e = this.scratch;
    e.key = storedKey;
    e.bestMove = this.bestMoveArr[idx];
    e.score = this.scoreArr[idx];
    e.depth = this.depthArr[idx];
    e.flag = this.flagArr[idx];
    return e;
  }

  store(hash: bigint, depth: number, score: number, flag: number, bestMove: number): void {
    const idx = Number(hash & this.mask);
    if (this.used[idx] === 0) {
      this.used[idx] = 1;
      this.filledCount++;
    }
    // BigInt64Array stores signed; asIntN keeps the bit pattern.
    this.keys[idx] = BigInt.asIntN(64, hash & FULL64);
    this.depthArr[idx] = depth;
    this.scoreArr[idx] = score;
    this.flagArr[idx] = flag;
    this.bestMoveArr[idx] = bestMove;
  }

  clear(): void {
    this.used.fill(0);
    this.filledCount = 0;
  }

  size(): number {
    return this.sizeVal;
  }

  filled(): number {
    return this.filledCount;
  }
}
