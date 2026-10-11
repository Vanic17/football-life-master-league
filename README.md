# Football Life Master League — integrazione e aggiornamenti

Integrazione per Football Life 26 di una copia locale del gestionale Master League.
Questo repository pubblica esclusivamente il codice dell'adattatore. Non contiene
il motore originale RBs GameLab, database/immagini/file del gioco, runtime Python,
EDIT, percorsi locali, credenziali o salvataggi personali.

Il motore originale va ottenuto separatamente dal suo autore. La sua licenza non
consente di ripubblicarlo, neppure modificato. Queste release sono aggiornamenti
per un'installazione locale esistente, non un installer autonomo del gestionale.

## Aggiornare una copia già installata

1. Scarica `FL26-adapter-update.zip` dalla pagina Releases.
2. Estrai `football-life` sopra la cartella `football-life` del gestionale.
3. Se il vecchio pacchetto non ha il comando Aggiorna, scarica anche
   `Aggiorna Master League FL26.cmd` e mettilo accanto al comando Avvia.
4. In futuro apri **Aggiorna Master League FL26.cmd**: scarica l'ultima release,
   verifica i file, crea un backup e aggiorna solo l'adattatore.
5. Per importare un EDIT diverso esegui **Configura Master League FL26.cmd**.

Carriere, configurazione locale, database importato e backup dell'EDIT non vengono
sostituiti dalla patch. La sincronizzazione del gioco continua a creare backup.
Il gioco deve essere chiuso prima di configurare o preparare una partita.

## EDIT modificati

Importazione delle modifiche a giocatori già presenti nel database compatibile:
nomi, abilità, età, fisico, posizioni, stili, skills. I flag EDIT determinano quali
gruppi sostituiscono il database. Aspetto/volti e altri dati dell'EDIT restano
conservati. Durante la sincronizzazione, le abilità modificate nell'EDIT vengono
aggiornate con la progressione della carriera per evitare che annullino Player.bin.
Nuovi ID creati o composizioni dei campionati incompatibili richiedono ancora un
importatore del relativo database. La versione esatta del gioco è verificata.

## Economia

Valori pubblicati datati ove disponibili; stime basate sulle abilità native FL,
età e modelli calibrati negli altri casi. Le fonti già abbinate vengono aggiornate
in background quando si apre un giocatore, con cache di sette giorni. Se il sito
blocca l'accesso o cambia formato restano disponibili i dati precedenti/le stime.
Non è un accesso ufficiale alle API Transfermarkt/Capology e non garantisce dati
in tempo reale o copertura totale. Nessun account/API key è incluso.

Gli stipendi sono EUR lordi annui, esclusi bonus. I nuovi contratti/rinnovi usano
valore, ruolo e capacità economica della squadra di destinazione. Un contratto
firmato è conservato nella carriera e non riscritto da una ricerca online.

## Pubblicare una patch

Modifica i sorgenti, esegui i test pertinenti, aggiorna il tag e pubblica un tag
`vX.Y.Z`. GitHub Actions genera automaticamente ZIP e manifest SHA-256 e li
pubblica nella release. La release comprende soltanto i moduli dell'adattatore.

## Verifiche e limiti

Test per overlay EDIT, preservazione aspetto, progressione, salario per budget,
persistenza contratti, aggiornamento con backup/rollback e preservazione dati.
Il file EDIT dell'altro PC va ancora provato su quell'installazione. Le statistiche
avanzate e alcuni casi di autogol non sono ancora decodificati. Supplementari e
rigori sono verificati offline, non ancora in tutte le situazioni sul campo.

Riferimenti: https://implyingrigged.info/wiki/Pro_Evolution_Soccer_2021/Edit_file
e licenza originale nella copia locale `engine/docs/LICENSE.txt`.
