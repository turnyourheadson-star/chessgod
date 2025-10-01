@echo off
setlocal EnableDelayedExpansion

:: Get the absolute path of the current directory
set "CURRENT_DIR=%~dp0"
set "CURRENT_DIR=!CURRENT_DIR:~0,-1!"

:: Update the manifest path in the registry
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.chessgod.backend" /ve /t REG_SZ /d "!CURRENT_DIR!\com.chessgod.backend.json" /f

echo Native messaging host has been registered.
pause