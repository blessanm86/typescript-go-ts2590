// Generate four variant scene files with the same usage shape but different
// underlying type machinery for translation keys. Each variant:
//   1. defines its own BigUnion / Selector type
//   2. declares N typed-prop functions and N call sites
//   3. has the original [k1, k2] TS2590 trigger
//   4. has a [Key, Values] tuple shape mirroring the deprecated getTranslationProps
//   5. has a useTranslations() stub call site to mirror Ben's hot-path concern
import { readFileSync, writeFileSync } from "node:fs";
const sample = JSON.parse(readFileSync("sample-keys.json", "utf8"));
const N = sample.length;

function callSitesString(getKeyExpr) {
	// N call sites: each calls `takesKey(<expr>)` and `t(<expr>)` and `useT()(<expr>)`.
	const lines = [];
	for (let i = 0; i < N; i++) {
		lines.push(`takesKey(${getKeyExpr(i)});`);
		lines.push(`t(${getKeyExpr(i)});`);
		lines.push(`tFn(${getKeyExpr(i)});`);
	}
	return lines.join("\n");
}

const HEADER = `// SPDX: variant scene for tsgo TS2590 + perf testbed.\nimport messages from "./fixture.json";\ntype Messages = typeof messages;\ntype TranslationValues = Record<string, string | number>;\n`;

// --- baseline (current production approach) ---
{
	const code = HEADER + `
type NestedKeyOf<ObjectType> = ObjectType extends object
	? { [P in keyof ObjectType]: \`\${P & string}\` | \`\${P & string}.\${NestedKeyOf<ObjectType[P]>}\` }[keyof ObjectType]
	: never;
type NestedValueOf<ObjectType, Path extends string> = Path extends \`\${infer Cur}.\${infer Rest}\`
	? Cur extends keyof ObjectType ? NestedValueOf<ObjectType[Cur], Rest> : never
	: Path extends keyof ObjectType ? ObjectType[Path] : never;
type MessageKeys<ObjectType, AllKeys extends string> = {
	[P in AllKeys]: NestedValueOf<ObjectType, P> extends string ? P : never;
}[AllKeys];

export type BigUnion = MessageKeys<Messages, NestedKeyOf<Messages>>;

declare function takesKey(label: BigUnion): void;
declare function t(key: BigUnion, values?: TranslationValues): string;
declare function getTranslationProps(input: BigUnion | [BigUnion, TranslationValues]): [BigUnion, TranslationValues | undefined];
declare function useTranslations(): { (key: BigUnion): string; (key: BigUnion, values: TranslationValues): string };

const tFn = useTranslations();

` + callSitesString(i => JSON.stringify(sample[i])) + `

declare const k1: BigUnion;
declare const k2: BigUnion;
export const arr = [k1, k2]; // TS2590 trigger under tsgo
export const tuple: [BigUnion, TranslationValues] = ["${sample[0]}", { v: "x" }];
`;
	writeFileSync("repro-baseline.ts", code);
}

// --- string lower bound ---
{
	const code = HEADER + `
export type BigUnion = string;

declare function takesKey(label: BigUnion): void;
declare function t(key: BigUnion, values?: TranslationValues): string;
declare function getTranslationProps(input: BigUnion | [BigUnion, TranslationValues]): [BigUnion, TranslationValues | undefined];
declare function useTranslations(): { (key: BigUnion): string; (key: BigUnion, values: TranslationValues): string };
const tFn = useTranslations();

` + callSitesString(i => JSON.stringify(sample[i])) + `

declare const k1: BigUnion;
declare const k2: BigUnion;
export const arr = [k1, k2];
export const tuple: [BigUnion, TranslationValues] = ["${sample[0]}", { v: "x" }];
`;
	writeFileSync("repro-string.ts", code);
}

// --- codegen flat union ---
{
	const code = HEADER + `
import type { FlatKeys } from "./keys-flat.gen";
export type BigUnion = FlatKeys;

declare function takesKey(label: BigUnion): void;
declare function t(key: BigUnion, values?: TranslationValues): string;
declare function getTranslationProps(input: BigUnion | [BigUnion, TranslationValues]): [BigUnion, TranslationValues | undefined];
declare function useTranslations(): { (key: BigUnion): string; (key: BigUnion, values: TranslationValues): string };
const tFn = useTranslations();

` + callSitesString(i => JSON.stringify(sample[i])) + `

declare const k1: BigUnion;
declare const k2: BigUnion;
export const arr = [k1, k2];
export const tuple: [BigUnion, TranslationValues] = ["${sample[0]}", { v: "x" }];
`;
	writeFileSync("repro-codegen.ts", code);
}

// --- selector API ---
{
	// Build a selector chain expression for each sample key. e.g. "Foo.Bar.Baz" -> "m.Foo.Bar.Baz".
	const accessors = sample.map(p => "m => m." + p);
	const code = HEADER + `
// Selector API: no string-literal union is ever constructed from Messages.
// TypeScript checks property access through Messages directly.
declare function t<R extends string>(selector: (m: Messages) => R, values?: TranslationValues): string;
declare function takesKey<R extends string>(selector: (m: Messages) => R): void;
declare function getTranslationProps<R extends string>(
	input: ((m: Messages) => R) | [(m: Messages) => R, TranslationValues]
): [(m: Messages) => R, TranslationValues | undefined];
declare function useTranslations(): {
	<R extends string>(selector: (m: Messages) => R): string;
	<R extends string>(selector: (m: Messages) => R, values: TranslationValues): string;
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

// Selector equivalent of [k1, k2] — no union construction here either.
declare const sel1: (m: Messages) => string;
declare const sel2: (m: Messages) => string;
export const arr = [sel1, sel2];
export const tuple: [(m: Messages) => string, TranslationValues] = [${accessors[0]}, { v: "x" }];
`;
	writeFileSync("repro-selector.ts", code);
}

console.log("wrote 4 variant scenes");
