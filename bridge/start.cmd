@echo off
rem Запуск моста в этом окне (для проверки). Постоянная работа: install-autostart.ps1
cd /d "%~dp0"
node codex-bridge.mjs %*
