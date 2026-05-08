// Selector variant with full ICU value type safety via GetICUArgs.
//
//   <R extends string>(selector: (m: Messages) => R, values?: GetICUArgs<R>): string
//
// Generic R preserves the literal leaf type; GetICUArgs<R> derives the values
// shape from ICU placeholders in the leaf string. This is what gives full
// "values match the message" type safety — and what we want to measure.
//
// Generates the same 100 callsites as gen-selector-leaf.mjs, then varies the
// values argument depending on what placeholders the leaf actually contains
// (looked up live from fixture.json). Plain leaves get no values; placeholder
// leaves pass a values object that matches.
import { readFileSync, writeFileSync } from "node:fs";

const sample = JSON.parse(readFileSync("sample-keys.json", "utf8"));
const fixture = JSON.parse(readFileSync("../fixture.json", "utf8"));

function leafValueAt(path) {
	const parts = path.split(".");
	let node = fixture;
	for (const p of parts) node = node[p];
	return node;
}

// Build a values literal matching the ICU placeholders in a leaf.
// Mirrors the GetICUArgs parser at runtime so emitted call sites typecheck.
function valuesLiteralFor(leaf) {
	const args = new Set();
	let needsKind = false;
	// Single-arg style: {name}
	for (const m of leaf.matchAll(/\{([a-zA-Z_$][\w$]*)\}/g)) args.add(m[1]);
	// Plural: {count, plural, ...}
	for (const m of leaf.matchAll(/\{([a-zA-Z_$][\w$]*),\s*plural/g)) args.add(m[1]);
	// Select: {kind, select, ...}
	for (const m of leaf.matchAll(/\{([a-zA-Z_$][\w$]*),\s*select/g)) {
		args.add(m[1]);
		if (m[1] === "kind") needsKind = true;
	}
	if (args.size === 0) return null;
	const props = [...args].map((a) => {
		if (a === "count") return `count: 1`;
		if (a === "kind") return `kind: "host" as const`;
		return `${a}: "x"`;
	});
	return `{ ${props.join(", ")} }`;
}

const accessors = sample.map((p) => `m => m.${p}`);
const N = sample.length;

const lines = [];
for (let i = 0; i < N; i++) {
	const leaf = leafValueAt(sample[i]);
	const values = typeof leaf === "string" ? valuesLiteralFor(leaf) : null;
	const valuesArg = values === null ? "" : `, ${values}`;
	lines.push(`takesKey(${accessors[i]});`);
	lines.push(`t(${accessors[i]}${valuesArg});`);
	lines.push(`tFn(${accessors[i]}${valuesArg});`);
}

const code = `// SPDX: variant scene — selector + GetICUArgs (full ICU value safety).
import messages from "../fixture.json";
import type { GetICUArgs } from "@schummar/icu-type-parser";
type Messages = typeof messages;

type ICUOpts = {
	ICUArgument: string | number;
	ICUNumberArgument: number;
	ICUDateArgument: Date;
};
type Args<R extends string> = GetICUArgs<R, ICUOpts>;

declare function t<R extends string>(
	selector: (m: Messages) => R,
	values?: Args<R>
): string;
declare function takesKey<R extends string>(selector: (m: Messages) => R): void;
declare function useTranslations(): {
	<R extends string>(selector: (m: Messages) => R): string;
	<R extends string>(selector: (m: Messages) => R, values: Args<R>): string;
};
const tFn = useTranslations();

${lines.join("\n")}

declare const sel1: <R extends string>(m: Messages) => R;
declare const sel2: <R extends string>(m: Messages) => R;
export const arr = [sel1, sel2];
`;

writeFileSync("repro-selector-icu.ts", code);
console.log("wrote repro-selector-icu.ts");
