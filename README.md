# TS2590 repro — tsgo vs tsc@6.0.2

`tsgo --noEmit` reports TS2590 on a bare array literal containing three values of a large string-literal union. `tsc@6.0.2` accepts the same input.

## Reproduce

```bash
pnpm install --ignore-workspace
pnpm run tsc    # exit 0
pnpm run tsgo   # exit 2 — TS2590 at repro.ts:44
```

## What's happening

`BigUnion` is `MessageKeys<Messages, NestedKeyOf<Messages>>` — the same type `next-intl` derives from an app's translation JSON. `fixture.json` is an anonymized substitute with identical shape (7 161 leaf keys, max depth 9).

The error fires at:

```ts
export const arr = [key1, key2]; // two BigUnion values is enough
```

## Versions

| Compiler | Version | Result |
|---|---|---|
| `typescript` | `6.0.2` | clean |
| `@typescript/native-preview` | `7.0.0-dev.20260421.2` | TS2590 |
