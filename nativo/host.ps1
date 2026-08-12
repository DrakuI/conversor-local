# Host de Native Messaging. Recebe {acao, url, tipo} da extensão e roda o yt-dlp.
# A extensão NÃO envia comando: os perfis abaixo são a única coisa executável.
#
# Protocolo: cada mensagem = 4 bytes little-endian com o tamanho + JSON em UTF-8.
# Nada além de Enviar() pode escrever em stdout, ou o canal corrompe.

$ErrorActionPreference = 'Stop'
$PastaDestino = Join-Path $HOME 'Videos'

$stdin  = [Console]::OpenStandardInput()
$stdout = [Console]::OpenStandardOutput()

function Enviar($obj) {
  $json  = $obj | ConvertTo-Json -Compress -Depth 6
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $stdout.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

function Receber {
  $cab = New-Object byte[] 4
  $lidos = 0
  while ($lidos -lt 4) {
    $n = $stdin.Read($cab, $lidos, 4 - $lidos)
    if ($n -le 0) { return $null }
    $lidos += $n
  }
  $tam = [BitConverter]::ToInt32($cab, 0)
  if ($tam -le 0 -or $tam -gt 1048576) { return $null }

  $buf = New-Object byte[] $tam
  $lidos = 0
  while ($lidos -lt $tam) {
    $n = $stdin.Read($buf, $lidos, $tam - $lidos)
    if ($n -le 0) { return $null }
    $lidos += $n
  }
  return [Text.Encoding]::UTF8.GetString($buf) | ConvertFrom-Json
}

function Achar($nome) {
  $cmd = Get-Command $nome -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  # O PATH herdado do Chrome pode estar desatualizado; procura nos locais padrão.
  foreach ($p in @(
    (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\$nome.exe"),
    (Join-Path $env:USERPROFILE "scoop\shims\$nome.exe"),
    "C:\ProgramData\chocolatey\bin\$nome.exe"
  )) { if (Test-Path $p) { return $p } }
  return $null
}

# Única lista de argumentos executáveis. A extensão só escolhe a chave.
$PERFIS = @{
  video  = @('-f','bv*+ba/b','--merge-output-format','mp4')
  som    = @('-x','--audio-format','mp3','--audio-quality','0','--embed-thumbnail','--embed-metadata')
  imagem = @('--write-thumbnail','--convert-thumbnails','jpg','--skip-download')
  texto  = @('--write-subs','--write-auto-subs','--sub-langs','pt.*,en.*','--convert-subs','srt','--skip-download')
}
$PastaMusica = Join-Path $HOME 'Music'

$MODELO_SAIDA = '%(playlist_title&{}/|)s%(playlist_index&{} - |)s%(title)s.%(ext)s'

while ($true) {
  $msg = Receber
  if ($null -eq $msg) { break }

  try {
    if ($msg.acao -eq 'verificar') {
      Enviar @{
        tipo   = 'info'
        ytdlp  = [bool](Achar 'yt-dlp')
        ffmpeg = [bool](Achar 'ffmpeg')
		spotdl = [bool](Achar 'spotdl')
        pasta  = $PastaDestino
      }
      continue
    }
	if ($msg.acao -eq 'spotdl') {
      # Normaliza: descarta a query string (?si=, &dlsi=, &autoplay_ok=) e
      # o segmento de idioma (/intl-pt/) que o app insere ao compartilhar.
      $url = ([string]$msg.url -split '\?')[0]
      $url = $url -replace '/intl-[A-Za-z\-]+/', '/'

      if ($url -notmatch '^https://open\.spotify\.com/(track|album|playlist|artist|show|episode)/[A-Za-z0-9]+$') {
        Enviar @{ tipo='erro'; mensagem='URL do Spotify nao reconhecida.' }; continue
      }

      $exe = Achar 'spotdl'
      if (-not $exe) {
        Enviar @{ tipo='erro'; mensagem='spotdl não encontrado. Instale com: pip install spotdl' }
        continue
      }

      New-Item -ItemType Directory -Force -Path $PastaMusica | Out-Null

      $argumentos = @(
        'download', $url,
        '--output', (Join-Path $PastaMusica '{artist}/{album}/{title}.{output-ext}'),
        '--format', 'mp3',
        '--bitrate', '320k'
      )

      Enviar @{ tipo='inicio'; comando = "spotdl $($argumentos -join ' ')" }
      & $exe @argumentos 2>&1 | ForEach-Object { Enviar @{ tipo='log'; linha = [string]$_ } }
      Enviar @{ tipo='fim'; codigo = $LASTEXITCODE }
      continue
    }
    if ($msg.acao -ne 'baixar') {
      Enviar @{ tipo='erro'; mensagem='Ação desconhecida.' }; continue
    }

    $perfil = [string]$msg.tipo
    if (-not $PERFIS.ContainsKey($perfil)) {
      Enviar @{ tipo='erro'; mensagem='Tipo fora da lista permitida.' }; continue
    }

    # Só http/https e caracteres válidos de URL. Nada de aspas, ponto e vírgula, crase.
    $url = [string]$msg.url
    if ($url.Length -gt 2000 -or $url -notmatch '^https?://[A-Za-z0-9\-._~:/?#\[\]@!$&''()*+,;=%]+$') {
      Enviar @{ tipo='erro'; mensagem='URL rejeitada pela validação.' }; continue
    }

    $exe = Achar 'yt-dlp'
    if (-not $exe) {
      Enviar @{ tipo='erro'; mensagem='yt-dlp não encontrado. Instale com: winget install yt-dlp.yt-dlp' }
      continue
    }

    New-Item -ItemType Directory -Force -Path $PastaDestino | Out-Null

    $argumentos = @($PERFIS[$perfil]) + @(
      '--yes-playlist',        # URL com &list= baixa a lista inteira
      '-i',                    # item removido/privado não derruba o resto
      '--newline',             # progresso em linhas, não sobrescrevendo com \r
      '--no-colors',
      '--download-archive', (Join-Path $PastaDestino "baixados-$perfil.txt"),
      '-P', $PastaDestino,
      '-o', $MODELO_SAIDA,
      $url
    )

    Enviar @{ tipo='inicio'; comando = "yt-dlp $($argumentos -join ' ')" }

    # O operador & com array passa cada item como argumento separado: sem concatenar string.
    & $exe @argumentos 2>&1 | ForEach-Object { Enviar @{ tipo='log'; linha = [string]$_ } }

    Enviar @{ tipo='fim'; codigo = $LASTEXITCODE }
  }
  catch {
    Enviar @{ tipo='erro'; mensagem = $_.Exception.Message }
  }
}