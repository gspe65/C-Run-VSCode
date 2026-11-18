// La logica senza editor: come si compila un file C, che cosa dicono i messaggi del compilatore, quale programma è nato,
// e le righe in italiano che lo studente legge nel terminale. Nessun import dell'editor: le prove la chiamano da sole.

import { basename, dirname, extname, isAbsolute, join } from "node:path";

export type Gravita = "errore" | "avviso" | "nota";
export type Segnalazione = { file: string; riga: number; colonna: number; gravita: Gravita; messaggio: string };
export type Riga = { testo: string; grigio?: boolean };

/** Il nome del programma che nasce da un file C compilato da solo: accanto al file, `.exe` solo su Windows. */
export function nomeDelProgramma(file: string, sistema: string): string {
  return basename(file, extname(file)) + (sistema === "win32" ? ".exe" : "");
}

/** Il compilatore: quello scritto nelle impostazioni, se c'è; se no il primo che si trova fra clang, gcc, cc. */
export function scegliCompilatore(scritto: string, esiste: (nome: string) => boolean): string | undefined {
  if (scritto.trim() !== "") return scritto.trim();
  return ["clang", "gcc", "cc"].find(esiste);
}

/** Le frasi di quando manca uno strumento: che cosa manca e che cosa fare. */
export const MANCA_MAKE = "Questo programma ha un Makefile, ma il comando make non c'è (non è nel PATH dell'editor): il programma non parte. Installa make, oppure, se usi un ambiente portabile, apri l'editor dal suo collegamento, che aggiunge gli strumenti al PATH.";
export const MANCA_IL_COMPILATORE = "Non trovo un compilatore C (clang, gcc o cc) nel PATH dell'editor: il programma non parte. Installane uno, o scrivi quale usare nell'impostazione «c-run.compilatore»; se usi un ambiente portabile, apri l'editor dal suo collegamento.";
export const mancaLEstensioneDelDebug = (id: string) => `Per andare passo passo serve l'estensione «LLDB DAP» (${id}): installala dal pannello Estensioni.`;

export type Piano = { come: "makefile" | "file"; cartella: string; comando: string[]; descrizione: string; programma?: string };

/** Come si compila il file: col Makefile della sua cartella, se c'è, o il file da solo. Per il passo passo il Makefile
 *  riceve il compilatore scelto (`CC=`), perché il debugger ferma solo i programmi che sa leggere. `-B` rifà tutto: i
 *  file oggetto di due compilatori non si collegano fra loro. */
export function pianoDiCompilazione(a: { file: string; haMakefile: boolean; sistema: string; compilatore: string | undefined; perPassoPasso: boolean }): Piano {
  const cartella = dirname(a.file);
  const nome = basename(a.file);
  if (a.haMakefile) {
    const comando = ["make", "-s", "-B", ...(a.perPassoPasso && a.compilatore !== undefined ? [`CC=${a.compilatore}`] : [])];
    return { come: "makefile", cartella, comando, descrizione: `Compilo ${nome} col Makefile…` };
  }
  const compilatore = a.compilatore ?? "cc";
  const programma = nomeDelProgramma(a.file, a.sistema);
  return { come: "file", cartella, comando: [compilatore, "-std=c11", "-Wall", "-Wextra", "-g", "-O0", nome, "-o", programma], descrizione: `Compilo ${nome} con ${basename(compilatore)}…`, programma };
}

const MESSAGGIO = /^(.+?):(\d+):(?:(\d+):)?\s+(fatal error|error|warning|note):\s+(.*)$/;

/** I messaggi del compilatore (gcc e clang hanno la stessa forma): file, riga, colonna, gravità, testo. Il file relativo si
 *  legge rispetto alla cartella in cui il compilatore è partito. */
export function segnalazioniDi(testo: string, cartella: string): Segnalazione[] {
  const fuori: Segnalazione[] = [];
  for (const r of testo.split(/\r?\n/)) {
    const m = MESSAGGIO.exec(r);
    if (m === null) continue;
    const [, file, riga, colonna, tipo, messaggio] = m as unknown as [string, string, string, string | undefined, string, string];
    // Una riga del linker o di make («make: *** ... Error 1») non ha un numero di riga e non entra qui.
    const gravita: Gravita = tipo === "warning" ? "avviso" : tipo === "note" ? "nota" : "errore";
    fuori.push({ file: isAbsolute(file) ? file : join(cartella, file), riga: Number(riga), colonna: colonna === undefined ? 1 : Number(colonna), gravita, messaggio });
  }
  return fuori;
}

/** La riga che dice perché il programma non parte. */
export function rigaDelRifiuto(segnalazioni: Segnalazione[], fileAperto: string): string {
  const errori = segnalazioni.filter((s) => s.gravita === "errore");
  const primo = errori[0];
  if (primo === undefined) return "La compilazione non è riuscita, il programma non parte: il motivo è nelle righe qui sopra.";
  const dove = primo.file.toLowerCase() === fileAperto.toLowerCase() ? `riga ${primo.riga}` : `riga ${primo.riga} di ${basename(primo.file)}`;
  return errori.length === 1
    ? `1 errore, il programma non parte: lo trovi in «Problemi» (${dove}).`
    : `${errori.length} errori, il programma non parte: li trovi in «Problemi» (il primo alla ${dove}).`;
}

/** La riga del passo passo quando il programma si compila col suo compilatore ma non con quello del debugger (su Windows: un
 *  programma che usa fork o altre funzioni che ci sono solo con il gcc di MSYS2 o Cygwin, e clang no). */
export function rigaDelPassoPassoImpossibile(compilatore: string): string {
  return `Questo programma si compila e si esegue con «Compila ed esegui», ma non con ${compilatore}, che serve al passo passo: usa funzioni che ${compilatore} qui non ha. Gli errori di ${compilatore} sono in «Problemi». Per seguirlo passo passo usa un debug con gcc (F5), se l'editor ne ha uno.`;
}

export type Voce = { nome: string; modificato: number; eseguibile: boolean };

/** Il programma che il Makefile ha prodotto: l'unico eseguibile della cartella scritto dopo l'inizio della compilazione.
 *  Su Windows conta l'estensione `.exe`; altrove il permesso di esecuzione. */
export function programmaNato(voci: Voce[], inizio: number, sistema: string): { programma?: string; motivo?: string } {
  const nuovi = voci.filter((v) => v.modificato >= inizio && (sistema === "win32" ? v.nome.toLowerCase().endsWith(".exe") : v.eseguibile)).map((v) => v.nome).sort();
  if (nuovi.length === 1) return { programma: nuovi[0] };
  if (nuovi.length === 0) return { motivo: "Il Makefile non ha prodotto un programma da eseguire: controlla che la sua prima regola costruisca l'eseguibile." };
  return { motivo: `Il Makefile ha prodotto più programmi (${nuovi.join(", ")}): non so quale eseguire. Fai in modo che ne produca uno solo, o eseguilo dal terminale.` };
}

/** Il limite della riga di comando di cmd su Windows (misurato con CreateProcess: 8.147 caratteri passano, 8.347 danno «La
 *  riga di comando è troppo lunga.» e non esegue nulla). */
export const LIMITE_DELLA_RIGA_DI_CMD = 8191;

/** Come si avvia il terminale «Programma C». Le righe da scrivere stanno in un file (`fileDelleRighe`), non sulla riga di
 *  comando: l'uscita del compilatore non ha un tetto, la riga di comando di cmd sì, e oltre il tetto il programma non partirebbe.
 *  Sulla riga restano solo i percorsi. Su Windows il codice d'uscita si legge con !errorlevel! (/v:on): %errorlevel% varrebbe
 *  quello di prima del programma. ELECTRON_RUN_AS_NODE la imposta la shell subito prima: l'editor la toglie dall'ambiente dei
 *  suoi terminali. */
export function comandoDelTerminale(a: { sistema: string; comSpec?: string; motore: string; scrittore: string; fileDelleRighe: string; programma?: string }): { shellPath: string; shellArgs: string | string[] } {
  if (a.sistema === "win32") {
    return {
      shellPath: a.comSpec ?? "cmd.exe",
      shellArgs:
        a.programma === undefined
          ? `/d /s /c "set ELECTRON_RUN_AS_NODE=1&& "${a.motore}" "${a.scrittore}" solo "${a.fileDelleRighe}""`
          : `/d /v:on /s /c "set ELECTRON_RUN_AS_NODE=1&& "${a.motore}" "${a.scrittore}" testa "${a.fileDelleRighe}" & "${a.programma}" & "${a.motore}" "${a.scrittore}" coda !errorlevel!"`,
    };
  }
  return {
    shellPath: "/bin/sh",
    shellArgs:
      a.programma === undefined
        ? ["-c", 'ELECTRON_RUN_AS_NODE=1 exec "$0" "$1" solo "$2"', a.motore, a.scrittore, a.fileDelleRighe]
        : ["-c", 'ELECTRON_RUN_AS_NODE=1 "$0" "$1" testa "$2"; "$3"; c=$?; ELECTRON_RUN_AS_NODE=1 exec "$0" "$1" coda "$c"', a.motore, a.scrittore, a.fileDelleRighe, a.programma],
  };
}

/** Le righe del terminale prima del programma: che cosa si fa, il comando vero in grigio, ciò che il compilatore ha scritto. */
export function righeDellaCompilazione(piano: Piano, uscitaDelCompilatore: string): Riga[] {
  const righe: Riga[] = [{ testo: piano.descrizione }, { testo: `  ${piano.comando.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(" ")}`, grigio: true }];
  for (const r of uscitaDelCompilatore.split(/\r?\n/)) if (r.trim() !== "") righe.push({ testo: r });
  return righe;
}
