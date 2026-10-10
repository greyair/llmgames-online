export interface CompiledShapePath {
  readonly contour: readonly [number, number][];
  contains(x: number, y: number): boolean;
}
export function compileShapePath(source: string): CompiledShapePath;
