<#
  Gera o par de chaves da extensao e fixa o ID.

  RODE UMA VEZ SO. Rodar de novo gera uma chave nova e muda o ID,
  obrigando a reinstalar a ponte nativa em todas as maquinas.

  O que faz:
    - gera um par RSA-2048
    - grava a chave privada em nativo\chave-privada.pem (NAO distribua)
    - insere a chave publica no campo "key" do manifest.json (pode distribuir)
    - imprime o ID resultante

  Uso:  .\nativo\gerar-chave.ps1
#>

$ErrorActionPreference = 'Stop'
$pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
$raiz  = Split-Path -Parent $pasta

$manifestPath = Join-Path $raiz 'manifest.json'
$pemPath      = Join-Path $pasta 'chave-privada.pem'

if (-not (Test-Path $manifestPath)) {
  Write-Host "manifest.json nao encontrado em $raiz" -ForegroundColor Red
  exit 1
}

if (Test-Path $pemPath) {
  Write-Host 'Ja existe nativo\chave-privada.pem.' -ForegroundColor Yellow
  Write-Host 'Gerar outra muda o ID e quebra as instalacoes existentes.' -ForegroundColor Yellow
  if ((Read-Host 'Digite SIM para gerar mesmo assim') -ne 'SIM') {
    Write-Host 'Cancelado.' -ForegroundColor DarkGray
    exit 0
  }
  Copy-Item $pemPath "$pemPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
}

# ============================================================ codificacao DER
# .NET Framework 4.x (Windows PowerShell 5.1) nao tem ExportSubjectPublicKeyInfo,
# entao a estrutura ASN.1 e montada na mao a partir dos parametros do RSA.

function New-DerLength([int]$n) {
  if ($n -lt 0x80) { return [byte[]]@([byte]$n) }
  $lista = New-Object System.Collections.Generic.List[byte]
  $v = $n
  while ($v -gt 0) { $lista.Insert(0, [byte]($v -band 0xFF)); $v = $v -shr 8 }
  return [byte[]](@([byte](0x80 -bor $lista.Count)) + $lista.ToArray())
}

function New-DerTlv([byte]$tag, [byte[]]$conteudo) {
  return [byte[]](@($tag) + (New-DerLength $conteudo.Length) + $conteudo)
}

function New-DerInteger([byte[]]$valor) {
  # DER exige INTEGER sem zeros a esquerda e com 0x00 na frente se o bit alto estiver ligado.
  $i = 0
  while ($i -lt ($valor.Length - 1) -and $valor[$i] -eq 0) { $i++ }
  $v = [byte[]]$valor[$i..($valor.Length - 1)]
  if ($v[0] -ge 0x80) { $v = [byte[]](@([byte]0) + $v) }
  return (New-DerTlv 0x02 $v)
}

function Format-Pem([byte[]]$der, [string]$rotulo) {
  $b64 = [Convert]::ToBase64String($der)
  $linhas = @()
  for ($i = 0; $i -lt $b64.Length; $i += 64) {
    $linhas += $b64.Substring($i, [Math]::Min(64, $b64.Length - $i))
  }
  return "-----BEGIN $rotulo-----`n" + ($linhas -join "`n") + "`n-----END $rotulo-----`n"
}

# ============================================================ gerar o par

Write-Host 'Gerando par RSA-2048...' -ForegroundColor Cyan

$rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider 2048
$pub = $rsa.ExportParameters($false)
$prv = $rsa.ExportParameters($true)

# SubjectPublicKeyInfo: SEQUENCE { AlgorithmIdentifier, BIT STRING { RSAPublicKey } }
$rsaPublicKey = New-DerTlv 0x30 ([byte[]]((New-DerInteger $pub.Modulus) + (New-DerInteger $pub.Exponent)))
$bitString    = New-DerTlv 0x03 ([byte[]](@([byte]0) + $rsaPublicKey))
$algId        = [byte[]]@(0x30,0x0D,0x06,0x09,0x2A,0x86,0x48,0x86,0xF7,0x0D,0x01,0x01,0x01,0x05,0x00)
$spki         = New-DerTlv 0x30 ([byte[]]($algId + $bitString))

# RSAPrivateKey (PKCS#1): version, n, e, d, p, q, dp, dq, qinv
$corpoPrivado = [byte[]](
  (New-DerInteger ([byte[]]@(0))) +
  (New-DerInteger $prv.Modulus)   +
  (New-DerInteger $prv.Exponent)  +
  (New-DerInteger $prv.D)         +
  (New-DerInteger $prv.P)         +
  (New-DerInteger $prv.Q)         +
  (New-DerInteger $prv.DP)        +
  (New-DerInteger $prv.DQ)        +
  (New-DerInteger $prv.InverseQ)
)
$pkcs1 = New-DerTlv 0x30 $corpoPrivado

$rsa.Dispose()

# ============================================================ ID

$chave = [Convert]::ToBase64String($spki)

$hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($spki)
$sb = New-Object System.Text.StringBuilder
for ($i = 0; $i -lt 16; $i++) {
  # Cada nibble do hash vira uma letra de 'a' a 'p'.
  [void]$sb.Append([char](97 + ($hash[$i] -shr 4)))
  [void]$sb.Append([char](97 + ($hash[$i] -band 0x0F)))
}
$id = $sb.ToString()

# ============================================================ gravar

# Sem BOM: o Chrome rejeita manifest.json com marca de ordem de bytes.
$semBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($pemPath, (Format-Pem $pkcs1 'RSA PRIVATE KEY'), $semBom)

$texto = [IO.File]::ReadAllText($manifestPath, $semBom)

if ($texto -match '"key"\s*:\s*"[^"]*"') {
  $texto = $texto -replace '"key"\s*:\s*"[^"]*"', ('"key": "' + $chave + '"')
  $acao = 'atualizado'
} elseif ($texto -match '"manifest_version"\s*:\s*3\s*,') {
  $texto = $texto -replace '("manifest_version"\s*:\s*3\s*,)', ('$1' + "`r`n  `"key`": `"$chave`",")
  $acao = 'inserido'
} else {
  Write-Host 'Nao achei "manifest_version": 3 no manifest. Adicione o campo "key" na mao:' -ForegroundColor Red
  Write-Host "  `"key`": `"$chave`"," -ForegroundColor Cyan
  exit 1
}

[IO.File]::WriteAllText($manifestPath, $texto, $semBom)

# ============================================================ resumo

Write-Host ''
Write-Host "Campo key $acao no manifest.json." -ForegroundColor Green
Write-Host "Chave privada em: $pemPath" -ForegroundColor Green
Write-Host ''
Write-Host 'ID FIXO DA EXTENSAO:' -ForegroundColor Cyan
Write-Host "  $id" -ForegroundColor White
Write-Host ''
Write-Host 'A partir de agora esse ID e o mesmo em qualquer maquina e qualquer pasta.' -ForegroundColor DarkGray
Write-Host ''
Write-Host 'NAO distribua chave-privada.pem. Guarde uma copia fora da pasta da extensao' -ForegroundColor Yellow
Write-Host 'e nao versione o arquivo (adicione ao .gitignore).' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Proximos passos:' -ForegroundColor Cyan
Write-Host '  1. Remova a extensao antiga em chrome://extensions (o ID mudou)'
Write-Host '  2. Carregue sem compactacao de novo'
Write-Host '  3. Rode .\nativo\instalar.ps1'
