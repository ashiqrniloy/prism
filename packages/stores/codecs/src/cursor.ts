export function encodeBranchCursor(offset: number): string {
  return String(offset);
}

export function decodeBranchCursor(cursor: string): number {
  if (cursor.length > 16 || !/^(0|[1-9]\d*)$/.test(cursor)) throw new Error("Invalid branch pagination cursor");
  const value = Number(cursor);
  if (!Number.isSafeInteger(value)) throw new Error("Invalid branch pagination cursor");
  return value;
}
