// Gira dentro il terminale «Programma C» (il motore dell'editor usato come Node) e scrive le righe in italiano. Il programma
// dello studente NON lo lancia lui: lo lancia la shell del terminale fra la testa e la coda, così il programma ha la console
// vera e legge dalla tastiera (misurato su Windows: lanciato da qui, il motore è un'applicazione grafica e il programma legge
// subito la fine dell'ingresso). La coda resta aperta, perché un terminale il cui processo esce si chiude, e l'uscita del
// programma si perderebbe.
//
//   <motore> terminale.cjs testa <file delle righe, in JSON>    scrive le righe, toglie il file ed esce
//   <motore> terminale.cjs solo  <file delle righe, in JSON>    scrive le righe, toglie il file e resta (nessun programma da eseguire)
//   <motore> terminale.cjs coda  <codice d'uscita>              scrive com'è finito e resta
//
// Le righe arrivano in un file, non sulla riga di comando: l'uscita del compilatore non ha un tetto, la riga di comando di cmd
// sì (8.191 caratteri), e oltre il tetto non partirebbe nulla.

import { readFileSync, rmSync } from "node:fs";

type Riga = { testo: string; grigio?: boolean };

const [modo, dato] = process.argv.slice(2);
const scrivi = (testo: string, grigio = false) => process.stdout.write(`${grigio ? "\x1b[90m" : ""}${testo}${grigio ? "\x1b[0m" : ""}\r\n`);
const resta = () => setInterval(() => {}, 1 << 30);

if (modo === "coda") {
  scrivi("");
  scrivi(`(finito: uscita ${dato ?? "?"})`, true);
  scrivi("Il programma è finito. Per eseguirlo di nuovo: ▶ Compila ed esegui, nella barra in basso.");
  // Il cursore si nasconde: in questo terminale non si scrive più nulla (un cursore acceso promette una riga di comando che non c'è).
  process.stdout.write("\x1b[?25l");
  resta();
} else {
  // Il titolo della scheda: senza, l'editor mostra il nome del processo, non «Programma C».
  process.stdout.write("\x1b]0;Programma C\x07");
  let righe: Riga[];
  try {
    righe = JSON.parse(readFileSync(dato ?? "", "utf8")) as Riga[];
  } catch (e) {
    righe = [{ testo: `(le righe della compilazione non si leggono: ${e instanceof Error ? e.message : String(e)})` }];
  }
  rmSync(dato ?? "", { force: true });
  for (const r of righe) scrivi(r.testo, r.grigio);
  if (modo === "solo") resta();
}
