// La logica senza editor (src/piano.ts). I messaggi dei compilatori sono uscite VERE di clang, gcc e make su un errore messo
// apposta (prove/casi/uscite/), non testi scritti a mano.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nomeDelProgramma, pianoDiCompilazione, programmaNato, righeDellaCompilazione, rigaDelPassoPassoImpossibile, rigaDelRifiuto, scegliCompilatore, segnalazioniDi } from "../src/piano";

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
  expect(rigaDelPassoPassoImpossibile("clang")).toBe("Questo programma si compila e si esegue con «Compila ed esegui», ma non con clang, che serve al passo passo: usa funzioni che clang qui non ha. Gli errori di clang sono in «Problemi».");
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
  expect(programmaNato([{ nome: "ciao", modificato: 120, eseguibile: true }], 100, "win32").motivo).toBe("Il Makefile non ha prodotto un programma da eseguire.");
  expect(programmaNato([...voci, { nome: "altro.exe", modificato: 130, eseguibile: true }], 100, "win32").motivo).toBe("Il Makefile ha prodotto più programmi (altro.exe, ciao.exe): non so quale eseguire.");
});

test("le righe del terminale: la descrizione, il comando in grigio, l'uscita del compilatore senza righe vuote", () => {
  const p = pianoDiCompilazione({ file: join("una  cartella", "leggi.c"), haMakefile: false, sistema: "linux", compilatore: "clang", perPassoPasso: false });
  const r = righeDellaCompilazione(p, "riga uno\r\n\r\nriga due\n");
  expect(r).toEqual([{ testo: "Compilo leggi.c con clang…" }, { testo: "  clang -std=c11 -Wall -Wextra -g -O0 leggi.c -o leggi", grigio: true }, { testo: "riga uno" }, { testo: "riga due" }]);
});
