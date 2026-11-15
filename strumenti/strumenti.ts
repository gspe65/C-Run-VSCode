// Gli strumenti per la prova con l'editor, nelle versioni fissate qui e con l'impronta: l'estensione di debug «LLDB DAP»
// (Open VSX), estratta in una cartella da dare all'editor; su Windows anche clang e lldb-dap di llvm-mingw. Su Linux e macOS
// compilatori e lldb-dap sono quelli del sistema (li cerca la prova).
//
//   bun strumenti/strumenti.ts --cartella <dove> [--uscita <file>]     scrive estensione=<cartella> e, su Windows, llvm=<bin>
//
// Uscite: 0 verde, 1 rosso (impronta sbagliata), 2 fermo.
//
// Che cosa NON guarda: che gli strumenti funzionino; lo dice la prova.

import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { esegui, fermo, scaricato, vociDelloZip } from "./comune";

export const LLDB_DAP = {
  indirizzo: "https://open-vsx.org/api/llvm-vs-code-extensions/lldb-dap/0.7.20261012/file/llvm-vs-code-extensions.lldb-dap-0.7.20261012.vsix",
  nome: "llvm-vs-code-extensions.lldb-dap-0.7.20261012.vsix",
  sha256: "f264239b109dd2fd8602b6eaa23f88f01d42d61168b10e6f2619a78ddbe54ace",
};
export const LLVM_MINGW = {
  indirizzo: "https://github.com/mstorsjo/llvm-mingw/releases/download/20260826/llvm-mingw-20260826-ucrt-x86_64.zip",
  nome: "llvm-mingw-20260826-ucrt-x86_64.zip",
  sha256: "ae601f4e0f72bbdf441ad2df8bb16f037e2e9251559ea6b37b4057aef39c06c3",
  radice: "llvm-mingw-20260826-ucrt-x86_64",
};

const { values: opzioni } = parseArgs({ args: Bun.argv.slice(2), options: { cartella: { type: "string" }, uscita: { type: "string" } }, strict: true });
// Assoluta: chi legge il file delle uscite può girare in un'altra cartella.
const cartella = resolve(opzioni.cartella ?? fermo("--cartella vuole la cartella"));
const uscite: string[] = [];

// L'estensione di debug: le voci sotto extension/ del pacchetto, in una cartella sua.
const vsix = await scaricato(LLDB_DAP.indirizzo, LLDB_DAP.nome, LLDB_DAP.sha256, cartella);
const estensione = join(cartella, "lldb-dap");
rmSync(estensione, { recursive: true, force: true });
let scritte = 0;
for (const [voce, dati] of vociDelloZip(readFileSync(vsix))) {
  if (!voce.startsWith("extension/")) continue;
  const dove = join(estensione, ...voce.slice("extension/".length).split("/"));
  mkdirSync(dirname(dove), { recursive: true });
  writeFileSync(dove, dati);
  scritte++;
}
if (!existsSync(join(estensione, "package.json"))) fermo("nel pacchetto di LLDB DAP non c'è extension/package.json");
console.log(`LLDB DAP: ${scritte} file in ${estensione}`);
uscite.push(`estensione=${estensione}`);

if (process.platform === "win32") {
  const zip = await scaricato(LLVM_MINGW.indirizzo, LLVM_MINGW.nome, LLVM_MINGW.sha256, cartella);
  const bin = join(cartella, LLVM_MINGW.radice, "bin");
  if (!existsSync(join(bin, "clang.exe"))) {
    const e = esegui([join(process.env.SystemRoot ?? fermo("manca SystemRoot"), "System32", "tar.exe"), "-xf", zip, "-C", cartella]);
    if (e.uscita !== 0) fermo(`estrazione di llvm-mingw non riuscita:\n${e.testo}`);
  }
  for (const p of ["clang.exe", "lldb-dap.exe"]) if (!existsSync(join(bin, p))) fermo(`in llvm-mingw manca ${p}`);
  console.log(`llvm-mingw: ${bin}`);
  uscite.push(`llvm=${bin}`);
}

for (const u of uscite) console.log(u);
if (opzioni.uscita !== undefined) appendFileSync(opzioni.uscita, `${uscite.join("\n")}\n`);
console.log("ESITO: VERDE");
