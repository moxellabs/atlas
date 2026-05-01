import { describe, expect, test } from "bun:test";

import { decodeJson, decodeJsonArray, encodeJson } from "./json";

describe("store JSON helpers", () => {
	test("encodeJson serializes structured values", () => {
		expect(encodeJson({ b: 2, a: [1] })).toBe('{"b":2,"a":[1]}');
	});

	test("decodeJson returns undefined for nullish and empty values", () => {
		expect(decodeJson(null, "metadata")).toBeUndefined();
		expect(decodeJson(undefined, "metadata")).toBeUndefined();
		expect(decodeJson("", "metadata")).toBeUndefined();
	});

	test("decodeJson parses valid JSON and labels invalid JSON errors", () => {
		expect(decodeJson<{ ok: boolean }>('{"ok":true}', "metadata")).toEqual({
			ok: true,
		});
		expect(() => decodeJson("{", "metadata")).toThrow(
			/metadata must contain valid JSON/,
		);
	});

	test("decodeJsonArray returns empty arrays for nullish and empty values", () => {
		expect(decodeJsonArray(null, "items")).toEqual([]);
		expect(decodeJsonArray(undefined, "items")).toEqual([]);
		expect(decodeJsonArray("", "items")).toEqual([]);
	});

	test("decodeJsonArray parses arrays and rejects non-array JSON", () => {
		expect(decodeJsonArray<string>('["a","b"]', "items")).toEqual(["a", "b"]);
		expect(() => decodeJsonArray('{"a":1}', "items")).toThrow(
			"items must contain a JSON array.",
		);
		expect(() => decodeJsonArray("{", "items")).toThrow();
	});
});
