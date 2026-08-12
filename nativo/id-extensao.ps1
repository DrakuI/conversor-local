# Calcula o ID da extensao a partir do campo "key" do manifest.json.
# Carregado com dot-source pelos instaladores:  . "$pasta\id-extensao.ps1"
#
# O ID e derivado da chave publica: SHA-256 do DER, primeiros 16 bytes,
# cada nibble mapeado para uma letra de 'a' a 'p'.

function Get-IdExtensao([string]$manifestPath) {
  if (-not (Test-Path $manifestPath)) { return $null }

  $texto = [IO.File]::ReadAllText($manifestPath, (New-Object System.Text.UTF8Encoding($false)))
  $m = [regex]::Match($texto, '"key"\s*:\s*"([^"]+)"')
  if (-not $m.Success) { return $null }

  try { $der = [Convert]::FromBase64String($m.Groups[1].Value) } catch { return $null }

  $hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($der)
  $sb = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt 16; $i++) {
    [void]$sb.Append([char](97 + ($hash[$i] -shr 4)))
    [void]$sb.Append([char](97 + ($hash[$i] -band 0x0F)))
  }
  return $sb.ToString()
}
