@echo off
chcp 65001 >nul
title Conversor Local - Instalacao

cd /d "%~dp0"

echo.
echo   ============================================
echo     CONVERSOR LOCAL - INSTALACAO
echo   ============================================
echo.
echo   Isso vai instalar yt-dlp, ffmpeg e spotDL,
echo   e preparar a extensao. Pode demorar alguns
echo   minutos na primeira vez.
echo.
pause

REM Tira a marca de "baixado da internet" de todos os arquivos,
REM senao o PowerShell recusa executar os scripts.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem '%~dp0' -Recurse | Unblock-File" 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0nativo\instalar-tudo.ps1"

echo.
pause
