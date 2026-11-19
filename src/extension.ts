// Il collegamento con l'editor: i due comandi, la scritta nella barra di stato, il pannello «Problemi», il terminale
// «Programma C» e l'avvio del passo passo. La logica sta in piano.ts.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import * as vscode from "vscode";
import { comandoDelTerminale, MANCA_IL_COMPILATORE, MANCA_MAKE, mancaLEstensioneDelDebug, PASSO_PASSO_SENZA_TERMINALE, pianoDiCompilazione, programmaNato, righeDellaCompilazione, righeNonScritte, rigaDelPassoPassoImpossibile, rigaDelRifiuto, scegliCompilatore, scriviLeRighe, segnalazioniDi, terminaleNonAperto, togliLeRighe, type Piano, type Riga, type Segnalazione } from "./piano";

const NOME_DEL_TERMINALE = "Programma C";
const ESTENSIONE_DEL_DEBUG = "llvm-vs-code-extensions.lldb-dap";

let problemi: vscode.DiagnosticCollection;
let terminale: vscode.Terminal | undefined;
let cartellaDellEstensione: string;

/** Un eseguibile nel PATH, come lo cercherebbe il sistema (su Windows con le estensioni di PATHEXT). */
function esiste(nome: string): boolean {
  const estensioni = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE").split(";").filter((e) => e !== "") : [""];
  return (process.env.PATH ?? "").split(delimiter).some((d) => d !== "" && estensioni.some((e) => existsSync(join(d, nome + e))));
}

function compila(piano: Piano): Promise<{ uscita: number | null; testo: string; errore?: string }> {
  return new Promise((risolvi) => {
    let testo = "";
    const p = spawn(piano.comando[0]!, piano.comando.slice(1), { cwd: piano.cartella });
    p.stdout.on("data", (d: Buffer) => (testo += d.toString()));
    p.stderr.on("data", (d: Buffer) => (testo += d.toString()));
    p.on("error", (e) => risolvi({ uscita: null, testo, errore: e.message }));
    p.on("close", (uscita) => risolvi({ uscita, testo }));
  });
}

function mostraNelPannello(segnalazioni: Segnalazione[], fonte: string): void {
  problemi.clear();
  const perFile = new Map<string, vscode.Diagnostic[]>();
  for (const s of segnalazioni) {
    const posto = new vscode.Position(Math.max(0, s.riga - 1), Math.max(0, s.colonna - 1));
    const d = new vscode.Diagnostic(new vscode.Range(posto, posto), s.messaggio, s.gravita === "errore" ? vscode.DiagnosticSeverity.Error : s.gravita === "avviso" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
    d.source = fonte;
    perFile.set(s.file, [...(perFile.get(s.file) ?? []), d]);
  }
  for (const [file, d] of perFile) problemi.set(vscode.Uri.file(file), d);
}

/** Il terminale «Programma C»: sempre uno, rifatto a ogni avvio. Il processo è il motore dell'editor usato come Node
 *  (misurato: senza ELECTRON_RUN_AS_NODE il motore parte come una seconda finestra dell'editor, passa il file a quella aperta
 *  ed esce). Le righe vanno in un file temporaneo, che lo scrittore legge e toglie: sulla riga di comando di cmd non ci
 *  starebbero (comandoDelTerminale in piano.ts). L'icona è quella del terminale, non un triangolo: il solo triangolo di
 *  esecuzione è «Compila ed esegui», nella barra di stato. */
function apriIlTerminale(righe: Riga[], cartella: string, programma: string | undefined, prendeIlFuoco: boolean): void {
  terminale?.dispose();
  const tutte = programma === undefined ? righe : [...righe, { testo: `Eseguo ${programma} (se legge qualcosa, scrivilo qui e premi Invio):` }];
  // Il file è nuovo a ogni esecuzione; se il terminale non lo legge (non parte, o si chiude prima), lo toglie la sua chiusura.
  const scritte = scriviLeRighe(tutte, tmpdir());
  if ("errore" in scritte) {
    void vscode.window.showErrorMessage(righeNonScritte(scritte.errore, tmpdir()));
    return;
  }
  const comando = comandoDelTerminale({
    sistema: process.platform,
    comSpec: process.env.ComSpec,
    motore: process.execPath,
    scrittore: join(cartellaDellEstensione, "dist", "terminale.cjs"),
    fileDelleRighe: scritte.file,
    programma: programma === undefined ? undefined : join(cartella, programma),
  });
  try {
    terminale = vscode.window.createTerminal({ name: NOME_DEL_TERMINALE, ...comando, cwd: cartella, iconPath: new vscode.ThemeIcon(ICONA_DEL_TERMINALE) });
  } catch (e) {
    togliLeRighe(scritte.file);
    terminale = undefined;
    void vscode.window.showErrorMessage(terminaleNonAperto(e instanceof Error ? e.message : String(e)));
    return;
  }
  righeDelTerminale.set(terminale, scritte.file);
  terminale.show(!prendeIlFuoco);
}
/** Il file delle righe di ciascun terminale «Programma C», da togliere quando il terminale si chiude. */
const righeDelTerminale = new Map<vscode.Terminal, string>();
const ICONA_DEL_TERMINALE = "terminal";

/** Il file C che i comandi della barra nominano: quello attivo, se no il primo C visibile (per esempio accanto a una pagina
 *  che non è un file di testo). Solo un file del disco: un documento senza nome o di un'altra estensione non si compila. */
function fileCVisibile(): vscode.TextDocument | undefined {
  const eC = (d: vscode.TextDocument | undefined) => d?.languageId === "c" && d.uri.scheme === "file";
  const attivo = vscode.window.activeTextEditor?.document;
  return eC(attivo) ? attivo : vscode.window.visibleTextEditors.find((e) => eC(e.document))?.document;
}

/** Il file C su cui lavorare, salvato. */
async function fileC(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  const doc = uri !== undefined ? await vscode.workspace.openTextDocument(uri) : fileCVisibile();
  if (doc === undefined || doc.languageId !== "c" || doc.uri.scheme !== "file") {
    void vscode.window.showWarningMessage("Apri un file .c: i comandi compilano il programma del file aperto.");
    return undefined;
  }
  if (doc.isDirty) await doc.save();
  return doc;
}

/** Compila; se non riesce lo dice nel terminale e nel pannello e porta il cursore sul primo errore. */
async function compilaIlFile(doc: vscode.TextDocument, perPassoPasso: boolean): Promise<{ piano: Piano; righe: Riga[]; programma: string } | undefined> {
  const file = doc.uri.fsPath;
  const haMakefile = ["Makefile", "makefile", "GNUmakefile"].some((n) => existsSync(join(file, "..", n)));
  const scritto = vscode.workspace.getConfiguration("c-run", doc.uri).get<string>("compilatore", "");
  const compilatore = scegliCompilatore(scritto, esiste);
  const piano = pianoDiCompilazione({ file, haMakefile, sistema: process.platform, compilatore, perPassoPasso });
  if (piano.come === "makefile" && !esiste("make")) {
    apriIlTerminale([{ testo: MANCA_MAKE }], piano.cartella, undefined, false);
    return undefined;
  }
  if (piano.come === "file" && compilatore === undefined) {
    apriIlTerminale([{ testo: MANCA_IL_COMPILATORE }], piano.cartella, undefined, false);
    return undefined;
  }
  const inizio = Date.now() - 1000;
  const esito = await compila(piano);
  const segnalazioni = segnalazioniDi(esito.testo, piano.cartella);
  mostraNelPannello(segnalazioni, piano.come === "makefile" ? "make" : (compilatore ?? "cc"));
  const righe = righeDellaCompilazione(piano, esito.errore !== undefined ? `${esito.testo}\n${esito.errore}` : esito.testo);
  if (esito.uscita !== 0) {
    // Per il passo passo: se il programma si compila nel modo normale, il difetto non è del programma ma del compilatore.
    const normale = perPassoPasso && compilatore !== undefined ? await compila(pianoDiCompilazione({ file, haMakefile, sistema: process.platform, compilatore, perPassoPasso: false })) : undefined;
    righe.push({ testo: "" }, { testo: normale?.uscita === 0 ? rigaDelPassoPassoImpossibile(basename(compilatore!)) : rigaDelRifiuto(segnalazioni, file) });
    apriIlTerminale(righe, piano.cartella, undefined, false);
    const primo = segnalazioni.find((s) => s.gravita === "errore");
    if (primo !== undefined) {
      const ed = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(primo.file), { preview: false });
      const p = new vscode.Position(primo.riga - 1, Math.max(0, primo.colonna - 1));
      ed.selection = new vscode.Selection(p, p);
      ed.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    await vscode.commands.executeCommand("workbench.actions.view.problems");
    return undefined;
  }
  let programma = piano.programma;
  if (programma === undefined) {
    const voci = readdirSync(piano.cartella).flatMap((nome) => {
      const s = statSync(join(piano.cartella, nome));
      return s.isFile() ? [{ nome, modificato: s.mtimeMs, eseguibile: (s.mode & 0o111) !== 0 && !/\.(o|a|so|sh|dylib)$/.test(nome) }] : [];
    });
    const scelta = programmaNato(voci, inizio, process.platform);
    if (scelta.programma === undefined) {
      righe.push({ testo: "" }, { testo: scelta.motivo ?? "" });
      apriIlTerminale(righe, piano.cartella, undefined, false);
      return undefined;
    }
    programma = scelta.programma;
  }
  return { piano, righe, programma };
}

async function compilaEdEsegui(uri?: vscode.Uri): Promise<void> {
  const doc = await fileC(uri);
  if (doc === undefined) return;
  const c = await compilaIlFile(doc, false);
  if (c === undefined) return;
  apriIlTerminale(c.righe, c.piano.cartella, c.programma, true);
}

/** Vero se il debug è partito. */
async function passoPasso(uri?: vscode.Uri): Promise<boolean> {
  const doc = await fileC(uri);
  if (doc === undefined) return false;
  if (vscode.extensions.getExtension(ESTENSIONE_DEL_DEBUG) === undefined) {
    void vscode.window.showErrorMessage(mancaLEstensioneDelDebug(ESTENSIONE_DEL_DEBUG));
    return false;
  }
  const c = await compilaIlFile(doc, true);
  if (c === undefined) return false;
  // Senza punti d'arresto nel file, il programma si ferma sulla prima riga di main: se no correrebbe fino alla fine.
  const conPunti = vscode.debug.breakpoints.some((b) => b.enabled && b instanceof vscode.SourceBreakpoint && b.location.uri.fsPath.toLowerCase() === doc.uri.fsPath.toLowerCase());
  // Il terminale del debugger prende il fuoco: lo studente scrive lì ciò che il programma legge, non nel file. Quando
  // l'editor lo riusa (dal secondo passo passo) non si apre di nuovo: lo rimette davanti l'evento «process» (in attivazione).
  const sub = vscode.window.onDidOpenTerminal((t) => {
    if (t !== terminale && t !== terminaleDelPasso) {
      terminaleDelDebug = t;
      t.show(false);
    }
  });
  setTimeout(() => sub.dispose(), 30000);
  // Su Linux il debugger non può agganciarsi a un programma lanciato dal terminale (il kernel lascia tracciare solo i figli:
  // misurato, «process exited during launch or attach»): lldb lo lancia come figlio suo, con ingresso e uscita sul terminale
  // «Passo passo», che dice il suo dispositivo. Altrove il terminale lo apre lldb-dap (`console` per le versioni nuove,
  // `runInTerminal` per quelle che non la conoscono).
  let comeSiCollega: Record<string, unknown> = { console: "integratedTerminal", runInTerminal: true };
  const primaDellAvvio = conPunti ? [] : ["breakpoint set --name main --one-shot true"];
  if (process.platform === "linux") {
    const dispositivo = await terminaleDelPassoPasso(c.piano.cartella);
    if (dispositivo === undefined) {
      void vscode.window.showErrorMessage(PASSO_PASSO_SENZA_TERMINALE);
      return false;
    }
    // Misurato con lldb-dap 21: l'attributo `stdio` non collega il programma al terminale. Le impostazioni del bersaglio sì:
    // le legge il lancio che lldb fa da sé.
    comeSiCollega = { console: "internalConsole", stdio: [dispositivo, dispositivo, dispositivo] };
    primaDellAvvio.unshift(`settings set target.input-path ${dispositivo}`, `settings set target.output-path ${dispositivo}`, `settings set target.error-path ${dispositivo}`);
  }
  return vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(doc.uri), {
    type: "lldb-dap",
    request: "launch",
    name: "Passo passo",
    program: join(c.piano.cartella, c.programma),
    cwd: c.piano.cartella,
    // La console di debug non viene davanti da sola: davanti resta il terminale dove il programma legge.
    internalConsoleOptions: "neverOpen",
    ...comeSiCollega,
    ...(primaDellAvvio.length > 0 ? { preRunCommands: primaDellAvvio } : {}),
  });
}

let terminaleDelPasso: vscode.Terminal | undefined;
/** Il terminale che l'editor apre (e poi riusa) per il programma del passo passo, fuori da Linux. */
let terminaleDelDebug: vscode.Terminal | undefined;

/** Su Linux: il terminale «Passo passo», che scrive il nome del suo dispositivo in un file e poi resta fermo; il programma
 *  in debug legge e scrive lì. Il dispositivo, o nulla se non arriva entro 10 secondi. */
async function terminaleDelPassoPasso(cartella: string): Promise<string | undefined> {
  terminaleDelPasso?.dispose();
  const file = join(tmpdir(), `c-run-tty-${process.pid}-${Date.now()}`);
  terminaleDelPasso = vscode.window.createTerminal({
    name: "Passo passo",
    shellPath: "/bin/sh",
    shellArgs: ["-c", 'printf "\\033]0;Passo passo\\007"; tty > "$0"; exec sleep 2147483647', file],
    cwd: cartella,
    // Il bug, non il triangolo col bug: durante il passo passo il triangolo è «Continua» della barra del debug.
    iconPath: new vscode.ThemeIcon("bug"),
  });
  terminaleDelPasso.show(false);
  for (let i = 0; i < 100; i++) {
    if (existsSync(file)) {
      const d = readFileSync(file, "utf8").trim();
      if (d.startsWith("/dev/")) {
        rmSync(file, { force: true });
        return d;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  cartellaDellEstensione = context.extensionPath;
  problemi = vscode.languages.createDiagnosticCollection("c-run");
  // Nella barra un solo triangolo, col nome del file su cui agisce. Durante una sessione di debug i due comandi spariscono:
  // il triangolo che resta è «Continua» della barra del debug.
  const esegui = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const passo = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  // Lo stato delle due voci, per le prove: l'editor non dice che cosa mostra la barra di stato.
  let visibili = false;
  const aggiorna = () => {
    const doc = fileCVisibile();
    if (doc === undefined || vscode.debug.activeDebugSession !== undefined) {
      esegui.hide();
      passo.hide();
      visibili = false;
      return;
    }
    visibili = true;
    const nome = basename(doc.uri.fsPath);
    esegui.text = `$(play) Compila ed esegui ${nome}`;
    esegui.tooltip = `Compila ${nome} e lo esegue nel terminale «${NOME_DEL_TERMINALE}»`;
    esegui.command = { command: "c-run.compilaEdEsegui", title: "Compila ed esegui", arguments: [doc.uri] };
    passo.text = `$(bug) Passo passo ${nome}`;
    passo.tooltip = `Compila ${nome} e lo segue passo passo: si ferma sui punti d'arresto (il clic a sinistra del numero di riga)`;
    passo.command = { command: "c-run.passoPasso", title: "Passo passo", arguments: [doc.uri] };
    esegui.show();
    passo.show();
  };
  aggiorna();
  context.subscriptions.push(
    problemi,
    esegui,
    passo,
    vscode.window.onDidChangeActiveTextEditor(aggiorna),
    vscode.window.onDidChangeVisibleTextEditors(aggiorna),
    vscode.debug.onDidChangeActiveDebugSession(aggiorna),
    // Quando il programma del passo passo è partito, il suo terminale davanti e col cursore (anche se l'editor l'ha riusato).
    // Due momenti: la risposta dell'editor alla richiesta di lanciare il programma nel terminale (l'editor ha finito di
    // usarlo), e l'evento «process» (il debugger è agganciato), con una seconda volta poco dopo. Su Windows e Linux basta;
    // su macOS, dal secondo passo passo, il cursore resta nel file anche così (misurato nelle Actions; limite nel README).
    vscode.debug.registerDebugAdapterTrackerFactory("lldb-dap", {
      createDebugAdapterTracker: (s) => {
        if (s.name !== "Passo passo") return undefined;
        const davanti = () => (process.platform === "linux" ? terminaleDelPasso : terminaleDelDebug)?.show(false);
        return {
          onWillReceiveMessage: (m: { type?: string; command?: string }) => {
            if (m.type === "response" && m.command === "runInTerminal") setTimeout(davanti, 300);
          },
          onDidSendMessage: (m: { type?: string; event?: string }) => {
            if (m.type === "event" && m.event === "process") {
              davanti();
              setTimeout(davanti, 1000);
            }
          },
        };
      },
    }),
    vscode.window.onDidCloseTerminal((t) => {
      if (t === terminale) terminale = undefined;
      const file = righeDelTerminale.get(t);
      if (file !== undefined) {
        togliLeRighe(file);
        righeDelTerminale.delete(t);
      }
      if (t === terminaleDelDebug) terminaleDelDebug = undefined;
    }),
    vscode.commands.registerCommand("c-run.compilaEdEsegui", compilaEdEsegui),
    vscode.commands.registerCommand("c-run.passoPasso", passoPasso),
    // Non nel manifesto, quindi non nella tavolozza dei comandi: le voci della barra come le vede chi usa l'editor.
    vscode.commands.registerCommand("c-run.statoDellaBarra", () => ({ voci: visibili ? [esegui.text, passo.text] : [] })),
  );
}

export function deactivate(): void {
  for (const file of righeDelTerminale.values()) togliLeRighe(file);
  righeDelTerminale.clear();
}
