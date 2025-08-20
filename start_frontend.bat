@echo off
REM Servidor estático simple para frontend (requiere Python en PATH)
pushd %~dp0\frontend
echo Sirviendo frontend en http://127.0.0.1:5173 (Ctrl+C para salir)
python -m http.server 5173
popd
