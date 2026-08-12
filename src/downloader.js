export function ehHls(url) {
  return /\.m3u8(\?|#|$)/i.test(url);
}

export function ehArquivoDireto(url) {
  return /\.(mp4|webm|mkv|mov|m3u8|mp3|m4a|aac|ogg|opus|wav|flac|jpe?g|png|gif|webp|avif|svg|pdf)(\?|#|$)/i.test(url);
}

export function nomeDaUrl(url, resposta = null) {
  const cd = resposta?.headers.get('content-disposition') || '';
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
  if (m) {
    try { return decodeURIComponent(m[1].trim()); } catch { return m[1].trim(); }
  }
  try {
    const nome = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    if (nome.includes('.')) return nome;
  } catch { /* cai no padrão */ }
  return 'download.bin';
}

/** Concede permissão de host apenas para a origem desta URL. */
export async function pedirPermissao(url) {
  const origens = [new URL(url).origin + '/*'];
  if (await chrome.permissions.contains({ origins: origens })) return true;
  return chrome.permissions.request({ origins: origens });
}

export async function baixarArquivo(url, aoProgresso, sinal) {
  const resposta = await fetch(url, { signal: sinal });
  if (!resposta.ok) {
    throw new Error(`HTTP ${resposta.status}. O link pode ter expirado ou exigir login.`);
  }

  const total = Number(resposta.headers.get('content-length')) || 0;
  const leitor = resposta.body.getReader();
  const pedacos = [];
  let recebidos = 0;

  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    pedacos.push(value);
    recebidos += value.length;
    aoProgresso?.(total ? recebidos / total : -1, recebidos, total);
  }

  return {
    blob: new Blob(pedacos, { type: resposta.headers.get('content-type') || '' }),
    nome: nomeDaUrl(url, resposta),
  };
}

async function lerTexto(url, sinal) {
  const r = await fetch(url, { signal: sinal });
  if (!r.ok) throw new Error(`HTTP ${r.status} ao ler a playlist.`);
  return r.text();
}

/** Baixa uma playlist HLS e concatena os segmentos. Não lida com streams criptografados. */
export async function baixarHls(url, aoProgresso, sinal, aoLog) {
  let playlistUrl = url;
  let texto = await lerTexto(playlistUrl, sinal);

  if (texto.includes('#EXT-X-STREAM-INF')) {
    const linhas = texto.split(/\r?\n/);
    let melhor = null;
    let maiorBanda = -1;

    for (let i = 0; i < linhas.length; i++) {
      if (!linhas[i].startsWith('#EXT-X-STREAM-INF')) continue;
      const banda = Number(/BANDWIDTH=(\d+)/.exec(linhas[i])?.[1] || 0);
      const destino = (linhas[i + 1] || '').trim();
      if (destino && !destino.startsWith('#') && banda > maiorBanda) {
        maiorBanda = banda;
        melhor = destino;
      }
    }

    if (!melhor) throw new Error('Playlist mestre sem variantes utilizáveis.');
    playlistUrl = new URL(melhor, playlistUrl).href;
    aoLog?.(`Qualidade escolhida: ~${Math.round(maiorBanda / 1000)} kbps`);
    texto = await lerTexto(playlistUrl, sinal);
  }

  if (/#EXT-X-KEY:(?!.*METHOD=NONE)/.test(texto)) {
    throw new Error('Stream criptografado (AES/DRM).');
  }

  const segmentos = [];
  const mapa = /#EXT-X-MAP:[^\n]*URI="([^"]+)"/.exec(texto);
  if (mapa) segmentos.push(new URL(mapa[1], playlistUrl).href);

  for (const linha of texto.split(/\r?\n/)) {
    const l = linha.trim();
    if (l && !l.startsWith('#')) segmentos.push(new URL(l, playlistUrl).href);
  }
  if (!segmentos.length) throw new Error('Nenhum segmento encontrado na playlist.');

  aoLog?.(`${segmentos.length} segmentos.`);

  const pedacos = [];
  for (let i = 0; i < segmentos.length; i++) {
    const r = await fetch(segmentos[i], { signal: sinal });
    if (!r.ok) throw new Error(`Falha no segmento ${i + 1}/${segmentos.length} (HTTP ${r.status}).`);
    pedacos.push(new Uint8Array(await r.arrayBuffer()));
    aoProgresso?.((i + 1) / segmentos.length, i + 1, segmentos.length);
  }

  return { blob: new Blob(pedacos), nome: mapa ? 'stream.mp4' : 'stream.ts' };
}