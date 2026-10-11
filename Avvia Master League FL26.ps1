$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$pythonCandidates = @()
$runtimeFile = Join-Path $taskRoot 'football-life\runtime-path.txt'
if (Test-Path -LiteralPath $runtimeFile) {
    $runtime = (Get-Content -LiteralPath $runtimeFile -Raw).Trim()
    if ($runtime -match '^runtime[\\/][a-zA-Z0-9_.-]+$') { $pythonCandidates += Join-Path $taskRoot ('football-life\' + ($runtime -replace '/', '\') + '\python.exe') }
}
$pythonCandidates += Join-Path $taskRoot 'football-life\runtime\py312-r1\python.exe'
$pythonCandidates += Join-Path $taskRoot 'football-life\python\python.exe'
$pythonCandidates += Join-Path $taskRoot 'football-life\.runtime12\Scripts\python.exe'
$python = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$python) { throw 'Runtime Python non trovato: il pacchetto non e stato estratto completamente.' }
try {
    if ((Test-Path -LiteralPath (Join-Path $taskRoot 'football-life\portable-compatibility.json')) -and !(Test-Path -LiteralPath (Join-Path $taskRoot 'football-life\installation.json'))) {
        & (Join-Path $taskRoot 'Configura Master League FL26.ps1')
        if (!(Test-Path -LiteralPath (Join-Path $taskRoot 'football-life\installation.json'))) { throw 'Configurazione necessaria prima di avviare il gestionale.' }
    }
    $ready = $false
    $status=$null
    try { $status = Invoke-RestMethod 'http://127.0.0.1:8770/fl/status' -TimeoutSec 2 } catch { }
    if ($status) {
        if ($status.program -ne 'Football Life Master League') { throw 'Porta 8770 occupata da un altro programma.' }
        $serverRoot=$status.program_root
        if (!$serverRoot) { $serverRoot=Split-Path $status.save_dir -Parent }
        if ([IO.Path]::GetFullPath($serverRoot) -ne [IO.Path]::GetFullPath((Join-Path $taskRoot 'football-life'))) { throw 'Un altro gestionale e gia aperto da una cartella diversa. Chiudilo prima di avviare questa copia.' }
        $ready = $true
    }
    if (!$ready) {
        $serverFile = Join-Path $taskRoot 'football-life\port_server.py'
        Start-Process -FilePath $python -ArgumentList @('-X', 'utf8', ('"' + $serverFile + '"')) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'football-life\port.log') -RedirectStandardError (Join-Path $taskRoot 'football-life\port-error.log')
        for ($i=0; $i -lt 80; $i++) {
            Start-Sleep -Milliseconds 250
            try {
                $status = Invoke-RestMethod 'http://127.0.0.1:8770/fl/status' -TimeoutSec 1
                if ($status.program -eq 'Football Life Master League') { $ready=$true; break }
            } catch { }
        }
    }
    if (!$ready) { throw 'Avvio non riuscito. Vedi football-life\port-error.log.' }
    Start-Process 'http://127.0.0.1:8770/'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Premi Invio per chiudere'
    exit 1
}
