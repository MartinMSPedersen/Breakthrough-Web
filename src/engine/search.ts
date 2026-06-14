import { Board } from './board';
import { EMPTY, WHITE, BLACK, SIZE } from './piece';
import { Evaluator, WIN_SCORE, MAX_SCORE } from './evaluator';
import { TT, EXACT, LOWER, UPPER } from './tt';
import * as Move from './move';
import { generate, generateQuiescence, MAX_MOVES } from './movegen';
import { FULL64, mask64 } from './bits';

/**
 * Negamax + alpha-beta + iterative deepening + TT + killers + quiescence +
 * PVS, with a triangular PV table. Faithful port of the Java Search.
 *
 * Scores are ply-indexed: a forced win/loss at distance P from the root
 * scores WIN_SCORE - P. The TT adjusts mate scores on store/probe so
 * distances don't corrupt across hits at different plies.
 */

export interface Result {
  bestMove: number; // packed, or Move.NONE
  score: number;
  nodes: number;
  depth: number;
  ms: number;
}

export type CancelFlag = () => boolean;
export type IterationCallback = (r: Result) => void;

const NEVER_CANCEL: CancelFlag = () => false;
const NO_CALLBACK: IterationCallback = () => {};

const MATE_THRESHOLD = WIN_SCORE - 1000;
const MAX_PLY = 128;
const CANCEL_CHECK_MASK = 0xfff;

/** Thrown from negamax to unwind on cancel; caught in findBest. */
class Cancelled extends Error {}
const CANCEL_SENTINEL = new Cancelled();

export class Search {
  private readonly ttRef: TT;
  private readonly evalRef: Evaluator;
  private readonly noiseAmp: number;
  private readonly noiseSeed: bigint;
  private nodes = 0;

  private readonly moveBuf: Int32Array[] = [];
  private readonly orderScoreBuf: Int32Array[] = [];
  private readonly killers: Int32Array[] = [];
  private readonly pvTable: Int32Array[] = [];
  private readonly pvLen: Int32Array = new Int32Array(MAX_PLY);
  private rootPv: number[] = [];

  private cancel: CancelFlag = NEVER_CANCEL;
  private callback: IterationCallback = NO_CALLBACK;

  constructor(ttBits = 20, evaluator: Evaluator = Evaluator.defaults(), noiseAmp = 0, noiseSeed = 0n) {
    this.ttRef = new TT(ttBits);
    this.evalRef = evaluator;
    this.noiseAmp = Math.max(0, noiseAmp);
    this.noiseSeed = noiseSeed;
    for (let i = 0; i < MAX_PLY; i++) {
      this.moveBuf.push(new Int32Array(MAX_MOVES));
      this.orderScoreBuf.push(new Int32Array(MAX_MOVES));
      this.killers.push(new Int32Array(2));
      this.pvTable.push(new Int32Array(MAX_PLY));
    }
  }

  tt(): TT {
    return this.ttRef;
  }

  evaluator(): Evaluator {
    return this.evalRef;
  }

  findBest(
    b: Board,
    maxDepth: number,
    cancel: CancelFlag = NEVER_CANCEL,
    cb: IterationCallback = NO_CALLBACK
  ): Result {
    this.clearKillers();
    this.cancel = cancel ?? NEVER_CANCEL;
    this.callback = cb ?? NO_CALLBACK;

    let bestMovePacked = Move.NONE;
    let bestScore = 0;
    let bestNodes = 0;
    let bestDepth = 0;
    let totalNodes = 0;
    const t0 = Date.now();

    for (let d = 1; d <= maxDepth; d++) {
      if (this.cancel()) break;
      this.nodes = 0;
      let score: number;
      try {
        score = this.negamax(b, d, 0, -MAX_SCORE, MAX_SCORE);
      } catch (e) {
        if (e instanceof Cancelled) {
          // Discard the partial iteration; its TT entries would poison future
          // searches, so wipe the table.
          this.ttRef.clear();
          break;
        }
        throw e;
      }
      totalNodes += this.nodes;
      bestScore = score;
      bestNodes = totalNodes;
      bestDepth = d;
      const rootE = this.ttRef.probe(b.hash);
      if (rootE !== null) bestMovePacked = rootE.bestMove;
      const rootLen = this.pvLen[0];
      this.rootPv = Array.from(this.pvTable[0].subarray(0, rootLen));

      const elapsed = Date.now() - t0;
      this.callback({
        bestMove: bestMovePacked,
        score,
        nodes: totalNodes,
        depth: d,
        ms: elapsed,
      });
      if (Math.abs(score) >= MATE_THRESHOLD) break;
    }

    this.cancel = NEVER_CANCEL;
    this.callback = NO_CALLBACK;
    return {
      bestMove: bestMovePacked,
      score: bestScore,
      nodes: bestNodes,
      depth: bestDepth,
      ms: Date.now() - t0,
    };
  }

  private clearKillers(): void {
    for (let i = 0; i < MAX_PLY; i++) {
      this.killers[i][0] = Move.NONE;
      this.killers[i][1] = Move.NONE;
    }
  }

  /** PV from the last completed iteration, capped at maxLength. */
  extractPv(maxLength: number): number[] {
    const n = Math.min(maxLength, this.rootPv.length);
    return this.rootPv.slice(0, n);
  }

  private rememberKiller(ply: number, packedMove: number): void {
    if (ply >= MAX_PLY) return;
    const slot0 = this.killers[ply][0];
    if (packedMove === slot0) return;
    this.killers[ply][1] = slot0;
    this.killers[ply][0] = packedMove;
  }

  private negamax(b: Board, depth: number, ply: number, alpha: number, beta: number): number {
    this.nodes++;
    if ((this.nodes & CANCEL_CHECK_MASK) === 0 && this.cancel()) {
      throw CANCEL_SENTINEL;
    }
    if (ply < MAX_PLY) this.pvLen[ply] = 0;
    const alphaOrig = alpha;
    const hash = b.hash;

    /* TT probe */
    let ttMove = Move.NONE;
    const ttE = this.ttRef.probe(hash);
    if (ttE !== null) {
      ttMove = ttE.bestMove;
      if (ttE.depth >= depth) {
        const ttScore = adjustMateFromTT(ttE.score, ply);
        if (ttE.flag === EXACT) return ttScore;
        else if (ttE.flag === LOWER) { if (ttScore > alpha) alpha = ttScore; }
        else if (ttE.flag === UPPER) { if (ttScore < beta) beta = ttScore; }
        if (alpha >= beta) return ttScore;
      }
    }

    /* Terminal / leaf */
    const winner = b.winner();
    if (winner !== EMPTY) {
      return winner === b.side ? WIN_SCORE - ply : -(WIN_SCORE - ply);
    }
    if (depth === 0) {
      return this.quiesce(b, alpha, beta, ply);
    }

    /* Move generation */
    const moves = this.moveBuf[ply];
    const n = generate(b, moves);
    if (n === 0) {
      return -(WIN_SCORE - ply);
    }

    /* Move ordering scores */
    const side = b.side;
    const killer0 = ply < MAX_PLY ? this.killers[ply][0] : Move.NONE;
    const killer1 = ply < MAX_PLY ? this.killers[ply][1] : Move.NONE;
    const scores = this.orderScoreBuf[ply];
    for (let i = 0; i < n; i++) {
      scores[i] = orderScore(b, side, moves[i], ttMove, killer0, killer1);
    }

    /* PVS over children */
    let bestMove = moves[0];
    let bestScore = -MAX_SCORE;
    let searchedPV = false;
    for (let i = 0; i < n; i++) {
      // Selection-sort the next best move into position i.
      let maxIdx = i;
      let maxVal = scores[i];
      for (let j = i + 1; j < n; j++) {
        if (scores[j] > maxVal) { maxVal = scores[j]; maxIdx = j; }
      }
      if (maxIdx !== i) {
        const tm = moves[i]; moves[i] = moves[maxIdx]; moves[maxIdx] = tm;
        const ts = scores[i]; scores[i] = scores[maxIdx]; scores[maxIdx] = ts;
      }

      const m = moves[i];
      const cap = b.applyPacked(m);

      let s: number;
      if (!searchedPV) {
        s = -this.negamax(b, depth - 1, ply + 1, -beta, -alpha);
        searchedPV = true;
      } else {
        // Zero-window scout.
        s = -this.negamax(b, depth - 1, ply + 1, -alpha - 1, -alpha);
        if (s > alpha && s < beta) {
          // Fail-high scout is a BOUND, never exact — always re-search,
          // including at depth 1. (See the long Java comment: skipping this
          // at depth 1 produced false mate scores and a real game blunder.)
          s = -this.negamax(b, depth - 1, ply + 1, -beta, -alpha);
        }
      }

      b.undoPacked(m, cap);

      if (s > bestScore) { bestScore = s; bestMove = m; }
      if (s > alpha) {
        alpha = s;
        if (ply < MAX_PLY) {
          this.pvTable[ply][0] = m;
          let childLen = ply + 1 < MAX_PLY ? this.pvLen[ply + 1] : 0;
          if (childLen > MAX_PLY - 1 - ply) childLen = MAX_PLY - 1 - ply;
          for (let k = 0; k < childLen; k++) {
            this.pvTable[ply][k + 1] = this.pvTable[ply + 1][k];
          }
          this.pvLen[ply] = childLen + 1;
        }
      }
      if (alpha >= beta) {
        if (cap === EMPTY) this.rememberKiller(ply, m);
        break;
      }
    }

    /* TT store */
    let flag: number;
    if (bestScore <= alphaOrig) flag = UPPER;
    else if (bestScore >= beta) flag = LOWER;
    else flag = EXACT;
    this.ttRef.store(hash, depth, adjustMateToTT(bestScore, ply), flag, bestMove);

    return bestScore;
  }

  private quiesce(b: Board, alpha: number, beta: number, ply: number): number {
    this.nodes++;

    const winner = b.winner();
    if (winner !== EMPTY) {
      return winner === b.side ? WIN_SCORE - ply : -(WIN_SCORE - ply);
    }
    if (ply >= MAX_PLY) return this.leafEval(b);

    const standPat = this.leafEval(b);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;

    const caps = this.moveBuf[ply];
    const n = generateQuiescence(b, caps);
    if (n === 0) return alpha;

    const side = b.side;
    const scores = this.orderScoreBuf[ply];
    for (let i = 0; i < n; i++) scores[i] = advanceBonusPacked(side, caps[i]);

    for (let i = 0; i < n; i++) {
      let maxIdx = i;
      let maxVal = scores[i];
      for (let j = i + 1; j < n; j++) {
        if (scores[j] > maxVal) { maxVal = scores[j]; maxIdx = j; }
      }
      if (maxIdx !== i) {
        const tm = caps[i]; caps[i] = caps[maxIdx]; caps[maxIdx] = tm;
        const ts = scores[i]; scores[i] = scores[maxIdx]; scores[maxIdx] = ts;
      }

      const m = caps[i];
      const cap = b.applyPacked(m);
      const score = -this.quiesce(b, -beta, -alpha, ply + 1);
      b.undoPacked(m, cap);

      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  private leafEval(b: Board): number {
    const s = this.evalRef.evaluate(b);
    if (this.noiseAmp === 0) return s;
    const h = splitmix64(b.hash ^ this.noiseSeed);
    const span = BigInt(2 * this.noiseAmp + 1);
    const n = Number(((h % span) + span) % span) - this.noiseAmp;
    return s + n;
  }
}

/* ----- Move ordering ----- */

function orderScore(
  b: Board,
  side: number,
  packedMove: number,
  ttMove: number,
  killer0: number,
  killer1: number
): number {
  if (packedMove === ttMove) return 1_000_000;
  const toSq = packedMove & 0x3f;
  const oppBits = side === WHITE ? b.black : b.white;
  const capture = ((oppBits >> BigInt(toSq)) & 1n) !== 0n;
  if (capture) return 10_000 + advanceBonusPacked(side, packedMove);
  if (packedMove === killer0) return 900;
  if (packedMove === killer1) return 800;
  return advanceBonusPacked(side, packedMove);
}

function advanceBonusPacked(side: number, packedMove: number): number {
  const toRow = (packedMove & 0x3f) >>> 3;
  const homeRow = side === WHITE ? SIZE - 1 : 0;
  return 100 - Math.abs(homeRow - toRow) * 10;
}

/* ----- Mate-score adjustment around the TT ----- */

function adjustMateToTT(score: number, ply: number): number {
  if (score >= MATE_THRESHOLD) return score + ply;
  if (score <= -MATE_THRESHOLD) return score - ply;
  return score;
}

function adjustMateFromTT(score: number, ply: number): number {
  if (score >= MATE_THRESHOLD) return score - ply;
  if (score <= -MATE_THRESHOLD) return score + ply;
  return score;
}

/* ----- 64-bit splitmix64 for deterministic leaf noise ----- */

function splitmix64(x: bigint): bigint {
  x = mask64(x + 0x9e3779b97f4a7c15n);
  x = mask64((x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n);
  x = mask64((x ^ (x >> 27n)) * 0x94d049bb133111ebn);
  return (x ^ (x >> 31n)) & FULL64;
}
