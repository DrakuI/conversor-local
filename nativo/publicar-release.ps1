<#
  Gera o zip de distribuicao e publica como release no GitHub.

  O zip INCLUI a pasta vendor/ (32 MB), para que quem instalar
  nao precise de Node.js nem npm.

  Uso:  .\nativo\publicar-release.ps1 -Versao 1.0
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Versao
)

$ErrorActionPreference = 'Stop'
$pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
$raiz  = Split-Path -Parent $pasta

$nomeZip = "conversor-local-$Versao.zip"
$destino = Join-Path (Split-Path -Parent $raiz) $nomeZip

# ============================================================ seguranca

# A chave privada nunca pode sair da maquina. Compress-Archive nao le .gitignore,
# entao a verificacao tem de ser explicita.
$pems = Get-ChildItem $raiz -Recurse -Filter '*.pem' -ErrorAction SilentlyContinue
if ($pems) {
  Write-Host 'ABORTADO: ha chave privada dentro da pasta do projeto.' -ForegroundColor Red
  $pems | ForEach-Object { Write-Host "  $($_.FullName)" -ForegroundColor Red }
  Write-Host ''
  Write-Host 'Mova para fora antes de empacotar, por exemplo:' -ForegroundColor Yellow
  Write-Host "  Move-Item '$($pems[0].FullName)' `$HOME\chave-conversor.pem" -ForegroundColor White
  exit 1
}

$wasm = Join-Path $raiz 'vendor\core\ffmpeg-core.wasm'
if (-not ((Test-Path $wasm) -and ((Get-Item $wasm).Length -gt 20MB))) {
  Write-Host 'ABORTADO: vendor/ incompleto. O zip ficaria inutil sem Node.js.' -ForegroundColor Red
  Write-Host 'Rode o instalar-tudo.ps1 primeiro para baixar o ffmpeg.wasm.' -ForegroundColor Yellow
  exit 1
}

# ============================================================ empacotar

# Sobras que nao devem ir no zip.
$excluir = @('node_modules', 'tmp', '.git')

$itens = Get-ChildItem $raiz -Force |
         Where-Object { $excluir -notcontains $_.Name }

if (Test-Path $destino) { Remove-Item $destino -Force }

Write-Host 'Compactando...' -ForegroundColor Cyan
Compress-Archive -Path $itens.FullName -DestinationPath $destino -CompressionLevel Optimal

$mb = [math]::Round((Get-Item $destino).Length / 1MB, 1)
Write-Host "Gerado: $destino ($mb MB)" -ForegroundColor Green

# ============================================================ publicar

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host ''
  Write-Host 'gh nao encontrado. Suba o zip manualmente em Releases > Draft a new release.' -ForegroundColor Yellow
  exit 0
}

$notas = @"
Baixe o zip, extraia em qualquer lugar e rode **INSTALAR.bat**.

O ffmpeg ja vem incluido: nao precisa de Node.js nem npm.
O instalador copia a extensao para C:\dev\conversor-local e cuida do resto.
"@

Push-Location $raiz
try {
  gh release create "v$Versao" $destino --title "v$Versao" --notes $notas
} finally {
  Pop-Location
}
