// La logica senza editor (src/piano.ts). I messaggi dei compilatori sono uscite VERE di clang, gcc e make su un errore messo
// apposta (prove/casi/uscite/), non testi scritti a mano.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { comandoDelTerminale, LIMITE_DELLA_RIGA_DI_CMD, MANCA_IL_COMPILATORE, MANCA_MAKE, mancaLEstensioneDelDebug, nomeDelProgramma, PASSO_PASSO_SENZA_TERMINALE, pianoDiCompilazione, programmaNato, righeDellaCompilazione, righeNonScritte, rigaDelPassoPassoImpossibile, rigaDelRifiuto, scegliCompilatore, scriviLeRighe, segnalazioniDi, terminaleNonAperto, togliLeRighe } from "../src/piano";

const uscita = (nome: string) => readFileSync(join(import.meta.dir, "casi", "uscite", nome), "utf8");
const CARTELLA = join("prova", "dove");

test("il nome del programma: .exe solo su Windows", () => {
  expect(nomeDelProgramma(join(CARTELLA, "lettura-intero.c"), "win32")).toBe("lettura-intero.exe");
  expect(nomeDelProgramma(join(CARTELLA, "lettura-intero.c"), "linux")).toBe("lettura-intero");
  expect(nomeDelProgramma(join(CARTELLA, "lettura-intero.c"), "darwin")).toBe("lettura-intero");
});

test("il compilatore: lo scritto vince, poi clang, gcc, cc; nessuno se non c'è", () => {
  expect(scegliCompilatore(" gcc-14 ", () => false)).toBe("gcc-14");
  expect(scegliCompilatore("", (n) => n !== "clang")).toBe("gcc");
  expect(scegliCompilatore("", () => true)).toBe("clang");
  expect(scegliCompilatore("", (n) => n === "cc")).toBe("cc");
  expect(scegliCompilatore("", () => false)).toBeUndefined();
});

test("il file da solo: il comando e il programma accanto", () => {
  const p = pianoDiCompilazione({ file: join(CARTELLA, "leggi.c"), haMakefile: false, sistema: "win32", compilatore: "clang", perPassoPasso: false });
  expect(p.come).toBe("file");
  expect(p.cartella).toBe(CARTELLA);
  expect(p.comando).toEqual(["clang", "-std=c11", "-Wall", "-Wextra", "-g", "-O0", "leggi.c", "-o", "leggi.exe"]);
  expect(p.programma).toBe("leggi.exe");
  expect(p.descrizione).toBe("Compilo leggi.c con clang…");
});

test("col Makefile: make in silenzio e da capo; il compilatore passa solo per il passo passo", () => {
  const esegui = pianoDiCompilazione({ file: join(CARTELLA, "main.c"), haMakefile: true, sistema: "linux", compilatore: "clang", perPassoPasso: false });
  expect(esegui.comando).toEqual(["make", "-s", "-B"]);
  expect(esegui.programma).toBeUndefined();
  expect(esegui.descrizione).toBe("Compilo main.c col Makefile…");
  const passo = pianoDiCompilazione({ file: join(CARTELLA, "main.c"), haMakefile: true, sistema: "linux", compilatore: "clang", perPassoPasso: true });
  expect(passo.comando).toEqual(["make", "-s", "-B", "CC=clang"]);
});

test("i messaggi veri di clang: un errore sulla riga 5", () => {
  const s = segnalazioniDi(uscita("clang.txt"), CARTELLA);
  expect(s).toEqual([{ file: join(CARTELLA, "errore.c"), riga: 5, colonna: 33, gravita: "errore", messaggio: "expected ';' after expression" }]);
});

test("i messaggi veri di gcc: un errore sulla riga 5, la riga «In function» non conta", () => {
  const s = segnalazioniDi(uscita("gcc.txt"), CARTELLA);
  expect(s.map((x) => [x.riga, x.colonna, x.gravita])).toEqual([[5, 33, "errore"]]);
});

test("i messaggi veri di make: l'errore di gcc sì, la riga di make no", () => {
  const s = segnalazioniDi(uscita("make.txt"), CARTELLA);
  expect(s.map((x) => [x.file, x.riga, x.gravita])).toEqual([[join(CARTELLA, "main.c"), 5, "errore"]]);
});

test("un avviso vero di clang è un avviso, non un errore", () => {
  const s = segnalazioniDi(uscita("clang-avviso.txt"), CARTELLA);
  expect(s.map((x) => [x.riga, x.gravita])).toEqual([[4, "avviso"]]);
});

test("controllo: le righe di contorno (codice citato, conteggi) non diventano segnalazioni", () => {
  const tutte = ["clang.txt", "gcc.txt", "make.txt", "clang-avviso.txt"].map(uscita).join("\n");
  expect(tutte.split(/\r?\n/).filter((r) => r.trim() !== "").length).toBeGreaterThan(10);
  expect(segnalazioniDi(tutte, CARTELLA).length).toBe(4);
});

test("la riga del rifiuto: uno, più d'uno, in un altro file, nessuna riga", () => {
  const file = join(CARTELLA, "leggi.c");
  const e = (riga: number, f = file) => ({ file: f, riga, colonna: 1, gravita: "errore" as const, messaggio: "x" });
  expect(rigaDelRifiuto([e(5)], file)).toBe("1 errore, il programma non parte: lo trovi in «Problemi» (riga 5).");
  expect(rigaDelRifiuto([e(5), e(9), { ...e(2), gravita: "avviso" }], file)).toBe("2 errori, il programma non parte: li trovi in «Problemi» (il primo alla riga 5).");
  expect(rigaDelRifiuto([e(3, join(CARTELLA, "utils.c"))], file)).toBe("1 errore, il programma non parte: lo trovi in «Problemi» (riga 3 di utils.c).");
  expect(rigaDelRifiuto([], file)).toBe("La compilazione non è riuscita, il programma non parte: il motivo è nelle righe qui sopra.");
});

test("il passo passo impossibile col compilatore del debugger: la frase nomina il compilatore e il rimedio", () => {
  expect(rigaDelPassoPassoImpossibile("clang")).toBe("Questo programma si compila e si esegue con «Compila ed esegui», ma non con clang, che serve al passo passo: usa funzioni che clang qui non ha. Gli errori di clang sono in «Problemi». Questa estensione non può seguirlo passo passo: serve un debugger per gcc, come gdb.");
});

test("le frasi di quando manca uno strumento o un terminale dicono che cosa fare", () => {
  expect(MANCA_MAKE).toContain("il programma non parte. Installa make");
  expect(MANCA_IL_COMPILATORE).toContain("«c-run.compilatore»");
  expect(mancaLEstensioneDelDebug("x.y")).toBe("Per andare passo passo serve l'estensione «LLDB DAP» (x.y): installala dal pannello Estensioni.");
  expect(PASSO_PASSO_SENZA_TERMINALE).toBe("Il terminale «Passo passo» non si è aperto, quindi il passo passo non parte. Riprova con «Passo passo» nella barra in basso; se non si apre ancora, chiudi e riapri l'editor.");
  expect(terminaleNonAperto("x")).toBe("Il terminale «Programma C» non si è aperto (x): il programma non parte. Riprova; se non si apre ancora, chiudi e riapri l'editor.");
  expect(righeNonScritte("x", "y")).toBe("Il file temporaneo per il terminale non si scrive (x): il programma non parte. Controlla che la cartella temporanea del sistema (y) esista e che si possa scrivere.");
});

test("il file delle righe: nuovo a ogni esecuzione, in una cartella sua, e tolto con la cartella", () => {
  const radice = mkdtempSync(join(tmpdir(), "c-run  righe-"));
  try {
    const righe = [{ testo: "Compilo leggi.c con clang…" }, { testo: "  clang leggi.c", grigio: true }];
    const a = scriviLeRighe(righe, radice);
    const b = scriviLeRighe(righe, radice);
    if (!("file" in a) || !("file" in b)) throw new Error(`non scritte: ${JSON.stringify([a, b])}`);
    expect(a.file).not.toBe(b.file);
    expect(dirname(a.file)).not.toBe(dirname(b.file));
    expect(JSON.parse(readFileSync(a.file, "utf8"))).toEqual(righe);
    expect(readdirSync(radice).length).toBe(2);
    // Scritto solo se non c'è: lo stesso nome, scritto di nuovo con `wx`, è un errore.
    expect(() => writeFileSync(a.file, "x", { flag: "wx" })).toThrow();
    // Tolto con la sua cartella (il terminale non è partito); tolto di nuovo, nessun errore.
    togliLeRighe(a.file);
    togliLeRighe(a.file);
    expect(existsSync(dirname(a.file))).toBe(false);
    // Il terminale l'ha già letto e tolto: resta la cartella vuota, che si toglie.
    rmSync(b.file);
    togliLeRighe(b.file);
    expect(readdirSync(radice)).toEqual([]);
  } finally {
    rmSync(radice, { recursive: true, force: true });
  }
});

test("il file delle righe che non si scrive: il motivo, e nessuna cartella lasciata", () => {
  const radice = mkdtempSync(join(tmpdir(), "c-run  righe-"));
  try {
    const nonCe = join(radice, "non c'è");
    const r = scriviLeRighe([{ testo: "x" }], nonCe);
    expect("errore" in r && r.errore.length > 0).toBe(true);
    expect(existsSync(nonCe)).toBe(false);
    expect(readdirSync(radice)).toEqual([]);
  } finally {
    rmSync(radice, { recursive: true, force: true });
  }
});

/** Esegue il comando del terminale con la shell vera del sistema (su Windows cmd, con la riga così com'è, come la passa
 *  l'editor), con uno scrittore finto che annota i suoi argomenti. Torna le righe annotate. */
function eseguiIlComando(c: { shellPath: string; shellArgs: string | string[]; env: Record<string, string> }, annotazioni: string): string[] {
  rmSync(annotazioni, { force: true });
  const env = { ...process.env, ...c.env, CRUN_ANNOTAZIONI: annotazioni };
  const p = typeof c.shellArgs === "string" ? spawnSync(c.shellPath, [c.shellArgs], { env, windowsVerbatimArguments: true, stdio: "ignore", timeout: 20000 }) : spawnSync(c.shellPath, c.shellArgs, { env, stdio: "ignore", timeout: 20000 });
  if (p.error !== undefined) throw p.error;
  return existsSync(annotazioni) ? readFileSync(annotazioni, "utf8").split("\n").filter((r) => r !== "") : [];
}

test("i percorsi con ^ % & ' ! e spazi doppi arrivano al terminale come sono (misurato con la shell vera)", () => {
  // La cartella dell'editor, dell'estensione e del programma con i caratteri che cmd tratta a parte; %OS% c'è su Windows.
  const radice = mkdtempSync(join(tmpdir(), "c-run  prova-"));
  try {
    const strana = join(radice, "a  ^b 100%OS% & l'altro !x! fine");
    mkdirSync(strana);
    const scrittore = join(strana, "scrittore.cjs");
    writeFileSync(scrittore, 'require("node:fs").appendFileSync(process.env.CRUN_ANNOTAZIONI, JSON.stringify(process.argv.slice(2)) + "\\n");\n');
    const righe = join(strana, "righe.json");
    writeFileSync(righe, "[]");
    // Il programma: su Windows una copia di where.exe (senza argomenti esce con un codice suo), altrove uno script.
    const windows = process.platform === "win32";
    const programma = join(strana, windows ? "programma.exe" : "programma");
    if (windows) copyFileSync(join(process.env.SystemRoot ?? "", "System32", "where.exe"), programma);
    else {
      writeFileSync(programma, "#!/bin/sh\nexit 7\n");
      chmodSync(programma, 0o755);
    }
    const diretto = spawnSync(programma, [], { stdio: "ignore" }).status;
    expect(diretto === null || diretto === 0).toBe(false);
    // Il motore (qui Bun, che esegue lo scrittore come lo esegue l'editor) nella stessa cartella: un collegamento, se no una copia.
    const motore = join(strana, windows ? "motore.exe" : "motore");
    try {
      linkSync(process.execPath, motore);
    } catch {
      copyFileSync(process.execPath, motore);
    }
    if (!windows) chmodSync(motore, 0o755);
    const comune = { sistema: process.platform, comSpec: process.env.ComSpec, motore, scrittore, fileDelleRighe: righe };
    const annotazioni = join(radice, "annotazioni.txt");
    expect(eseguiIlComando(comandoDelTerminale({ ...comune, programma }), annotazioni)).toEqual([JSON.stringify(["testa", righe]), JSON.stringify(["coda", String(diretto)])]);
    expect(eseguiIlComando(comandoDelTerminale(comune), annotazioni)).toEqual([JSON.stringify(["solo", righe])]);
    if (windows) {
      // Il controllo: i percorsi scritti sulla riga di cmd (com'era nella 0.0.6) non arrivano come sono.
      const sullaRiga = `/d /v:on /s /c "set ELECTRON_RUN_AS_NODE=1&& "${comune.motore}" "${scrittore}" testa "${righe}" & "${programma}" & "${comune.motore}" "${scrittore}" coda !errorlevel!"`;
      expect(eseguiIlComando({ shellPath: comune.comSpec ?? "cmd.exe", shellArgs: sullaRiga, env: {} }, annotazioni)).not.toEqual([JSON.stringify(["testa", righe]), JSON.stringify(["coda", String(diretto)])]);
    }
  } finally {
    rmSync(radice, { recursive: true, force: true });
  }
}, 60000);

test("il comando del terminale con trenta diagnostiche: le righe restano nel file, la riga di cmd sotto il limite", () => {
  // Trenta avvisi veri di clang 23 su prove/casi/avvisi/avvisi.c (il caso della prova con l'editor), in una cartella dal
  // percorso lungo con spazi doppi.
  const cartella = join("C:", "una  cartella  dal  nome  lungo".repeat(4), "esercizi  di  oggi");
  const uscitaLunga = uscita("clang-trenta-avvisi.txt");
  const p = pianoDiCompilazione({ file: join(cartella, "avvisi.c"), haMakefile: false, sistema: "win32", compilatore: "clang", perPassoPasso: false });
  const righe = righeDellaCompilazione(p, uscitaLunga);
  expect(segnalazioniDi(uscitaLunga, cartella).length).toBe(30);
  // Il controllo: le stesse righe sulla riga di comando (com'era prima, in base64) supererebbero il limite.
  expect(Buffer.from(JSON.stringify(righe)).toString("base64").length).toBeGreaterThan(LIMITE_DELLA_RIGA_DI_CMD);
  const motore = join("C:", "una  cartella  dal  nome  lungo".repeat(4), "vscodium", "VSCodium.exe");
  const c = comandoDelTerminale({ sistema: "win32", comSpec: join("C:", "Windows", "system32", "cmd.exe"), motore, scrittore: join(motore, "..", "dist", "terminale.cjs"), fileDelleRighe: join("C:", "Temp", "c-run-righe-1-1.json"), programma: join(cartella, "avvisi.exe") });
  const riga = `${c.shellPath} ${String(c.shellArgs)}`;
  expect(riga.length).toBeLessThan(LIMITE_DELLA_RIGA_DI_CMD);
  expect(riga).not.toContain("unused variable");
  expect(riga).toContain("!errorlevel!");
  const senza = comandoDelTerminale({ sistema: "linux", motore: "/m", scrittore: "/s.cjs", fileDelleRighe: "/tmp/r.json" });
  expect(senza.shellArgs).toEqual(["-c", 'ELECTRON_RUN_AS_NODE=1 exec "$0" "$1" solo "$2"', "/m", "/s.cjs", "/tmp/r.json"]);
});

test("il programma del Makefile: l'unico eseguibile nuovo", () => {
  const voci = [
    { nome: "main.c", modificato: 50, eseguibile: false },
    { nome: "vecchio.exe", modificato: 10, eseguibile: true },
    { nome: "ciao.exe", modificato: 120, eseguibile: true },
    { nome: "main.o", modificato: 110, eseguibile: false },
  ];
  expect(programmaNato(voci, 100, "win32")).toEqual({ programma: "ciao.exe" });
  expect(programmaNato([{ nome: "ciao", modificato: 120, eseguibile: true }, { nome: "main.o", modificato: 120, eseguibile: false }], 100, "linux")).toEqual({ programma: "ciao" });
  expect(programmaNato([{ nome: "ciao", modificato: 120, eseguibile: true }], 100, "win32").motivo).toBe("Il Makefile non ha prodotto un programma da eseguire: controlla che la sua prima regola costruisca l'eseguibile.");
  expect(programmaNato([...voci, { nome: "altro.exe", modificato: 130, eseguibile: true }], 100, "win32").motivo).toBe("Il Makefile ha prodotto più programmi (altro.exe, ciao.exe): non so quale eseguire. Fai in modo che ne produca uno solo, o eseguilo dal terminale.");
});

test("le righe del terminale: la descrizione, il comando in grigio, l'uscita del compilatore senza righe vuote", () => {
  const p = pianoDiCompilazione({ file: join("una  cartella", "leggi.c"), haMakefile: false, sistema: "linux", compilatore: "clang", perPassoPasso: false });
  const r = righeDellaCompilazione(p, "riga uno\r\n\r\nriga due\n");
  expect(r).toEqual([{ testo: "Compilo leggi.c con clang…" }, { testo: "  clang -std=c11 -Wall -Wextra -g -O0 leggi.c -o leggi", grigio: true }, { testo: "riga uno" }, { testo: "riga due" }]);
});
