// Avvia l'editor dato con l'estensione estratta dal pacchetto e quella di debug, e dentro `finestra.cjs`. Nessun download.
//
//   node prove/lancia.cjs <eseguibile> <estensione> <estensione di debug> <cartella dei casi> <file di uscita> <cartella dei dati> <programma dell'errore>
//
// L'ambiente (PATH coi compilatori) è quello di chi lancia. Su Linux l'editor parte senza la sandbox di Chromium: sulle
// macchine senza namespace utente (Ubuntu delle Actions) non si avvia, e qui gira solo con un profilo temporaneo.

const { join } = require("node:path");
const { runTests } = require("@vscode/test-electron");

const [eseguibile, estensione, debug, casi, uscita, dati, programmaErrore] = process.argv.slice(2);

runTests({
  vscodeExecutablePath: eseguibile,
  extensionDevelopmentPath: [estensione, debug],
  extensionTestsPath: join(__dirname, "finestra.cjs"),
  extensionTestsEnv: { CRUN_CARTELLA: casi, CRUN_USCITA: uscita, CRUN_PROGRAMMA_ERRORE: programmaErrore },
  launchArgs: [casi, "--user-data-dir", join(dati, "profilo"), "--extensions-dir", join(dati, "estensioni"), "--disable-extensions", ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
}).catch((e) => {
  console.error(String(e));
  process.exit(1);
});
