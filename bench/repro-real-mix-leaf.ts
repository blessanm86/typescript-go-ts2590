// Real-world callsite mix from 4 production files in dash0-ui (sampled
// from `next-intl-Perf-Fix` branch). Uses the real, un-anonymized en.json.
//
// Files sampled (count = callsites):
//   gcp-resource-detail-page.tsx                          (3)
//   metric-histogram-bucket-boundaries-card.tsx           (3 — incl. 1 t.rich)
//   logs/no-signals/layout.tsx                            (1)
//   metadata.ts                                           — uses resolvePath, skipped
//
// Total: 7 callsites across 3 files. Real fan-out, real path lengths,
// real ICU placeholder distribution at the leaves (mostly plain, one
// placeholder + plural via t.rich).
import messages from "../fixture-real.json";
type Messages = typeof messages;

type TranslationValues = Record<string, string | number>;
type RichValues = Record<string, unknown>;

declare function t(selector: (m: Messages) => string, values?: TranslationValues): string;
declare const tRich: {
	(selector: (m: Messages) => string, values?: RichValues): unknown;
};

// gcp-resource-detail-page.tsx — 3 callsites
const a1 = t((m) => m.Infrastructure.GoogleCloud.breadcrumb.infrastructure);
const a2 = t((m) => m.Infrastructure.GoogleCloud.breadcrumb.gcp);
const a3 = t((m) => m.Infrastructure.GoogleCloud.details.resourceAttributes);

// metric-histogram-bucket-boundaries-card.tsx — 3 callsites (1 plain, 1 plain, 1 rich+plural)
const b1 = t((m) => m.Metrics.Sidebar.bucketBoundaries.title);
const b2 = t((m) => m.Metrics.Sidebar.bucketBoundaries.title);
const b3 = tRich((m) => m.Metrics.Sidebar.bucketBoundaries.showMore, {
	count: 5,
	em: (c: unknown) => c,
});

// logs/no-signals/layout.tsx — 1 callsite
const c1 = t((m) => m.Logs.title.default);

export { a1, a2, a3, b1, b2, b3, c1 };
