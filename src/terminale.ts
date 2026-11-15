// Gira dentro il terminale «Programma C» (il motore dell'editor usato come Node) e scrive le righe in italiano. Il programma
// dello studente NON lo lancia lui: lo lancia la shell del terminale fra la testa e la coda, così il programma ha la console
// vera e legge dalla tastiera (misurato su Windows: lanciato da qui, il motore è un'applicazione grafica e il programma legge
// subito la fine dell'ingresso). La coda resta aperta, perché un terminale il cui processo esce si chiude, e l'uscita del
// programma si perderebbe.
//
//   <motore> terminale.cjs testa <righe in JSON, in base64>    scrive le righe ed esce
//   <motore> terminale.cjs solo  <righe in JSON, in base64>    scrive le righe e resta (nessun programma da eseguire)
//   <motore> terminale.cjs coda  <codice d'uscita>             scrive com'è finito e resta

type Riga = { testo: string; grigio?: boolean };

const [modo, dato] = process.argv.slice(2);
const scrivi = (testo: string, grigio = false) => process.stdout.write(`${grigio ? "\x1b[90m" : ""}${testo}${grigio ? "\x1b[0m" : ""}\r\n`);
const resta = () => setInterval(() => {}, 1 << 30);

if (modo === "coda") {
  scrivi("");
  scrivi(`(finito: uscita ${dato ?? "?"})`, true);
  resta();
} else {
  // Il titolo della scheda: senza, l'editor mostra il nome del processo, non «Programma C».
  process.stdout.write("\x1b]0;Programma C\x07");
  for (const r of JSON.parse(Buffer.from(dato ?? "", "base64").toString("utf8")) as Riga[]) scrivi(r.testo, r.grigio);
  if (modo === "solo") resta();
}
