// Scramble a source JSON into a shape-preserving synthetic fixture.
//
// Usage:
//   node scramble.mjs <source.json> <output.json>
//
// What is preserved (anything that affects the tsgo TS2590 trigger):
//   - Exact tree structure (every object node, every key position).
//   - Exact length of every key string (keys become "k<digit+pad>" of
//     the same character count as the original). Length matters for the
//     template-literal union that `NestedKeyOf` produces — shorter keys
//     give shorter paths give a different-shape union.
//   - Leaf type: strings stay strings, arrays stay arrays, numbers stay
//     numbers. Values are replaced with deterministic placeholders.
//
// What is scrubbed:
//   - The alphabetic content of all keys and string values.
//   - Any interpolation syntax inside leaf strings ({name}, ICU plurals,
//     etc.). Those are irrelevant to the type-check as `string` is the
//     leaf type regardless.

import { readFileSync, writeFileSync } from "node:fs";

const [, , src, dst] = process.argv;
if (!src || !dst) {
	console.error("Usage: node scramble.mjs <source.json> <output.json>");
	process.exit(1);
}

const input = JSON.parse(readFileSync(src, "utf8"));

// Deterministic counter so the same input produces the same output.
let keyCounter = 0;

function scrambleKey(original) {
	const n = keyCounter++;
	const digits = String(n);
	// Keep the key's original length so the resulting template-literal union
	// members match the original in length. If the counter digits exceed the
	// original length, we simply use the digits (won't happen for sensible inputs).
	if (digits.length >= original.length) {
		return "k" + digits;
	}
	// "k" + digits + padding up to original length.
	const padLen = original.length - ("k".length + digits.length);
	return "k" + digits + "x".repeat(Math.max(0, padLen));
}

function scrambleValue(v) {
	if (v === null || v === undefined) return v;
	if (typeof v === "string") {
		// Replace with a short placeholder. Value strings do not affect the
		// union because leaves in `MessageKeys<T, NestedKeyOf<T>>` are only
		// checked for `extends string`.
		return "v";
	}
	if (typeof v === "number" || typeof v === "boolean") return v;
	if (Array.isArray(v)) return v.map(scrambleValue);
	if (typeof v === "object") return scrambleObject(v);
	return v;
}

function scrambleObject(obj) {
	const out = {};
	for (const k of Object.keys(obj)) {
		out[scrambleKey(k)] = scrambleValue(obj[k]);
	}
	return out;
}

const output = scrambleObject(input);
writeFileSync(dst, JSON.stringify(output, null, 2) + "\n");

// Report some shape statistics so we can sanity-check parity.
function stats(obj) {
	let leaves = 0;
	let paths = 0;
	let maxDepth = 0;
	function walk(node, depth) {
		maxDepth = Math.max(maxDepth, depth);
		for (const k of Object.keys(node)) {
			paths++;
			const v = node[k];
			if (v !== null && typeof v === "object" && !Array.isArray(v)) {
				walk(v, depth + 1);
			} else {
				leaves++;
			}
		}
	}
	walk(obj, 1);
	return { leaves, paths, maxDepth };
}

const inStats = stats(input);
const outStats = stats(output);
console.log("source:", inStats);
console.log("output:", outStats);
if (JSON.stringify(inStats) !== JSON.stringify(outStats)) {
	console.error("Shape mismatch!");
	process.exit(1);
}
console.log("Shape preserved.");
