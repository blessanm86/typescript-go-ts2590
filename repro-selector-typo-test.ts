import messages from "./fixture.json";
type Messages = typeof messages;
declare function t(selector: (m: Messages) => string): string;

// Valid keys (string leaves):
t(m => m.k0xxx);
t(m => m.k63xxxxxxx.k70xx.k161xxxxxxx.k162x);

// Typo — not a real key:
t(m => m.NoSuchKey);

// Real path but lands on intermediate object, not string leaf:
t(m => m.k63xxxxxxx);

// Typo deep in chain:
t(m => m.k63xxxxxxx.k70xx.bogus);
