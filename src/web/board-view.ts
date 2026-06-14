import { Board } from '../engine/board';
import { EMPTY, WHITE } from '../engine/piece';
import { Theme, CLASSIC } from './themes';
import { ntz } from '../engine/bits';

/**
 * Canvas-based board renderer + interaction. Pure view: holds a Board
 * snapshot plus selection/highlight/last-move state handed in by the app,
 * converts pointer events to (row,col), and forwards them to a listener.
 *
 * Port of BoardPanel.java, including click-select, drag-and-drop with a
 * pixel threshold, last-move/selection/destination overlays, coordinate
 * labels, and flip-view.
 */

export type SquareClickListener = (row: number, col: number) => void;

const DRAG_THRESHOLD = 5;

export class BoardView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private theme: Theme = CLASSIC;

  private board: Board = Board.initial();
  private selectedSq = -1;
  private highlights = 0n;
  private lastFromSq = -1;
  private lastToSq = -1;
  private flipped = false;
  private showLabels = true;

  // Drag state.
  private pressSq = -1;
  private pressX = 0;
  private pressY = 0;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;

  private listener: SquareClickListener | null = null;

  // Cached geometry, recomputed on each render / used for hit-testing.
  private geom = { x0: 0, y0: 0, cell: 1, boardSize: 8 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.attachPointer();
  }

  setTheme(t: Theme): void { this.theme = t; this.render(); }
  setBoard(b: Board): void { this.board = b; this.render(); }
  setSelected(row: number, col: number): void {
    this.selectedSq = row < 0 ? -1 : row * 8 + col;
    this.render();
  }
  clearSelection(): void { this.selectedSq = -1; this.highlights = 0n; this.render(); }
  setHighlights(bb: bigint): void { this.highlights = bb; this.render(); }
  setLastMove(fromSq: number, toSq: number): void {
    this.lastFromSq = fromSq; this.lastToSq = toSq; this.render();
  }
  clearLastMove(): void { this.lastFromSq = -1; this.lastToSq = -1; this.render(); }
  setShowLabels(s: boolean): void { this.showLabels = s; this.render(); }
  setFlipped(f: boolean): void { this.flipped = f; this.render(); }
  isFlipped(): boolean { return this.flipped; }
  setClickListener(l: SquareClickListener): void { this.listener = l; }

  /* ----- geometry ----- */

  private recomputeGeometry(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const side = Math.min(w, h);
    const margin = Math.floor(side / 16);
    const boardSide = side - 2 * margin;
    const cell = Math.floor(boardSide / 8);
    const boardSize = cell * 8;
    this.geom = {
      x0: Math.floor((w - boardSize) / 2),
      y0: Math.floor((h - boardSize) / 2),
      cell,
      boardSize,
    };
  }

  private squareAt(mx: number, my: number): number {
    const { x0, y0, cell, boardSize } = this.geom;
    const cx = mx - x0;
    const cy = my - y0;
    if (cx < 0 || cy < 0 || cx >= boardSize || cy >= boardSize) return -1;
    const col = Math.floor(cx / cell);
    const rowFromTop = Math.floor(cy / cell);
    const row = this.flipped ? rowFromTop : 7 - rowFromTop;
    return row * 8 + col;
  }

  /** Convert a client (mouse/touch) event to canvas-pixel coordinates. */
  private toCanvasXY(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / rect.width;
    const sy = this.canvas.height / rect.height;
    return [(clientX - rect.left) * sx, (clientY - rect.top) * sy];
  }

  /* ----- pointer handling ----- */

  private attachPointer(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = this.toCanvasXY(e.clientX, e.clientY);
      const sq = this.squareAt(x, y);
      if (sq < 0) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.pressSq = sq;
      this.pressX = x;
      this.pressY = y;
      this.dragging = false;
      if (this.listener) this.listener(sq >> 3, sq & 7);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const [x, y] = this.toCanvasXY(e.clientX, e.clientY);
      if (this.pressSq < 0) {
        // Hover cursor: hand over own pieces.
        const sq = this.squareAt(x, y);
        let cursor = 'default';
        if (sq >= 0) {
          const p = this.board.get(sq >> 3, sq & 7);
          if (p === this.board.side) cursor = 'grab';
        }
        this.canvas.style.cursor = cursor;
        return;
      }
      this.dragX = x;
      this.dragY = y;
      if (!this.dragging) {
        const dx = x - this.pressX;
        const dy = y - this.pressY;
        if (dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
          if (this.selectedSq === this.pressSq) {
            this.dragging = true;
            this.canvas.style.cursor = 'grabbing';
          }
        }
      }
      if (this.dragging) this.render();
    });

    const endDrag = (e: PointerEvent) => {
      if (this.pressSq < 0) return;
      const [x, y] = this.toCanvasXY(e.clientX, e.clientY);
      const releaseSq = this.squareAt(x, y);
      const wasDragging = this.dragging;
      const srcSq = this.pressSq;
      this.pressSq = -1;
      this.dragging = false;
      this.canvas.style.cursor = 'default';
      if (wasDragging) {
        if (releaseSq === srcSq || releaseSq < 0) {
          this.render();
          return;
        }
        if (this.listener) this.listener(releaseSq >> 3, releaseSq & 7);
      }
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', () => {
      this.pressSq = -1;
      this.dragging = false;
      this.canvas.style.cursor = 'default';
      this.render();
    });
  }

  /* ----- rendering ----- */

  render(): void {
    this.recomputeGeometry();
    const g = this.ctx;
    const { x0, y0, cell, boardSize } = this.geom;
    const t = this.theme;

    g.fillStyle = t.panelBg;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Squares
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sx = x0 + c * cell;
        const sy = y0 + (this.flipped ? r : 7 - r) * cell;
        g.fillStyle = ((r + c) & 1) === 0 ? t.darkSq : t.lightSq;
        g.fillRect(sx, sy, cell, cell);
      }
    }

    // Overlays
    if (this.lastFromSq >= 0) this.overlay(this.lastFromSq, t.lastMv);
    if (this.lastToSq >= 0) this.overlay(this.lastToSq, t.lastMv);
    if (this.selectedSq >= 0) this.overlay(this.selectedSq, t.selSq);
    let bb = this.highlights;
    while (bb !== 0n) {
      const sq = ntz(bb);
      this.overlay(sq, t.hlDest);
      bb &= bb - 1n;
    }

    // Pieces (skip the dragged source)
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board.get(r, c);
        if (p === EMPTY) continue;
        const thisSq = r * 8 + c;
        if (this.dragging && thisSq === this.pressSq) continue;
        const sx = x0 + c * cell;
        const sy = y0 + (this.flipped ? r : 7 - r) * cell;
        this.drawPiece(p, sx, sy, cell);
      }
    }

    // Labels
    if (this.showLabels) {
      g.fillStyle = t.label;
      const fontPx = Math.max(14, Math.floor(cell / 3.5));
      g.font = `bold ${fontPx}px sans-serif`;
      g.textBaseline = 'alphabetic';
      for (let c = 0; c < 8; c++) {
        const s = String.fromCharCode(97 + c);
        const tw = g.measureText(s).width;
        const sx = x0 + c * cell + (cell - tw) / 2;
        g.fillText(s, sx, y0 + boardSize + fontPx + 2);
      }
      for (let r = 0; r < 8; r++) {
        const s = String(r + 1);
        const tw = g.measureText(s).width;
        const sy = y0 + (this.flipped ? r : 7 - r) * cell + (cell + fontPx) / 2 - 2;
        g.fillText(s, x0 - tw - 4, sy);
      }
    }

    // Floating drag piece
    if (this.dragging && this.pressSq >= 0) {
      const r = this.pressSq >> 3;
      const c = this.pressSq & 7;
      const p = this.board.get(r, c);
      if (p !== EMPTY) {
        const pad = Math.max(4, Math.floor(cell / 8));
        const d = cell - 2 * pad;
        this.drawPieceCircle(p, this.dragX - d / 2, this.dragY - d / 2, d, cell);
      }
    }
  }

  private overlay(sq: number, color: string): void {
    const { x0, y0, cell } = this.geom;
    const r = sq >> 3;
    const col = sq & 7;
    const sx = x0 + col * cell;
    const sy = y0 + (this.flipped ? r : 7 - r) * cell;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(sx, sy, cell, cell);
  }

  private drawPiece(p: number, sx: number, sy: number, cell: number): void {
    const pad = Math.max(4, Math.floor(cell / 8));
    const d = cell - 2 * pad;
    this.drawPieceCircle(p, sx + pad, sy + pad, d, cell);
  }

  private drawPieceCircle(p: number, x: number, y: number, d: number, cell: number): void {
    const g = this.ctx;
    const t = this.theme;
    const cx = x + d / 2;
    const cy = y + d / 2;
    const radius = d / 2;
    g.beginPath();
    g.arc(cx, cy, radius, 0, Math.PI * 2);
    g.fillStyle = p === WHITE ? t.whitePc : t.blackPc;
    g.fill();
    g.lineWidth = Math.max(1, cell / 28);
    g.strokeStyle = p === WHITE ? t.whiteEdge : t.blackEdge;
    g.stroke();
  }
}
