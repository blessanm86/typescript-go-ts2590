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

Type safety is preserved — typos, non-string leaves, and intermediate objects all error:

```ts
t(m => m.NoSuchKey);              // TS2339: Property 'NoSuchKey' does not exist
t(m => m.Infrastructure);         // TS2322: type '{...}' is not assignable to 'string'
```

The critical detail is the **non-generic** signature `(m: Messages) => string`. A generic `<R extends string>(m: Messages) => R` triggers per-callsite instantiation and lands at the same cost as baseline. See [ANALYSIS.md](./ANALYSIS.md) for why.

### Runtime

A Proxy records property accesses, converting `m => m.X.Y` into `"X.Y"`, then delegates to next-intl's `t(path)`. Full reference implementation in [`proposal/selector-api.ts`](./proposal/selector-api.ts).

### Performance

Measured against a 7,161-key fixture, 100 call sites per file:

| | tsc 6.0.2 | tsgo 7.0 | Instantiations | TS2590 |
|---|---:|---:|---:|---|
| `MessageKeys<NestedKeyOf<>>` | 1.24 s | 0.19 s | **730,585** | fails on tsgo |
| `(m: Messages) => string` | **0.10 s** | **0.017 s** | **15** | n/a |

Bonus: hierarchical autocomplete (IDE narrows per dot-step) instead of a flat 7,000-item list.

## Reproduce

```bash
git clone https://github.com/blessanm86/typescript-go-ts2590.git
cd typescript-go-ts2590
pnpm install --ignore-workspace

pnpm run tsc    # exit 0
pnpm run tsgo   # exit 2 — TS2590

# compare baseline vs selector-leaf
pnpm exec tsc --extendedDiagnostics -p bench/tsconfig.baseline.json
pnpm exec tsc --extendedDiagnostics -p bench/tsconfig.selector-leaf.json
```

## Structure

```
reproduction/    — minimal TS2590 repro (repro.ts)
proposal/        — selector-api.ts (runtime wrapper) + type safety tests
bench/           — performance measurement infrastructure
fixture.json     — anonymized 7,161-key message catalog (shared)
ANALYSIS.md      — full comparison
```
