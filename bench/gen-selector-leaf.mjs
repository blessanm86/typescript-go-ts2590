// Selector variant that constrains return to string (so non-string leaves error).
// No generic <R> — just (m: Messages) => string.
import { readFileSync, writeFileSync } from "node:fs";
const sample = JSON.parse(readFileSync("sample-keys.json", "utf8"));
const accessors = sample.map(p => "m => m." + p);
const N = sample.length;
const code = `import messages from "../fixture.json";
type Messages = typeof messages;
type TranslationValues = Record<string, string | number>;

declare function t(selector: (m: Messages) => string, values?: TranslationValues): string;
declare function takesKey(selector: (m: Messages) => string): void;
declare function useTranslations(): {
	(selector: (m: Messages) => string): string;
	(selector: (m: Messages) => string, values: TranslationValues): string;
};
const tFn = useTranslations();

` + (() => {
	const lines = [];
	for (let i = 0; i < N; i++) {
		lines.push(`takesKey(${accessors[i]});`);
		lines.push(`t(${accessors[i]});`);
		lines.push(`tFn(${accessors[i]});`);
	}
	return lines.join("\n");
})() + `

declare const sel1: (m: Messages) => string;
declare const sel2: (m: Messages) => string;
export const arr = [sel1, sel2];
export const tuple: [(m: Messages) => string, TranslationValues] = [${accessors[0]}, { v: "x" }];
`;
writeFileSync("repro-selector-leaf.ts", code);
console.log("wrote repro-selector-leaf.ts");
