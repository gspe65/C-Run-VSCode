// VSCodium per le prove con l'editor: la versione fissata qui, scaricata dalla release di VSCodium per il sistema su cui gira,
// confrontata con l'impronta scritta qui ed estratta. Scrive il percorso dell'eseguibile, e con --uscita lo mette in quel file
// come `editor=<percorso>` (il file delle uscite di un passo delle Actions).
//
//   bun strumenti/vscodium.ts --cartella <dove> [--uscita <file>]
//
// Uscite: 0 verde, 1 rosso (impronta sbagliata), 2 fermo (sistema non previsto, rete, estrazione).
//
// Che cosa NON guarda: che l'editor parta; lo dice la prova.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { esegui, fermo, impronta, rosso } from "./comune";

export const VERSIONE = "1.143.17232";
/** Un file per sistema, con l'impronta pubblicata da VSCodium accanto a ciascun file della release. */
const PER_SISTEMA: Record<string, { file: string; sha256: string }> = {
  win32: { file: `VSCodium-win32-x64-${VERSIONE}.zip`, sha256: "a1090868af8ac0ac04c22d79fdd02246fa115a78daf38a741d8db06df1753c1d" },
  linux: { file: `VSCodium-linux-x64-${VERSIONE}.tar.gz`, sha256: "ca1895aa040bd91a09c709d79eac7862d8c1aa0237fdc25b503deeb8bcd87efd" },
  darwin: { file: `VSCodium-darwin-arm64-${VERSIONE}.zip`, sha256: "ade8f5e0ebf47e5ea9e2478844f150c68e43def192b6f8be05d0329d25ec0917" },
};

const { values: opzioni } = parseArgs({ args: Bun.argv.slice(2), options: { cartella: { type: "string" }, uscita: { type: "string" } }, strict: true });
const cartella = opzioni.cartella ?? fermo("--cartella vuole la cartella");
const voce = PER_SISTEMA[process.platform] ?? fermo(`sistema non previsto: ${process.platform}`);
mkdirSync(cartella, { recursive: true });

const archivio = join(cartella, voce.file);
if (!existsSync(archivio)) {
  const indirizzo = `https://github.com/VSCodium/vscodium/releases/download/${VERSIONE}/${voce.file}`;
  const r = await fetch(indirizzo).catch((e: unknown) => fermo(`non si è potuto scaricare ${indirizzo}: ${String(e)}`));
  if (!r.ok) fermo(`non si è potuto scaricare ${indirizzo}: risposta ${r.status}`);
  writeFileSync(archivio, new Uint8Array(await r.arrayBuffer()));
}
const misurata = impronta(readFileSync(archivio));
console.log(`${voce.file}: ${statSync(archivio).size} byte, impronta ${misurata}`);
if (misurata !== voce.sha256) rosso(`l'impronta di ${voce.file} non torna: attesa ${voce.sha256}`);

const estratto = join(cartella, "VSCodium");
mkdirSync(estratto, { recursive: true });
// Su Windows il tar di System32 apre lo zip; su macOS ditto tiene i collegamenti dei framework, che unzip romperebbe.
const e =
  process.platform === "win32"
    ? esegui([join(process.env.SystemRoot ?? fermo("manca SystemRoot"), "System32", "tar.exe"), "-xf", archivio, "-C", estratto])
    : process.platform === "darwin"
      ? esegui(["ditto", "-x", "-k", archivio, estratto])
      : esegui(["tar", "-xzf", archivio, "-C", estratto]);
if (e.uscita !== 0) fermo(`estrazione non riuscita:\n${e.testo}`);

let eseguibile: string;
if (process.platform === "win32") eseguibile = join(estratto, "VSCodium.exe");
else if (process.platform === "linux") eseguibile = join(estratto, "codium");
else {
  const app = readdirSync(estratto).filter((n) => n.endsWith(".app"));
  if (app.length !== 1) fermo(`nell'estratto le applicazioni sono ${app.length}: ${app.join(", ")}`);
  const macos = join(estratto, app[0]!, "Contents", "MacOS");
  const dentro = readdirSync(macos);
  if (dentro.length !== 1) fermo(`in ${macos} ci sono ${dentro.length} file: ${dentro.join(", ")}`);
  eseguibile = join(macos, dentro[0]!);
}
if (!existsSync(eseguibile)) fermo(`non c'è l'eseguibile ${eseguibile}`);
console.log(`editor: ${eseguibile}`);
if (opzioni.uscita !== undefined) appendFileSync(opzioni.uscita, `editor=${eseguibile}\n`);
console.log("ESITO: VERDE");
