// Il conteggio dei rapporti delle prove con l'editor: uno per ciascun sistema dichiarato qui, scritto a parte dalla matrice della
// corsa, nei due versi. Un sistema che non ha scritto il rapporto (tolto dalla matrice, saltato, fermato) è un rosso, come un
// rapporto in più, una prova rossa, un editor non aperto o un pacchetto diverso da quello costruito.
//
//   bun prove/conteggio.ts --cartella <dove stanno i rapporti> --sha256 <impronta del pacchetto costruito>
//
// Uscite: 0 verde, 1 rosso, 2 fermo.
//
// Che cosa NON guarda: il contenuto delle prove, che sta nei rapporti e nei registri dei loro lavori.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { differenze, fermo } from "../strumenti/comune";

/** I sistemi su cui la prova con l'editor deve girare, come li chiama Node. */
export const SISTEMI = ["win32", "linux", "darwin"];

const { values: opzioni } = parseArgs({ args: Bun.argv.slice(2), options: { cartella: { type: "string" }, sha256: { type: "string" } }, strict: true });
const cartella = opzioni.cartella ?? fermo("--cartella vuole la cartella dei rapporti");
const atteso = opzioni.sha256 ?? fermo("--sha256 vuole l'impronta del pacchetto costruito");
if (!/^[0-9a-f]{64}$/.test(atteso)) fermo(`--sha256 non è un'impronta: ${atteso}`);

type Rapporto = { sistema: string; editor: string | null; pacchetto: { sha256: string }; fatte: number; previste: number; fallite: string[]; esito: string };
const file = readdirSync(cartella, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".json"));
const rapporti = file.map((f) => ({ f, r: JSON.parse(readFileSync(join(cartella, f), "utf8")) as Rapporto }));
console.log(`rapporti: ${rapporti.length} [${file.join(", ")}]; sistemi dichiarati ${SISTEMI.length} [${SISTEMI.join(", ")}]`);

const motivi: string[] = [];
const visti = rapporti.map((x) => x.r.sistema);
const ripetuti = visti.filter((s, i) => visti.indexOf(s) !== i);
for (const s of new Set(ripetuti)) motivi.push(`più rapporti per ${s}`);
const d = differenze(visti, SISTEMI);
for (const s of d.soloA) motivi.push(`rapporto di un sistema non dichiarato: ${s}`);
for (const s of d.soloB) motivi.push(`manca il rapporto di ${s}`);
for (const { f, r } of rapporti) {
  console.log(`  ${r.sistema}: ${r.esito}, prove ${r.fatte}/${r.previste}, fallite ${r.fallite.length}, editor ${r.editor ?? "non aperto"}, pacchetto ${r.pacchetto.sha256.slice(0, 12)}`);
  if (r.esito !== "VERDE") motivi.push(`${f}: esito ${r.esito}${r.fallite.length > 0 ? ` (${r.fallite.join("; ")})` : ""}`);
  if (r.fatte !== r.previste) motivi.push(`${f}: prove ${r.fatte} su ${r.previste}`);
  if (r.editor === null) motivi.push(`${f}: l'editor non è stato aperto`);
  if (r.pacchetto.sha256 !== atteso) motivi.push(`${f}: il pacchetto provato non è quello costruito (${r.pacchetto.sha256.slice(0, 12)})`);
}
for (const m of motivi) console.log(`ROSSO: ${m}`);
console.log(`ESITO: ${motivi.length === 0 ? "VERDE" : "ROSSO"}`);
process.exit(motivi.length === 0 ? 0 : 1);
