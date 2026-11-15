# C-Run-VSCode

Un'estensione per VSCodium e Visual Studio Code che compila ed esegue con un clic il programma C del file aperto, o lo segue passo passo.

> **Versione di prova (0.0.1).** Il pacchetto è costruito e provato dalle GitHub Actions di questo repository; la prima versione per l'uso è in preparazione.

## Che cosa fa

Con un file `.c` aperto, in basso nella barra di stato compaiono **«Compila ed esegui»** e **«Passo passo»** (e le stesse due icone in alto a destra, nel titolo del file).

- **Compila ed esegui**: salva il file e lo compila. Se nella sua cartella c'è un `Makefile`, usa quello (`make -B`); altrimenti compila il file da solo (`clang`, se no `gcc`, se no `cc`, con `-std=c11 -Wall -Wextra -g -O0`). Poi esegue il programma nel terminale **«Programma C»**, dove si scrive ciò che il programma legge. Se la compilazione non riesce, il programma non parte: gli errori sono nel pannello «Problemi» e il cursore va sulla riga del primo.
- **Passo passo**: compila allo stesso modo con il compilatore scelto (anche col `Makefile`, che riceve `CC=`) e avvia il debug con l'estensione [LLDB DAP](https://open-vsx.org/extension/llvm-vs-code-extensions/lldb-dap) nel terminale integrato, così il programma legge dalla tastiera anche mentre è fermo. Il programma si ferma sui punti d'arresto del file; se non ce n'è nessuno, sulla prima riga di `main`.

Il compilatore per il file da solo e per il passo passo si sceglie nell'impostazione `c-run.compilatore` (vuota: il primo che si trova fra `clang`, `gcc`, `cc`).

## Che cosa serve

- un compilatore C e, per i progetti col `Makefile`, `make`;
- per «Passo passo» l'estensione LLDB DAP (`llvm-vs-code-extensions.lldb-dap`) e il programma `lldb-dap` (incluso in LLVM; su macOS negli strumenti di Xcode). Su Windows lldb ferma i programmi compilati con clang di [llvm-mingw](https://github.com/mstorsjo/llvm-mingw), non quelli del gcc di MSYS2 o Cygwin.

## Installarla

Dalla [pagina delle release](https://github.com/gspe65/C-Run-VSCode/releases) si scarica `C-Run-0.0.1.vsix`, poi nell'editor: «Estensioni», menu «···», «Installa da VSIX…». Da riga di comando:

```
codium --install-extension C-Run-0.0.1.vsix
```

(`code` al posto di `codium` per Visual Studio Code.)

## Da dove viene il pacchetto

Il pacchetto lo costruisce la corsa delle GitHub Actions di questo repository, a ogni etichetta, **una volta sola**. Lo stesso file viene provato con VSCodium 1.143.17232 su Windows, Ubuntu (con uno schermo virtuale) e macOS, facendo ciò che fa chi lo usa: un progetto col `Makefile`, un file da solo che legge un numero, un errore messo apposta, il passo passo. La release si crea solo se le tre prove sono verdi, e il file porta un'attestazione della sua provenienza, che si verifica con:

```
gh attestation verify C-Run-0.0.1.vsix -R gspe65/C-Run-VSCode
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
