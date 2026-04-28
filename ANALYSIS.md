# Analysis — five approaches to typed translation keys at scale

This document compares five approaches to typing translation keys in a project that uses `next-intl`-style `MessageKeys<NestedKeyOf<Messages>>`, measured against a 7,161-leaf, depth-9 fixture (anonymized scramble of a real-world `en.json`). It covers four dimensions:

1. **Type-checker performance** — total compile time, instantiations, memory, TS2590 outcome.
2. **Usage from a developer's perspective** — what you write at the call site.
3. **Type safety** — what mistakes the compiler catches, and what it doesn't.
4. **Editor support** — how autocomplete behaves as you type.

The numbers are reproducible from this repo: see [Reproduce](#reproduce) at the end.

---

## The five approaches

| ID | Name | Definition |
|---|---|---|
| **A** | baseline | `BigUnion = MessageKeys<Messages, NestedKeyOf<Messages>>` — current production approach in many `next-intl` codebases. |
| **B** | string | `BigUnion = string` — lower bound. No safety, but tells us how much the *type itself* costs. |
| **C** | codegen flat union | A build script walks `Messages` and emits `type FlatKeys = "k0" \| "k0.k1" \| ...;`. No recursive conditional types — same union, pre-computed. |
| **D** | selector with `<R extends string>` | `t<R extends string>(selector: (m: Messages) => R): string`. The i18next-style selector pattern, with a generic return-type constraint. |
| **E** | **selector-leaf** | `t(selector: (m: Messages) => string): string`. Same selector pattern, **non-generic**, with `=> string` as the return constraint. |

---

## Performance

Measured on Node 20.x macOS, 3 cold runs per variant per compiler, median reported. The scene file imports `fixture.json`, declares 100 typed call sites, the original `arr = [k1, k2]` TS2590 trigger, a `[Key, Values]` tuple, and a `useTranslations()` stub.

### tsc 6.0.2

| Variant | Total | Check | Types | Instantiations | Memory | TS2590 |
|---|---:|---:|---:|---:|---:|---|
| A baseline | 1.24 s | 1.18 s | 49,990 | **730,585** | 207 MB | passes (legacy ordering) |
| B string | 0.08 s | 0.03 s | 4,503 | 15 | 45 MB | n/a |
| C codegen | 0.12 s | 0.06 s | 18,482 | 15 | 53 MB | n/a |
| D selector-generic | 1.16 s | 1.10 s | 4,628 | 324 | 77 MB | n/a |
| **E selector-leaf** | **0.10 s** | **0.04 s** | **4,614** | **15** | **61 MB** | **n/a** |

### tsgo 7.0.0-dev.20260421.2

| Variant | Total | Check | Types | Instantiations | Memory | TS2590 |
|---|---:|---:|---:|---:|---:|---|
| A baseline | 0.19 s | 0.18 s | 50,253 | **728,557** | 38 MB | **fails** |
| B string | 0.02 s | 0.007 s | 4,758 | 15 | 16 MB | n/a |
| C codegen | 0.03 s | 0.018 s | 32,914 | 15 | 22 MB | n/a |
| D selector-generic | 0.31 s | 0.30 s | 4,883 | 324 | 17 MB | n/a |
| **E selector-leaf** | **0.017 s** | **0.008 s** | **4,869** | **15** | **17 MB** | **n/a** |

### What the numbers say

1. **Baseline does ~730k instantiations** for one file with 100 call sites. The recursive `MessageKeys<NestedKeyOf<>>` is the dominant cost — not just the TS2590 ceiling that surfaced under tsgo's deterministic ordering. Switching to `string` confirms it: 15 instantiations, ~15× faster.

2. **The naive selector form (D) is *not* a perf win.** Adding `<R extends string>` to the selector signature triggers per-callsite generic instantiation; with 100 call sites the total cost lands almost on top of baseline (1.10 s vs 1.18 s on tsc; 0.30 s vs 0.18 s on tsgo). The i18next pattern is correct *in intent* but the specific generic shape matters.

3. **Selector-leaf (E) is the clear winner.** It hits the `string` lower bound, scales flat as the message catalog grows (the type doesn't enumerate keys at all), needs no build step, and fixes TS2590 because no string-literal union is ever constructed.

4. **Codegen (C) is a viable runner-up.** Drop-in (just change the type definition), ~10× faster than baseline, but adds a build step + sync guard, and Types grow linearly with key count (already 18k–33k for 7,087 literal members; will grow further as the catalog grows).

---

## Usage from a developer's perspective

How each variant looks at the call site, and what kinds of code are easy or awkward to express.

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

**Strengths**: minimal call-site overhead. Just a string. Compatible with any code that wants to pass keys around as strings.

**Friction**:
- Cannot put `AsMessageKey` values in tuple-literal positions without TS2590 on tsgo (deps arrays, `[key, values]` test asserts).
- Helpers that compose `AsMessageKey` (e.g. `[AsMessageKey, TranslationValues]`) become unsafe — the parent codebase has accumulated a deprecated zone of such helpers.

### B — `BigUnion = string`

```ts
t("Infrastructure.GoogleCloud.tabs.overview");
t("anything you want");  // also valid, no error
```

**Strengths**: maximum simplicity, fastest possible.

**Friction**: no compile-time validation. Typos slip through to runtime. Refactors that rename keys go undetected. Loss of confidence in i18n correctness.

### C — codegen flat union

```ts
import { useTranslations } from "next-intl";

const t = useTranslations();
t("Infrastructure.GoogleCloud.tabs.overview");  // checked against generated FlatKeys union
```

**Strengths**: identical call-site syntax to baseline. Zero migration cost. `pnpm run sync:i18n-types` (or equivalent) pre-commit/CI hook keeps the generated file in sync.

**Friction**:
- Build-step orchestration: must run when `en.json` changes. CI verification needed to prevent stale generated files.
- Generated file must be checked in (or re-generated on every install) so type checks work without an explicit build step.
- Doesn't help if you also want argument-shape safety (e.g. enforce `{ count: number }` for plural keys).

### D — selector with `<R extends string>`

```ts
t(m => m.Infrastructure.GoogleCloud.tabs.overview);
t(m => m.Infrastructure.GoogleCloud.tabs.overview, { count: 3 });
```

The call site is **identical** to E. The difference is in the *signature*:

```ts
// D
declare function t<R extends string>(selector: (m: Messages) => R): string;

// E
declare function t(selector: (m: Messages) => string): string;
```

D has a generic type parameter `R` inferred per call site. At every `t(...)` invocation, TypeScript:

1. Type-checks `m.Foo.Bar` against `Messages` (same as E)
2. Infers a fresh `R` from the selector's return type
3. Validates `R extends string`
4. Substitutes `R` back into the signature

Steps 2-4 are the per-callsite generic instantiation cost. With 100 call sites you pay it 100 times.

**When would D be useful?** When you want `t`'s *return type* to depend on which selector was passed — for example, an API where the result varies by key. That's not the case for translation calls: the runtime always returns the rendered translation as `string`. So `R` is paid for and never used.

**E is the same selector pattern without paying for a generic feature we don't need.** Functionally identical at the call site, dramatically cheaper to type-check (see the perf table above).

### E — selector-leaf (recommended)

```ts
t(m => m.Infrastructure.GoogleCloud.tabs.overview);
t(m => m.Infrastructure.GoogleCloud.tabs.overview, { count: 3 });

// Translation prop:
type Props = { label: (m: Messages) => string };
function MyComponent({ label }: Props) { return <span>{t(label)}</span>; }
```

**Strengths**:
- No string-literal union ever constructed — TS2590 cannot fire from this type.
- Tuples of selectors are free: `[label1, label2]` and `[selector, values]` compose without union expansion.
- Hierarchical, scoped autocomplete (see [Editor support](#editor-support) below).
- No build step, no codegen, no sync guard.

**Friction**:
- **Slightly more verbose**: `t(m => m.X.Y)` is six characters more than `t("X.Y")`.
- **Dynamic keys are awkward**. `t(someStringVar)` becomes `t(m => (m as any)[someStringVar])` or `t(someStringVar as never)` with an escape hatch helper — but in practice these are rare and worth marking explicitly.
- **Runtime needs path resolution.** A wrapper around `next-intl`'s `t` runs the selector against a Proxy that records the property chain, then delegates to `t("X.Y")`. Well-understood pattern, low overhead, single function to write and test.
- **Migration cost**: every existing `t("X.Y")` call site rewritten. Mechanical, codemod-able.

---

## Type safety

What does each variant catch?

| Check | A baseline | B string | C codegen | D selector-generic | E selector-leaf |
|---|:-:|:-:|:-:|:-:|:-:|
| Typo at root key (`t("nope")`) | ✅ | ❌ | ✅ | ✅ | ✅ |
| Typo deep in chain (`t("Foo.nope")`) | ✅ | ❌ | ✅ | ✅ | ✅ |
| Reject non-string leaves (e.g., array `searchTags`) | ✅ | ❌ | implicit¹ | ✅ | ✅ |
| Reject intermediate-object as key (`t("Foo")` where Foo is an object) | ✅ | ❌ | implicit¹ | ✅ | ✅ |
| Compile in tuple/deps positions on tsgo | ❌ (TS2590) | ✅ | ✅ | ✅ | ✅ |
| Argument shape (e.g. `{ count: number }` required for plural keys) | ❌ | ❌ | ❌ | ❌ | ❌ |

¹ codegen emits only string-leaf paths, so non-string leaves and intermediate-object keys never appear in `FlatKeys` and are rejected as "not assignable to FlatKeys" — same outcome via a different mechanism.

**On the typo / leaf checks for E**, both errors are validated in `repro-selector-typo-test.ts`:

```ts
declare function t(selector: (m: Messages) => string): string;
t(m => m.Infrastructure.GoogleCloud);  // TS2322: type '{...}' is not assignable to type 'string'
t(m => m.NoSuchKey);                   // TS2339: Property 'NoSuchKey' does not exist on type ...
t(m => m.Infrastructure.NoSuchKey);    // TS2339: Property 'NoSuchKey' does not exist on type ...
```

Both `tsc` and `tsgo` produce these errors, with file:line:col precision.

---

## Editor support

This is where the difference becomes most tangible day-to-day. Behavior is described against the same fixture (~7,000 keys, deeply nested).

### A — baseline

You type `t("` and the IDE attempts to complete from the full ~7,000-member literal union. In practice:
- Some IDEs truncate or paginate the suggestion list.
- The list is flat — finding `Infrastructure.GoogleCloud.tabs.overview` requires either typing several characters of the prefix or scrolling.
- IDE responsiveness can degrade with the recursive type's evaluation cost (Ben Blackmore's profiling showed multi-second delays in the parent codebase).

### B — string

No suggestions. You're typing into a free-form string literal.

### C — codegen flat union

Same UX as A — the IDE completes from the literal union. The only difference is that the underlying type is pre-computed, so the IDE does not pay the recursive-conditional evaluation cost on each completion. In practice, faster and more responsive than A while showing the same suggestions.

### D, E — selector

You type `t(m => m.` and the IDE shows the **top-level keys** of `Messages` — typically a few dozen entries.

You pick `Infrastructure`, type `.`, and the IDE shows **only the children of `Infrastructure`** — likely 1–10 entries.

Continue: `m.Infrastructure.GoogleCloud.tabs.` shows just the tab keys — a handful of strings.

This is **hierarchical, scoped, incremental autocomplete**. Each property step narrows the suggestion list to that subtree. There is never a 7,000-item list to scroll through — at every step, the suggestions are bounded by the local fan-out of the message tree.

For a developer exploring the i18n catalog, this is materially better than the flat union experience: it surfaces the structure of the catalog as you navigate it, the way you'd browse `en.json` itself in a JSON editor with collapsible nodes.

The non-generic `(m: Messages) => string` form (E) preserves this completion experience while being as fast as the `string` lower bound.

---

## Recommendation

**Adopt E (selector-leaf).**

| Property | A baseline | C codegen | E selector-leaf |
|---|:-:|:-:|:-:|
| Fixes TS2590 | ❌ | ✅ | ✅ |
| Total time vs. baseline | 1× | ~10× faster | ~15× faster |
| Build step | none | required | none |
| Scales with key count | bad | linear | flat |
| Catches typos | ✅ | ✅ | ✅ |
| Catches non-string leaves | ✅ | implicit | ✅ |
| Drop-in vs. callsite migration | drop-in | drop-in | callsite migration |
| Editor autocomplete | flat 7k list | flat 7k list | hierarchical |
| Runtime work needed | none | none | thin Proxy wrapper |

Codegen is a viable fallback if the runtime selector wrapper proves harder to integrate than expected — but the type-system-level evidence makes selector-leaf the structurally cleanest answer.

The remaining work the testbed cannot validate moves to two questions:

- **Runtime path resolution**: a `Proxy`-based wrapper around `next-intl`'s `t()` to convert `m => m.X.Y` to `"X.Y"` at call time. Well-understood pattern.
- **Codemod scope**: mechanical rewrite of `t("X.Y")` → `t(m => m.X.Y)` across every call site.

---

## Reproduce

```bash
git clone https://github.com/blessanm86/typescript-go-ts2590.git
cd typescript-go-ts2590
pnpm install --ignore-workspace

# Generate the flat-union codegen file and the variant scenes
node gen-flat-union.mjs       # → keys-flat.gen.ts
node gen-sample-keys.mjs      # → sample-keys.json
node gen-scenes.mjs           # → repro-{baseline,string,codegen,selector}.ts
node gen-selector-simple.mjs  # → repro-selector-simple.ts
node gen-selector-leaf.mjs    # → repro-selector-leaf.ts

# Run perf measurements (3 cold runs per variant per compiler)
node run-measure.mjs

# Or check a single variant by hand:
pnpm exec tsc  --extendedDiagnostics -p tsconfig.selector-leaf.json
pnpm exec tsgo --extendedDiagnostics -p tsconfig.selector-leaf.json
```

The original minimal repro (`pnpm run tsc` / `pnpm run tsgo` against `repro.ts`) is preserved unchanged.
