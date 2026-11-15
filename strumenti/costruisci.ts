// La costruzione, sempre da capo: l'estensione in dist/extension.cjs, il programma del terminale in dist/terminale.cjs, e il
// pacchetto dist/<name>-<version>.vsix fatto da vsce coi file che .vscodeignore lascia passare.
//
//   bun run costruisci    atteso: ESITO: VERDE e il nome del pacchetto
//
// Uscite: 0 verde, 1 rosso, 2 fermo.
//
// Che cosa NON guarda: il contenuto del pacchetto, che guarda prove/prova.ts.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { esegui, fermo, impronta, RADICE, rosso } from "./comune";

const DIST = join(RADICE, "dist");
rmSync(DIST, { recursive: true, force: true });
// Bun.build solleva un AggregateError quando non riesce: i suoi errori sono il motivo del rosso.
for (const [sorgente, nome] of [["extension.ts", "extension.cjs"], ["terminale.ts", "terminale.cjs"]] as const) {
  try {
    await Bun.build({ entrypoints: [join(RADICE, "src", sorgente)], outdir: DIST, naming: nome, target: "node", format: "cjs", minify: { whitespace: true }, external: ["vscode"] });
  } catch (e) {
    const errori = e instanceof AggregateError ? e.errors.map(String) : [String(e)];
    rosso(`la costruzione di ${sorgente} non è riuscita:\n${errori.join("\n")}`);
  }
}

const manifesto = JSON.parse(readFileSync(join(RADICE, "package.json"), "utf8")) as { name: string; version: string };
const vsix = join(DIST, `${manifesto.name}-${manifesto.version}.vsix`);
const vsce = join(RADICE, "node_modules", "@vscode", "vsce", "vsce");
if (!existsSync(vsce)) fermo("vsce non c'è: prima bun install --frozen-lockfile");
const p = esegui(["node", vsce, "package", "--no-dependencies", "-o", vsix]);
console.log(p.testo.trim());
if (p.uscita !== 0 || !existsSync(vsix)) rosso(`vsce non ha fatto il pacchetto, uscita ${p.uscita}`);
console.log(`pacchetto ${vsix}: ${readFileSync(vsix).length} byte, impronta ${impronta(readFileSync(vsix))}`);
console.log("ESITO: VERDE");
