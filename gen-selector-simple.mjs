import { readFileSync, writeFileSync } from "node:fs";
const sample = JSON.parse(readFileSync("sample-keys.json", "utf8"));
const N = sample.length;
const accessors = sample.map(p => "m => m." + p);
const code = `import messages from "./fixture.json";
type Messages = typeof messages;
type TranslationValues = Record<string, string | number>;

// Non-generic selector — just type-checks property access, no R inference.
declare function t(selector: (m: Messages) => unknown, values?: TranslationValues): string;
declare function takesKey(selector: (m: Messages) => unknown): void;
declare function useTranslations(): {
	(selector: (m: Messages) => unknown): string;
	(selector: (m: Messages) => unknown, values: TranslationValues): string;
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

declare const sel1: (m: Messages) => unknown;
declare const sel2: (m: Messages) => unknown;
export const arr = [sel1, sel2];
export const tuple: [(m: Messages) => unknown, TranslationValues] = [${accessors[0]}, { v: "x" }];
`;
writeFileSync("repro-selector-simple.ts", code);
console.log("wrote repro-selector-simple.ts");
