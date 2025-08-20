@echo off
REM Script de verificación para Fire Viewer

echo 🔥 Fire Viewer - Verificación de instalación
echo ================================================

REM Verificar Python
echo 📋 Verificando Python...
python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Python encontrado
) else (
    echo ❌ Python no encontrado
    exit /b 1
)

REM Verificar archivos principales
echo 📁 Verificando estructura...

if exist .env.example (echo ✅ .env.example) else (echo ❌ .env.example - FALTA)
if exist README.md (echo ✅ README.md) else (echo ❌ README.md - FALTA)
if exist LICENSE (echo ✅ LICENSE) else (echo ❌ LICENSE - FALTA)
if exist start_backend.bat (echo ✅ start_backend.bat) else (echo ❌ start_backend.bat - FALTA)
if exist backend\requirements.txt (echo ✅ backend\requirements.txt) else (echo ❌ backend\requirements.txt - FALTA)
if exist frontend\index.html (echo ✅ frontend\index.html) else (echo ❌ frontend\index.html - FALTA)
if exist frontend\app.js (echo ✅ frontend\app.js) else (echo ❌ frontend\app.js - FALTA)

REM Verificar configuración limpia
echo 🔐 Verificando configuración...
findstr /C:"YOUR_NASA_FIRMS_MAP_KEY_HERE" .env.example >nul
if %errorlevel% equ 0 (echo ✅ .env.example limpio) else (echo ❌ .env.example contiene datos reales)

findstr /C:"YOUR_CESIUM_TOKEN_HERE" frontend\index.html >nul
if %errorlevel% equ 0 (echo ✅ Token Cesium limpio) else (echo ❌ Token Cesium real encontrado)

echo.
echo 🚀 Siguiente paso: configurar APIs en .env y frontend\index.html
echo 📖 Lee el README.md para instrucciones completas
pause
