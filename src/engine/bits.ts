/**
 * 64-bit bitboard helpers.
 *
 * JavaScript's `number` is a 64-bit float with only 53 bits of integer
 * precision, and its bitwise operators work on 32-bit values — neither is
 * usable for a 64-bit bitboard. We therefore represent bitboards as `bigint`,
 * which is exact and supports the bitwise operators we need.
 *
 * The one discipline BigInt imposes: there is no unsigned right shift, and
 * operations can produce values outside the 0..2^64-1 range (negative, or
 * wider than 64 bits). After any shift or NOT we mask back down to 64 bits
 * with `mask64`, mirroring how Java's `long` silently wraps at 64 bits.
 */

export const FULL64 = (1n << 64n) - 1n;

/** Mask a bigint down to its low 64 bits (emulates Java long wraparound). */
export function mask64(x: bigint): bigint {
  return x & FULL64;
}

/** Bitwise NOT within 64 bits (Java's ~ on a long). */
export function not64(x: bigint): bigint {
  return (~x) & FULL64;
}

/** Logical left shift, truncated to 64 bits (Java's << on a long). */
export function shl(x: bigint, n: bigint): bigint {
  return (x << n) & FULL64;
}

/**
 * Logical (unsigned) right shift within 64 bits (Java's >>> on a long).
 * Since we always keep bitboards masked to the non-negative 0..2^64-1 range,
 * a plain bigint >> is already logical here.
 */
export function shr(x: bigint, n: bigint): bigint {
  return (x & FULL64) >> n;
}

/** File and rank masks. */
export const FILE_A = 0x0101010101010101n;
export const FILE_H = 0x8080808080808080n;
export const NOT_FILE_A = not64(FILE_A);
export const NOT_FILE_H = not64(FILE_H);
export const RANK_1 = 0x00000000000000ffn; // White's home (row 0)
export const RANK_8 = 0xff00000000000000n; // Black's home (row 7)

/** Single-bit mask for a square index 0..63. */
export function bitSq(sq: number): bigint {
  return 1n << BigInt(sq);
}

/** Single-bit mask for (row, col). */
export function bit(row: number, col: number): bigint {
  return 1n << BigInt((row << 3) | col);
}

/**
 * Number of trailing zeros of a non-zero 64-bit bigint — i.e. the index of
 * the least-significant set bit. Mirrors Long.numberOfTrailingZeros.
 *
 * Implemented by extracting the lowest set bit (x & -x), then locating it.
 * For our use (iterating set bits) the caller guarantees x != 0.
 */
export function ntz(x: bigint): number {
  // Isolate lowest set bit. For bigint, -x is two's-complement-like under our
  // masking convention, but a direct subtraction approach is clearer:
  let n = 0;
  // Walk 32/16/8/4/2/1 like a debruijn-free binary search.
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

/** Population count (number of set bits) of a 64-bit bigint. */
export function popcount(x: bigint): number {
  let v = x & FULL64;
  let count = 0;
  while (v !== 0n) {
    v &= v - 1n;
    count++;
  }
  return count;
}

/** Clear the lowest set bit: x & (x-1). */
export function clearLowest(x: bigint): bigint {
  return x & (x - 1n);
}
