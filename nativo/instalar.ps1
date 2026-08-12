<#
  Registra o host de Native Messaging.

  O ID vem do campo "key" do manifest.json, entao nao e preciso informar nada.
  Se o manifest ainda nao tiver a chave, rode antes:  .\nativo\gerar-chave.ps1

  Uso:  .\nativo\instalar.ps1
        .\nativo\instalar.ps1 -Id abcdefghijklmnopabcdefghijklmnop   (forca um ID)
#>
param(
  [ValidatePattern('^([a-p]{32})?$')]
  [string]$Id = ''
)

$ErrorActionPreference = 'Stop'
$pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
$raiz  = Split-Path -Parent $pasta
$nomeHost = 'com.conversor.local'

. (Join-Path $pasta 'id-extensao.ps1')

# ============================================================ ID

if (-not $Id) {
  $Id = Get-IdExtensao (Join-Path $raiz 'manifest.json')
}

if (-not $Id) {
  Write-Host 'O manifest.json nao tem o campo "key".' -ForegroundColor Red
  Write-Host 'Rode primeiro:  .\nativo\gerar-chave.ps1' -ForegroundColor Yellow
  exit 1
}

Write-Host "ID da extensao: $Id" -ForegroundColor Cyan

# ============================================================ encoding do host

# Windows PowerShell 5.1 le .ps1 sem BOM como Windows-1252 e corrompe os acentos.
$hostPs1 = Join-Path $pasta 'host.ps1'
if (Test-Path $hostPs1) {
  $conteudo = [IO.File]::ReadAllText($hostPs1, (New-Object System.Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText($hostPs1, $conteudo, (New-Object System.Text.UTF8Encoding($true)))
  Write-Host 'host.ps1 regravado com BOM.' -ForegroundColor Green
} else {
  Write-Host 'host.ps1 nao encontrado.' -ForegroundColor Red
  exit 1
}

# ============================================================ registro

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

Write-Host "Ponte registrada: $destino" -ForegroundColor Green

# ============================================================ ferramentas

Write-Host ''
foreach ($p in 'yt-dlp', 'ffmpeg', 'spotdl') {
  if (Get-Command $p -ErrorAction SilentlyContinue) {
    Write-Host ("{0,-8}: ok" -f $p) -ForegroundColor Green
  } else {
    Write-Host ("{0,-8}: NAO encontrado" -f $p) -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host 'Feche o Chrome COMPLETAMENTE e abra de novo.' -ForegroundColor Cyan
