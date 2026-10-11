@echo off
powershell.exe -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:8770/fl/shutdown' -Method Post -ContentType 'application/json' -Body '{}' | Out-Null } catch { Write-Host 'Gestionale gia chiuso.' }"
