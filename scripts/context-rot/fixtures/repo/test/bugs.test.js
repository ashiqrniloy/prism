import { expect, test } from "bun:test";
import {
  binarySearch,
  chunk,
  clamp,
  countVowels,
  flattenOne,
  formatCents,
  parseKeyValues,
  reverseWords,
  sumRange,
  uniqueSorted,
} from "../src/bugs.js";

test("sumRange sums 1..n", () => {
  expect(sumRange(5)).toBe(15);
});

test("reverseWords reverses word order", () => {
  expect(reverseWords("hello brave world")).toBe("world brave hello");
});

test("uniqueSorted returns unique values in order", () => {
  expect(uniqueSorted([3, 1, 3, 2])).toEqual([1, 2, 3]);
});

test("chunk keeps the final short chunk", () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
});

test("parseKeyValues accepts equals lines", () => {
  expect(parseKeyValues("a=1\nb=two")).toEqual({ a: "1", b: "two" });
});

test("clamp bounds value", () => {
  expect(clamp(12, 0, 10)).toBe(10);
  expect(clamp(-3, 0, 10)).toBe(0);
});

test("countVowels counts a e i o u only", () => {
  expect(countVowels("rhythm and vowels")).toBe(4);
});

test("flattenOne flattens one level", () => {
  expect(flattenOne([1, [2, 3], [4]])).toEqual([1, 2, 3, 4]);
});

test("formatCents pads cents", () => {
  expect(formatCents(1205)).toBe("12.05");
  expect(formatCents(7)).toBe("0.07");
});

test("binarySearch finds last element", () => {
  expect(binarySearch([1, 3, 5, 7], 7)).toBe(3);
  expect(binarySearch([1, 3, 5, 7], 4)).toBe(-1);
});
