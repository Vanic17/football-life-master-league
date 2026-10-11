@echo off
set "FL_ML_UPDATE_ROOT=%~dp0football-life"
if not exist "%FL_ML_UPDATE_ROOT%\port_server.py" (
  echo Metti questo comando nella cartella che contiene Avvia Master League FL26.cmd.
  pause
  exit /b 1
)
if exist "%FL_ML_UPDATE_ROOT%" (
  powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/Vanic17/football-life-master-league/main/football-life/update_manager.py' -OutFile (Join-Path $env:FL_ML_UPDATE_ROOT 'update_manager.py')"
  if errorlevel 1 (
    echo Download iniziale non riuscito. Controlla la connessione.
    pause
    exit /b 1
  )
)
if exist "%FL_ML_UPDATE_ROOT%\runtime-path.txt" (
  for /f "usebackq delims=" %%R in ("%FL_ML_UPDATE_ROOT%\runtime-path.txt") do "%FL_ML_UPDATE_ROOT%\%%R\python.exe" -X utf8 "%FL_ML_UPDATE_ROOT%\update_manager.py"
) else if exist "%FL_ML_UPDATE_ROOT%\runtime\py312-r1\python.exe" (
  "%FL_ML_UPDATE_ROOT%\runtime\py312-r1\python.exe" -X utf8 "%FL_ML_UPDATE_ROOT%\update_manager.py"
) else if exist "%~dp0football-life\python\python.exe" (
  "%~dp0football-life\python\python.exe" -X utf8 "%~dp0football-life\update_manager.py"
) else (
  "%~dp0football-life\.runtime12\Scripts\python.exe" -X utf8 "%~dp0football-life\update_manager.py"
)
if exist "%FL_ML_UPDATE_ROOT%\runtime-path.txt" (
  for /f "usebackq delims=" %%R in ("%FL_ML_UPDATE_ROOT%\runtime-path.txt") do "%FL_ML_UPDATE_ROOT%\%%R\python.exe" -X utf8 "%FL_ML_UPDATE_ROOT%\update_manager.py"
)
pause
