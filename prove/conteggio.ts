// Il conteggio dei rapporti delle prove con l'editor: uno per ciascun sistema dichiarato qui, scritto a parte dalla matrice della
// corsa, nei due versi. Un sistema che non ha scritto il rapporto (tolto dalla matrice, saltato, fermato) è un rosso, come un
// rapporto in più, una prova rossa, un editor non aperto, un pacchetto diverso da quello costruito, o un numero di prove
// diverso da quello atteso qui per quel sistema (il denominatore non lo decide chi scrive il rapporto).
//
//   bun prove/conteggio.ts --cartella <dove stanno i rapporti> --sha256 <impronta del pacchetto costruito>
//   bun prove/conteggio.ts --sonde      rapporti finti, uno per ramo rosso: ognuno deve dare il suo rosso e solo quello
//
// Uscite: 0 verde, 1 rosso, 2 fermo.
//
// Che cosa NON guarda: il contenuto delle prove, che sta nei rapporti e nei registri dei loro lavori.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { differenze, fermo } from "../strumenti/comune";

/** I sistemi su cui la prova con l'editor deve girare, come li chiama Node, con le prove attese per ciascuno sul pacchetto
 *  della corsa: 16 senza editor (la costruzione non si conta) più 23 con l'editor; su macOS una in meno, la prova del cursore
 *  nel terminale riusato, che lì si scrive nel rapporto senza contarla (limite dichiarato nel README). */
export const PREVISTE: Record<string, number> = { win32: 39, linux: 39, darwin: 38 };
export const SISTEMI = Object.keys(PREVISTE);

type Rapporto = { sistema: string; editor: string | null; pacchetto: { sha256: string }; fatte: number; previste: number; fallite: string[]; esito: string };

/** I motivi del rosso; vuoto è verde. */
export function motiviDelConteggio(rapporti: { f: string; r: Rapporto }[], atteso: string): string[] {
  const motivi: string[] = [];
  const visti = rapporti.map((x) => x.r.sistema);
  const ripetuti = visti.filter((s, i) => visti.indexOf(s) !== i);
  for (const s of new Set(ripetuti)) motivi.push(`più rapporti per ${s}`);
  const d = differenze(visti, SISTEMI);
  for (const s of d.soloA) motivi.push(`rapporto di un sistema non dichiarato: ${s}`);
  for (const s of d.soloB) motivi.push(`manca il rapporto di ${s}`);
  for (const { f, r } of rapporti) {
    if (r.esito !== "VERDE") motivi.push(`${f}: esito ${r.esito}${r.fallite.length > 0 ? ` (${r.fallite.join("; ")})` : ""}`);
    if (r.fatte !== r.previste) motivi.push(`${f}: prove ${r.fatte} su ${r.previste}`);
    if (PREVISTE[r.sistema] !== undefined && r.previste !== PREVISTE[r.sistema]) motivi.push(`${f}: prove previste ${r.previste}, attese per ${r.sistema} ${PREVISTE[r.sistema]}`);
    if (r.editor === null) motivi.push(`${f}: l'editor non è stato aperto`);
    if (r.pacchetto.sha256 !== atteso) motivi.push(`${f}: il pacchetto provato non è quello costruito (${r.pacchetto.sha256.slice(0, 12)})`);
  }
  return motivi;
}

function leggi(cartella: string): { f: string; r: Rapporto }[] {
  const file = readdirSync(cartella, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".json")).sort();
  return file.map((f) => ({ f: f.replaceAll("\\", "/"), r: JSON.parse(readFileSync(join(cartella, f), "utf8")) as Rapporto }));
}

/** Le sonde: rapporti finti scritti su disco e riletti come quelli veri, un caso verde e un rosso per ramo. */
function sonde(): number {
  const IMPRONTA = "a".repeat(64);
  const buono = (sistema: string): Rapporto => ({ sistema, editor: "VSCodium", pacchetto: { sha256: IMPRONTA }, fatte: PREVISTE[sistema]!, previste: PREVISTE[sistema]!, fallite: [], esito: "VERDE" });
  const tre = () => SISTEMI.map(buono);
  const casi: { nome: string; rapporti: Rapporto[]; atteso: string[] }[] = [
    { nome: "i tre rapporti verdi", rapporti: tre(), atteso: [] },
    { nome: "un sistema tolto", rapporti: tre().filter((r) => r.sistema !== "darwin"), atteso: ["manca il rapporto di darwin"] },
    { nome: "due rapporti per un sistema", rapporti: [...tre(), buono("linux")], atteso: ["più rapporti per linux"] },
    { nome: "un sistema non dichiarato", rapporti: [...tre(), { ...buono("linux"), sistema: "freebsd" }], atteso: ["rapporto di un sistema non dichiarato: freebsd"] },
    { nome: "una prova rossa", rapporti: tre().map((r) => (r.sistema === "win32" ? { ...r, fallite: ["x"], esito: "ROSSO" } : r)), atteso: ["rapporto-win32.json: esito ROSSO (x)"] },
    { nome: "prove fatte meno delle previste", rapporti: tre().map((r) => (r.sistema === "linux" ? { ...r, fatte: r.fatte - 1 } : r)), atteso: [`rapporto-linux.json: prove ${PREVISTE.linux! - 1} su ${PREVISTE.linux}`] },
    { nome: "il denominatore abbassato da chi scrive il rapporto", rapporti: tre().map((r) => (r.sistema === "linux" ? { ...r, fatte: 30, previste: 30 } : r)), atteso: [`rapporto-linux.json: prove previste 30, attese per linux ${PREVISTE.linux}`] },
    { nome: "l'editor non aperto", rapporti: tre().map((r) => (r.sistema === "darwin" ? { ...r, editor: null } : r)), atteso: ["rapporto-darwin.json: l'editor non è stato aperto"] },
    { nome: "un altro pacchetto", rapporti: tre().map((r) => (r.sistema === "win32" ? { ...r, pacchetto: { sha256: "b".repeat(64) } } : r)), atteso: ["rapporto-win32.json: il pacchetto provato non è quello costruito (bbbbbbbbbbbb)"] },
  ];
  const radice = mkdtempSync(join(tmpdir(), "c-run  conteggio-"));
  let sbagliate = 0;
  try {
    casi.forEach((c, i) => {
      const cartella = join(radice, String(i));
      mkdirSync(cartella);
      // Il nome del file dice il sistema, come nella corsa; un sistema ripetuto va in una sottocartella, come un altro artefatto.
      const usati = new Set<string>();
      for (const r of c.rapporti) {
        const nome = `rapporto-${r.sistema}.json`;
        const dove = usati.has(nome) ? join(cartella, "doppio") : cartella;
        mkdirSync(dove, { recursive: true });
        writeFileSync(join(dove, nome), JSON.stringify(r));
        usati.add(nome);
      }
      const letti = leggi(cartella);
      const motivi = motiviDelConteggio(letti, IMPRONTA);
      const buona = letti.length === c.rapporti.length && motivi.length === c.atteso.length && c.atteso.every((a, j) => motivi[j] === a);
      if (!buona) sbagliate++;
      console.log(`${buona ? "PASS" : "FAIL"}  sonda «${c.nome}»: rapporti ${letti.length} su ${c.rapporti.length}, motivi ${motivi.length} [${motivi.join("; ")}]`);
    });
  } finally {
    rmSync(radice, { recursive: true, force: true });
  }
  const rossi = casi.filter((c) => c.atteso.length > 0).length;
  console.log(`sonde: ${casi.length} (1 verde, ${rossi} rami rossi); sbagliate ${sbagliate}; attese per sistema ${SISTEMI.map((s) => `${s} ${PREVISTE[s]}`).join(", ")}`);
  console.log(`ESITO: ${sbagliate === 0 ? "VERDE" : "ROSSO"}`);
  return sbagliate === 0 ? 0 : 1;
}

if (import.meta.main) {
  const { values: opzioni } = parseArgs({ args: Bun.argv.slice(2), options: { cartella: { type: "string" }, sha256: { type: "string" }, sonde: { type: "boolean" } }, strict: true });
  if (opzioni.sonde) process.exit(sonde());
  const cartella = opzioni.cartella ?? fermo("--cartella vuole la cartella dei rapporti");
  const atteso = opzioni.sha256 ?? fermo("--sha256 vuole l'impronta del pacchetto costruito");
  if (!/^[0-9a-f]{64}$/.test(atteso)) fermo(`--sha256 non è un'impronta: ${atteso}`);
  const rapporti = leggi(cartella);
  console.log(`rapporti: ${rapporti.length} [${rapporti.map((x) => x.f).join(", ")}]; sistemi dichiarati ${SISTEMI.length} [${SISTEMI.join(", ")}]`);
  for (const { r } of rapporti) console.log(`  ${r.sistema}: ${r.esito}, prove ${r.fatte}/${r.previste} (attese ${PREVISTE[r.sistema] ?? "?"}), fallite ${r.fallite.length}, editor ${r.editor ?? "non aperto"}, pacchetto ${r.pacchetto.sha256.slice(0, 12)}`);
  const motivi = motiviDelConteggio(rapporti, atteso);
  for (const m of motivi) console.log(`ROSSO: ${m}`);
  console.log(`ESITO: ${motivi.length === 0 ? "VERDE" : "ROSSO"}`);
  process.exit(motivi.length === 0 ? 0 : 1);
}
