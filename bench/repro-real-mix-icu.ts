// Same 7 real callsites as repro-real-mix-leaf.ts but with full ICU value
// type safety via `<R extends string>` selector + `GetICUArgs<R>`.
import messages from "../fixture-real.json";
import type { GetICUArgs } from "@schummar/icu-type-parser";
type Messages = typeof messages;

type ICUOpts = {
	ICUArgument: string | number;
	ICUNumberArgument: number;
	ICUDateArgument: Date;
};
type Args<R extends string> = GetICUArgs<R, ICUOpts>;

declare function t<R extends string>(
	selector: (m: Messages) => R,
	values?: Args<R>
): string;
type RichValues<R extends string> = Args<R> & Record<string, unknown>;
declare const tRich: {
	<R extends string>(selector: (m: Messages) => R, values?: RichValues<R>): unknown;
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
