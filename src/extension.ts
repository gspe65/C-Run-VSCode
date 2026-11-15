// Il collegamento con l'editor: i due comandi, la scritta nella barra di stato, il pannello «Problemi», il terminale
// «Programma C» e l'avvio del passo passo. La logica sta in piano.ts.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import * as vscode from "vscode";
import { pianoDiCompilazione, programmaNato, righeDellaCompilazione, rigaDelPassoPassoImpossibile, rigaDelRifiuto, scegliCompilatore, segnalazioniDi, type Piano, type Riga, type Segnalazione } from "./piano";

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

/** Il terminale «Programma C»: sempre uno, rifatto a ogni avvio. Il processo è il motore dell'editor usato come Node.
 *  ELECTRON_RUN_AS_NODE la imposta la shell del sistema subito prima: l'editor la toglie dall'ambiente dei suoi terminali
 *  (misurato: senza, il motore parte come una seconda finestra dell'editor, passa il file a quella aperta ed esce). */
function apriIlTerminale(righe: Riga[], cartella: string, programma: string | undefined, prendeIlFuoco: boolean): void {
  terminale?.dispose();
  const tutte = programma === undefined ? righe : [...righe, { testo: `Eseguo ${programma}:` }];
  const dato = Buffer.from(JSON.stringify(tutte)).toString("base64");
  const motore = process.execPath;
  const scrittore = join(cartellaDellEstensione, "dist", "terminale.cjs");
  // Su Windows il codice d'uscita si legge con !errorlevel! (/v:on): %errorlevel% varrebbe quello di prima del programma.
  const comando: Pick<vscode.TerminalOptions, "shellPath" | "shellArgs"> =
    process.platform === "win32"
      ? {
          shellPath: process.env.ComSpec ?? "cmd.exe",
          shellArgs:
            programma === undefined
              ? `/d /s /c "set ELECTRON_RUN_AS_NODE=1&& "${motore}" "${scrittore}" solo ${dato}"`
              : `/d /v:on /s /c "set ELECTRON_RUN_AS_NODE=1&& "${motore}" "${scrittore}" testa ${dato} & "${join(cartella, programma)}" & "${motore}" "${scrittore}" coda !errorlevel!"`,
        }
      : {
          shellPath: "/bin/sh",
          shellArgs:
            programma === undefined
              ? ["-c", 'ELECTRON_RUN_AS_NODE=1 exec "$0" "$1" solo "$2"', motore, scrittore, dato]
              : ["-c", 'ELECTRON_RUN_AS_NODE=1 "$0" "$1" testa "$2"; "$3"; c=$?; ELECTRON_RUN_AS_NODE=1 exec "$0" "$1" coda "$c"', motore, scrittore, dato, join(cartella, programma)],
        };
  terminale = vscode.window.createTerminal({ name: NOME_DEL_TERMINALE, ...comando, cwd: cartella, iconPath: new vscode.ThemeIcon("play") });
  terminale.show(!prendeIlFuoco);
}

/** Il file C su cui lavorare, salvato. */
async function fileC(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  const doc = uri !== undefined ? await vscode.workspace.openTextDocument(uri) : (vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors.find((e) => e.document.languageId === "c"))?.document;
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
    apriIlTerminale([{ testo: "Questo programma ha un Makefile, ma il comando make non c'è: il programma non parte." }], piano.cartella, undefined, false);
    return undefined;
  }
  if (piano.come === "file" && compilatore === undefined) {
    apriIlTerminale([{ testo: "Non trovo un compilatore C (clang, gcc o cc): il programma non parte." }], piano.cartella, undefined, false);
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
    void vscode.window.showErrorMessage(`Per andare passo passo serve l'estensione «LLDB DAP» (${ESTENSIONE_DEL_DEBUG}).`);
    return false;
  }
  const c = await compilaIlFile(doc, true);
  if (c === undefined) return false;
  // Senza punti d'arresto nel file, il programma si ferma sulla prima riga di main: se no correrebbe fino alla fine.
  const conPunti = vscode.debug.breakpoints.some((b) => b.enabled && b instanceof vscode.SourceBreakpoint && b.location.uri.fsPath.toLowerCase() === doc.uri.fsPath.toLowerCase());
  // Il terminale del debugger prende il fuoco: lo studente scrive lì ciò che il programma legge, non nel file.
  const sub = vscode.window.onDidOpenTerminal((t) => {
    if (t !== terminale && t !== terminaleDelPasso) t.show(false);
  });
  setTimeout(() => sub.dispose(), 30000);
  // Su Linux il debugger non può agganciarsi a un programma lanciato dal terminale (il kernel lascia tracciare solo i figli:
  // misurato, «process exited during launch or attach»): lldb lo lancia come figlio suo, con ingresso e uscita sul terminale
  // «Passo passo», che dice il suo dispositivo. Altrove il terminale lo apre lldb-dap (`console` per le versioni nuove,
  // `runInTerminal` per quelle che non la conoscono).
  let comeSiCollega: Record<string, unknown> = { console: "integratedTerminal", runInTerminal: true };
  if (process.platform === "linux") {
    const dispositivo = await terminaleDelPassoPasso(c.piano.cartella);
    if (dispositivo === undefined) {
      void vscode.window.showErrorMessage("Il terminale «Passo passo» non si è aperto: il passo passo non parte.");
      return false;
    }
    comeSiCollega = { console: "internalConsole", stdio: [dispositivo, dispositivo, dispositivo] };
  }
  return vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(doc.uri), {
    type: "lldb-dap",
    request: "launch",
    name: "Passo passo",
    program: join(c.piano.cartella, c.programma),
    cwd: c.piano.cartella,
    ...comeSiCollega,
    ...(conPunti ? {} : { preRunCommands: ["breakpoint set --name main --one-shot true"] }),
  });
}

let terminaleDelPasso: vscode.Terminal | undefined;

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
    iconPath: new vscode.ThemeIcon("debug-alt"),
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
  const esegui = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  esegui.text = "$(play) Compila ed esegui";
  esegui.command = "c-run.compilaEdEsegui";
  const passo = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  passo.text = "$(debug-alt) Passo passo";
  passo.command = "c-run.passoPasso";
  const aggiorna = () => {
    const c = (vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors.find((e) => e.document.languageId === "c"))?.document.languageId === "c";
    for (const v of [esegui, passo]) c ? v.show() : v.hide();
  };
  aggiorna();
  context.subscriptions.push(
    problemi,
    esegui,
    passo,
    vscode.window.onDidChangeActiveTextEditor(aggiorna),
    vscode.window.onDidChangeVisibleTextEditors(aggiorna),
    vscode.window.onDidCloseTerminal((t) => {
      if (t === terminale) terminale = undefined;
    }),
    vscode.commands.registerCommand("c-run.compilaEdEsegui", compilaEdEsegui),
    vscode.commands.registerCommand("c-run.passoPasso", passoPasso),
  );
}

export function deactivate(): void {}
