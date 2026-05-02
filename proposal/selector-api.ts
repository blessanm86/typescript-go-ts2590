/**
 * Reference implementation of the selector-based translation wrapper.
 *
 * Bridges next-intl's string-key translator into a selector API where
 * `t(m => m.X.Y)` replaces `t("X.Y")`. The Proxy records property
 * accesses and delegates to next-intl's `t(path)` at runtime.
 *
 * This file is self-contained — no framework dependencies beyond
 * next-intl's translator shape.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Stub types matching next-intl's value shapes. In a real integration these
// come from `import type { TranslationValues, ... } from "next-intl"`.
type TranslationValues = Record<string, unknown>;
type RichTranslationValues = Record<string, unknown>;
type MarkupTranslationValues = Record<string, unknown>;

/**
 * Selector that navigates the typed messages tree to a string leaf.
 *
 * In a real integration, `Messages` is `IntlMessages` (the type of your
 * `en.json`). The `=> string` return constraint is what makes this cheap:
 * TypeScript checks property access without constructing a union.
 */
type MessageSelector<Messages = Record<string, unknown>> = (m: Messages) => string;

/**
 * Minimal structural type for a next-intl translator. Uses only the
 * methods we need — avoids importing next-intl's generic types that
 * carry the full IntlMessages union and risk TS2590.
 */
type BaseTranslator = {
	(key: string, values?: TranslationValues): string;
	rich: (key: string, values?: RichTranslationValues) => unknown;
	markup: (key: string, values?: MarkupTranslationValues) => string;
	has: (key: string) => boolean;
	raw: (key: string) => unknown;
};

/**
 * The public API shape returned by the wrapper.
 */
type SelectorTranslator<Messages = Record<string, unknown>> = {
	(selector: MessageSelector<Messages>, values?: TranslationValues): string;
	rich(selector: MessageSelector<Messages>, values?: RichTranslationValues): unknown;
	markup(selector: MessageSelector<Messages>, values?: MarkupTranslationValues): string;
	hasLeaf(selector: MessageSelector<Messages>): boolean;
	hasLeafRaw(path: string): boolean;
};

// ---------------------------------------------------------------------------
// Path resolution — the Proxy trick
// ---------------------------------------------------------------------------

/**
 * Runs a selector against a Proxy that records every property access,
 * converting `m => m.MainNavigation.items.home` into `"MainNavigation.items.home"`.
 */
function pathFromSelector(selector: (m: object) => unknown): string {
	const parts: string[] = [];
	const handler: ProxyHandler<object> = {
		get(_target, prop) {
			if (typeof prop === "string") {
				parts.push(prop);
				return new Proxy({}, handler);
			}
			return undefined;
		},
	};
	selector(new Proxy({}, handler));
	return parts.join(".");
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps a next-intl translator into the selector-API shape.
 *
 * Usage with next-intl:
 *
 *   // React hook
 *   const baseT = useTranslations();
 *   const t = wrapBaseTranslator(baseT as BaseTranslator);
 *   t(m => m.MainNavigation.items.home);
 *   t.rich(m => m.Some.Key, { strong: (chunks) => <strong>{chunks}</strong> });
 *
 *   // Server async
 *   const baseT = await getTranslations();
 *   const t = wrapBaseTranslator(baseT as BaseTranslator);
 */
function wrapBaseTranslator<Messages = Record<string, unknown>>(
	baseT: BaseTranslator,
): SelectorTranslator<Messages> {
	const resolveLeafPath = (selector: MessageSelector<Messages>): string => {
		return pathFromSelector(selector as (m: object) => unknown);
	};

	const isStringLeafAtPath = (path: string): boolean => {
		if (path === "") return false;
		if (!baseT.has(path)) return false;
		return typeof baseT.raw(path) === "string";
	};

	const callable = (selector: MessageSelector<Messages>, values?: TranslationValues): string =>
		baseT(resolveLeafPath(selector), values);

	return Object.assign(callable, {
		rich: (selector: MessageSelector<Messages>, values?: RichTranslationValues) =>
			baseT.rich(resolveLeafPath(selector), values),
		markup: (selector: MessageSelector<Messages>, values?: MarkupTranslationValues): string =>
			baseT.markup(resolveLeafPath(selector), values),
		hasLeaf: (selector: MessageSelector<Messages>): boolean => {
			return isStringLeafAtPath(pathFromSelector(selector as (m: object) => unknown));
		},
		hasLeafRaw: (path: string): boolean => isStringLeafAtPath(path),
	});
}

export { pathFromSelector, wrapBaseTranslator };
export type { BaseTranslator, MessageSelector, SelectorTranslator };
