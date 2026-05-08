# Selector API proposal for `next-intl` — fixing TS2590 at scale

## The problem

`MessageKeys<NestedKeyOf<Messages>>` constructs a string-literal union of every dot-path in the messages tree. At ~7,000+ leaf keys this triggers TS2590, generates ~730k type instantiations per file, and [can crash the compiler entirely](https://github.com/amannn/next-intl/issues/2296).

## Proposed solution

Inspired by [i18next's selector API](https://www.locize.com/blog/i18next-typescript-selector-api/) — replace string keys with selector functions that walk the typed `Messages` object. No union is ever constructed.

```ts
// before
t("MainNavigation.items.home");
t.rich("Some.Key", { strong: (c) => <strong>{c}</strong> });

// after
t(m => m.MainNavigation.items.home);
t.rich(m => m.Some.Key, { strong: (c) => <strong>{c}</strong> });
```

The full API surface we've prototyped as a userland wrapper:

```ts
t(m => m.Some.Key);                    // basic translation
t(m => m.Some.Key, { count: 3 });      // with values
t.rich(m => m.Some.Key, { strong });   // rich text (ReactNode)
t.markup(m => m.Some.Key, { em });     // markup (string)
t.hasLeaf(m => m.Some.Key);            // type-safe existence check
t.hasLeafRaw("some.runtime.key");      // escape hatch for dynamic keys
```

The `MessageSelector` type also works as a prop type — replacing `label: AsMessageKey` (which puts the full union in the component signature) with a function type that's safe everywhere:

```tsx
type Props = { label: MessageSelector };

<LabelledItem label={m => m.MainNavigation.items.home} />
```

See [`proposal/example-usage.tsx`](./proposal/example-usage.tsx) for multi-key arrays, prop patterns, and the autocomplete experience.

Type safety is preserved — typos, non-string leaves, and intermediate objects all error:

```ts
t(m => m.NoSuchKey);              // TS2339: Property 'NoSuchKey' does not exist
t(m => m.Infrastructure);         // TS2322: type '{...}' is not assignable to 'string'
```

The critical detail is the **non-generic** signature `(m: Messages) => string`. A generic `<R extends string>(m: Messages) => R` triggers per-callsite instantiation and lands close to baseline on tsc (0.91 s vs 1.01 s); on tsgo it's still ~19× slower than the non-generic form (0.30 s vs 0.016 s). Adding `GetICUArgs<R>` for full ICU value safety on top of that is a smaller marginal cost (0.30 s → 0.47 s on tsgo). See [ANALYSIS.md](./ANALYSIS.md) for the full decomposition.

### Go-to-definition tip

The recommended `declare interface IntlMessages extends Messages {}` pattern adds type indirection that breaks Cmd+Click — the IDE shows multiple targets instead of jumping to the JSON property. Flattening to a type alias fixes it:

```ts
// before (docs recommendation) — Cmd+Click shows multiple targets
type Messages = typeof import("./messages/en.json");
declare interface IntlMessages extends Messages {}

// after — Cmd+Click jumps straight to en.json
type IntlMessages = typeof import("./messages/en.json");
```

The `interface` exists for declaration merging, but most projects don't augment `IntlMessages` from multiple files.

### Runtime

A Proxy records property accesses, converting `m => m.X.Y` into `"X.Y"`, then delegates to next-intl's `t(path)`. Full reference implementation in [`proposal/selector-api.ts`](./proposal/selector-api.ts).

### Performance

Measured against a 7,161-key fixture (with ICU placeholders in ~20% of leaves), 100 call sites per file:

| Variant | tsc 6.0.2 | tsgo 7.0 | Instantiations | TS2590 |
|---|---:|---:|---:|---|
| baseline `MessageKeys<NestedKeyOf<>>` | 1.01 s | 0.18 s | **730,585** | fails on tsgo |
| **selector-leaf** `(m) => string` | **0.10 s** | **0.016 s** | **15** | n/a |
| selector-generic `<R extends string>` | 0.91 s | 0.30 s | 316 | n/a |
| selector-icu `<R> + GetICUArgs<R>` | 1.62 s | 0.47 s | 27,693 | n/a |

The **TS2590 ceiling is gone for every selector form** — even the ICU-typed variant stays well below baseline's instantiation count. The remaining choice is a perf vs values-safety trade. See [ANALYSIS.md](./ANALYSIS.md) for the full breakdown including the cost decomposition (generic instantiation alone is the bigger cost; ICU parsing on top is the cheaper marginal).

Bonus: hierarchical autocomplete (IDE narrows per dot-step) instead of a flat 7,000-item list.

## Reproduce

```bash
git clone https://github.com/blessanm86/typescript-go-ts2590.git
cd typescript-go-ts2590
pnpm install --ignore-workspace

pnpm run tsc    # exit 0
pnpm run tsgo   # exit 2 — TS2590

# compare any pair of variants
pnpm exec tsc --extendedDiagnostics -p bench/tsconfig.baseline.json
pnpm exec tsc --extendedDiagnostics -p bench/tsconfig.selector-leaf.json
pnpm exec tsc --extendedDiagnostics -p bench/tsconfig.selector-generic.json
pnpm exec tsc --extendedDiagnostics -p bench/tsconfig.selector-icu.json

# or run the full suite (3 cold runs × 4 variants × 2 compilers)
cd bench
node inject-icu-placeholders.mjs   # one-time fixture mutation
node gen-scenes.mjs                # → repro-baseline.ts
node gen-selector-leaf.mjs         # → repro-selector-leaf.ts
node gen-selector-generic.mjs      # → repro-selector-generic.ts
node gen-selector-icu.mjs          # → repro-selector-icu.ts
node run-measure.mjs               # → measurements.json
```

## Structure

```
reproduction/    — minimal TS2590 repro (repro.ts)
proposal/        — selector-api.ts (runtime wrapper) + example usage + type safety tests
bench/           — performance measurement infrastructure
fixture.json     — anonymized 7,161-key message catalog (shared)
ANALYSIS.md      — full comparison
```
