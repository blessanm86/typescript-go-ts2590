# Analysis — selector-leaf approach to typed translation keys at scale

This document compares the current `next-intl` key-typing approach against a proposed selector-leaf alternative, measured against a 7,161-leaf, depth-9 fixture (anonymized from a production `en.json`). It covers four dimensions:

1. **Type-checker performance** — total compile time, instantiations, memory, TS2590 outcome.
2. **Usage from a developer's perspective** — what you write at the call site.
3. **Type safety** — what mistakes the compiler catches.
4. **Editor support** — how autocomplete behaves as you type.

The numbers are reproducible from this repo: see [Reproduce](#reproduce) at the end.

---

## The four approaches

| ID | Name | Definition |
|---|---|---|
| **A** | baseline | `BigUnion = MessageKeys<Messages, NestedKeyOf<Messages>>` — current approach in `next-intl` codebases. |
| **E** | **selector-leaf** | `t(selector: (m: Messages) => string): string`. Non-generic; values typed as plain `TranslationValues`. The proposal we recommend. |
| **G** | selector-generic | `t<R extends string>(selector: (m: Messages) => R, values?: TranslationValues): string`. Preserves the leaf literal `R` but doesn't use it for anything. Decomposition probe — see what generic instantiation alone costs. |
| **I** | **selector-icu** | `t<R extends string>(selector: (m: Messages) => R, values?: GetICUArgs<R>): string`. Full ICU value safety: values shape is derived from the leaf's ICU placeholders via [`@schummar/icu-type-parser`](https://www.npmjs.com/package/@schummar/icu-type-parser). |

The fixture for variants G and I has ICU placeholders injected into 20% of leaves (a deterministic mix of `{name}`, plurals, selects, two-arg) so `GetICUArgs<R>` does real parser work — not just `EmptyObject` for plain leaves. See `bench/inject-icu-placeholders.mjs`.

---

## Performance

Measured on Node 20.x macOS, 3 cold runs per variant per compiler, median reported. The scene file imports `fixture.json`, declares 100 typed call sites, the original `arr = [k1, k2]` TS2590 trigger, a `[Key, Values]` tuple, and a `useTranslations()` stub.

### tsc 6.0.2

| Variant | Total | Check | Types | Instantiations | Memory | TS2590 |
|---|---:|---:|---:|---:|---:|---|
| A baseline | 1.01 s | 0.96 s | 50,002 | **730,585** | 215 MB | passes (legacy ordering) |
| **E selector-leaf** | **0.10 s** | **0.04 s** | **4,626** | **15** | **61 MB** | **n/a** |
| G selector-generic | 0.91 s | 0.85 s | 4,611 | 316 | 46 MB | n/a |
| I selector-icu | 1.62 s | 1.56 s | 6,304 | 27,693 | 69 MB | n/a |

### tsgo 7.0.0-dev.20260421.2

| Variant | Total | Check | Types | Instantiations | Memory | TS2590 |
|---|---:|---:|---:|---:|---:|---|
| A baseline | 0.18 s | 0.18 s | 50,265 | **728,557** | 38 MB | **fails** |
| **E selector-leaf** | **0.016 s** | **0.007 s** | **4,881** | **15** | **17 MB** | **n/a** |
| G selector-generic | 0.30 s | 0.29 s | 4,866 | 316 | 17 MB | n/a |
| I selector-icu | 0.47 s | 0.46 s | 6,639 | 27,732 | 18 MB | n/a |

### What the numbers say

1. **Baseline does ~730k instantiations** for one file with 100 call sites. The recursive `MessageKeys<NestedKeyOf<>>` is the dominant cost. Selector-leaf does 15 instantiations — the same as `BigUnion = string`.

2. **Selector-leaf matches the `string` lower bound on performance** while retaining full type-correctness (typo detection, non-string leaf rejection). No string-literal union is ever constructed, so TS2590 cannot fire.

3. **TS2590 ceiling is gone for every selector variant** — even the most expensive (selector-icu) does only ~28k instantiations, well below baseline's 730k. The `arr = [sel1, sel2]` tuple position that wedges baseline on tsgo compiles cleanly in all three selector forms. The ceiling problem is solved by the structure (selector vs union), not by the value-typing strategy on top.

4. **Generic instantiation, not ICU parsing, is the dominant added cost.** Decomposing the climb from selector-leaf → selector-icu on tsgo:

   - `+ <R extends string>` (no values benefit): **+0.28 s** (0.016 → 0.30 s)
   - `+ GetICUArgs<R>` (real values safety): **+0.17 s** (0.30 → 0.47 s)

   Once you commit to a generic selector, ICU parsing on top is the cheaper marginal cost. This contradicts the natural intuition that "ICU parsing must be the expensive bit" — it's not.

5. **Implication for the middle-ground design:** selector-generic with permissive values (G) gives no safety win over selector-leaf (E) but pays most of selector-icu's cost (I). It's strictly dominated. No reason to ship it.

6. **The real perf trade is selector-leaf vs selector-icu**, ~25–30× slower on tsgo for full ICU value safety. Whether that's acceptable depends on project size, callsite density, and whether IDE responsiveness or CI time is the binding constraint.

> **Hint:** if you want full ICU value safety, the right next experiment is to measure your actual project's typecheck delta — not extrapolate from this 100-callsite stress file. The per-callsite delta is real but most files have far fewer callsites than 100.

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
