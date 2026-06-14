import { Board } from './engine/board';
import { Search } from './engine/search';
import { Evaluator } from './engine/evaluator';
import * as Move from './engine/move';
import { legalMoves } from './engine/movegen';
import { EMPTY } from './engine/piece';

function pvStr(pv: number[]): string {
  return pv.map(Move.toAlgebraic).join(' ');
}

console.log('=== Search from the initial position ===');
{
  const b = Board.initial();
  for (const d of [4, 6, 8]) {
    const s = new Search(20, Evaluator.defaults());
    const t0 = Date.now();
    const r = s.findBest(b, d);
    const ms = Date.now() - t0;
    const pv = s.extractPv(6);
    console.log(
      `depth=${d}  best=${Move.toAlgebraic(r.bestMove)}  score=${r.score >= 0 ? '+' : ''}${r.score}  ` +
        `nodes=${r.nodes}  pv=${pvStr(pv)}  (${ms} ms)`
    );
  }
}

console.log();
console.log('=== Critical bug-fix position (after 24. f6g7, Black to move) ===');
console.log('Black should choose h8g7 (the saving capture), NOT h8h7.');
{
  // Position the user reported: rebuilt from the .game file, ply 47.
  // Reconstructed FEN from the annotation board diagram:
  //  8: O O . O . . . O
  //  7: . . . . . O X .
  //  6: . O O O . . O .
  //  5: . . . . . . . .
  //  4: . X . O . . O .
  //  3: . X . . . . X O
  //  2: . . X X X X X X
  //  1: X . . . . . X X
  const fen = 'OO1O3O/5OX1/1OOO2O1/8/1X1O2O1/1X4XO/2XXXXXX/X5XX B';
  const b = Board.fromFen(fen);
  const legal = legalMoves(b).map(Move.toAlgebraic);
  console.log('h8g7 legal? ' + legal.includes('h8g7'));
  for (const d of [4, 8, 12]) {
    const s = new Search(22, Evaluator.defaults());
    const r = s.findBest(b, d);
    const pv = s.extractPv(6);
    const ok = Move.toAlgebraic(r.bestMove) === 'h8g7';
    console.log(
      `depth=${d}  best=${Move.toAlgebraic(r.bestMove)}  score=${r.score >= 0 ? '+' : ''}${r.score}  ` +
        `pv=${pvStr(pv)}  ${ok ? 'OK' : 'WRONG'}`
    );
  }
}

console.log();
console.log('=== Engine self-play sanity (depth 4, 60 ply cap) ===');
{
  const b = Board.initial();
  let plies = 0;
  while (b.winner() === EMPTY && plies < 60) {
    const s = new Search(18, Evaluator.defaults());
    const r = s.findBest(b, 4);
    if (r.bestMove === Move.NONE) break;
    b.applyPacked(r.bestMove);
    plies++;
  }
  const w = b.winner();
  console.log(
    `Played ${plies} plies; result: ` +
      (w === EMPTY ? 'no winner within cap' : w === 1 ? 'White wins' : 'Black wins')
  );
  console.log('Final position:' + b.toString());
}
