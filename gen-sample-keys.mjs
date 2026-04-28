// Pick a representative sample of keys to reuse across all variant scenes.
import { readFileSync, writeFileSync } from "node:fs";
const data = JSON.parse(readFileSync("fixture.json", "utf8"));
const paths = [];
function walk(node, prefix) {
	for (const k of Object.keys(node)) {
		const path = prefix ? `${prefix}.${k}` : k;
		const v = node[k];
		if (v !== null && typeof v === "object" && !Array.isArray(v)) walk(v, path);
		else if (typeof v === "string") paths.push(path);
	}
}
walk(data, "");
// Pick 100 evenly-spaced samples for the call sites.
const N = 100;
const step = Math.max(1, Math.floor(paths.length / N));
const sample = [];
for (let i = 0; i < N; i++) sample.push(paths[i * step]);
writeFileSync("sample-keys.json", JSON.stringify(sample, null, 2) + "\n");
console.log("wrote", sample.length, "sample keys");
