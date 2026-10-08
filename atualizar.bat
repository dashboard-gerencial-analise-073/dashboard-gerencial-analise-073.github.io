@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Atualizando dados e relatorio...
python -m pip install -q -r requirements.txt
python pipeline\build.py %*
if errorlevel 1 (echo. & echo ERRO na atualizacao. Veja as mensagens acima. & pause & exit /b 1)
echo.
echo Concluido. Abrindo o relatorio...
start "" "dashboard\index.html"
pause
