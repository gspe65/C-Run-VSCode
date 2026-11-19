// Il conteggio dei rapporti delle prove con l'editor: uno per ciascun sistema dichiarato qui, scritto a parte dalla matrice della
// corsa, nei due versi. Un sistema che non ha scritto il rapporto (tolto dalla matrice, saltato, fermato) è un rosso, come un
// rapporto in più, una prova rossa, un editor non aperto, un pacchetto diverso da quello costruito, o un numero di prove
// diverso da quello atteso qui per quel sistema (il denominatore non lo decide chi scrive il rapporto). Un rapporto FERMO (la
// prova non ha potuto misurare) fa FERMO, non rosso; un rosso vince su un fermo.
//
// Le due dichiarazioni della corsa lanciata a mano, coi nomi della matrice (windows, linux, macos):
// - `togli`: il sistema esce dalla matrice per controllare il conteggio, che allora è ROSSO, sempre;
// - `senza_macchina`: GitHub non dà la macchina di quel sistema; esce dalla matrice, il conteggio vuole verdi tutti gli altri e
//   scrive che quello manca per dichiarazione, e la nota della release lo dice. Mai più di un sistema mancante: con `togli`
//   insieme (sullo stesso sistema o su un altro) vince `togli`, e il conteggio è rosso.
//
//   bun prove/conteggio.ts --cartella <rapporti> --sha256 <impronta> [--togli <s>] [--senza-macchina <s>] [--riassunto <file>]
//   bun prove/conteggio.ts --matrice [--togli <s>] [--senza-macchina <s>] [--uscita <file>]     la matrice della corsa
//   bun prove/conteggio.ts --nota <file> --riassunto <file> --file <pacchetto> --sha256 <impronta> --corsa <numero>
//                          --etichetta <etichetta> --commit <sha> --repository <proprietario/nome> --uscita <file>
//                                                                   il testo della release: la nota più il paragrafo della corsa
//   bun prove/conteggio.ts --sonde      casi finti: ognuno deve dare il suo esito, i suoi motivi e il suo testo, e solo quelli
//
// Uscite: 0 verde, 1 rosso, 2 fermo (anche un'eccezione: un rapporto che non si legge non è un rosso, è una misura mancata).
//
// Che cosa NON guarda: il contenuto delle prove, che sta nei rapporti e nei registri dei loro lavori.

import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { differenze, fermo } from "../strumenti/comune";

/** I sistemi su cui la prova con l'editor deve girare, come li chiama Node, con le prove attese per ciascuno sul pacchetto
 *  della corsa: 22 senza editor (la costruzione non si conta) più 25 con l'editor; su macOS una in meno, la prova del cursore
 *  nel terminale riusato, che lì si scrive nel rapporto senza contarla (limite dichiarato nel README). La prova confronta
 *  questi numeri con i suoi (prove/prova.ts). */
export const PREVISTE: Record<string, number> = { win32: 47, linux: 47, darwin: 46 };
export const SISTEMI = Object.keys(PREVISTE);
/** I nomi della matrice della corsa, il sistema che Node riporta e la macchina delle Actions. */
const DELLA_CORSA: Record<string, { sistema: string; os: string }> = { windows: { sistema: "win32", os: "windows-latest" }, linux: { sistema: "linux", os: "ubuntu-latest" }, macos: { sistema: "darwin", os: "macos-latest" } };
/** I nomi dei sistemi nella nota della release. */
const NOMI: Record<string, string> = { win32: "Windows", linux: "Ubuntu", darwin: "macOS" };

type Rapporto = { sistema: string; editor: string | null; versioneDellEditor?: string | null; pacchetto: { sha256: string }; fatte: number; previste: number; fallite: string[]; esito: string };
export type Dichiarazioni = { togli: string; senzaMacchina: string };
export type Riassunto = { provati: { sistema: string; prove: number }[]; mancante: string | null; versione: string };
export type Esito = { rossi: string[]; fermi: string[]; riassunto?: Riassunto };

/** Le dichiarazioni coi nomi di Node, o il motivo per cui non si leggono. */
function dichiarati(d: Dichiarazioni): { togli?: string; senza?: string; fermo?: string } {
  for (const [nome, valore] of [["togli", d.togli], ["senza_macchina", d.senzaMacchina]] as const) {
    if (valore !== "" && DELLA_CORSA[valore] === undefined) return { fermo: `${nome}: «${valore}» non è un sistema della corsa (${Object.keys(DELLA_CORSA).join(", ")})` };
  }
  return { togli: DELLA_CORSA[d.togli]?.sistema, senza: DELLA_CORSA[d.senzaMacchina]?.sistema };
}

/** La matrice della corsa: tutti i sistemi, meno quelli dichiarati. */
export function matrice(d: Dichiarazioni): { sistema: string; os: string }[] | { fermo: string } {
  const x = dichiarati(d);
  if (x.fermo !== undefined) return { fermo: x.fermo };
  return Object.entries(DELLA_CORSA).filter(([nome]) => nome !== d.togli && nome !== d.senzaMacchina).map(([nome, v]) => ({ sistema: nome, os: v.os }));
}

/** I motivi del rosso e del fermo; tutti e due vuoti è verde, e allora c'è il riassunto per la nota. */
export function esitoDelConteggio(rapporti: { f: string; r: Rapporto }[], atteso: string, d: Dichiarazioni): Esito {
  const rossi: string[] = [];
  const fermi: string[] = [];
  const x = dichiarati(d);
  if (x.fermo !== undefined) return { rossi, fermi: [x.fermo] };
  if (x.togli !== undefined) rossi.push(`${x.togli} tolto dalla matrice apposta: il conteggio deve dire rosso`);
  if (x.togli !== undefined && x.senza !== undefined) rossi.push(`togli e senza_macchina insieme (${x.togli}, ${x.senza}): al più un sistema mancante, e vince togli`);
  const attesi = SISTEMI.filter((s) => s !== x.senza);
  const visti = rapporti.map((y) => y.r.sistema);
  const ripetuti = visti.filter((s, i) => visti.indexOf(s) !== i);
  for (const s of new Set(ripetuti)) rossi.push(`più rapporti per ${s}`);
  const diff = differenze(visti, attesi);
  for (const s of diff.soloA) rossi.push(s === x.senza ? `rapporto di ${s}, dichiarato senza macchina` : `rapporto di un sistema non dichiarato: ${s}`);
  for (const s of diff.soloB) rossi.push(`manca il rapporto di ${s}`);
  for (const { f, r } of rapporti) {
    if (r.esito === "FERMO") fermi.push(`${f}: esito FERMO, la prova non ha potuto misurare`);
    else if (r.esito !== "VERDE") rossi.push(`${f}: esito ${r.esito}${r.fallite.length > 0 ? ` (${r.fallite.join("; ")})` : ""}`);
    if (r.esito !== "FERMO" && r.fatte !== r.previste) rossi.push(`${f}: prove ${r.fatte} su ${r.previste}`);
    if (PREVISTE[r.sistema] !== undefined && r.previste !== PREVISTE[r.sistema]) rossi.push(`${f}: prove previste ${r.previste}, attese per ${r.sistema} ${PREVISTE[r.sistema]}`);
    if (r.editor === null) rossi.push(`${f}: l'editor non è stato aperto`);
    if (r.pacchetto.sha256 !== atteso) rossi.push(`${f}: il pacchetto provato non è quello costruito (${r.pacchetto.sha256.slice(0, 12)})`);
  }
  const versioni = [...new Set(rapporti.map((y) => y.r.versioneDellEditor ?? ""))];
  if (versioni.includes("")) rossi.push(`la versione dell'editor manca in ${rapporti.filter((y) => !y.r.versioneDellEditor).map((y) => y.f).join(", ")}`);
  else if (versioni.length > 1) rossi.push(`versioni dell'editor diverse: ${versioni.sort().join(", ")}`);
  if (rossi.length > 0 || fermi.length > 0) return { rossi, fermi };
  const provati = attesi.map((s) => ({ sistema: s, prove: rapporti.find((y) => y.r.sistema === s)!.r.fatte }));
  return { rossi, fermi, riassunto: { provati, mancante: x.senza ?? null, versione: versioni[0]! } };
}

/** Il testo della release: la nota della versione (che dice che cosa cambia) e il paragrafo della corsa, dal riassunto del
 *  conteggio. Un riassunto che non torna è un'eccezione: la release non esce. */
export function testoDellaRelease(nota: string, r: Riassunto, c: { file: string; sha256: string; corsa: string; etichetta: string; commit: string; repository: string }): string {
  const nomi = r.provati.map((p) => p.sistema);
  const attesi = SISTEMI.filter((s) => s !== r.mancante);
  if (nomi.join() !== attesi.join() || (r.mancante !== null && !SISTEMI.includes(r.mancante))) throw new Error(`il riassunto non torna: provati ${nomi.join(", ")}, mancante ${r.mancante}`);
  if (r.versione.trim() === "" || r.provati.some((p) => !(p.prove > 0))) throw new Error(`il riassunto non torna: versione «${r.versione}», prove ${r.provati.map((p) => p.prove).join(", ")}`);
  for (const [nome, valore] of Object.entries(c)) if (valore.trim() === "") throw new Error(`manca ${nome}`);
  const parti = r.provati.map((p, i) => `${NOMI[p.sistema]} (${p.prove}${i === 0 ? " prove verdi" : ""})`);
  const elenco = parti.length === 3 ? `${parti[0]}, ${parti[1]} e ${parti[2]}` : `${parti[0]} e ${parti[1]}`;
  const dove = r.mancante === null ? `su ${elenco}.` : `su ${elenco}; su ${NOMI[r.mancante]} non è stato provato, perché GitHub non ha dato la macchina per la prova.`;
  const paragrafo = `Il pacchetto \`${c.file}\` è stato costruito una volta sola dalla corsa ${c.corsa} delle GitHub Actions di questo repository, all'etichetta \`${c.etichetta}\` (commit \`${c.commit.slice(0, 7)}\`), sha256 \`${c.sha256}\`. Lo stesso file è stato provato con VSCodium ${r.versione} ${dove} Porta l'attestazione della sua provenienza:`;
  return `${nota.trimEnd()}\n\n${paragrafo}\n\n\`\`\`\ngh attestation verify ${c.file} -R ${c.repository}\n\`\`\`\n`;
}

function leggi(cartella: string): { f: string; r: Rapporto }[] {
  const file = readdirSync(cartella, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".json")).sort();
  return file.map((f) => ({ f: f.replaceAll("\\", "/"), r: JSON.parse(readFileSync(join(cartella, f), "utf8")) as Rapporto }));
}

/** Le sonde: rapporti finti scritti su disco e riletti come quelli veri, coi casi verdi (e il loro testo della release), un
 *  rosso per ramo e i fermi; poi lo stesso programma lanciato da riga di comando, per le uscite. */
function sonde(): number {
  const IMPRONTA = "a".repeat(64);
  const VERSIONE = "1.143.17232";
  const buono = (sistema: string): Rapporto => ({ sistema, editor: "VSCodium", versioneDellEditor: VERSIONE, pacchetto: { sha256: IMPRONTA }, fatte: PREVISTE[sistema]!, previste: PREVISTE[sistema]!, fallite: [], esito: "VERDE" });
  const tre = () => SISTEMI.map(buono);
  const nessuna: Dichiarazioni = { togli: "", senzaMacchina: "" };
  const corsa = { file: "C-Run-9.9.9.vsix", sha256: IMPRONTA, corsa: "123", etichetta: "v9.9.9", commit: "0123456789abcdef", repository: "gspe65/C-Run-VSCode" };
  const NOTA = "Che cosa cambia.\n";
  const coda = (dove: string) => `Che cosa cambia.\n\nIl pacchetto \`C-Run-9.9.9.vsix\` è stato costruito una volta sola dalla corsa 123 delle GitHub Actions di questo repository, all'etichetta \`v9.9.9\` (commit \`0123456\`), sha256 \`${IMPRONTA}\`. Lo stesso file è stato provato con VSCodium ${VERSIONE} ${dove} Porta l'attestazione della sua provenienza:\n\n\`\`\`\ngh attestation verify C-Run-9.9.9.vsix -R gspe65/C-Run-VSCode\n\`\`\`\n`;
  const P = PREVISTE;
  type Caso = { nome: string; rapporti: Rapporto[]; d?: Dichiarazioni; rossi?: string[]; fermi?: string[]; testo?: string };
  const casi: Caso[] = [
    { nome: "i tre rapporti verdi", rapporti: tre(), testo: coda(`su Windows (${P.win32} prove verdi), Ubuntu (${P.linux}) e macOS (${P.darwin}).`) },
    { nome: "senza_macchina macos e gli altri due verdi", rapporti: tre().filter((r) => r.sistema !== "darwin"), d: { togli: "", senzaMacchina: "macos" }, testo: coda(`su Windows (${P.win32} prove verdi) e Ubuntu (${P.linux}); su macOS non è stato provato, perché GitHub non ha dato la macchina per la prova.`) },
    { nome: "senza_macchina windows e gli altri due verdi", rapporti: tre().filter((r) => r.sistema !== "win32"), d: { togli: "", senzaMacchina: "windows" }, testo: coda(`su Ubuntu (${P.linux} prove verdi) e macOS (${P.darwin}); su Windows non è stato provato, perché GitHub non ha dato la macchina per la prova.`) },
    { nome: "un rapporto mancante senza dichiarazione", rapporti: tre().filter((r) => r.sistema !== "darwin"), rossi: ["manca il rapporto di darwin"] },
    { nome: "togli macos", rapporti: tre().filter((r) => r.sistema !== "darwin"), d: { togli: "macos", senzaMacchina: "" }, rossi: ["darwin tolto dalla matrice apposta: il conteggio deve dire rosso", "manca il rapporto di darwin"] },
    { nome: "togli linux, col rapporto che c'è lo stesso", rapporti: tre(), d: { togli: "linux", senzaMacchina: "" }, rossi: ["linux tolto dalla matrice apposta: il conteggio deve dire rosso"] },
    { nome: "togli e senza_macchina sullo stesso sistema", rapporti: tre().filter((r) => r.sistema !== "darwin"), d: { togli: "macos", senzaMacchina: "macos" }, rossi: ["darwin tolto dalla matrice apposta: il conteggio deve dire rosso", "togli e senza_macchina insieme (darwin, darwin): al più un sistema mancante, e vince togli"] },
    { nome: "togli e senza_macchina su due sistemi", rapporti: tre().filter((r) => r.sistema === "win32"), d: { togli: "linux", senzaMacchina: "macos" }, rossi: ["linux tolto dalla matrice apposta: il conteggio deve dire rosso", "togli e senza_macchina insieme (linux, darwin): al più un sistema mancante, e vince togli", "manca il rapporto di linux"] },
    { nome: "senza_macchina con il rapporto di quel sistema", rapporti: tre(), d: { togli: "", senzaMacchina: "macos" }, rossi: ["rapporto di darwin, dichiarato senza macchina"] },
    { nome: "senza_macchina e un altro rapporto mancante", rapporti: tre().filter((r) => r.sistema === "win32"), d: { togli: "", senzaMacchina: "macos" }, rossi: ["manca il rapporto di linux"] },
    { nome: "due rapporti per un sistema", rapporti: [...tre(), buono("linux")], rossi: ["più rapporti per linux"] },
    { nome: "un sistema non dichiarato", rapporti: [...tre(), { ...buono("linux"), sistema: "freebsd" }], rossi: ["rapporto di un sistema non dichiarato: freebsd"] },
    { nome: "un rapporto rosso", rapporti: tre().map((r) => (r.sistema === "win32" ? { ...r, fallite: ["x"], esito: "ROSSO" } : r)), rossi: ["rapporto-win32.json: esito ROSSO (x)"] },
    { nome: "prove fatte meno delle previste", rapporti: tre().map((r) => (r.sistema === "linux" ? { ...r, fatte: r.fatte - 1 } : r)), rossi: [`rapporto-linux.json: prove ${P.linux! - 1} su ${P.linux}`] },
    { nome: "il denominatore abbassato da chi scrive il rapporto", rapporti: tre().map((r) => (r.sistema === "linux" ? { ...r, fatte: 30, previste: 30 } : r)), rossi: [`rapporto-linux.json: prove previste 30, attese per linux ${P.linux}`] },
    { nome: "l'editor non aperto", rapporti: tre().map((r) => (r.sistema === "darwin" ? { ...r, editor: null } : r)), rossi: ["rapporto-darwin.json: l'editor non è stato aperto"] },
    { nome: "un altro pacchetto", rapporti: tre().map((r) => (r.sistema === "win32" ? { ...r, pacchetto: { sha256: "b".repeat(64) } } : r)), rossi: ["rapporto-win32.json: il pacchetto provato non è quello costruito (bbbbbbbbbbbb)"] },
    { nome: "due versioni dell'editor", rapporti: tre().map((r) => (r.sistema === "linux" ? { ...r, versioneDellEditor: "1.0.0" } : r)), rossi: [`versioni dell'editor diverse: 1.0.0, ${VERSIONE}`] },
    { nome: "la versione dell'editor che manca", rapporti: tre().map((r) => (r.sistema === "darwin" ? { ...r, versioneDellEditor: null } : r)), rossi: ["la versione dell'editor manca in rapporto-darwin.json"] },
    { nome: "un rapporto fermo", rapporti: tre().map((r) => (r.sistema === "linux" ? { ...r, fatte: 3, esito: "FERMO" } : r)), fermi: ["rapporto-linux.json: esito FERMO, la prova non ha potuto misurare"] },
    { nome: "un rapporto fermo e uno rosso", rapporti: tre().map((r) => (r.sistema === "linux" ? { ...r, esito: "FERMO" } : r.sistema === "win32" ? { ...r, fallite: ["x"], esito: "ROSSO" } : r)), rossi: ["rapporto-win32.json: esito ROSSO (x)"], fermi: ["rapporto-linux.json: esito FERMO, la prova non ha potuto misurare"] },
    { nome: "una dichiarazione che non è un sistema", rapporti: tre(), d: { togli: "", senzaMacchina: "solaris" }, fermi: ["senza_macchina: «solaris» non è un sistema della corsa (windows, linux, macos)"] },
  ];
  const radice = mkdtempSync(join(tmpdir(), "c-run  conteggio-"));
  let sbagliate = 0;
  const giudica = (nome: string, buona: boolean, dettaglio: string) => {
    if (!buona) sbagliate++;
    console.log(`${buona ? "PASS" : "FAIL"}  sonda «${nome}»: ${dettaglio}`);
  };
  const scriviRapporti = (cartella: string, rapporti: Rapporto[]) => {
    mkdirSync(cartella, { recursive: true });
    // Il nome del file dice il sistema, come nella corsa; un sistema ripetuto va in una sottocartella, come un altro artefatto.
    const usati = new Set<string>();
    for (const r of rapporti) {
      const nome = `rapporto-${r.sistema}.json`;
      const dove = usati.has(nome) ? join(cartella, "doppio") : cartella;
      mkdirSync(dove, { recursive: true });
      writeFileSync(join(dove, nome), JSON.stringify(r));
      usati.add(nome);
    }
  };
  try {
    casi.forEach((c, i) => {
      const cartella = join(radice, String(i));
      scriviRapporti(cartella, c.rapporti);
      const letti = leggi(cartella);
      const e = esitoDelConteggio(letti, IMPRONTA, c.d ?? nessuna);
      const uguali = (a: string[], b: string[]) => a.length === b.length && a.every((x, j) => x === b[j]);
      let testo: string | undefined;
      if (e.riassunto !== undefined) testo = testoDellaRelease(NOTA, e.riassunto, corsa);
      const buona = letti.length === c.rapporti.length && uguali(e.rossi, c.rossi ?? []) && uguali(e.fermi, c.fermi ?? []) && testo === c.testo;
      giudica(c.nome, buona, `rapporti ${letti.length} su ${c.rapporti.length}, rossi ${e.rossi.length} [${e.rossi.join("; ")}], fermi ${e.fermi.length} [${e.fermi.join("; ")}]${testo === c.testo ? "" : `\n      testo: ${JSON.stringify(testo)}\n      atteso: ${JSON.stringify(c.testo)}`}`);
    });
    // La matrice: tutti, meno i dichiarati; una dichiarazione che non è un sistema è un fermo.
    const m = (togli: string, senzaMacchina: string) => {
      const x = matrice({ togli, senzaMacchina });
      return "fermo" in x ? "fermo" : x.map((y) => y.sistema).join();
    };
    const matrici = [m("", ""), m("windows", ""), m("", "macos"), m("linux", "macos"), m("macos", "macos"), m("mac", "")];
    giudica("la matrice coi tre sistemi e con le dichiarazioni", matrici.join(" | ") === "windows,linux,macos | linux,macos | windows,linux | windows | windows,linux | fermo", matrici.join(" | "));
    // Un riassunto che non torna non fa una nota.
    const rotti: Riassunto[] = [
      { provati: [{ sistema: "win32", prove: 1 }], mancante: null, versione: VERSIONE },
      { provati: [{ sistema: "win32", prove: 1 }, { sistema: "linux", prove: 1 }], mancante: null, versione: VERSIONE },
      { provati: [{ sistema: "win32", prove: 1 }, { sistema: "linux", prove: 1 }, { sistema: "darwin", prove: 1 }], mancante: null, versione: "" },
    ];
    const rifiutati = rotti.filter((r) => {
      try {
        testoDellaRelease(NOTA, r, corsa);
        return false;
      } catch {
        return true;
      }
    }).length;
    giudica("un riassunto che non torna non fa la nota", rifiutati === rotti.length, `rifiutati ${rifiutati} su ${rotti.length}`);
    // Da riga di comando: le uscite di un verde, di un rosso, di un fermo e di un rapporto che non si legge (un'eccezione).
    const uscite: string[] = [];
    for (const [nome, rapporti, rotto] of [["verde", tre(), false], ["rosso", tre().filter((r) => r.sistema !== "linux"), false], ["fermo", tre().map((r) => (r.sistema === "darwin" ? { ...r, esito: "FERMO" } : r)), false], ["illeggibile", tre(), true]] as const) {
      const cartella = join(radice, `riga-${nome}`);
      scriviRapporti(cartella, [...rapporti]);
      if (rotto) writeFileSync(join(cartella, "rapporto-win32.json"), "{ non è JSON");
      const p = Bun.spawnSync(["bun", import.meta.path, "--cartella", cartella, "--sha256", IMPRONTA, "--riassunto", join(cartella, "riassunto", "riassunto.json")], { stdout: "pipe", stderr: "pipe" });
      const esito = /^ESITO: (\w+)/m.exec(p.stdout.toString())?.[1] ?? (/^FERMO:/m.test(p.stdout.toString()) ? "FERMO" : "?");
      uscite.push(`${nome} ${p.exitCode} ${esito}`);
    }
    giudica("le uscite da riga di comando: verde 0, rosso 1, fermo 2, un rapporto illeggibile 2", uscite.join(" | ") === "verde 0 VERDE | rosso 1 ROSSO | fermo 2 FERMO | illeggibile 2 FERMO", uscite.join(" | "));
  } finally {
    rmSync(radice, { recursive: true, force: true });
  }
  const verdi = casi.filter((c) => c.testo !== undefined).length;
  const fermati = casi.filter((c) => (c.fermi ?? []).length > 0 && (c.rossi ?? []).length === 0).length;
  const rossi = casi.length - verdi - fermati;
  console.log(`sonde: ${casi.length + 3} (${verdi} verdi, ${rossi} rami rossi, ${fermati} fermi, più la matrice, i riassunti rotti e le uscite); sbagliate ${sbagliate}; attese per sistema ${SISTEMI.map((s) => `${s} ${PREVISTE[s]}`).join(", ")}`);
  console.log(`ESITO: ${sbagliate === 0 ? "VERDE" : "ROSSO"}`);
  return sbagliate === 0 ? 0 : 1;
}

function principale(): number {
  const { values: o } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      cartella: { type: "string" },
      sha256: { type: "string" },
      togli: { type: "string", default: "" },
      "senza-macchina": { type: "string", default: "" },
      riassunto: { type: "string" },
      matrice: { type: "boolean" },
      uscita: { type: "string" },
      nota: { type: "string" },
      file: { type: "string" },
      corsa: { type: "string" },
      etichetta: { type: "string" },
      commit: { type: "string" },
      repository: { type: "string" },
      sonde: { type: "boolean" },
    },
    strict: true,
  });
  if (o.sonde) return sonde();
  const d: Dichiarazioni = { togli: o.togli.trim(), senzaMacchina: o["senza-macchina"].trim() };
  if (o.matrice) {
    const m = matrice(d);
    if ("fermo" in m) fermo(m.fermo);
    console.log(`matrice: ${m.map((x) => x.sistema).join(", ")}${d.togli !== "" ? `; tolto apposta ${d.togli}` : ""}${d.senzaMacchina !== "" ? `; senza macchina ${d.senzaMacchina}` : ""}`);
    if (o.uscita !== undefined) appendFileSync(o.uscita, `matrice=${JSON.stringify(m)}\n`);
    return 0;
  }
  if (o.nota !== undefined) {
    const riassunto = JSON.parse(readFileSync(o.riassunto ?? fermo("--nota vuole --riassunto"), "utf8")) as Riassunto;
    const valore = (nome: string, v: string | undefined) => v ?? fermo(`--nota vuole --${nome}`);
    const testo = testoDellaRelease(readFileSync(o.nota, "utf8"), riassunto, { file: valore("file", o.file), sha256: valore("sha256", o.sha256), corsa: valore("corsa", o.corsa), etichetta: valore("etichetta", o.etichetta), commit: valore("commit", o.commit), repository: valore("repository", o.repository) });
    writeFileSync(valore("uscita", o.uscita), testo);
    console.log(testo);
    return 0;
  }
  const cartella = o.cartella ?? fermo("--cartella vuole la cartella dei rapporti");
  const atteso = o.sha256 ?? fermo("--sha256 vuole l'impronta del pacchetto costruito");
  if (!/^[0-9a-f]{64}$/.test(atteso)) fermo(`--sha256 non è un'impronta: ${atteso}`);
  const rapporti = leggi(cartella);
  console.log(`rapporti: ${rapporti.length} [${rapporti.map((x) => x.f).join(", ")}]; sistemi dichiarati ${SISTEMI.length} [${SISTEMI.join(", ")}]; togli «${d.togli}», senza macchina «${d.senzaMacchina}»`);
  for (const { r } of rapporti) console.log(`  ${r.sistema}: ${r.esito}, prove ${r.fatte}/${r.previste} (attese ${PREVISTE[r.sistema] ?? "?"}), fallite ${r.fallite.length}, editor ${r.editor ?? "non aperto"} ${r.versioneDellEditor ?? "(versione?)"}, pacchetto ${r.pacchetto.sha256.slice(0, 12)}`);
  const e = esitoDelConteggio(rapporti, atteso, d);
  for (const m of e.rossi) console.log(`ROSSO: ${m}`);
  for (const m of e.fermi) console.log(`FERMO: ${m}`);
  if (e.riassunto !== undefined) {
    if (e.riassunto.mancante !== null) console.log(`manca per dichiarazione: ${e.riassunto.mancante}, GitHub non ha dato la macchina`);
    if (o.riassunto !== undefined) {
      mkdirSync(dirname(o.riassunto), { recursive: true });
      writeFileSync(o.riassunto, `${JSON.stringify(e.riassunto, null, 2)}\n`);
    }
  }
  const esito = e.rossi.length > 0 ? "ROSSO" : e.fermi.length > 0 ? "FERMO" : "VERDE";
  console.log(`ESITO: ${esito}`);
  return esito === "VERDE" ? 0 : esito === "ROSSO" ? 1 : 2;
}

if (import.meta.main) {
  let uscita: number;
  try {
    uscita = principale();
  } catch (e) {
    fermo(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  }
  process.exit(uscita);
}
