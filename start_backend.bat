@echo off
REM Arranca backend FastAPI en entorno virtual
pushd %~dp0
if not exist .venv (echo [ERROR] Entorno .venv no existe & exit /b 1)
call .venv\Scripts\activate.bat
echo Iniciando backend en puerto 8089...
uvicorn backend.app.main:app --reload --port 8089
popd
