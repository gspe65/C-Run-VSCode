# C-Run-VSCode

Un'estensione per VSCodium e Visual Studio Code che compila ed esegue con un clic il programma C del file aperto, o lo segue passo passo.

> **Versione di prova (0.0.4).** Il pacchetto è costruito e provato dalle GitHub Actions di questo repository; la prima versione per l'uso è in preparazione.

## Che cosa fa

Con un file `.c` aperto, in basso nella barra di stato compaiono **«Compila ed esegui»** e **«Passo passo»**, col nome del file su cui agiscono (per esempio «Compila ed esegui lettura-intero.c»). È l'unico posto, scritto per esteso: chi impara a programmare non deve scegliere fra due triangoli. Restano visibili anche quando il file è aperto accanto a un'altra pagina, e spariscono durante il passo passo, che si continua dalla barra del debug.

- **Compila ed esegui**: salva il file e lo compila. Se nella sua cartella c'è un `Makefile`, usa quello (`make -B`); altrimenti compila il file da solo (`clang`, se no `gcc`, se no `cc`, con `-std=c11 -Wall -Wextra -g -O0`). Poi esegue il programma nel terminale **«Programma C»**, dove si scrive ciò che il programma legge (la riga prima del programma lo dice). Alla fine il terminale dice che il programma è finito e come eseguirlo di nuovo. Se la compilazione non riesce, il programma non parte: gli errori sono nel pannello «Problemi» e il cursore va sulla riga del primo.
- **Passo passo**: compila allo stesso modo con il compilatore scelto (anche col `Makefile`, che riceve `CC=`) e avvia il debug con l'estensione [LLDB DAP](https://open-vsx.org/extension/llvm-vs-code-extensions/lldb-dap) nel terminale integrato, così il programma legge dalla tastiera anche mentre è fermo. La console di debug non si apre da sola e, quando il programma parte, il cursore va nel terminale dove legge (anche quando l'editor riusa quel terminale; su macOS, dal secondo passo passo, il cursore può restare nel file: fai clic nel terminale «Processo di debug» prima di scrivere). Il programma si ferma sui punti d'arresto del file; se non ce n'è nessuno, sulla prima riga di `main`. Se il programma si compila col suo `Makefile` ma non col compilatore del passo passo (su Windows: un programma che usa `fork` o altre funzioni che ci sono solo con il gcc di MSYS2 o Cygwin), il terminale lo dice e gli errori sono in «Problemi».

Come si collega il programma al terminale durante il passo passo:

- **Windows e macOS**: il terminale lo apre LLDB DAP («Processo di debug»), e il programma parte lì aspettando il debugger;
- **Linux**: l'estensione apre il terminale **«Passo passo»**, e lldb lancia il programma con ingresso e uscita su quel terminale. Il kernel di Linux non lascia agganciare il debugger a un programma che non ha lanciato lui, quindi la strada di Windows e macOS lì non funziona.

Il compilatore per il file da solo e per il passo passo si sceglie nell'impostazione `c-run.compilatore` (vuota: il primo che si trova fra `clang`, `gcc`, `cc`).

## Che cosa serve

- un compilatore C e, per i progetti col `Makefile`, `make`;
- per «Passo passo» l'estensione LLDB DAP (`llvm-vs-code-extensions.lldb-dap`) e il programma `lldb-dap` (incluso in LLVM; su macOS negli strumenti di Xcode). Su Windows lldb ferma i programmi compilati con clang di [llvm-mingw](https://github.com/mstorsjo/llvm-mingw), non quelli del gcc di MSYS2 o Cygwin. Su Linux la prova usa `lldb-dap` 21 dai [pacchetti di LLVM](https://apt.llvm.org); quello di Ubuntu 24.04 (versione 18) con questa estensione non è provato.

## Installarla

Dalla [pagina delle release](https://github.com/gspe65/C-Run-VSCode/releases) si scarica `C-Run-0.0.4.vsix`, poi nell'editor: «Estensioni», menu «···», «Installa da VSIX…». Da riga di comando:

```
codium --install-extension C-Run-0.0.4.vsix
```

(`code` al posto di `codium` per Visual Studio Code.)

## Da dove viene il pacchetto

Il pacchetto lo costruisce la corsa delle GitHub Actions di questo repository, a ogni etichetta, **una volta sola**. Lo stesso file viene provato con VSCodium 1.143.17232 su Windows (clang e lldb di llvm-mingw, make e gcc di MSYS2), Ubuntu (con uno schermo virtuale, i compilatori del sistema e lldb 21 di LLVM) e macOS (gli strumenti di Xcode), facendo ciò che fa chi lo usa: un progetto col `Makefile`, un file da solo che legge un numero, un errore messo apposta, il passo passo (due volte, la seconda nel terminale che l'editor riusa: su macOS l'esito del cursore si scrive nel rapporto senza fermare la release, per il limite detto sopra). La release si crea solo se le tre prove sono verdi, e il file porta un'attestazione della sua provenienza, che si verifica con:

```
gh attestation verify C-Run-0.0.4.vsix -R gspe65/C-Run-VSCode
```

## Costruirla e provarla dai sorgenti

Servono [Bun](https://bun.sh) 1.4.2, git, un compilatore C, `make`, `lldb-dap` e la rete (la prima volta).

```
bun install --frozen-lockfile
bun run costruisci
bun prove/prova.ts
bun strumenti/strumenti.ts --cartella strumenti-scaricati --uscita strumenti-scaricati/strumenti.txt
bun prove/prova.ts --editor <percorso dell'eseguibile di VSCodium> --strumenti strumenti-scaricati/strumenti.txt
```

`bun run costruisci` scrive in `dist/` l'estensione e il pacchetto. `bun prove/prova.ts` prova il pacchetto e la logica senza aprire nulla. `strumenti/strumenti.ts` scarica, con l'impronta, l'estensione LLDB DAP e, su Windows, llvm-mingw; con `--editor` la prova apre l'editor indicato per qualche secondo, con un profilo temporaneo, e prova l'estensione dentro (su Windows `make` e `gcc` si cercano in `msys64\usr\bin` sul disco di sistema, dove li mette l'installazione di MSYS2, o nella cartella data con `--msys`).

## Licenza

MIT (`LICENSE`).
