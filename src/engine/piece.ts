/** Piece / side constants, matching the Java engine. */
export const EMPTY = 0;
export const WHITE = 1;
export const BLACK = 2;
export const SIZE = 8;

export function other(side: number): number {
  return side === WHITE ? BLACK : WHITE;
}
