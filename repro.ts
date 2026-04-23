// Minimal reproduction of a type-check divergence between tsc and tsgo
// (TypeScript 7.0 beta / @typescript/native-preview).
//
// Symptom: tsgo reports
//   error TS2590: Expression produces a union type that is too complex
//   to represent.
// while typescript@6.0.2 accepts the same input.
//
// Real-world context: we migrated a Next.js app from typescript@6.0.2
// to tsgo (~7× typecheck speedup). A call site in a React component
// broke with TS2590. The value involved is a very large string-literal
// union derived from `next-intl`'s
//   `MessageKeys<IntlMessages, NestedKeyOf<IntlMessages>>`
// over an ~11 k-line `en.json` (7 161 leaf keys, max nesting depth 9).
//
// This repro uses the exact `next-intl` / `use-intl` type definitions
// (copy-pasted so the repro doesn't need the runtime dependency) and
// the real `en.json` from the failing codebase.
//
// Run:
//   pnpm install --ignore-workspace
//   pnpm run tsc     # exit 0 under typescript@6.0.2
//   pnpm run tsgo    # exit 2 under @typescript/native-preview
//
// Tested against:
//   typescript                  6.0.2
//   @typescript/native-preview  7.0.0-dev.20260421.2

// ---------------------------------------------------------------------
// 1. The exact `NestedKeyOf` / `NestedValueOf` / `MessageKeys` as shipped
//    by `next-intl` / `use-intl`. Copy-paste from
//    node_modules/use-intl/dist/types/core/MessageKeys.d.ts so the
//    repro does not require the runtime package.

type NestedKeyOf<ObjectType> = ObjectType extends object
	? {
			[Property in keyof ObjectType]:
				| `${Property & string}`
				| `${Property & string}.${NestedKeyOf<ObjectType[Property]>}`;
		}[keyof ObjectType]
	: never;

type NestedValueOf<ObjectType, Path extends string> = Path extends `${infer Cur}.${infer Rest}`
	? Cur extends keyof ObjectType
		? NestedValueOf<ObjectType[Cur], Rest>
		: never
	: Path extends keyof ObjectType
		? ObjectType[Path]
		: never;

type MessageKeys<ObjectType, AllKeys extends string> = {
	[PropertyPath in AllKeys]: NestedValueOf<ObjectType, PropertyPath> extends string ? PropertyPath : never;
}[AllKeys];

// ---------------------------------------------------------------------
// 2. Load the real `en.json` from the failing codebase.

import messages from "./fixture.json";
type Messages = typeof messages;

// Same definition as `AsMessageKey` in the real codebase:
type BigUnion = MessageKeys<Messages, NestedKeyOf<Messages>>;

declare const key1: BigUnion;
declare const key2: BigUnion;
declare const key3: BigUnion;

// ---------------------------------------------------------------------
// 3. React.useMemo-style factory with a deps tuple carrying three
//    BigUnion entries. No React import; just the signature shape.
//
// tsgo: TS2590 on the deps tuple `[key1, key2, key3]`.
// tsc@6.0.2: clean.
//
// Workaround that we shipped in the real codebase: group the three
// labels inside a single object and pass that object as one dep —
// e.g. `[..., { key1, key2, key3 }]` — so the deps tuple has a single
// nested-object element instead of three parallel BigUnion elements.
// That avoids the tuple-of-BigUnion inference that tsgo can't represent.

type DependencyList = readonly unknown[];
declare function useMemo<T>(factory: () => T, deps: DependencyList): T;

type Tab = {
	label: BigUnion;
	value: string;
	content: number; // stand-in for ReactNode
};

export const tabs = useMemo(
	(): Tab[] => [
		{ label: key1, value: "one", content: 1 },
		{ label: key2, value: "two", content: 2 },
		{ label: key3, value: "three", content: 3 },
	],
	[key1, key2, key3],
);
