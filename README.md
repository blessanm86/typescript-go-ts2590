# Selector API proposal for `next-intl` — fixing TS2590 at scale

## The problem

`next-intl`'s `MessageKeys<NestedKeyOf<Messages>>` type constructs a string-literal union of every dot-path in the messages tree. With large catalogs (~7,000+ leaf keys), this union:

1. **Triggers TS2590** ("Expression produces a union type that is too complex to represent") when values appear in tuple-literal or array-literal positions — especially under `tsgo`'s deterministic ordering.
2. **Generates ~730,000 type instantiations** per file with 100 call sites, making type-checking slow.
3. **Can crash the TypeScript compiler** entirely via `RangeError: Map maximum size exceeded` when the `stringLiteralTypes` internal cache exceeds V8's Map limit (see [next-intl#2296](https://github.com/amannn/next-intl/issues/2296)).

## Proposed solution: selector-leaf API

Inspired by [i18next's selector API](https://www.locize.com/blog/i18next-typescript-selector-api/), replace string-key lookups with selector functions that walk the typed messages tree:

```ts
// Before — string key checked against a ~7,000-member union
t("Infrastructure.GoogleCloud.tabs.overview");

// After — selector walks the typed Messages object, no union constructed
t(m => m.Infrastructure.GoogleCloud.tabs.overview);
```

The key insight is the **non-generic signature**:

```ts
// This is fast — no per-callsite instantiation, no union
declare function t(selector: (m: Messages) => string): string;

// This is NOT — generic R triggers per-callsite instantiation, same cost as baseline
declare function t<R extends string>(selector: (m: Messages) => R): string;
```

### What you get

- **No string-literal union ever constructed** — TS2590 cannot fire
- **Full type safety** — typos, non-string leaves, and intermediate objects are all caught
- **Hierarchical autocomplete** — IDE shows ~20 top-level keys, then narrows per dot-step, instead of a flat 7,000-item list
- **No build step** — no codegen, no sync guards

### Performance (this repo)

| Variant | tsc 6.0.2 | tsgo 7.0 | Instantiations | TS2590 |
|---|---:|---:|---:|---|
| `MessageKeys<NestedKeyOf<>>` (current) | 1.24 s | 0.19 s | **730,585** | fails on tsgo |
| **`(m: Messages) => string`** (proposed) | **0.10 s** | **0.017 s** | **15** | n/a |

See [ANALYSIS.md](./ANALYSIS.md) for the full comparison.

### Type safety verification

```ts
declare function t(selector: (m: Messages) => string): string;

t(m => m.NoSuchKey);              // TS2339: Property 'NoSuchKey' does not exist
t(m => m.Infrastructure.NoSuch);  // TS2339: Property 'NoSuch' does not exist
t(m => m.Infrastructure);         // TS2322: type '{...}' is not assignable to 'string'
```

Both `tsc` and `tsgo` produce these errors. See [`proposal/repro-selector-typo-test.ts`](./proposal/repro-selector-typo-test.ts).

## Reproduce

```bash
git clone https://github.com/blessanm86/typescript-go-ts2590.git
cd typescript-go-ts2590
pnpm install --ignore-workspace

# Check the original TS2590 repro
pnpm run tsc    # exit 0 (tsc accepts it)
pnpm run tsgo   # exit 2 — TS2590 at repro.ts:44

# Compare baseline vs selector-leaf
pnpm exec tsc  --extendedDiagnostics -p bench/tsconfig.baseline.json
pnpm exec tsc  --extendedDiagnostics -p bench/tsconfig.selector-leaf.json

# Or run the full measurement suite (3 cold runs per variant per compiler)
cd bench
node gen-sample-keys.mjs
node gen-scenes.mjs
node gen-selector-leaf.mjs
node run-measure.mjs
```

## Runtime implementation

See [`proposal/selector-api.ts`](./proposal/selector-api.ts) for the full reference implementation. The core idea:

1. **`pathFromSelector`** — a Proxy records every property access, converting `m => m.X.Y` into the string `"X.Y"`
2. **`wrapBaseTranslator`** — wraps next-intl's string-key `t()` into the selector shape, delegating to the original `t(path)` at runtime

```ts
import type { BaseTranslator } from "./selector-api";
import { wrapBaseTranslator } from "./selector-api";

// Wrap any next-intl translator
const baseT = useTranslations();
const t = wrapBaseTranslator(baseT as BaseTranslator);

t(m => m.MainNavigation.items.home);
t.rich(m => m.Some.Key, { strong: (chunks) => <strong>{chunks}</strong> });
t.hasLeaf(m => m.Some.Key);       // type-safe leaf check
t.hasLeafRaw("some.runtime.key"); // escape hatch for dynamic keys
```

Same pattern [i18next uses](https://www.locize.com/blog/i18next-typescript-selector-api/). Low overhead, single function.

## Structure

```
├── reproduction/          # The problem
│   ├── repro.ts           # Minimal TS2590 reproduction
│   └── tsconfig.json
├── proposal/              # The solution
│   ├── selector-api.ts    # Reference runtime implementation (Proxy wrapper + types)
│   └── repro-selector-typo-test.ts  # Type safety verification
├── bench/                 # Performance measurement
│   ├── repro-baseline.ts  # 100 call sites using MessageKeys<NestedKeyOf<>>
│   ├── repro-selector-leaf.ts  # 100 call sites using (m: Messages) => string
│   └── run-measure.mjs    # Measurement runner
├── fixture.json           # Anonymized 7,161-key message catalog (shared)
├── ANALYSIS.md            # Full performance and type-safety comparison
└── README.md
```
