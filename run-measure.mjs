// Run each variant with each compiler, 3 cold runs, capture extended diagnostics.
import { spawnSync } from "node:child_process";

const variants = ["baseline", "string", "codegen", "selector"];
const compilers = [
	{ name: "tsc", bin: "node_modules/.bin/tsc", args: ["--extendedDiagnostics", "-p"] },
	{ name: "tsgo", bin: "node_modules/.bin/tsgo", args: ["--extendedDiagnostics", "-p"] },
];
const RUNS = 3;

function parseDiagnostics(output) {
	const out = {};
	const wanted = [
		"Files",
		"Lines",
		"Identifiers",
		"Symbols",
		"Types",
		"Instantiations",
		"Memory used",
		"Parse time",
		"ResolveModule time",
		"ResolveTypeReference time",
		"ResolveLibrary time",
		"Program time",
		"Bind time",
		"Check time",
		"printTime time",
		"Emit time",
		"Total time",
	];
	for (const line of output.split(/\r?\n/)) {
		const m = line.match(/^([A-Za-z][^:]+?):\s+([\d.,]+(?:K|s)?)\s*$/);
		if (m && wanted.includes(m[1].trim())) {
			out[m[1].trim()] = m[2].trim();
		}
	}
	return out;
}

const results = [];
for (const variant of variants) {
	for (const compiler of compilers) {
		const runs = [];
		for (let i = 0; i < RUNS; i++) {
			const start = Date.now();
			const r = spawnSync(compiler.bin, [...compiler.args, `tsconfig.${variant}.json`], { encoding: "utf8" });
			const elapsedMs = Date.now() - start;
			const stdout = r.stdout || "";
			const stderr = r.stderr || "";
			const exit = r.status;
			const ts2590 = (stdout + stderr).includes("TS2590") || (stdout + stderr).includes("too complex to represent");
			const diag = parseDiagnostics(stdout);
			runs.push({ run: i + 1, elapsedMs, exit, ts2590, diag });
		}
		results.push({ variant, compiler: compiler.name, runs });
		const median = runs.map(r => r.elapsedMs).sort((a, b) => a - b)[Math.floor(RUNS / 2)];
		const status = runs.every(r => r.exit === 0) ? "ok" : runs.some(r => r.ts2590) ? "TS2590" : `exit ${runs[0].exit}`;
		console.log(`${variant.padEnd(10)} ${compiler.name.padEnd(6)} median ${median}ms  ${status}`);
	}
}

import { writeFileSync } from "node:fs";
writeFileSync("measurements.json", JSON.stringify(results, null, 2));
console.log("\nwrote measurements.json");
