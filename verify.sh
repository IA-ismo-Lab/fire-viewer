#!/bin/bash
# Script de verificación para Fire Viewer

echo "🔥 Fire Viewer - Verificación de instalación"
echo "================================================"

# Verificar Python
echo "📋 Verificando Python..."
python --version || python3 --version
if [ $? -eq 0 ]; then
    echo "✅ Python encontrado"
else
    echo "❌ Python no encontrado"
    exit 1
fi

# Verificar estructura de archivos
echo "📁 Verificando estructura..."
required_files=(".env.example" "README.md" "LICENSE" "start_backend.bat" "backend/requirements.txt" "frontend/index.html" "frontend/app.js")

for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ $file - FALTA"
    fi
done

# Verificar que .env.example no contiene APIs reales
echo "🔐 Verificando plantilla de configuración..."
if grep -q "YOUR_NASA_FIRMS_MAP_KEY_HERE" .env.example; then
    echo "✅ .env.example limpio"
else
    echo "❌ .env.example contiene datos reales"
fi

# Verificar que frontend no contiene token real
if grep -q "YOUR_CESIUM_TOKEN_HERE" frontend/index.html; then
    echo "✅ Token Cesium limpio"
else
    echo "❌ Token Cesium real encontrado"
fi

echo ""
echo "🚀 Siguiente paso: configurar APIs en .env y frontend/index.html"
echo "📖 Lee el README.md para instrucciones completas"
