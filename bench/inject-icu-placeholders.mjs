// Mutate fixture.json in place: inject ICU placeholders into a deterministic
// fraction of string leaves so the selector-icu variant exercises real ICU
// type-parsing work. Plain "v" leaves stay plain; ~20% of leaves get mutated.
//
// Determinism matters: every run picks the same leaves so measurements are
// reproducible. We use a counter mod N rather than a hash, so the mix is
// stable across Node versions.
//
// Placeholder mix is intentionally varied to exercise the parser:
//   - 60% of mutated leaves: simple `{name}` (one arg)
//   - 25%: ICU plural `{count, plural, ...}`
//   - 10%: ICU select `{kind, select, ...}`
//   - 5%: two-arg `{name} ({count})`
import { readFileSync, writeFileSync } from "node:fs";

const data = JSON.parse(readFileSync("../fixture.json", "utf8"));

const placeholderTemplates = [
	// 60% — single arg
	"hello {name}",
	"hello {name}",
	"hello {name}",
	"hello {name}",
	"hello {name}",
	"hello {name}",
	// 25% — plural
	"{count, plural, one {# item} other {# items}}",
	"{count, plural, one {# day} other {# days}}",
	"{count, plural, one {# error} other {# errors}}",
	// 10% — select
	"{kind, select, host {server} container {pod} other {resource}}",
	// 5% — two-arg
	"{name} ({count})",
];

let leafIndex = 0;
let mutated = 0;
let kept = 0;

function walk(node) {
	for (const k of Object.keys(node)) {
		const v = node[k];
		if (v !== null && typeof v === "object" && !Array.isArray(v)) {
			walk(v);
		} else if (typeof v === "string") {
			// Mutate every 5th leaf.
			if (leafIndex % 5 === 0) {
				node[k] = placeholderTemplates[mutated % placeholderTemplates.length];
				mutated++;
			} else {
				kept++;
			}
			leafIndex++;
		}
	}
}

walk(data);
writeFileSync("../fixture.json", JSON.stringify(data, null, 2) + "\n");
console.log(`mutated ${mutated} leaves, kept ${kept} plain (total ${leafIndex})`);
