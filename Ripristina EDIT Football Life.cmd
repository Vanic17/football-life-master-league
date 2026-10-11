@echo off
if exist "%~dp0football-life\python\python.exe" (
  "%~dp0football-life\python\python.exe" -X utf8 "%~dp0football-life\restore_native.py"
) else (
  "%~dp0football-life\.runtime12\Scripts\python.exe" -X utf8 "%~dp0football-life\restore_native.py"
)
pause
