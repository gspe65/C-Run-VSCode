// La prova dell'estensione: il pacchetto, la logica e, con `--editor`, l'estensione dentro l'editor indicato, coi passi dello
// studente: il progetto col Makefile, il file da solo con l'ingresso, un errore messo apposta, il passo passo.
//
//   bun prove/prova.ts                                   costruisce il pacchetto e lo prova senza aprire nulla
//   bun prove/prova.ts --editor <eseguibile> --strumenti <file>
//                                                        lo stesso, poi apre quell'editor per qualche secondo, con un profilo
//                                                        temporaneo; <file> è quello scritto da strumenti/strumenti.ts --uscita
//   opzioni: --pacchetto <file .vsix>  prova quel pacchetto invece di costruirlo (la corsa delle Actions: costruito una volta sola)
//            --rapporto <file>         scrive l'esito in JSON (sistema, impronta del pacchetto, prove, fallite, esito)
//            --msys <cartella>         su Windows, dove stanno make e gcc (predefinito: msys64\usr\bin sul disco di sistema)
//
// Atteso: ESITO: VERDE, prove N/N. Uscite: 0 verde, 1 rosso, 2 fermo (non si è potuto misurare).
//
// Che cosa NON guarda:
// - la tastiera vera: l'ingresso arriva al terminale con sendText; lo schermo: il testo del terminale si copia dagli appunti;
// - la scritta nella barra di stato (l'editor non la espone): il manifesto e i comandi registrati sì;
// - il fuoco del sistema; un editor diverso da quello dato con `--editor`;
// - i compilatori: quelli del sistema (su Windows clang di llvm-mingw e gcc di MSYS), che decidono i messaggi.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { differenze, esegui, fermo, impronta, RADICE, vociDelloZip } from "../strumenti/comune";

const { values: opzioni } = parseArgs({
  args: Bun.argv.slice(2),
  options: { editor: { type: "string" }, pacchetto: { type: "string" }, rapporto: { type: "string" }, strumenti: { type: "string" }, msys: { type: "string" } },
  strict: true,
});

/** I denominatori, dichiarati prima della corsa: le chiamate a `prova` senza editor, e quelle in più con l'editor. */
const PROVE_SENZA_EDITOR = 17;
const PROVE_DELL_EDITOR = 23;
const TEST_ATTESI = 15;
/** Le icone col triangolo di esecuzione: nella barra ce ne dev'essere una sola. */
const TRIANGOLI = /\$\((play|run|debug-start|debug-continue|triangle-right)\)/g;

/** Ciò che il pacchetto contiene, e nient'altro. */
const NEL_PACCHETTO = ["[Content_Types].xml", "extension.vsixmanifest", "extension/LICENSE.txt", "extension/dist/extension.cjs", "extension/dist/terminale.cjs", "extension/package.json", "extension/readme.md"];
/** Le voci che sono file del repository così come sono. Il README vsce lo mette sempre. */
const DAL_REPOSITORY: Record<string, string> = { "extension/package.json": "package.json", "extension/LICENSE.txt": "LICENSE", "extension/readme.md": "README.md" };
/** Che cosa può importare ciascun programma del pacchetto: l'editor e i moduli di Node, nient'altro. */
const IMPORT_ATTESI: Record<string, string[]> = { "extension/dist/extension.cjs": ["node:child_process", "node:fs", "node:os", "node:path", "vscode"], "extension/dist/terminale.cjs": ["node:fs"] };
const PERCORSO_ASSOLUTO = /(?<![A-Za-z])[A-Za-z]:[\\/]/;
const VIETATE = [/bun:/, /Bun\./];

const cartella = mkdtempSync(join(tmpdir(), "c-run  prova-"));
// L'editor appena chiuso può tenere la cartella ancora per un momento: la pulizia non decide l'esito.
process.on("exit", () => {
  try {
    rmSync(cartella, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (e) {
    console.log(`nota: la cartella temporanea ${cartella} non si è potuta togliere (${e instanceof Error ? e.message : String(e)})`);
  }
});

let fatte = 0;
const fallite: string[] = [];
/** Le premesse di una prova che non si sono avverate: la prova non dice nulla, e l'esito è FERMO. */
const premesseMancanti: string[] = [];
/** Gli esiti dei limiti dichiarati nel README, scritti nel rapporto senza contarli. */
const limiti: string[] = [];
function prova(nome: string, buona: boolean, dettaglio = ""): void {
  fatte++;
  console.log(`${buona ? "PASS" : "FAIL"}  ${nome}${buona ? "" : `\n      ${dettaglio}`}`);
  if (!buona) fallite.push(nome);
}

const manifestoDelRepository = JSON.parse(readFileSync(join(RADICE, "package.json"), "utf8")) as { name: string; version: string };

// --- Il pacchetto: costruito ora, o quello dato.
let VSIX: string;
if (opzioni.pacchetto !== undefined) {
  VSIX = opzioni.pacchetto;
  if (!existsSync(VSIX)) fermo(`non c'è il pacchetto ${VSIX}`);
  console.log(`pacchetto dato: ${VSIX}`);
} else {
  VSIX = join(RADICE, "dist", `${manifestoDelRepository.name}-${manifestoDelRepository.version}.vsix`);
  const costruzione = esegui(["bun", "run", "costruisci"]);
  prova("la costruzione: estensione, terminale, pacchetto", costruzione.uscita === 0 && existsSync(VSIX), costruzione.testo);
  if (!existsSync(VSIX)) fermo(`il pacchetto non c'è:\n${costruzione.testo}`);
}
const pacchetto = readFileSync(VSIX);
console.log(`pacchetto: ${pacchetto.length} byte, impronta ${impronta(pacchetto)}`);

// --- I tipi.
const tsc = join(RADICE, "node_modules", "typescript", "bin", "tsc");
if (!existsSync(tsc)) fermo("tsc non c'è: prima bun install --frozen-lockfile");
for (const [nome, conf] of [["l'estensione", "tsconfig.json"], ["le prove e gli strumenti", join("prove", "tsconfig.json")]] as const) {
  const t = esegui(["node", tsc, "-p", conf]);
  prova(`tsc su ${nome}`, t.uscita === 0, t.testo);
}

// --- La logica. L'esito si legge dal rapporto che il programma scrive, non dalla sola uscita.
const rapportoDeiTest = join(cartella, "test.xml");
const test = esegui(["bun", "test", "./prove/logica.test.ts", "--reporter=junit", `--reporter-outfile=${rapportoDeiTest}`]);
if (!existsSync(rapportoDeiTest)) fermo(`bun test non ha scritto il rapporto, uscita ${test.uscita}:\n${test.testo}`);
const radiceDelRapporto = /<testsuites\b[^>]*>/.exec(readFileSync(rapportoDeiTest, "utf8"))?.[0] ?? "";
const numero = (nome: string) => Number(new RegExp(`\\b${nome}="(\\d+)"`).exec(radiceDelRapporto)?.[1] ?? "-1");
console.log(`logica: ${numero("tests")} prove, fallite ${numero("failures")}, saltate ${numero("skipped")}; dichiarate ${TEST_ATTESI}`);
prova("la logica, senza editor", test.uscita === 0 && numero("tests") === TEST_ATTESI && numero("failures") === 0 && numero("skipped") === 0, test.testo);

// --- Il verdetto sul pacchetto: una funzione sola, per il file vero e per le mutazioni. Vuoto è verde; ogni motivo nomina la voce.
const colpiIn = (testo: string): string[] => [PERCORSO_ASSOLUTO, ...VIETATE].flatMap((rx) => rx.exec(testo)?.[0] ?? []);
const importDi = (testo: string): string[] => [...new Set(new Bun.Transpiler({ loader: "js" }).scanImports(testo).map((i) => i.path))].sort();
type Manifesto = { license?: string; contributes?: { commands?: { command: string; icon?: string }[]; menus?: Record<string, { command: string; when?: string }[]> } };
/** I due comandi ci sono, e nessuno dei due ha un'icona nel titolo dell'editor: chi impara a programmare vede un solo
 *  triangolo di esecuzione, quello scritto nella barra di stato. */
const comandiSenzaTitolo = (m: Manifesto): boolean =>
  ["c-run.compilaEdEsegui", "c-run.passoPasso"].every((c) => m.contributes?.commands?.some((x) => x.command === c)) && !(m.contributes?.menus?.["editor/title"] ?? []).some((x) => x.command.startsWith("c-run."));

function motiviDelleVoci(voci: ReadonlyMap<string, Uint8Array>): string[] {
  const motivi: string[] = [];
  const elenco = differenze(voci.keys(), NEL_PACCHETTO);
  for (const v of elenco.soloA) motivi.push(`voce in più: ${v}`);
  for (const v of elenco.soloB) motivi.push(`voce mancante: ${v}`);
  for (const [voce, file] of Object.entries(DAL_REPOSITORY)) {
    const d = voci.get(voce);
    if (d !== undefined && impronta(d) !== impronta(readFileSync(join(RADICE, file)))) motivi.push(`${voce}: non è ${file} del repository`);
  }
  for (const [voce, attesi] of Object.entries(IMPORT_ATTESI)) {
    const d = voci.get(voce);
    if (d !== undefined && importDi(new TextDecoder().decode(d)).join() !== attesi.join()) motivi.push(`${voce}: importa ${importDi(new TextDecoder().decode(d)).join(", ")}`);
  }
  const manifesto = voci.get("extension/package.json");
  if (manifesto !== undefined) {
    const m = JSON.parse(new TextDecoder().decode(manifesto)) as Manifesto;
    if (!comandiSenzaTitolo(m)) motivi.push("extension/package.json: i due comandi mancano, o hanno un'icona nel titolo dell'editor");
    if (m.license !== "MIT") motivi.push(`extension/package.json: licenza ${m.license}`);
  }
  const vsixManifest = voci.get("extension.vsixmanifest");
  if (vsixManifest !== undefined && !new TextDecoder().decode(vsixManifest).includes("<License>extension/LICENSE.txt</License>")) motivi.push("extension.vsixmanifest: non indica la licenza");
  for (const [v, d] of voci) for (const c of colpiIn(new TextDecoder().decode(d))) motivi.push(`${v}: ${c}`);
  return motivi;
}
function motiviDelFile(dati: Uint8Array): string[] {
  let voci: Map<string, Uint8Array>;
  try {
    voci = vociDelloZip(dati);
  } catch (e) {
    return [`il pacchetto non si legge: ${e instanceof Error ? e.message : String(e)}`];
  }
  return motiviDelleVoci(voci);
}

const motiviVeri = motiviDelFile(pacchetto);
const voci = (() => {
  try {
    return vociDelloZip(pacchetto);
  } catch {
    return new Map<string, Uint8Array>();
  }
})();
console.log(`voci: ${voci.size}, attese ${NEL_PACCHETTO.length}; motivi ${motiviVeri.length}`);
prova("il pacchetto: le voci attese nei due versi, i file del repository, gli import, i comandi senza icone nel titolo, la licenza, nessun percorso assoluto né stringa vietata", motiviVeri.length === 0, motiviVeri.join("; "));

// Il lettore dello zip contro un lettore del sistema, sullo stesso file. Su Windows il `tar` di System32; altrove `unzip`.
const estratto = join(cartella, "estratto  dal pacchetto");
mkdirSync(estratto);
const [elencoDelSistema, estrazione] = process.platform === "win32"
  ? (() => {
      const tar = join(process.env.SystemRoot ?? fermo("manca SystemRoot"), "System32", "tar.exe");
      return [esegui([tar, "-tf", VSIX]), esegui([tar, "-xf", VSIX, "-C", estratto])];
    })()
  : [esegui(["unzip", "-Z1", VSIX]), esegui(["unzip", "-q", VSIX, "-d", estratto])];
if (elencoDelSistema.uscita !== 0 || estrazione.uscita !== 0) fermo(`il lettore del sistema non apre il pacchetto:\n${elencoDelSistema.testo}\n${estrazione.testo}`);
const contenuto = elencoDelSistema.testo.split(/\r?\n/).filter((r) => r !== "" && !r.endsWith("/"));
const lettoreContro = differenze(voci.keys(), contenuto);
const lettoreDiverse = [...voci].filter(([v, d]) => !existsSync(join(estratto, v)) || impronta(d) !== impronta(readFileSync(join(estratto, v)))).map(([v]) => v);
console.log(`lettore dello zip: ${voci.size} voci, lettore del sistema ${contenuto.length}; solo nel nostro ${lettoreContro.soloA.length}, solo nel sistema ${lettoreContro.soloB.length}, byte diversi ${lettoreDiverse.length}`);
prova("il lettore dello zip vede il pacchetto come il lettore del sistema: stesso elenco, stessi byte", voci.size > 0 && lettoreContro.soloA.length + lettoreContro.soloB.length + lettoreDiverse.length === 0, `solo nel nostro: ${lettoreContro.soloA.join(", ")}; solo nel sistema: ${lettoreContro.soloB.join(", ")}; diversi: ${lettoreDiverse.join(", ")}`);

// --- Le mutazioni del verdetto: ognuna deve dare rosso col suo motivo, e lei solo. Si guarda anche quante voci ha toccato.
function mutazione(nome: string, toccate: number, motivi: string[], attesi: string[]): void {
  console.log(`  ${nome}: toccate ${toccate}, motivi ${motivi.length}: ${motivi.join("; ")}`);
  prova(`mutazione: ${nome}`, toccate > 0 && motivi.length === attesi.length && attesi.every((a, i) => motivi[i] === a), `toccate ${toccate}; motivi: ${motivi.join("; ")}`);
}
const mutata = (cambia: (m: Map<string, Uint8Array>) => number): { voci: Map<string, Uint8Array>; toccate: number } => {
  const m = new Map(voci);
  return { toccate: cambia(m), voci: m };
};
const testo = (s: string) => new TextEncoder().encode(s);
const EXTRA = "extension/dist/extra.cjs";
const assoluto = (disco: string, barra: string): string => `${disco}:${barra}`;
prova("controllo: le voci vere, copiate senza mutazioni, sono verdi", motiviDelleVoci(new Map(voci)).length === 0);
{
  const m = mutata((v) => (v.set(EXTRA, testo("module.exports = 1;\n")), 1));
  mutazione("una voce in più", m.toccate, motiviDelleVoci(m.voci), [`voce in più: ${EXTRA}`]);
}
{
  const m = mutata((v) => Number(v.delete("extension/LICENSE.txt")));
  mutazione("una voce mancante", m.toccate, motiviDelleVoci(m.voci), ["voce mancante: extension/LICENSE.txt"]);
}
{
  const m = mutata((v) => (v.set("extension/readme.md", Buffer.concat([v.get("extension/readme.md") ?? new Uint8Array(), Buffer.from(" ")])), 1));
  mutazione("un README diverso da quello del repository", m.toccate, motiviDelleVoci(m.voci), ["extension/readme.md: non è README.md del repository"]);
}
{
  const m = mutata((v) => (v.set("extension/dist/terminale.cjs", Buffer.concat([v.get("extension/dist/terminale.cjs") ?? new Uint8Array(), Buffer.from('\nif (false) require("node:net");')])), 1));
  mutazione("un import in più nel programma del terminale", m.toccate, motiviDelleVoci(m.voci), ["extension/dist/terminale.cjs: importa node:fs, node:net"]);
}
{
  const m = mutata((v) => (v.set(EXTRA, testo(`module.exports = ["${assoluto("C", "\\\\")}a", "bun:sqlite"];`)), 1));
  mutazione("una voce in più con un percorso assoluto e una stringa vietata", m.toccate, motiviDelleVoci(m.voci), [`voce in più: ${EXTRA}`, `${EXTRA}: ${assoluto("C", "\\")}`, `${EXTRA}: bun:`]);
}
const troncato = pacchetto.subarray(0, pacchetto.length - 30);
mutazione("un pacchetto troncato", pacchetto.length - troncato.length, motiviDelFile(troncato), ["il pacchetto non si legge: manca la fine dell'indice"]);
const manifestoVero = JSON.parse(readFileSync(join(estratto, "extension", "package.json"), "utf8")) as Manifesto;
prova("mutazione: un comando con l'icona nel titolo dell'editor è rosso", comandiSenzaTitolo(manifestoVero) && !comandiSenzaTitolo({ ...manifestoVero, contributes: { ...manifestoVero.contributes, menus: { ...manifestoVero.contributes?.menus, "editor/title": [{ command: "c-run.compilaEdEsegui", when: "resourceLangId == c" }] } } }));
prova("mutazione: un comando che manca è rosso", !comandiSenzaTitolo({ ...manifestoVero, contributes: { ...manifestoVero.contributes, commands: (manifestoVero.contributes?.commands ?? []).filter((c) => c.command !== "c-run.passoPasso") } }));
prova("mutazione: il lettore del sistema con una voce in più non torna", differenze(voci.keys(), [...contenuto, "extension/x"]).soloB.join() === "extension/x");

// --- Il conteggio dei rapporti della corsa: le sue sonde, un rosso per ramo (prove/conteggio.ts --sonde).
const sondeDelConteggio = esegui(["bun", join(RADICE, "prove", "conteggio.ts"), "--sonde"]);
console.log(sondeDelConteggio.testo.trim());
prova("il conteggio dei rapporti: ogni ramo rosso si accende da solo, il verde resta verde", sondeDelConteggio.uscita === 0 && /^ESITO: VERDE/m.test(sondeDelConteggio.testo), sondeDelConteggio.testo);

// --- Nell'editor dato.
function strumentiDa(file: string): Record<string, string> {
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).filter((r) => r.includes("=")).map((r) => [r.slice(0, r.indexOf("=")), r.slice(r.indexOf("=") + 1)]));
}
function lldbDap(strumenti: Record<string, string>): string {
  if (process.platform === "win32") return join(strumenti.llvm ?? fermo("manca llvm= nel file degli strumenti"), "lldb-dap.exe");
  if (process.platform === "darwin") {
    const x = esegui(["xcrun", "-f", "lldb-dap"]);
    if (x.uscita !== 0) fermo(`xcrun non trova lldb-dap:\n${x.testo}`);
    return x.testo.trim();
  }
  const nelPath = Bun.which("lldb-dap");
  if (nelPath !== null) return nelPath;
  const conVersione = existsSync("/usr/bin") ? readdirSync("/usr/bin").filter((n) => /^lldb-dap-\d+$/.test(n)).sort() : [];
  return conVersione.length > 0 ? join("/usr/bin", conVersione.at(-1)!) : fermo("lldb-dap non c'è");
}

async function nellEditor(eseguibile: string): Promise<void> {
  if (!existsSync(eseguibile)) fermo(`non c'è ${eseguibile}`);
  const node = Bun.which("node") ?? fermo("node non c'è");
  const strumenti = strumentiDa(opzioni.strumenti ?? fermo("--editor vuole anche --strumenti"));
  const estensioneDiDebug = strumenti.estensione ?? fermo("manca estensione= nel file degli strumenti");
  const eseguibileDiDebug = lldbDap(strumenti);
  console.log(`lldb-dap: ${eseguibileDiDebug}`);

  // Il PATH dell'editor: su Windows make e gcc di MSYS, poi clang e lldb-dap di llvm-mingw, in quest'ordine.
  if (process.platform === "win32") {
    const msys = opzioni.msys ?? join(process.env.SystemDrive ?? "C:", "\\", "msys64", "usr", "bin");
    for (const p of ["make.exe", "gcc.exe"]) if (!existsSync(join(msys, p))) fermo(`in ${msys} manca ${p}`);
    process.env.PATH = [msys, strumenti.llvm!, process.env.PATH ?? ""].join(";");
  }

  // I casi in una cartella con spazi doppi; l'errore è leggi.c senza il punto e virgola della riga 5.
  // Il percorso reale dei casi: su macOS la cartella temporanea passa da un collegamento (/var è /private/var), e un punto
  // d'arresto messo sul percorso del collegamento non si aggancia al programma, che porta quello reale. Solo i casi: il
  // profilo dell'editor resta sul percorso corto, perché sul reale il suo socket supera la lunghezza ammessa da macOS (misurato:
  // «listen EINVAL»).
  mkdirSync(join(cartella, "casi  con  spazi"));
  const casi = realpathSync(join(cartella, "casi  con  spazi"));
  cpSync(join(RADICE, "prove", "casi", "ciao"), join(casi, "ciao"), { recursive: true });
  cpSync(join(RADICE, "prove", "casi", "leggi"), join(casi, "leggi"), { recursive: true });
  cpSync(join(RADICE, "prove", "casi", "avvisi"), join(casi, "avvisi"), { recursive: true });
  mkdirSync(join(casi, "errore"));
  const righe = readFileSync(join(RADICE, "prove", "casi", "leggi", "leggi.c"), "utf8").split("\n");
  if (!righe[4]?.endsWith(");")) fermo(`la riga 5 di leggi.c non è quella attesa: ${righe[4]}`);
  righe[4] = righe[4]!.slice(0, -1);
  writeFileSync(join(casi, "errore", "errore.c"), righe.join("\n"));
  const programmaErrore = process.platform === "win32" ? "errore.exe" : "errore";

  const dati = join(cartella, "dati  editor");
  mkdirSync(join(dati, "profilo", "User"), { recursive: true });
  writeFileSync(join(dati, "profilo", "User", "settings.json"), JSON.stringify({ "lldb-dap.executable-path": eseguibileDiDebug, "security.workspace.trust.enabled": false }, null, 2));
  const uscita = join(cartella, "esiti.json");
  console.log(`APRO L'EDITOR: ${eseguibile}, una finestra per qualche secondo, con un profilo temporaneo`);
  const inizio = performance.now();
  const figlio = Bun.spawn([node, join(RADICE, "prove", "lancia.cjs"), eseguibile, join(estratto, "extension"), estensioneDiDebug, casi, uscita, dati, programmaErrore], { cwd: cartella, stdout: "pipe", stderr: "pipe", env: process.env });
  const [fuori, errori] = await Promise.all([new Response(figlio.stdout).text(), new Response(figlio.stderr).text()]);
  const codiceUscita = await figlio.exited;
  if (!existsSync(uscita)) fermo(`l'editor non ha scritto gli esiti, uscita ${codiceUscita}:\n${fuori.slice(-3000)}\n${errori.slice(-3000)}`);
  console.log(`editor: ${((performance.now() - inizio) / 1000).toFixed(1)} s, uscita ${codiceUscita}`);
  if (codiceUscita !== 0) console.log(`l'editor è uscito con ${codiceUscita}; la coda della sua uscita:\n${fuori.slice(-3000)}\n${errori.slice(-3000)}`);

  type Fermo = { fermo?: boolean; riga?: number; n?: string | null };
  const e = JSON.parse(readFileSync(uscita, "utf8")) as {
    comandiNelTitolo?: string[];
    terminalePrima?: string;
    ciao?: { testo: string; icona?: string | null };
    barraConUnFile?: { voci: string[] };
    leggi?: { domandaVista: boolean; terminaleAttivo?: string; titoloAttivo?: string; testo?: string };
    errore?: { testo: string; problemi: { riga: number; gravita: number; fonte?: string; messaggio: string }[]; cursore: number | null; programmaNato: boolean };
    passo?: Fermo & { terminale: string | null; fermoPrima: boolean; finito?: boolean; testo?: string; barra?: { voci: string[] } };
    inizio?: Fermo;
    riuso?: Fermo & { controllo: boolean; sporco: boolean; nuovoTerminale: boolean };
    avvisi?: { testo: string };
    senzaNome?: { schema?: string; barra?: { voci: string[] } };
  };
  console.log(JSON.stringify(e, null, 2).slice(0, 6000));
  const ciao = e.ciao?.testo ?? "";
  // I due della barra, più quello che dice lo stato della barra alle prove (fuori dal manifesto: non è nella tavolozza).
  prova("i comandi registrati nell'editor: i due della barra e quello dello stato della barra", (e.comandiNelTitolo ?? []).join() === "c-run.compilaEdEsegui,c-run.passoPasso,c-run.statoDellaBarra", String(e.comandiNelTitolo));
  // Il lettore del terminale distingue: vuoto prima del comando, col saluto dopo.
  prova("controllo: prima del comando il terminale «Programma C» non c'è, dopo sì", e.terminalePrima === "" && ciao.includes("Ciao, mondo!"), JSON.stringify(e.terminalePrima));
  prova("col Makefile: la riga della compilazione, il programma, la fine", ciao.includes("Compilo main.c col Makefile…") && ciao.includes("Ciao, mondo!") && ciao.includes("(finito: uscita 0)"), ciao);
  const leggi = e.leggi?.testo ?? "";
  prova("il file da solo: la domanda del programma compare prima dell'ingresso", e.leggi?.domandaVista === true, JSON.stringify(e.leggi));
  prova("il file da solo: con l'ingresso 21 scrive 42 ed esce con 0", leggi.includes("Compilo leggi.c con ") && /21\s*\r?\n\s*42/.test(leggi) && leggi.includes("(finito: uscita 0)"), leggi);
  prova("il file da solo: il terminale attivo è «Programma C»", e.leggi?.terminaleAttivo === "Programma C", String(e.leggi?.terminaleAttivo));
  prova("il titolo della scheda del terminale è «Programma C», non il nome del processo", e.leggi?.titoloAttivo === "Programma C", String(e.leggi?.titoloAttivo));
  const errore = e.errore;
  prova("l'errore: in «Problemi» un errore sulla riga 5", (errore?.problemi ?? []).some((p) => p.riga === 5 && p.gravita === 0), JSON.stringify(errore?.problemi));
  prova("l'errore: il cursore è sulla riga 5", errore?.cursore === 5, String(errore?.cursore));
  prova("l'errore: il terminale dice che non parte, e il programma non nasce", (errore?.testo ?? "").includes("1 errore, il programma non parte: lo trovi in «Problemi» (riga 5).") && !(errore?.testo ?? "").includes("Eseguo") && errore?.programmaNato === false, `${errore?.testo}; nato ${errore?.programmaNato}`);
  prova("passo passo: il terminale del debugger si apre e il programma aspetta l'ingresso", e.passo?.terminale !== null && e.passo?.terminale !== undefined && e.passo?.fermoPrima === false, JSON.stringify(e.passo));
  prova("passo passo: con l'ingresso 21 si ferma sulla riga 8 con n = 21", e.passo?.fermo === true && e.passo?.riga === 8 && e.passo?.n === "21", JSON.stringify(e.passo));
  prova("passo passo: continuando scrive 42 e la sessione finisce", e.passo?.finito === true && /42/.test(e.passo?.testo ?? ""), JSON.stringify(e.passo));
  prova("passo passo senza punti d'arresto: si ferma sulla riga 5, la prima di main", e.inizio?.fermo === true && e.inizio?.riga === 5, JSON.stringify(e.inizio));
  prova("il file da solo: la riga prima del programma dice di scrivere lì ciò che legge", leggi.includes("(se legge qualcosa, scrivilo qui e premi Invio):"), leggi);
  prova("la fine dice come eseguirlo di nuovo", ciao.includes("Il programma è finito. Per eseguirlo di nuovo: ▶ Compila ed esegui, nella barra in basso."), ciao);
  // La barra: con un file .c due voci col nome del file e un solo triangolo; durante il passo passo nessuna; su un documento
  // senza nome nessuna. Il terminale «Programma C» senza l'icona del triangolo.
  const vociConUnFile = e.barraConUnFile?.voci ?? [];
  prova("la barra con un file .c: «Compila ed esegui» e «Passo passo» col nome del file, un solo triangolo", vociConUnFile.length === 2 && vociConUnFile.every((v) => v.endsWith(" main.c")) && vociConUnFile.join(" ").match(TRIANGOLI)?.length === 1, JSON.stringify(e.barraConUnFile));
  prova("la barra durante il passo passo: le due voci non ci sono", e.passo?.barra !== undefined && e.passo.barra.voci.length === 0, JSON.stringify(e.passo?.barra));
  prova("la barra su un documento C senza nome: le due voci non ci sono", e.senzaNome?.schema === "untitled" && e.senzaNome.barra?.voci.length === 0, JSON.stringify(e.senzaNome));
  prova("il terminale «Programma C» ha l'icona del terminale, non un triangolo", e.ciao?.icona === "terminal", String(e.ciao?.icona));
  const avvisi = e.avvisi?.testo ?? "";
  prova("trenta avvisi del compilatore: il terminale li mostra e il programma parte", (avvisi.match(/warning:/g) ?? []).length === 30 && avvisi.includes("Partito nonostante gli avvisi") && avvisi.includes("(finito: uscita 0)"), avvisi.slice(-1500));
  // La premessa della prova del passo passo di nuovo, per sistema. Su Windows e macOS il terminale lo apre lldb-dap e l'editor
  // lo riusa: se ne apre uno nuovo, la prova non dice nulla del riuso. Su Linux l'estensione rifà il terminale «Passo passo» a
  // ogni avvio (extension.ts, terminaleDelPassoPasso): lì il terminale è nuovo, e se non si apre la prova non dice nulla.
  // In tutti e due i casi la prova non si conta, e l'esito è FERMO.
  const terminaleNuovoAtteso = process.platform === "linux";
  if (e.riuso?.nuovoTerminale !== terminaleNuovoAtteso) premesseMancanti.push(`passo passo di nuovo: ${terminaleNuovoAtteso ? "su Linux il terminale «Passo passo» non si è rifatto" : "l'editor non ha riusato il terminale del debugger"} (${JSON.stringify(e.riuso)})`);
  // Il controllo della digitazione deve sporcare il file col fuoco nel file, se no la prova dopo non discrimina.
  const cursoreNelTerminale = e.riuso?.controllo === true && e.riuso?.sporco === false;
  if (process.platform === "darwin") {
    // Limite dichiarato nel README: su macOS, dal secondo passo passo, il cursore resta nel file (misurato in due corse delle
    // Actions, anche rimettendo il terminale davanti dopo il lancio e dopo l'aggancio). Qui l'esito si scrive nel rapporto,
    // senza contarlo.
    limiti.push(`macOS, passo passo di nuovo: ${cursoreNelTerminale ? "il cursore è andato nel terminale" : "il cursore è rimasto nel file"} (controllo ${e.riuso?.controllo}, file toccato ${e.riuso?.sporco})`);
    console.log(`NOTA  limite dichiarato: ${limiti.at(-1)}`);
  } else {
    prova("passo passo di nuovo: il cursore va nel terminale del programma (la digitazione non tocca il file; col fuoco nel file sì)", cursoreNelTerminale, JSON.stringify(e.riuso));
  }
  prova("passo passo di nuovo: con l'ingresso 21 si ferma sulla riga 8 con n = 21", e.riuso?.fermo === true && e.riuso?.riga === 8 && e.riuso?.n === "21", JSON.stringify(e.riuso));
}

if (opzioni.editor !== undefined) await nellEditor(opzioni.editor);

// Su macOS la prova del cursore nel terminale riusato si scrive senza contarla (limite dichiarato nel README).
const provePreviste = PROVE_SENZA_EDITOR - (opzioni.pacchetto !== undefined ? 1 : 0) + (opzioni.editor !== undefined ? PROVE_DELL_EDITOR - (process.platform === "darwin" ? 1 : 0) : 0);
console.log(`prove: ${fatte}/${provePreviste}, fallite ${fallite.length}${opzioni.editor !== undefined ? "" : "; l'editor non è stato aperto"}`);
const esito = fatte !== provePreviste || premesseMancanti.length > 0 ? "FERMO" : fallite.length > 0 ? "ROSSO" : "VERDE";
if (opzioni.rapporto !== undefined) {
  mkdirSync(dirname(opzioni.rapporto), { recursive: true });
  writeFileSync(opzioni.rapporto, `${JSON.stringify({ sistema: process.platform, architettura: process.arch, editor: opzioni.editor ?? null, pacchetto: { nome: VSIX.split(/[\\/]/).pop(), byte: pacchetto.length, sha256: impronta(pacchetto) }, fatte, previste: provePreviste, fallite, premesseMancanti, limiti, esito }, null, 2)}\n`);
}
if (esito === "FERMO") {
  if (fatte !== provePreviste) console.log(`FERMO: il denominatore non torna: dichiarate ${provePreviste}, eseguite ${fatte}`);
  for (const p of premesseMancanti) console.log(`FERMO: manca la premessa: ${p}`);
  process.exit(2);
}
console.log(`ESITO: ${esito === "ROSSO" ? "ROSSO" : opzioni.editor !== undefined ? "VERDE" : "VERDE, senza l'editor: l'estensione nell'editor non è stata provata"}`);
process.exit(fallite.length === 0 ? 0 : 1);
