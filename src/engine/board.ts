import { EMPTY, WHITE, BLACK, SIZE, other } from './piece';
import { bit, FULL64, RANK_1, RANK_8 } from './bits';
import * as Zobrist from './zobrist';
import { fromSq as mFromSq, toSq as mToSq } from './move';

/**
 * 8x8 Breakthrough board backed by two 64-bit bitboards (bigint).
 *
 * row 0 = rank 1 (White home), row 7 = rank 8 (Black home).
 * col 0 = 'a', col 7 = 'h'.
 * White moves toward higher rows (+1), wins by reaching row 7.
 * Black moves toward lower rows (-1), wins by reaching row 0.
 *
 * sq = row*8 + col. Bit `sq` set in `white`/`black` means a piece there.
 * Mutable; applyPacked/undoPacked keep the Zobrist hash incrementally.
 */
export class Board {
  white = 0n;
  black = 0n;
  side = WHITE;
  hash = 0n;

  static initial(): Board {
    const b = new Board();
    b.white = 0x000000000000ffffn; // bits 0..15
    b.black = 0xffff000000000000n; // bits 48..63
    b.side = WHITE;
    b.hash = Zobrist.compute(b.white, b.black, b.side);
    return b;
  }

  clone(): Board {
    const b = new Board();
    b.white = this.white;
    b.black = this.black;
    b.side = this.side;
    b.hash = this.hash;
    return b;
  }

  get(r: number, c: number): number {
    const m = bit(r, c);
    if ((this.white & m) !== 0n) return WHITE;
    if ((this.black & m) !== 0n) return BLACK;
    return EMPTY;
  }

  /** Place a piece (or empty) at a square, maintaining the hash. Editor use. */
  set(r: number, c: number, piece: number): void {
    const m = bit(r, c);
    const sq = r * 8 + c;
    if ((this.white & m) !== 0n) { this.white &= ~m & FULL64; this.hash ^= Zobrist.PIECE_SQ[WHITE][sq]; }
    if ((this.black & m) !== 0n) { this.black &= ~m & FULL64; this.hash ^= Zobrist.PIECE_SQ[BLACK][sq]; }
    if (piece === WHITE) { this.white |= m; this.hash ^= Zobrist.PIECE_SQ[WHITE][sq]; }
    else if (piece === BLACK) { this.black |= m; this.hash ^= Zobrist.PIECE_SQ[BLACK][sq]; }
  }

  setSide(s: number): void {
    if (this.side !== s) this.hash ^= Zobrist.SIDE_BLACK;
    this.side = s;
  }

  /**
   * Apply a packed move in place. Returns the captured piece (EMPTY/WHITE/
   * BLACK) so undoPacked can restore it. Updates the hash incrementally.
   */
  applyPacked(move: number): number {
    const fromSq = mFromSq(move);
    const toSq = mToSq(move);
    const fromBit = 1n << BigInt(fromSq);
    const toBit = 1n << BigInt(toSq);
    const bothBit = fromBit | toBit;

    let captured: number;
    if ((this.white & fromBit) !== 0n) {
      this.white ^= bothBit;
      if ((this.black & toBit) !== 0n) {
        captured = BLACK;
        this.black ^= toBit;
        this.hash ^= Zobrist.PIECE_SQ[BLACK][toSq];
      } else {
        captured = EMPTY;
      }
      this.hash ^= Zobrist.PIECE_SQ[WHITE][fromSq];
      this.hash ^= Zobrist.PIECE_SQ[WHITE][toSq];
    } else {
      this.black ^= bothBit;
      if ((this.white & toBit) !== 0n) {
        captured = WHITE;
        this.white ^= toBit;
        this.hash ^= Zobrist.PIECE_SQ[WHITE][toSq];
      } else {
        captured = EMPTY;
      }
      this.hash ^= Zobrist.PIECE_SQ[BLACK][fromSq];
      this.hash ^= Zobrist.PIECE_SQ[BLACK][toSq];
    }
    this.hash ^= Zobrist.SIDE_BLACK;
    this.side = other(this.side);
    return captured;
  }

  undoPacked(move: number, captured: number): void {
    const fromSq = mFromSq(move);
    const toSq = mToSq(move);
    const fromBit = 1n << BigInt(fromSq);
    const toBit = 1n << BigInt(toSq);
    const bothBit = fromBit | toBit;

    if ((this.white & toBit) !== 0n) {
      this.white ^= bothBit;
      this.hash ^= Zobrist.PIECE_SQ[WHITE][toSq];
      this.hash ^= Zobrist.PIECE_SQ[WHITE][fromSq];
      if (captured !== EMPTY) {
        this.black ^= toBit;
        this.hash ^= Zobrist.PIECE_SQ[BLACK][toSq];
      }
    } else {
      this.black ^= bothBit;
      this.hash ^= Zobrist.PIECE_SQ[BLACK][toSq];
      this.hash ^= Zobrist.PIECE_SQ[BLACK][fromSq];
      if (captured !== EMPTY) {
        this.white ^= toBit;
        this.hash ^= Zobrist.PIECE_SQ[WHITE][toSq];
      }
    }
    this.hash ^= Zobrist.SIDE_BLACK;
    this.side = other(this.side);
  }

  /** WHITE or BLACK if that side has won, else EMPTY. */
  winner(): number {
    if ((this.white & RANK_8) !== 0n) return WHITE;
    if ((this.black & RANK_1) !== 0n) return BLACK;
    if (this.white === 0n) return BLACK;
    if (this.black === 0n) return WHITE;
    return EMPTY;
  }

  /** FEN-like: ranks 8→1, '/'-separated, X=white O=black digits=empties, side. */
  toFen(): string {
    let s = '';
    for (let r = SIZE - 1; r >= 0; r--) {
      let empties = 0;
      for (let c = 0; c < SIZE; c++) {
        const m = bit(r, c);
        if ((this.white & m) !== 0n) {
          if (empties > 0) { s += empties; empties = 0; }
          s += 'X';
        } else if ((this.black & m) !== 0n) {
          if (empties > 0) { s += empties; empties = 0; }
          s += 'O';
        } else {
          empties++;
        }
      }
      if (empties > 0) s += empties;
      if (r > 0) s += '/';
    }
    s += ' ' + (this.side === WHITE ? 'W' : 'B');
    return s;
  }

  static fromFen(fen: string): Board {
    const b = new Board();
    const parts = fen.trim().split(/\s+/);
    const ranks = parts[0].split('/');
    if (ranks.length !== SIZE) {
      throw new Error(`Bad FEN (need ${SIZE} ranks): ${fen}`);
    }
    for (let i = 0; i < SIZE; i++) {
      const r = SIZE - 1 - i;
      let c = 0;
      for (const ch of ranks[i]) {
        if (ch >= '0' && ch <= '9') {
          c += ch.charCodeAt(0) - 48;
        } else if (ch === 'X') {
          b.white |= bit(r, c++);
        } else if (ch === 'O') {
          b.black |= bit(r, c++);
        } else {
          throw new Error(`Bad FEN char '${ch}' in: ${fen}`);
        }
      }
      if (c !== SIZE) {
        throw new Error(`Rank ${8 - i} has ${c} cols (need 8): ${fen}`);
      }
    }
    b.side = parts.length > 1 && parts[1].toUpperCase() === 'B' ? BLACK : WHITE;
    b.hash = Zobrist.compute(b.white, b.black, b.side);
    return b;
  }

  /** ASCII board for debugging. */
  toString(): string {
    let out = '\n     a b c d e f g h\n   +-----------------+\n';
    for (let r = SIZE - 1; r >= 0; r--) {
      out += ' ' + (r + 1) + ' | ';
      for (let c = 0; c < SIZE; c++) {
        const m = bit(r, c);
        let ch = '.';
        if ((this.white & m) !== 0n) ch = 'X';
        else if ((this.black & m) !== 0n) ch = 'O';
        out += ch + ' ';
      }
      out += '| ' + (r + 1) + '\n';
    }
    out += '   +-----------------+\n     a b c d e f g h\n';
    out += 'Side to move: ' + (this.side === WHITE ? 'White (X)' : 'Black (O)') + '\n';
    return out;
  }
}
