// Selector variant — generic R but values stay permissive (plain TranslationValues).
//
//   <R extends string>(selector: (m: Messages) => R, values?: TranslationValues): string
//
// This decomposes the cost: vs selector-leaf we add per-callsite generic
// instantiation; vs selector-icu we drop GetICUArgs<R>. Tells us which one
// the bill is for.
import { readFileSync, writeFileSync } from "node:fs";

const sample = JSON.parse(readFileSync("sample-keys.json", "utf8"));
const accessors = sample.map((p) => `m => m.${p}`);
const N = sample.length;

const lines = [];
for (let i = 0; i < N; i++) {
	lines.push(`takesKey(${accessors[i]});`);
	lines.push(`t(${accessors[i]});`);
	lines.push(`tFn(${accessors[i]});`);
}

const code = `// SPDX: variant scene — generic selector with permissive values (no ICU parsing).
import messages from "../fixture.json";
type Messages = typeof messages;
type TranslationValues = Record<string, string | number>;

declare function t<R extends string>(
	selector: (m: Messages) => R,
	values?: TranslationValues
): string;
declare function takesKey<R extends string>(selector: (m: Messages) => R): void;
declare function useTranslations(): {
	<R extends string>(selector: (m: Messages) => R): string;
	<R extends string>(selector: (m: Messages) => R, values: TranslationValues): string;
};
const tFn = useTranslations();

${lines.join("\n")}

declare const sel1: <R extends string>(m: Messages) => R;
declare const sel2: <R extends string>(m: Messages) => R;
export const arr = [sel1, sel2];
`;

writeFileSync("repro-selector-generic.ts", code);
console.log("wrote repro-selector-generic.ts");
