@echo off
REM ---------------------------------------------------------------------------
REM Double-clickable launcher for wake-render.ps1.
REM
REM Exists so waking the services needs no terminal and no execution-policy
REM change: %~dp0 resolves next to this file, so the shortcut works from
REM anywhere, and -ExecutionPolicy Bypass applies to this one process only
REM rather than loosening the machine's policy.
REM
REM From a terminal, prefer `pnpm wake` or the .ps1 directly - this wrapper
REM pauses at the end so a double-clicked window does not vanish before the
REM result can be read.
REM ---------------------------------------------------------------------------

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wake-render.ps1" %*

echo.
pause
