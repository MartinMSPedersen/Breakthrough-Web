import { Board } from './board';
import { EMPTY, WHITE, BLACK, SIZE } from './piece';

/**
 * Position evaluation from the side-to-move's perspective.
 *
 * Two terms (see the Java original for the full rationale):
 *  1. Advancement: each piece adds a per-row weight; advanced pieces weigh
 *     more. Own pieces add, enemy pieces subtract.
 *  2. Defender bonus: a piece with a friendly piece diagonally behind it
 *     gets defenderScale * weight[row] per defender. Scale 0 disables it.
 */

export const WIN_SCORE = 100_000;
export const MAX_SCORE = WIN_SCORE + 1000;

export const DEFAULT_WEIGHTS: readonly number[] = [25, 22, 23, 27, 41, 58, 127, 1000];
export const DEFAULT_DEFENDER_SCALE = 0.0;

export class Evaluator {
  private readonly w: number[];
  private readonly defenderScale: number;

  constructor(weights: readonly number[] = DEFAULT_WEIGHTS, defenderScale = DEFAULT_DEFENDER_SCALE) {
    if (!weights || weights.length !== SIZE) {
      throw new Error(`Need ${SIZE} advancement weights`);
    }
    this.w = weights.slice();
    this.defenderScale = defenderScale;
  }

  static defaults(): Evaluator {
    return DEFAULT_EVALUATOR;
  }

  /** Parse a comma-separated weights spec, e.g. "25,22,23,27,41,58,127,1000". */
  static parse(spec: string, defenderScale = DEFAULT_DEFENDER_SCALE): Evaluator {
    const parts = spec.split(/\s*,\s*/);
    if (parts.length !== SIZE) {
      throw new Error(`Need ${SIZE} comma-separated weights, got ${parts.length}: ${spec}`);
    }
    const arr = parts.map((p) => parseInt(p.trim(), 10));
    return new Evaluator(arr, defenderScale);
  }

  weights(): number[] {
    return this.w.slice();
  }

  getDefenderScale(): number {
    return this.defenderScale;
  }

  spec(): string {
    return this.w.join(',');
  }

  evaluate(b: Board): number {
    const winner = b.winner();
    if (winner !== EMPTY) {
      return winner === b.side ? WIN_SCORE : -WIN_SCORE;
    }

    const stm = b.side;
    let score = 0;

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const p = b.get(r, c);
        if (p === EMPTY) continue;

        const adv = p === WHITE ? r : SIZE - 1 - r;
        let v = this.w[adv];

        if (this.defenderScale !== 0.0) {
          const defenders = countDefenders(b, r, c, p);
          if (defenders !== 0) {
            v += Math.round(this.defenderScale * this.w[adv] * defenders);
          }
        }

        if (p === stm) score += v;
        else score -= v;
      }
    }
    return score;
  }
}

function countDefenders(b: Board, r: number, c: number, piece: number): number {
  const defenderRow = piece === WHITE ? r - 1 : r + 1;
  if (defenderRow < 0 || defenderRow >= SIZE) return 0;
  let count = 0;
  if (c - 1 >= 0 && b.get(defenderRow, c - 1) === piece) count++;
  if (c + 1 < SIZE && b.get(defenderRow, c + 1) === piece) count++;
  return count;
}

const DEFAULT_EVALUATOR = new Evaluator(DEFAULT_WEIGHTS, DEFAULT_DEFENDER_SCALE);
