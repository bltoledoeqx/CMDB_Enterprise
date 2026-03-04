@echo off
:: CMDB Local Agent - Instalador
:: Execute como Administrador

setlocal EnableExtensions EnableDelayedExpansion
set AGENT_DIR=%ProgramFiles%\CMDB-Agent
set NODE_URL=https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi
set CMDB_BASE_URL=__CMDB_BASE_URL__

echo ============================================
echo  CMDB Enterprise - Instalador do Agente
echo ============================================
echo.

:: Verifica Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js nao encontrado.
    echo [*] Baixando Node.js...
    curl -L -o "%TEMP%\node_installer.msi" "%NODE_URL%"
    if %errorlevel% neq 0 (
      echo [ERRO] Falha ao baixar Node.js.
      pause
      exit /b 1
    )
    msiexec /i "%TEMP%\node_installer.msi" /quiet /norestart
    echo [OK] Node.js instalado.
    echo [!] Reinicie o instalador apos o Node.js estar no PATH.
    pause
    exit /b 1
)
echo [OK] Node.js encontrado:
node --version

:: Cria pasta de instalacao
if not exist "%AGENT_DIR%" mkdir "%AGENT_DIR%"

:: Baixa/copia arquivos do agente
echo [*] Preparando arquivos do agente...
if exist "%~dp0agent.js" (
  copy /Y "%~dp0agent.js" "%AGENT_DIR%\agent.js" >nul
) else (
  curl -fsSL "%CMDB_BASE_URL%/agent/agent.js" -o "%AGENT_DIR%\agent.js"
)
if %errorlevel% neq 0 (
  echo [ERRO] Falha ao obter agent.js
  pause
  exit /b 1
)

if exist "%~dp0package.json" (
  copy /Y "%~dp0package.json" "%AGENT_DIR%\package.json" >nul
) else (
  curl -fsSL "%CMDB_BASE_URL%/agent/package.json" -o "%AGENT_DIR%\package.json"
)
if %errorlevel% neq 0 (
  echo [ERRO] Falha ao obter package.json
  pause
  exit /b 1
)

echo [OK] Arquivos prontos.

:: Cria script VBS para rodar sem janela visivel
echo [*] Criando launcher...
(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo WshShell.Run "node ""%AGENT_DIR%\agent.js""", 0, False
) > "%AGENT_DIR%\run-agent.vbs"

:: Cria entrada no registro para inicializar com o Windows
echo [*] Configurando inicializacao automatica...
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" ^
    /v "CMDB-Agent" ^
    /t REG_SZ ^
    /d "wscript.exe \"%AGENT_DIR%\run-agent.vbs\"" ^
    /f >nul
echo [OK] Inicializacao automatica configurada.

:: Inicia agora
echo [*] Iniciando agente...
start "" wscript.exe "%AGENT_DIR%\run-agent.vbs"
timeout /t 2 /nobreak >nul

:: Verifica se subiu
curl -fsS http://127.0.0.1:27420/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Agente rodando em http://127.0.0.1:27420
) else (
    echo [!] Agente nao respondeu - verifique o Node.js no PATH e tente novamente.
)

echo.
echo ============================================
echo  Instalacao concluida!
echo  O agente iniciara automaticamente com o Windows.
echo ============================================
echo.
pause
