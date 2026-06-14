/**
 * A move is encoded as a packed integer: (fromSq << 6) | toSq, where each
 * square is a 0..63 index = row*8 + col. 12 bits, comfortably within JS's
 * safe-integer range, so we use plain `number` (no bigint) for moves — only
 * the bitboards themselves need 64-bit width.
 */

export const NONE = -1;

export function pack(fromSq: number, toSq: number): number {
  return (fromSq << 6) | toSq;
}

export function packRC(fromRow: number, fromCol: number, toRow: number, toCol: number): number {
  return (((fromRow << 3) | fromCol) << 6) | ((toRow << 3) | toCol);
}

export function fromSq(packed: number): number {
  return packed >>> 6;
}

export function toSq(packed: number): number {
  return packed & 0x3f;
}

export function fromRow(packed: number): number {
  return (packed >>> 6) >>> 3;
}

export function fromCol(packed: number): number {
  return (packed >>> 6) & 7;
}

export function toRow(packed: number): number {
  return (packed & 0x3f) >>> 3;
}

export function toCol(packed: number): number {
  return (packed & 0x3f) & 7;
}

/** Algebraic notation (e.g. "b2c3") directly from a packed int. */
export function toAlgebraic(packed: number): string {
  const fSq = packed >>> 6;
  const tSq = packed & 0x3f;
  const fr = fSq >>> 3, fc = fSq & 7, tr = tSq >>> 3, tc = tSq & 7;
  return (
    String.fromCharCode(97 + fc) +
    String.fromCharCode(49 + fr) +
    String.fromCharCode(97 + tc) +
    String.fromCharCode(49 + tr)
  );
}

/** Parse algebraic notation (e.g. "b2c3") into a packed int. */
export function parse(s: string): number {
  s = s.trim();
  if (s.length !== 4) {
    throw new Error(`Invalid move syntax: '${s}' (expected like b2c3)`);
  }
  const fc = s.charCodeAt(0) - 97; // 'a'
  const fr = s.charCodeAt(1) - 49; // '1'
  const tc = s.charCodeAt(2) - 97;
  const tr = s.charCodeAt(3) - 49;
  if (fc < 0 || fc > 7 || fr < 0 || fr > 7 || tc < 0 || tc > 7 || tr < 0 || tr > 7) {
    throw new Error(`Square out of range: '${s}'`);
  }
  return packRC(fr, fc, tr, tc);
}
