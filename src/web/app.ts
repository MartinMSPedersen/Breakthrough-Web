import { Board } from '../engine/board';
import { EMPTY, WHITE, BLACK } from '../engine/piece';
import { legalMoves } from '../engine/movegen';
import * as Move from '../engine/move';
import { bitSq } from '../engine/bits';
import { BoardView } from './board-view';
import { ALL as THEMES, Theme, CLASSIC } from './themes';

/**
 * Main application. Manages game state and the engine worker, wires up the
 * board view, mode selector, controls, and engine output log.
 *
 * Modes:
 *   mp1   - engine plays White, human Black
 *   mp2   - human White, engine Black (default)
 *   two   - engine vs engine
 *   human - human vs human (no engine)
 *   analyse - engine continuously analyses the current position; human may
 *             move for either side to explore
 */
type Mode = 'mp1' | 'mp2' | 'two' | 'human' | 'analyse';

const SIZE_PX = 560;

class App {
  private board = Board.initial();
  private view: BoardView;
  private worker: Worker;
  private theme: Theme = CLASSIC;

  private mode: Mode = 'mp2';
  private depth = 4;
  private ttBits = 22;

  private selectedSq = -1;
  private history: { move: number; cap: number }[] = [];
  private thinking = false;
  private searchId = 0;
  private gameOver = false;

  // DOM
  private statusEl: HTMLElement;
  private outputEl: HTMLElement;

  constructor() {
    const canvas = document.getElementById('board') as HTMLCanvasElement;
    canvas.width = SIZE_PX;
    canvas.height = SIZE_PX;
    this.view = new BoardView(canvas);
    this.view.setClickListener((r, c) => this.onSquare(r, c));

    this.statusEl = document.getElementById('status')!;
    this.outputEl = document.getElementById('output')!;

    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onWorkerMessage(e.data);

    this.buildControls();
    this.applyTheme(this.theme);
    this.refresh();
    this.maybeEngineMove();
  }

  /* ----- controls ----- */

  private buildControls(): void {
    const modeSel = document.getElementById('mode') as HTMLSelectElement;
    modeSel.value = this.mode;
    modeSel.addEventListener('change', () => {
      this.mode = modeSel.value as Mode;
      this.note(`Mode: ${this.modeLabel(this.mode)}`);
      this.cancelSearch();
      if (this.mode === 'analyse') this.startAnalyse();
      else this.maybeEngineMove();
      this.refresh();
    });

    const depthSel = document.getElementById('depth') as HTMLSelectElement;
    depthSel.value = String(this.depth);
    depthSel.addEventListener('change', () => {
      this.depth = parseInt(depthSel.value, 10);
      this.note(`Depth: ${this.depth}`);
      if (this.mode === 'analyse') { this.cancelSearch(); this.startAnalyse(); }
    });

    const themeSel = document.getElementById('theme') as HTMLSelectElement;
    THEMES.forEach((t, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = t.name;
      themeSel.appendChild(opt);
    });
    themeSel.addEventListener('change', () => {
      this.applyTheme(THEMES[parseInt(themeSel.value, 10)]);
    });

    (document.getElementById('newgame') as HTMLButtonElement).addEventListener('click', () => this.newGame());
    (document.getElementById('flip') as HTMLButtonElement).addEventListener('click', () => {
      this.view.setFlipped(!this.view.isFlipped());
    });
    (document.getElementById('undo') as HTMLButtonElement).addEventListener('click', () => this.undo());
  }

  private modeLabel(m: Mode): string {
    return { mp1: 'Machine plays White', mp2: 'Machine plays Black', two: 'Two Machines', human: 'Human vs Human', analyse: 'Analyse' }[m];
  }

  private applyTheme(t: Theme): void {
    this.theme = t;
    this.view.setTheme(t);
    this.outputEl.style.background = t.outputBg;
    this.outputEl.style.color = t.outputFg;
    document.body.style.setProperty('--panel-bg', t.panelBg);
  }

  /* ----- game flow ----- */

  private newGame(): void {
    this.cancelSearch();
    this.board = Board.initial();
    this.history = [];
    this.selectedSq = -1;
    this.gameOver = false;
    this.view.clearLastMove();
    this.note('New game');
    this.refresh();
    if (this.mode === 'analyse') this.startAnalyse();
    else this.maybeEngineMove();
  }

  private undo(): void {
    if (this.thinking) { this.cancelSearch(); }
    // Undo back to the previous human-to-move position. In mp1/mp2 that means
    // popping two plies (engine + human); in human/two, one.
    const pops = this.mode === 'mp1' || this.mode === 'mp2' ? 2 : 1;
    for (let i = 0; i < pops; i++) {
      const last = this.history.pop();
      if (!last) break;
      this.board.undoPacked(last.move, last.cap);
    }
    this.gameOver = false;
    this.selectedSq = -1;
    const prev = this.history[this.history.length - 1];
    if (prev) this.view.setLastMove(Move.fromSq(prev.move), Move.toSq(prev.move));
    else this.view.clearLastMove();
    this.note('Undo');
    this.refresh();
    if (this.mode === 'analyse') this.startAnalyse();
  }

  private sideToMoveIsEngine(): boolean {
    if (this.mode === 'two') return true;
    if (this.mode === 'human' || this.mode === 'analyse') return false;
    const engineSide = this.mode === 'mp1' ? WHITE : BLACK;
    return this.board.side === engineSide;
  }

  private onSquare(row: number, col: number): void {
    if (this.gameOver) return;
    if (this.mode === 'analyse') { this.onSquareAnalyse(row, col); return; }
    if (this.thinking) return;
    if (this.sideToMoveIsEngine()) return;
    this.handleHumanClick(row, col);
  }

  /** Click logic shared by play modes: select own piece, then click destination. */
  private handleHumanClick(row: number, col: number): void {
    const clickedSq = row * 8 + col;
    const piece = this.board.get(row, col);

    if (this.selectedSq < 0) {
      if (piece === this.board.side) {
        this.selectSquare(clickedSq);
      }
      return;
    }
    // Already have a selection.
    if (clickedSq === this.selectedSq) {
      this.selectedSq = -1;
      this.refresh();
      return;
    }
    // Try to play selected -> clicked.
    const packed = Move.pack(this.selectedSq, clickedSq);
    if (this.isLegal(packed)) {
      this.selectedSq = -1;
      this.playMove(packed);
      this.maybeEngineMove();
    } else if (piece === this.board.side) {
      // Reselect another own piece.
      this.selectSquare(clickedSq);
    } else {
      this.selectedSq = -1;
      this.refresh();
    }
  }

  private onSquareAnalyse(row: number, col: number): void {
    // In analyse mode the human can move for either side to explore.
    const clickedSq = row * 8 + col;
    const piece = this.board.get(row, col);
    if (this.selectedSq < 0) {
      if (piece === this.board.side) this.selectSquare(clickedSq);
      return;
    }
    if (clickedSq === this.selectedSq) { this.selectedSq = -1; this.refresh(); return; }
    const packed = Move.pack(this.selectedSq, clickedSq);
    if (this.isLegal(packed)) {
      this.selectedSq = -1;
      this.cancelSearch();
      this.playMove(packed);
      if (!this.gameOver) this.startAnalyse();
    } else if (piece === this.board.side) {
      this.selectSquare(clickedSq);
    } else {
      this.selectedSq = -1;
      this.refresh();
    }
  }

  private selectSquare(sq: number): void {
    this.selectedSq = sq;
    // Compute legal destinations from this square for highlighting.
    let bb = 0n;
    for (const m of legalMoves(this.board)) {
      if (Move.fromSq(m) === sq) bb |= bitSq(Move.toSq(m));
    }
    this.view.setSelected(sq >> 3, sq & 7);
    this.view.setHighlights(bb);
  }

  private isLegal(packed: number): boolean {
    for (const m of legalMoves(this.board)) if (m === packed) return true;
    return false;
  }

  private playMove(packed: number): void {
    const cap = this.board.applyPacked(packed);
    this.history.push({ move: packed, cap });
    this.view.setLastMove(Move.fromSq(packed), Move.toSq(packed));
    this.view.clearSelection();
    this.refresh();
    this.checkGameOver();
  }

  private checkGameOver(): boolean {
    const w = this.board.winner();
    if (w !== EMPTY) {
      this.gameOver = true;
      const moveNum = Math.ceil(this.history.length / 2);
      this.setStatus(`${w === WHITE ? 'White' : 'Black'} wins on move ${moveNum}`);
      this.note(`Game over: ${w === WHITE ? 'White' : 'Black'} wins`);
      return true;
    }
    return false;
  }

  /* ----- engine ----- */

  private maybeEngineMove(): void {
    if (this.gameOver || this.thinking) return;
    if (this.mode === 'analyse' || this.mode === 'human') return;
    if (!this.sideToMoveIsEngine()) return;
    this.thinking = true;
    this.searchId++;
    this.setStatus(`Engine thinking (depth ${this.depth})…`);
    this.worker.postMessage({
      type: 'search',
      id: this.searchId,
      fen: this.board.toFen(),
      depth: this.depth,
      ttBits: this.ttBits,
    });
  }

  private startAnalyse(): void {
    if (this.gameOver) return;
    this.searchId++;
    this.setStatus('Analysing…');
    this.worker.postMessage({
      type: 'search',
      id: this.searchId,
      fen: this.board.toFen(),
      depth: 99,
      ttBits: this.ttBits,
    });
  }

  private cancelSearch(): void {
    if (this.thinking || this.mode === 'analyse') {
      this.worker.postMessage({ type: 'cancel' });
    }
    this.thinking = false;
  }

  private onWorkerMessage(msg: any): void {
    if (msg.id !== undefined && msg.id !== this.searchId) return; // stale

    if (msg.type === 'iteration') {
      const scoreStr = (msg.score >= 0 ? '+' : '') + msg.score;
      const label = this.mode === 'analyse' ? '(analyse)' : '(engine)';
      this.note(`${label} depth=${msg.depth} pv=${msg.pv.join(' ') || msg.bestMove} score=${scoreStr} nodes=${msg.nodes} ${msg.ms}ms`);
    } else if (msg.type === 'done') {
      this.thinking = false;
      if (this.mode === 'analyse' || this.mode === 'human') { this.refresh(); return; }
      if (msg.bestMove) {
        const packed = Move.parse(msg.bestMove);
        this.playMove(packed);
        if (!this.gameOver) {
          // In two-machines, keep going; in mp1/mp2, hand back to human.
          if (this.mode === 'two') this.maybeEngineMove();
          else this.setStatus(`Your move (${this.board.side === WHITE ? 'White' : 'Black'})`);
        }
      }
    } else if (msg.type === 'cancelled') {
      this.thinking = false;
    }
  }

  /* ----- view / status ----- */

  private refresh(): void {
    this.view.setBoard(this.board);
    if (this.selectedSq < 0) this.view.clearSelection();
    if (!this.gameOver && !this.thinking) {
      if (this.mode === 'analyse') this.setStatus('Analysing — move for either side to explore');
      else if (this.mode === 'human') this.setStatus(`${this.board.side === WHITE ? 'White' : 'Black'} to move`);
      else if (!this.sideToMoveIsEngine()) this.setStatus(`Your move (${this.board.side === WHITE ? 'White' : 'Black'})`);
    }
  }

  private setStatus(s: string): void {
    this.statusEl.textContent = s;
  }

  private note(s: string): void {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.textContent = `${time}  ${s}`;
    this.outputEl.appendChild(line);
    // Cap at 500 lines.
    while (this.outputEl.childElementCount > 500) this.outputEl.removeChild(this.outputEl.firstChild!);
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }
}

window.addEventListener('DOMContentLoaded', () => new App());
