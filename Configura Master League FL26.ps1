$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$taskRoot=$PSScriptRoot
$python=Join-Path $taskRoot 'football-life\python\python.exe'
if (!(Test-Path -LiteralPath $python)) { $python=Join-Path $taskRoot 'football-life\.runtime12\Scripts\python.exe' }
if (Test-Path -LiteralPath (Join-Path $taskRoot 'football-life\runtime-path.txt')) { $runtime=(Get-Content -LiteralPath (Join-Path $taskRoot 'football-life\runtime-path.txt') -Raw).Trim(); if ($runtime -match '^runtime/[a-zA-Z0-9_.-]+$') { $python=Join-Path $taskRoot ('football-life/'+$runtime+'/python.exe') } }
try {
    try {
        $status=Invoke-RestMethod 'http://127.0.0.1:8770/fl/status' -TimeoutSec 1
        if ($status.program -eq 'Football Life Master League') { throw 'Chiudi il gestionale prima di cambiare configurazione. Usa il comando Chiudi gestionale FL26.cmd.' }
    } catch [System.Net.WebException] { }
    $folder=New-Object System.Windows.Forms.FolderBrowserDialog
    $folder.Description='Seleziona la cartella Football Life 2026 che contiene FL_2026.exe'
    if ($folder.ShowDialog() -ne 'OK') { exit 1 }
    $gamePath=$folder.SelectedPath
    $file=New-Object System.Windows.Forms.OpenFileDialog
    $file.Title='Seleziona EDIT00000000 del nuovo PC (Documents/KONAMI/.../2026/save)'
    $file.Filter='EDIT Football Life|EDIT00000000|Tutti i file|*.*'
    if ($file.ShowDialog() -ne 'OK') { exit 1 }
    $editPath=$file.FileName
    $argsList=@('-X','utf8',(Join-Path $taskRoot 'football-life\configure_installation.py'),'--game',$gamePath,'--edit',$editPath)
    & $python @argsList
    if ($LASTEXITCODE -ne 0) { throw 'Configurazione non riuscita: leggi il motivo nella finestra.' }
    [System.Windows.Forms.MessageBox]::Show('Configurazione completata. Ora apri Avvia Master League FL26.cmd. Il file EDIT del gioco non e stato modificato.','Master League FL26') | Out-Null
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Premi Invio per chiudere'
    exit 1
}
