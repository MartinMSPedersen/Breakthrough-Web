/**
 * Web Worker hosting the search engine. Runs off the main thread so deep
 * searches and continuous analysis never freeze the UI.
 *
 * Protocol (main → worker):
 *   { type: 'search', id, fen, depth, ttBits, weights?, defenderScale? }
 *   { type: 'cancel' }
 *
 * Protocol (worker → main):
 *   { type: 'iteration', id, depth, score, nodes, ms, bestMove, pv }   (per ID iteration)
 *   { type: 'done', id, depth, score, nodes, ms, bestMove, pv }
 *   { type: 'cancelled', id }
 */

import { Board } from '../engine/board';
import { Search } from '../engine/search';
import { Evaluator, DEFAULT_WEIGHTS, DEFAULT_DEFENDER_SCALE } from '../engine/evaluator';
import * as Move from '../engine/move';

interface SearchMsg {
  type: 'search';
  id: number;
  fen: string;
  depth: number;
  ttBits: number;
  weights?: number[];
  defenderScale?: number;
  noiseAmp?: number;
  noiseSeed?: string; // bigint serialized as decimal string (postMessage can't clone bigint reliably across all setups)
}
interface CancelMsg { type: 'cancel'; }
type InMsg = SearchMsg | CancelMsg;

// Cached Search so the TT persists across calls with the same settings —
// mirrors the cachedAnalyseSearch optimization in the Java GUI.
let cachedSearch: Search | null = null;
let cachedKey = '';
let cancelRequested = false;

function getSearch(
  ttBits: number, weights: number[], defenderScale: number,
  noiseAmp: number, noiseSeed: bigint
): Search {
  const key = `${ttBits}|${weights.join(',')}|${defenderScale}|${noiseAmp}|${noiseSeed}`;
  if (!cachedSearch || cachedKey !== key) {
    cachedSearch = new Search(ttBits, new Evaluator(weights, defenderScale), noiseAmp, noiseSeed);
    cachedKey = key;
  }
  return cachedSearch;
}

self.onmessage = (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type === 'cancel') {
    cancelRequested = true;
    return;
  }
  if (msg.type === 'search') {
    cancelRequested = false;
    const { id, fen, depth, ttBits } = msg;
    const weights = msg.weights ?? (DEFAULT_WEIGHTS as number[]).slice();
    const defenderScale = msg.defenderScale ?? DEFAULT_DEFENDER_SCALE;
    const noiseAmp = msg.noiseAmp ?? 0;
    const noiseSeed = msg.noiseSeed ? BigInt(msg.noiseSeed) : 0n;
    const board = Board.fromFen(fen);
    const search = getSearch(ttBits, weights, defenderScale, noiseAmp, noiseSeed);

    const result = search.findBest(
      board,
      depth,
      () => cancelRequested,
      (r) => {
        const pv = search.extractPv(8).map(Move.toAlgebraic);
        (self as unknown as Worker).postMessage({
          type: 'iteration',
          id,
          depth: r.depth,
          score: r.score,
          nodes: r.nodes,
          ms: r.ms,
          bestMove: r.bestMove === Move.NONE ? null : Move.toAlgebraic(r.bestMove),
          pv,
        });
      }
    );

    if (cancelRequested) {
      (self as unknown as Worker).postMessage({ type: 'cancelled', id });
    } else {
      const pv = search.extractPv(8).map(Move.toAlgebraic);
      (self as unknown as Worker).postMessage({
        type: 'done',
        id,
        depth: result.depth,
        score: result.score,
        nodes: result.nodes,
        ms: result.ms,
        bestMove: result.bestMove === Move.NONE ? null : Move.toAlgebraic(result.bestMove),
        pv,
      });
    }
  }
};
