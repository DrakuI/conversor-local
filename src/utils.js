export async function arquivoParaBytes(arquivo) {
  return new Uint8Array(await arquivo.arrayBuffer());
}

export function trocarExtensao(nome, novaExtensao) {
  return String(nome || 'arquivo').replace(/\.[^./\\]+$/, '') + '.' + novaExtensao;
}

export function extensaoDe(nome, padrao = 'bin') {
  return (/\.([A-Za-z0-9]+)$/.exec(String(nome || '')) || [, padrao])[1].toLowerCase();
}

export function escaparXml(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function escaparHtml(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Remove caracteres proibidos em nome de arquivo no Windows e limita o tamanho. */
export function nomeSeguro(texto, padrao = 'arquivo') {
  const limpo = String(texto || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
  return limpo || padrao;
}

export const mb = (bytes) => (bytes / 1048576).toFixed(1);