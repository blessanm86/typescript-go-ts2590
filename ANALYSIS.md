# Analysis — selector-leaf approach to typed translation keys at scale

This document compares the current `next-intl` key-typing approach against a proposed selector-leaf alternative, measured against a 7,161-leaf, depth-9 fixture (anonymized from a production `en.json`). It covers four dimensions:

1. **Type-checker performance** — total compile time, instantiations, memory, TS2590 outcome.
2. **Usage from a developer's perspective** — what you write at the call site.
3. **Type safety** — what mistakes the compiler catches.
4. **Editor support** — how autocomplete behaves as you type.

The numbers are reproducible from this repo: see [Reproduce](#reproduce) at the end.

---

## The two approaches

| ID | Name | Definition |
|---|---|---|
| **A** | baseline | `BigUnion = MessageKeys<Messages, NestedKeyOf<Messages>>` — current approach in `next-intl` codebases. |
| **E** | **selector-leaf** | `t(selector: (m: Messages) => string): string`. A selector function walks the typed messages tree; no union is ever constructed. |

---

## Performance

Measured on Node 20.x macOS, 3 cold runs per variant per compiler, median reported. The scene file imports `fixture.json`, declares 100 typed call sites, the original `arr = [k1, k2]` TS2590 trigger, a `[Key, Values]` tuple, and a `useTranslations()` stub.

### tsc 6.0.2

| Variant | Total | Check | Types | Instantiations | Memory | TS2590 |
|---|---:|---:|---:|---:|---:|---|
| A baseline | 1.24 s | 1.18 s | 49,990 | **730,585** | 207 MB | passes (legacy ordering) |
| **E selector-leaf** | **0.10 s** | **0.04 s** | **4,614** | **15** | **61 MB** | **n/a** |

### tsgo 7.0.0-dev.20260421.2

| Variant | Total | Check | Types | Instantiations | Memory | TS2590 |
|---|---:|---:|---:|---:|---:|---|
| A baseline | 0.19 s | 0.18 s | 50,253 | **728,557** | 38 MB | **fails** |
| **E selector-leaf** | **0.017 s** | **0.008 s** | **4,869** | **15** | **17 MB** | **n/a** |

### What the numbers say

1. **Baseline does ~730k instantiations** for one file with 100 call sites. The recursive `MessageKeys<NestedKeyOf<>>` is the dominant cost. The selector-leaf variant does 15 instantiations — the same as `BigUnion = string`.

2. **Selector-leaf matches the `string` lower bound on performance** while retaining full type safety. No string-literal union is ever constructed, so TS2590 cannot fire.

3. **12× faster on tsc, 11× faster on tsgo.** Memory drops from 207 MB to 61 MB (tsc) and 38 MB to 17 MB (tsgo).

> **Note on the generic selector variant:** An earlier iteration used `<R extends string>(selector: (m: Messages) => R)` — the generic form triggers per-callsite instantiation and lands almost on top of baseline (1.16 s vs 1.24 s on tsc). The non-generic `=> string` return constraint is what makes the selector approach fast.

---

## Usage from a developer's perspective

### A — baseline (`MessageKeys<NestedKeyOf<Messages>>`)

```ts
import { useTranslations } from "next-intl";

const t = useTranslations();
t("Infrastructure.GoogleCloud.tabs.overview");
t("Infrastructure.GoogleCloud.tabs.overview", { count: 3 });

// Translation prop:
type Props = { label: AsMessageKey };
function MyComponent({ label }: Props) { return <span>{t(label)}</span>; }
```

**Strengths**: minimal call-site overhead. Just a string.

**Friction**:
- Cannot put `AsMessageKey` values in tuple-literal positions without TS2590 on tsgo.
- Helpers that compose `AsMessageKey` (e.g. `[AsMessageKey, TranslationValues]`) hit the union complexity ceiling.

### E — selector-leaf (proposed)

```ts
import { useTranslations } from "next-intl";

const t = useTranslations();
t(m => m.Infrastructure.GoogleCloud.tabs.overview);
t(m => m.Infrastructure.GoogleCloud.tabs.overview, { count: 3 });

// Translation prop:
type Props = { label: (m: Messages) => string };
function MyComponent({ label }: Props) { return <span>{t(label)}</span>; }
```

**Strengths**:
- No string-literal union ever constructed — TS2590 cannot fire.
- Tuples of selectors compose freely: `[label1, label2]` works without union expansion.
- Hierarchical, scoped autocomplete (see [Editor support](#editor-support) below).
- No build step, no codegen.

**Friction**:
- **Slightly more verbose**: `t(m => m.X.Y)` is six characters more than `t("X.Y")`.
- **Dynamic keys need an escape hatch.** Rare in practice and worth marking explicitly.
- **Runtime path resolution needed.** A `Proxy`-based wrapper converts `m => m.X.Y` to `"X.Y"` at call time. Well-understood pattern, low overhead.
- **Migration cost**: mechanical rewrite of `t("X.Y")` → `t(m => m.X.Y)` across call sites. Codemod-able.

---

## Type safety

| Check | A baseline | E selector-leaf |
|---|:-:|:-:|
| Typo at root key (`t("nope")`) | ✅ | ✅ |
| Typo deep in chain (`t("Foo.nope")`) | ✅ | ✅ |
| Reject non-string leaves (e.g., array `searchTags`) | ✅ | ✅ |
| Reject intermediate-object as key (`t("Foo")` where Foo is an object) | ✅ | ✅ |
| Compile in tuple/deps positions on tsgo | ❌ (TS2590) | ✅ |

Both errors are validated in `repro-selector-typo-test.ts`:

```ts
declare function t(selector: (m: Messages) => string): string;
t(m => m.Infrastructure.GoogleCloud);  // TS2322: type '{...}' is not assignable to type 'string'
t(m => m.NoSuchKey);                   // TS2339: Property 'NoSuchKey' does not exist on type ...
t(m => m.Infrastructure.NoSuchKey);    // TS2339: Property 'NoSuchKey' does not exist on type ...
```

Both `tsc` and `tsgo` produce these errors.

---

## Editor support

### A — baseline

You type `t("` and the IDE shows the full ~7,000-member literal union. The list is flat — finding a specific key requires typing several characters of the prefix or scrolling. IDE responsiveness can degrade with the recursive type's evaluation cost.

### E — selector-leaf

You type `t(m => m.` and the IDE shows the **top-level keys** of `Messages` — typically a few dozen entries. Pick one, type `.`, and the IDE shows **only children of that key**. Each step narrows the suggestion list to the local subtree.

This is **hierarchical, incremental autocomplete**. There is never a 7,000-item list — at every step, suggestions are bounded by the local fan-out of the message tree.

---

## Prior art

This approach is inspired by [i18next's selector API](https://www.locize.com/blog/i18next-typescript-selector-api/), which introduced the `(m) => m.X.Y` pattern for the same reasons: avoiding expensive string-literal union construction while preserving type safety and improving editor autocomplete.

The non-generic `(m: Messages) => string` signature is the key insight — it avoids per-callsite generic instantiation costs that a generic `<R extends string>(m: Messages) => R` form would incur.

---

## Reproduce

```bash
git clone https://github.com/blessanm86/typescript-go-ts2590.git
cd typescript-go-ts2590
pnpm install --ignore-workspace

# Check a single variant by hand:
pnpm exec tsc  --extendedDiagnostics -p bench/tsconfig.baseline.json
pnpm exec tsc  --extendedDiagnostics -p bench/tsconfig.selector-leaf.json
pnpm exec tsgo --extendedDiagnostics -p bench/tsconfig.baseline.json
pnpm exec tsgo --extendedDiagnostics -p bench/tsconfig.selector-leaf.json

# Or run the full measurement suite (3 cold runs per variant per compiler):
cd bench
node gen-sample-keys.mjs      # → sample-keys.json
node gen-scenes.mjs           # → repro-baseline.ts
node gen-selector-leaf.mjs    # → repro-selector-leaf.ts
node run-measure.mjs
```

The original minimal repro (`pnpm run tsc` / `pnpm run tsgo` against `repro.ts`) is preserved unchanged in the root.
