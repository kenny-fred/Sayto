@echo off
REM Lancer live.js dans le dossier root
start cmd /k "node live.js"

REM Aller dans le dossier backend et lancer nodemon
cd /d "%~dp0backend"
start cmd /k "nodemon server.js"

pause
