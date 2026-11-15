// Gira dentro l'editor: fa ciò che fa lo studente e scrive che cosa ha visto. Non giudica nulla: i confronti stanno in
// `prova.ts`. Il testo del terminale si legge come lo vede lo studente: selezionato tutto e copiato.
//
// I passi: il progetto col Makefile; il file da solo con l'ingresso 21; un errore messo apposta; il passo passo con un
// punto d'arresto e l'ingresso; il passo passo senza punti d'arresto.

const { existsSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const vscode = require("vscode");

const { CRUN_CARTELLA, CRUN_USCITA, CRUN_PROGRAMMA_ERRORE } = process.env;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const NOME = "Programma C";

async function attendi(cond, ms) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await cond()) return true;
    await pausa(200);
  }
  return Boolean(await cond());
}

async function testoDel(terminale) {
  if (terminale === undefined) return "";
  // Un terminale appena sostituito dall'estensione può essere già chiuso: allora non c'è niente da leggere.
  try {
    terminale.show(false);
  } catch {
    return "";
  }
  await pausa(150);
  await vscode.commands.executeCommand("workbench.action.terminal.selectAll");
  await vscode.commands.executeCommand("workbench.action.terminal.copySelection");
  await vscode.commands.executeCommand("workbench.action.terminal.clearSelection");
  return vscode.env.clipboard.readText();
}
// Il terminale come l'ha creato l'estensione; il titolo che si vede (t.name) si registra a parte.
const programmaC = () => vscode.window.terminals.filter((t) => t.creationOptions?.name === NOME && t.exitStatus === undefined).at(-1);
const titoli = () => vscode.window.terminals.map((t) => t.name);

async function apri(...parti) {
  const doc = await vscode.workspace.openTextDocument(join(CRUN_CARTELLA, ...parti));
  return vscode.window.showTextDocument(doc, { preview: false });
}

// Il debugger: gli eventi «stopped» e la fine delle sessioni.
const eventi = [];
// I messaggi del debugger (risposte fallite, uscite che non sono del programma) si registrano per capire un rosso.
const messaggi = [];
vscode.debug.registerDebugAdapterTrackerFactory("*", {
  createDebugAdapterTracker: () => ({
    onDidSendMessage: (m) => {
      if (m.type === "event") eventi.push({ evento: m.event, corpo: m.body });
      if (m.type === "response" && m.success === false) messaggi.push(`risposta fallita a ${m.command}: ${m.message ?? ""} ${JSON.stringify(m.body ?? {}).slice(0, 300)}`);
      // Anche stdout: se il programma scrive nella console di debug invece che nel terminale, lo si vede qui.
      if (m.type === "event" && m.event === "output" && m.body?.category !== "telemetry") messaggi.push(`${m.body?.category}: ${String(m.body?.output).slice(0, 300)}`);
      if (m.type === "request") messaggi.push(`richiesta al editor: ${m.command}`);
    },
    onError: (e) => messaggi.push(`errore: ${String(e)}`),
    onExit: (codice, segnale) => messaggi.push(`il debugger è uscito: ${codice} ${segnale ?? ""}`),
  }),
});
const aperti = [];
vscode.window.onDidOpenTerminal((t) => aperti.push(t));

async function fermoSu(sessione) {
  const ev = eventi.find((e) => e.evento === "stopped");
  const st = await sessione.customRequest("stackTrace", { threadId: ev.corpo.threadId, startFrame: 0, levels: 1 });
  const f = st.stackFrames[0];
  let n = null;
  try {
    n = (await sessione.customRequest("evaluate", { expression: "n", frameId: f.id, context: "watch" })).result;
  } catch (e) {
    n = `errore: ${e.message}`;
  }
  return { riga: f.line, file: f.source?.name, n, threadId: ev.corpo.threadId };
}

exports.run = async () => {
  const esiti = {};
  const salva = () => writeFileSync(CRUN_USCITA, JSON.stringify(esiti, null, 2));
  await vscode.workspace.getConfiguration("terminal.integrated").update("enablePersistentSessions", false, vscode.ConfigurationTarget.Global);

  // 1. Il progetto col Makefile.
  await apri("ciao", "main.c");
  esiti.terminalePrima = await testoDel(programmaC());
  await vscode.commands.executeCommand("c-run.compilaEdEsegui");
  await attendi(async () => (await testoDel(programmaC())).includes("(finito:"), 30000);
  esiti.ciao = { testo: await testoDel(programmaC()), titoli: titoli() };
  esiti.comandiNelTitolo = (await vscode.commands.getCommands(true)).filter((c) => c.startsWith("c-run.")).sort();
  salva();

  // 2. Il file da solo, con l'ingresso.
  await apri("leggi", "leggi.c");
  await vscode.commands.executeCommand("c-run.compilaEdEsegui");
  const domanda = await attendi(async () => (await testoDel(programmaC())).includes("Scrivi un numero"), 30000);
  esiti.leggi = { domandaVista: domanda, terminaleAttivo: vscode.window.activeTerminal?.creationOptions?.name, titoloAttivo: vscode.window.activeTerminal?.name };
  programmaC()?.sendText("21", true);
  await attendi(async () => (await testoDel(programmaC())).includes("(finito:"), 15000);
  esiti.leggi.testo = await testoDel(programmaC());
  salva();

  // 3. L'errore messo apposta (riga 5 senza il punto e virgola).
  const ed = await apri("errore", "errore.c");
  await vscode.commands.executeCommand("c-run.compilaEdEsegui");
  await attendi(async () => (await testoDel(programmaC())).includes("non parte"), 30000);
  const diagnostiche = vscode.languages.getDiagnostics(ed.document.uri);
  esiti.errore = {
    testo: await testoDel(programmaC()),
    problemi: diagnostiche.map((d) => ({ riga: d.range.start.line + 1, gravita: d.severity, fonte: d.source, messaggio: d.message })),
    cursore: vscode.window.activeTextEditor?.document.uri.fsPath === ed.document.uri.fsPath ? vscode.window.activeTextEditor.selection.active.line + 1 : null,
    programmaNato: existsSync(join(CRUN_CARTELLA, "errore", CRUN_PROGRAMMA_ERRORE)),
  };
  salva();

  // 4. Il passo passo con un punto d'arresto sulla riga 8 e l'ingresso nel terminale del debugger.
  const leggi = await apri("leggi", "leggi.c");
  vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(leggi.document.uri, new vscode.Position(7, 0)))]);
  eventi.length = 0;
  aperti.length = 0;
  messaggi.length = 0;
  let sessione;
  const s1 = vscode.debug.onDidStartDebugSession((s) => (sessione = s));
  const fine1 = new Promise((r) => vscode.debug.onDidTerminateDebugSession(r));
  const partito = await vscode.commands.executeCommand("c-run.passoPasso");
  const t0 = Date.now();
  await attendi(() => aperti.some((t) => t.creationOptions?.name !== NOME), 45000);
  const msAlTerminale = Date.now() - t0;
  const delDebug = aperti.find((t) => t.creationOptions?.name !== NOME);
  esiti.passo = { partito, terminale: delDebug?.name ?? null, msAlTerminale, fermoPrima: eventi.some((e) => e.evento === "stopped") };
  await pausa(1500);
  delDebug?.sendText("21", true);
  esiti.passo.fermo = await attendi(() => eventi.some((e) => e.evento === "stopped"), 20000);
  if (esiti.passo.fermo && sessione) {
    Object.assign(esiti.passo, await fermoSu(sessione));
    await sessione.customRequest("continue", { threadId: esiti.passo.threadId });
  }
  esiti.passo.finito = await Promise.race([fine1.then(() => true), pausa(15000).then(() => false)]);
  esiti.passo.testo = await testoDel(delDebug);
  esiti.passo.messaggi = [...messaggi];
  s1.dispose();
  salva();

  // 5. Il passo passo senza punti d'arresto: si ferma sulla prima riga di main, prima di leggere.
  vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  await apri("leggi", "leggi.c");
  eventi.length = 0;
  messaggi.length = 0;
  sessione = undefined;
  const s2 = vscode.debug.onDidStartDebugSession((s) => (sessione = s));
  await vscode.commands.executeCommand("c-run.passoPasso");
  esiti.inizio = { fermo: await attendi(() => eventi.some((e) => e.evento === "stopped"), 30000) };
  if (esiti.inizio.fermo && sessione) Object.assign(esiti.inizio, await fermoSu(sessione));
  esiti.inizio.messaggi = [...messaggi];
  if (vscode.debug.activeDebugSession) await vscode.debug.stopDebugging();
  s2.dispose();
  await pausa(1000);
  salva();
};
