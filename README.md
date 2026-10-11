# Master League Football Life — aggiornamenti completi

Release complete del programma per copie locali già configurate con Football Life
26. Dal tag v1.1.0 le release comprendono motore del gestionale, interfaccia,
integrazione, algoritmo economico, strumenti EDIT, dipendenze e runtime Python.
La pubblicazione del motore è stata autorizzata dall'utente il 11 ottobre 2026,
che ha dichiarato di avere scritto e revocato il precedente divieto.
Le licenze e attribuzioni dei componenti di terze parti rimangono valide.

## Aggiornamento sull'altro PC

Scarica `Aggiorna.Master.League.FL26.cmd` dalla pagina Releases e mettilo accanto
ad `Avvia Master League FL26.cmd`. Aprilo: scarica e verifica la versione completa,
chiude il gestionale di quella cartella e aggiorna tutti i file del programma.
In futuro riusa lo stesso comando. Dopo il primo aggiornamento riesegui Configura
per importare l'EDIT locale modificato, poi Avvia.

La patch conserva carriera, EDIT originale, database importato, immagini estratte
dal proprio gioco, percorsi di installazione e backup. Non distribuisce FL_2026.exe,
archivi CPK, dati/immagini del gioco, credenziali o salvataggi personali.
Non è un installer autonomo: richiede la copia del gestionale già configurabile.

È pubblicata anche la piccola patch di transizione `FL26-adapter-update.zip` per
i vecchi aggiornatori. La patch completa è `FL26-complete-update.zip`.
Il runtime è versionato: cambiando Python o dipendenze crea una nuova cartella
runtime e aggiorna il campo `runtime` del manifest, evitando DLL in uso.

## EDIT ed economia

Importa modifiche di giocatori esistenti: abilità, nome, età, corpo, posizioni,
skills e stili. I flag EDIT decidono quali gruppi sostituire. Aspetto conservato;
abilità EDIT sincronizzate con la crescita della carriera. ID creati o database
incompatibili richiedono ancora un importatore specifico.

Valori online da Transfermarkt per identificazioni certe, in background aprendo
la scheda, con cache settimanale. Senza dati online conserva valori disponibili
o stime basate su abilità native/età. Capology può bloccare le richieste: non è
garantita la copertura online degli stipendi. Contratti firmati persistono; nuovi
ingaggi/rinnovi dipendono da valore, ruolo e budget. EUR lordi annui, bonus esclusi.

## Prossime patch

Modifica i file, esegui i test pertinenti, fai commit e pubblica un tag `vX.Y.Z`.
GitHub Actions verifica l'aggiornatore e pubblica automaticamente entrambe le ZIP.
La distinta dei file e SHA-256 è nel manifest. Sono previsti backup e rollback.
