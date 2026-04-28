# TS2590 repro — tsgo vs tsc@6.0.2

`tsgo --noEmit` reports TS2590 on a bare array literal containing two values of a large string-literal union derived from a JSON message catalog. `tsc@6.0.2` accepts the same input.

## Original repro

```bash
pnpm install --ignore-workspace
pnpm run tsc    # exit 0
pnpm run tsgo   # exit 2 — TS2590 at repro.ts:44
```

`BigUnion` is `MessageKeys<Messages, NestedKeyOf<Messages>>` — the same type `next-intl` derives from an app's translation JSON. `fixture.json` is an anonymized substitute with identical shape (7,161 leaf keys, max depth 9).

The error fires at:

```ts
export const arr = [key1, key2]; // two BigUnion values is enough
```

| Compiler | Version | Result |
|---|---|---|
| `typescript` | `6.0.2` | clean |
| `@typescript/native-preview` | `7.0.0-dev.20260421.2` | TS2590 |

## Solution analysis

This repo extends the original repro into a controlled testbed comparing five approaches to typing translation keys at scale, on four dimensions:

- **Type-checker performance** — total compile time, instantiations, memory, TS2590 outcome
- **Usage** — what you write at the call site
- **Type safety** — what mistakes the compiler catches
- **Editor support** — autocomplete behavior

See **[ANALYSIS.md](./ANALYSIS.md)** for the full comparison.

### Headline result

| Variant | tsc total | tsgo total | TS2590 | Build step | Editor autocomplete |
|---|---:|---:|---|---|---|
| baseline (`MessageKeys<NestedKeyOf<>>`) | 1.24 s | 0.19 s | **fails on tsgo** | no | flat 7k list |
| `BigUnion = string` | 0.08 s | 0.02 s | n/a | no | none |
| codegen flat union | 0.12 s | 0.03 s | passes | yes | flat 7k list |
| selector with `<R extends string>` | 1.16 s | 0.31 s | passes | no | hierarchical |
| **selector-leaf `(m: Messages) => string`** | **0.10 s** | **0.017 s** | **passes** | **no** | **hierarchical** |

**Recommendation**: adopt the selector-leaf form `(m: Messages) => string`. Matches the `string` lower bound on perf, fixes TS2590, requires no build step, scales flat as the catalog grows, and gives developers hierarchical incremental autocomplete instead of a flat 7,000-item list.

## Reproduce the analysis

```bash
pnpm install --ignore-workspace

node gen-flat-union.mjs       # → keys-flat.gen.ts
node gen-sample-keys.mjs      # → sample-keys.json
node gen-scenes.mjs           # → repro-{baseline,string,codegen,selector}.ts
node gen-selector-simple.mjs  # → repro-selector-simple.ts
node gen-selector-leaf.mjs    # → repro-selector-leaf.ts

node run-measure.mjs
```

`run-measure.mjs` runs each variant 3× on each compiler and writes `measurements.json`.
