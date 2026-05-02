/**
 * Illustrative usage of the selector API with next-intl.
 *
 * Open in your editor and try the autocomplete: type `m.` inside a
 * selector and observe hierarchical suggestions narrowing per dot-step,
 * instead of a flat ~7,000-item literal-union list.
 */

import type { MessageSelector, SelectorTranslator } from "./selector-api";

// Assume `useMessageT` returns a SelectorTranslator wrapping next-intl's t().
declare function useMessageT(): SelectorTranslator<IntlMessages>;

// Stand-in for the app's message type (typeof en.json).
declare type IntlMessages = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Basic usage
// ---------------------------------------------------------------------------

function HomeLink() {
	const t = useMessageT();
	return <a href="/">{t((m) => m.MainNavigation.items.home)}</a>;
}

// ---------------------------------------------------------------------------
// Multiple keys in an array — the case that triggers TS2590 with AsMessageKey
// ---------------------------------------------------------------------------

function MultiKey() {
	const t = useMessageT();

	// With AsMessageKey this array literal hits TS2590 on tsgo.
	// With selectors it's just an array of strings — no union expansion.
	const labels = [
		t((m) => m.MainNavigation.items.home),
		t((m) => m.MainNavigation.items.resources),
		t((m) => m.MainNavigation.items.resourceTable),
	];

	return (
		<ul>
			{labels.map((label) => (
				<li key={label}>{label}</li>
			))}
		</ul>
	);
}

// ---------------------------------------------------------------------------
// Translation-as-prop pattern
// ---------------------------------------------------------------------------

// Before:  type Props = { label: AsMessageKey }
//          — puts AsMessageKey in the prop type, risks TS2590 in deps arrays
//
// After:   type Props = { label: MessageSelector }
//          — function type, no union, safe everywhere
type LabelProps = { label: MessageSelector<IntlMessages> };

function LabelledItem({ label }: LabelProps) {
	const t = useMessageT();
	return <span>{t(label)}</span>;
}

function LabelledItemCaller() {
	return <LabelledItem label={(m) => m.MainNavigation.items.home} />;
}

export { HomeLink, LabelledItem, LabelledItemCaller, MultiKey };
