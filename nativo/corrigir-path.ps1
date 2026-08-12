<#
  Adiciona a pasta de scripts do Python ao PATH do usuário e limpa a lista:
  remove duplicatas e caminhos que não existem mais.
  Mexe SÓ no PATH do usuário — o PATH da máquina fica intacto.
#>

$ErrorActionPreference = 'Stop'

# ---------- backup ----------
$atual = [Environment]::GetEnvironmentVariable('Path', 'User')
$backup = Join-Path $HOME "path-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"
$atual | Set-Content -Path $backup -Encoding UTF8
Write-Host "Backup salvo em $backup`n" -ForegroundColor DarkGray

# ---------- pastas do Python instaladas para o usuário ----------
$novas = @()
$raizPython = Join-Path $env:APPDATA 'Python'
if (Test-Path $raizPython) {
  $novas += Get-ChildItem $raizPython -Directory |
            ForEach-Object { Join-Path $_.FullName 'Scripts' } |
            Where-Object { Test-Path $_ }
}

# ---------- monta a lista final ----------
$vistos = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$final = @()
$removidos = @()

foreach ($item in @($atual -split ';') + $novas) {
  $p = $item.Trim()
  if (-not $p) { continue }

  # Chave de comparação: sem barra final e com %VARIAVEL% expandida.
  $chave = [Environment]::ExpandEnvironmentVariables($p).TrimEnd('\')

  if (-not $vistos.Add($chave)) {
    $removidos += "duplicado: $p"
    continue
  }
  if (-not (Test-Path $chave)) {
    $removidos += "não existe: $p"
    continue
  }
  $final += $p
}

# ---------- relatório ----------
foreach ($n in $novas) {
  if ($final -contains $n) { Write-Host "Adicionado: $n" -ForegroundColor Green }
}
foreach ($r in $removidos) { Write-Host "Removido  : $r" -ForegroundColor Yellow }

if ($removidos.Count -eq 0 -and $novas.Count -eq 0) {
  Write-Host 'Nada a mudar.' -ForegroundColor DarkGray
}

[Environment]::SetEnvironmentVariable('Path', ($final -join ';'), 'User')
Write-Host "`nPATH do usuário: $($final.Count) entradas.`n" -ForegroundColor Cyan

# ---------- checagem das ferramentas ----------
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + ($final -join ';')

foreach ($nome in 'yt-dlp', 'spotdl', 'ffmpeg', 'python') {
  $achados = @(Get-Command $nome -All -ErrorAction SilentlyContinue | Select-Object -Expand Source -Unique)

  if ($achados.Count -eq 0) {
    Write-Host "$nome : NAO encontrado" -ForegroundColor Red
  } elseif ($achados.Count -eq 1) {
    Write-Host "$nome : $($achados[0])" -ForegroundColor Green
  } else {
    Write-Host "$nome : $($achados.Count) copias (roda a primeira)" -ForegroundColor Yellow
    $achados | ForEach-Object { Write-Host "        $_" -ForegroundColor DarkGray }
  }
}

Write-Host "`nFeche e reabra o PowerShell. Feche o Chrome COMPLETAMENTE e abra de novo." -ForegroundColor Cyan