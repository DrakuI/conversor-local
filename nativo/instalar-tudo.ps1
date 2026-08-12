<#
  Instalação completa do Conversor Local.

  Uso:
    .\nativo\instalar-tudo.ps1
    .\nativo\instalar-tudo.ps1 -SemSpotify     pula o spotDL
    .\nativo\instalar-tudo.ps1 -NaoMover       instala onde a pasta ja esta

  O ID da extensão vem do campo "key" do manifest.json — nada a informar.
  Não precisa de administrador: tudo é instalado no escopo do usuário.
#>
param(
  [switch]$SemSpotify,
  [switch]$NaoMover
)

$ErrorActionPreference = 'Stop'
$pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
$raiz  = Split-Path -Parent $pasta
$nomeHost = 'com.conversor.local'
$PASTA_FINAL = 'C:\dev\conversor-local'

. (Join-Path $pasta 'id-extensao.ps1')

function Titulo($texto) { Write-Host "`n=== $texto ===" -ForegroundColor Cyan }

function Achar($nome) {
  $cmd = Get-Command $nome -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @(
    (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\$nome.exe"),
    (Join-Path $env:APPDATA "Python\Python313\Scripts\$nome.exe"),
    (Join-Path $env:USERPROFILE "scoop\shims\$nome.exe"),
    "C:\Program Files\nodejs\$nome.cmd",
    "C:\ProgramData\chocolatey\bin\$nome.exe"
  )) { if (Test-Path $p) { return $p } }
  return $null
}

# Programa instalado agora nao aparece no PATH deste processo sem isso.
function Atualizar-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
}

$temWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)

# ============================================================ 0. pasta definitiva

Titulo '0/6  Local da instalacao'

$mesmaPasta = $raiz.TrimEnd('\') -ieq $PASTA_FINAL.TrimEnd('\')

if ($mesmaPasta -or $NaoMover) {
  Write-Host "Instalando em: $raiz" -ForegroundColor Green
} else {
  Write-Host "Pasta atual : $raiz" -ForegroundColor Yellow
  Write-Host "Pasta final : $PASTA_FINAL" -ForegroundColor Yellow
  Write-Host ''
  Write-Host 'A ponte com o yt-dlp guarda o caminho desta pasta no registro do Windows.' -ForegroundColor DarkGray
  Write-Host 'Se ela ficar em Downloads e for apagada depois, a extensao para de funcionar.' -ForegroundColor DarkGray
  Write-Host ''

  $r = Read-Host "Copiar para $PASTA_FINAL e continuar de la? [S/n]"
  if ($r -eq '' -or $r -match '^[sSyY]') {
    New-Item -ItemType Directory -Force -Path $PASTA_FINAL | Out-Null
    Copy-Item -Path (Join-Path $raiz '*') -Destination $PASTA_FINAL -Recurse -Force
    Write-Host "Copiado para $PASTA_FINAL" -ForegroundColor Green
    Write-Host 'Reiniciando o instalador a partir de la...' -ForegroundColor Cyan
    Write-Host ''

    $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
              (Join-Path $PASTA_FINAL 'nativo\instalar-tudo.ps1'))
    if ($SemSpotify) { $args += '-SemSpotify' }

    & powershell @args
    exit
  }
  Write-Host "Continuando em $raiz" -ForegroundColor Yellow
}

# ============================================================ 1. ffmpeg.wasm

Titulo '1/6  Arquivos do ffmpeg.wasm'

$wasm = Join-Path $raiz 'vendor\core\ffmpeg-core.wasm'
$temWasm = (Test-Path $wasm) -and ((Get-Item $wasm).Length -gt 20MB)

if ($temWasm) {
  Write-Host 'vendor/ ja esta completo. Node.js nao e necessario.' -ForegroundColor Green
} else {
  Write-Host 'vendor/ ausente. Preciso do Node.js para baixar o ffmpeg.wasm.' -ForegroundColor Yellow

  if (-not (Achar 'npm')) {
    if ($temWinget) {
      Write-Host 'Instalando Node.js LTS...' -ForegroundColor Yellow
      winget install --id OpenJS.NodeJS.LTS --scope user --accept-package-agreements --accept-source-agreements -h
      Atualizar-Path
    }
  }

  if (-not (Achar 'npm')) {
    Write-Host ''
    Write-Host '  Node.js nao encontrado e nao consegui instalar sozinho.' -ForegroundColor Red
    Write-Host ''
    Write-Host '  1. Baixe o instalador LTS em:' -ForegroundColor Yellow
    Write-Host '     https://nodejs.org/en/download' -ForegroundColor White
    Write-Host '  2. Instale (Avancar em tudo)'
    Write-Host '  3. Rode o INSTALAR.bat de novo'
    Write-Host ''
    Read-Host 'Enter para abrir a pagina de download'
    Start-Process 'https://nodejs.org/en/download'
    exit 1
  }

  Write-Host 'Baixando ffmpeg.wasm (uns 32 MB, demora um pouco)...' -ForegroundColor Yellow

  $tmp = Join-Path $env:TEMP "conversor-vendor-$(Get-Random)"
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Push-Location $tmp
  try {
    npm init -y | Out-Null
    npm i '@ffmpeg/ffmpeg@0.12.15' '@ffmpeg/core@0.12.10' | Out-Null

    New-Item -ItemType Directory -Force -Path (Join-Path $raiz 'vendor\ffmpeg') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $raiz 'vendor\core') | Out-Null

    Copy-Item "node_modules\@ffmpeg\ffmpeg\dist\esm\*" (Join-Path $raiz 'vendor\ffmpeg\') -Recurse -Force
    Copy-Item "node_modules\@ffmpeg\core\dist\esm\ffmpeg-core.js"   (Join-Path $raiz 'vendor\core\') -Force
    Copy-Item "node_modules\@ffmpeg\core\dist\esm\ffmpeg-core.wasm" (Join-Path $raiz 'vendor\core\') -Force

    Write-Host 'vendor/ instalado.' -ForegroundColor Green
  } finally {
    Pop-Location
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# ============================================================ 2. programas externos

Titulo '2/6  yt-dlp, ffmpeg e spotDL'

if (-not $temWinget) {
  Write-Host 'winget nao encontrado. Atualize o "Instalador de Aplicativo" pela Microsoft Store.' -ForegroundColor Yellow
} else {
  foreach ($pkg in @(
    @{ cmd = 'yt-dlp'; id = 'yt-dlp.yt-dlp' },
    @{ cmd = 'ffmpeg'; id = 'Gyan.FFmpeg'   }
  )) {
    if (Achar $pkg.cmd) {
      Write-Host "$($pkg.cmd) ja instalado." -ForegroundColor Green
    } else {
      Write-Host "Instalando $($pkg.id)..." -ForegroundColor Yellow
      winget install --id $pkg.id --scope user --accept-package-agreements --accept-source-agreements -h
      Atualizar-Path
    }
  }
}

if ($SemSpotify) {
  Write-Host 'spotDL: pulado (-SemSpotify).' -ForegroundColor DarkGray
} elseif (Achar 'spotdl') {
  Write-Host 'spotdl ja instalado.' -ForegroundColor Green
} else {
  if (-not (Get-Command python -ErrorAction SilentlyContinue) -and $temWinget) {
    Write-Host 'Instalando Python...' -ForegroundColor Yellow
    winget install --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements -h
    Atualizar-Path
  }

  if (Get-Command python -ErrorAction SilentlyContinue) {
    Write-Host 'Instalando spotdl via pip...' -ForegroundColor Yellow
    python -m pip install --user --quiet spotdl
  } else {
    Write-Host 'Python nao encontrado. O spotDL ficou de fora (Spotify nao vai funcionar).' -ForegroundColor Yellow
  }
}

# ============================================================ 3. PATH

Titulo '3/6  PATH do usuario'

$atual  = [Environment]::GetEnvironmentVariable('Path', 'User')
$backup = Join-Path $HOME "path-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"
$atual | Set-Content -Path $backup -Encoding UTF8

# Pastas onde o pip instala executaveis no escopo do usuario.
$novas = @()
$raizPython = Join-Path $env:APPDATA 'Python'
if (Test-Path $raizPython) {
  $novas += Get-ChildItem $raizPython -Directory |
            ForEach-Object { Join-Path $_.FullName 'Scripts' } |
            Where-Object { Test-Path $_ }
}

$vistos = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$final = @()

foreach ($item in @($atual -split ';') + $novas) {
  $p = $item.Trim()
  if (-not $p) { continue }
  # Compara com a variavel expandida e sem barra final, senao a deduplicacao escapa.
  $chave = [Environment]::ExpandEnvironmentVariables($p).TrimEnd('\')
  if (-not $vistos.Add($chave)) { continue }
  if (-not (Test-Path $chave))  { continue }
  $final += $p
}

[Environment]::SetEnvironmentVariable('Path', ($final -join ';'), 'User')
Atualizar-Path

Write-Host "$($final.Count) entradas. Backup em $backup" -ForegroundColor Green

# ============================================================ 4. encoding do host

Titulo '4/6  Encoding do host.ps1'

# Windows PowerShell 5.1 le .ps1 sem BOM como Windows-1252 e corrompe os acentos.
$hostPs1 = Join-Path $pasta 'host.ps1'
if (Test-Path $hostPs1) {
  $conteudo = [IO.File]::ReadAllText($hostPs1, (New-Object System.Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText($hostPs1, $conteudo, (New-Object System.Text.UTF8Encoding($true)))
  Write-Host 'host.ps1 regravado com BOM.' -ForegroundColor Green
} else {
  Write-Host 'host.ps1 nao encontrado.' -ForegroundColor Red
}

# ============================================================ 5. ponte nativa

Titulo '5/6  Ponte nativa'

$Id = Get-IdExtensao (Join-Path $raiz 'manifest.json')

if (-not $Id) {
  Write-Host 'O manifest.json nao tem o campo "key", entao o ID nao e fixo.' -ForegroundColor Red
  Write-Host 'Rode:  .\nativo\gerar-chave.ps1   e depois este script de novo.' -ForegroundColor Yellow
} else {
  Write-Host "ID (do manifest): $Id" -ForegroundColor Cyan

  $manifesto = @{
    name = $nomeHost
    description = 'Ponte para yt-dlp e spotDL'
    path = (Join-Path $pasta 'host.bat')
    type = 'stdio'
    allowed_origins = @("chrome-extension://$Id/")
  }

  $destino = Join-Path $pasta "$nomeHost.json"
  $manifesto | ConvertTo-Json -Depth 4 | Set-Content -Path $destino -Encoding UTF8

  # Chrome e Edge. A chave do navegador ausente e simplesmente ignorada.
  foreach ($nav in @('Google\Chrome', 'Microsoft\Edge')) {
    New-Item -Path "HKCU:\Software\$nav\NativeMessagingHosts\$nomeHost" -Force -Value $destino | Out-Null
  }

  Write-Host 'Ponte registrada.' -ForegroundColor Green
}

# ============================================================ 6. carregar a extensao

Titulo '6/6  Resumo'

foreach ($nome in 'yt-dlp', 'ffmpeg', 'spotdl') {
  $onde = Achar $nome
  if ($onde) { Write-Host ("  {0,-8}: ok" -f $nome) -ForegroundColor Green }
  else       { Write-Host ("  {0,-8}: nao instalado" -f $nome) -ForegroundColor Yellow }
}

$wasmOk = (Test-Path $wasm) -and ((Get-Item $wasm).Length -gt 20MB)
if ($wasmOk) { Write-Host '  ffmpeg.wasm: ok' -ForegroundColor Green }
else         { Write-Host '  ffmpeg.wasm: FALTANDO (video e audio nao vao funcionar)' -ForegroundColor Red }

if ($Id) {
  # Deixa o caminho no Ctrl+V: o seletor de pastas do Chrome aceita colar.
  try { Set-Clipboard -Value $raiz } catch { }

  Write-Host ''
  Write-Host '  ULTIMO PASSO — carregar a extensao' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '  1. A pagina chrome://extensions vai abrir'
  Write-Host '  2. Ligue "Modo do desenvolvedor" (canto superior direito)'
  Write-Host '  3. Clique em "Carregar sem compactacao"'
  Write-Host '  4. Na janela que abrir, cole com Ctrl+V e confirme'
  Write-Host ''
  Write-Host '     O caminho ja esta na area de transferencia:' -ForegroundColor DarkGray
  Write-Host "     $raiz" -ForegroundColor White
  Write-Host ''

  Read-Host '  Enter para abrir chrome://extensions'
  Start-Process 'chrome.exe' 'chrome://extensions' -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host '  Depois de carregar, FECHE O CHROME INTEIRO e abra de novo.' -ForegroundColor Yellow
Write-Host '  O navegador so le o registro da ponte nativa ao iniciar.' -ForegroundColor DarkGray
