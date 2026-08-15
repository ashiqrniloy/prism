export function encodeBranchCursor(offset: number): string {
  return String(offset);
}

export function decodeBranchCursor(cursor: string): number {
  const value = Number(cursor);
  if (!Number.isInteger(value) || value < 0) throw new Error("Invalid branch pagination cursor");
  return value;
}
