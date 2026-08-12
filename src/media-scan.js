/**
 * Executado dentro da página pelo chrome.scripting.executeScript.
 * Precisa ser autossuficiente: sem imports, sem referências a escopo externo.
 * O retorno tem de ser serializável em JSON.
 *
 * @param {'video'|'imagem'|'som'|'texto'} tipo
 */
export function escanear(tipo) {
  const abs = (u) => { try { return u ? new URL(u, location.href).href : null; } catch { return null; } };
  const meta = (n) =>
    document.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.getAttribute('content') || null;

  const itens = [];
  const add = (url, rotulo, peso = 0) => {
    if (!url || url.startsWith('data:')) return;
    if (itens.some((i) => i.url === url)) return;
    itens.push({ url, rotulo, peso, bloqueado: url.startsWith('blob:') });
  };

  // URLs de mídia costumam estar cravadas em blobs JSON dentro da página,
  // às vezes com as barras escapadas (https:\/\/...).
  const varrer = (regex, rotulo) => {
    for (const m of document.documentElement.innerHTML.matchAll(regex)) {
      add(m[0].replace(/\\\//g, '/'), rotulo, 1);
    }
  };

  const RE_VIDEO = /https?:\\?\/\\?\/[^\s"'<>\\)]+\.(?:mp4|webm|m3u8|mov)(?:\?[^\s"'<>\\)]*)?/gi;
  const RE_AUDIO = /https?:\\?\/\\?\/[^\s"'<>\\)]+\.(?:mp3|m4a|aac|ogg|opus|wav)(?:\?[^\s"'<>\\)]*)?/gi;

  const base = { titulo: document.title || location.hostname, url: location.href, itens: [], texto: '' };

  if (tipo === 'texto') {
    let t = '';
    try { t = document.body?.innerText || ''; } catch { t = ''; }
    if (!t.trim() && document.body) {
      const copia = document.body.cloneNode(true);
      copia.querySelectorAll('script,style,noscript,template,svg').forEach((e) => e.remove());
      t = copia.textContent || '';
    }
    base.texto = t.replace(/\n{3,}/g, '\n\n').trim();
    return base;
  }

  if (tipo === 'imagem') {
    // og:image quase sempre aponta para a versão original, não para a miniatura.
    add(abs(meta('og:image') || meta('twitter:image')), 'imagem principal', Number.MAX_SAFE_INTEGER);

    for (const img of document.querySelectorAll('img')) {
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      add(abs(img.currentSrc || img.src), `${w || '?'}×${h || '?'}`, w * h);
    }

    for (const s of document.querySelectorAll('picture source[srcset], img[srcset]')) {
      const candidatos = (s.getAttribute('srcset') || '').split(',');
      const maior = candidatos[candidatos.length - 1]?.trim().split(/\s+/)[0];
      add(abs(maior), 'srcset', 2);
    }

    for (const el of document.querySelectorAll('[style*="background-image"]')) {
      const m = /url\(["']?([^"')]+)/.exec(el.getAttribute('style') || '');
      add(abs(m?.[1]), 'fundo CSS', 1);
    }
  }

  if (tipo === 'video') {
    add(abs(meta('og:video:secure_url') || meta('og:video') || meta('twitter:player:stream')),
        'vídeo principal', Number.MAX_SAFE_INTEGER);

    for (const v of document.querySelectorAll('video')) {
      add(abs(v.currentSrc || v.getAttribute('src')), 'elemento <video>', 1000);
      for (const s of v.querySelectorAll('source')) add(abs(s.getAttribute('src')), '<source>', 900);
    }
    varrer(RE_VIDEO, 'no código da página');
  }

  if (tipo === 'som') {
    for (const a of document.querySelectorAll('audio')) {
      add(abs(a.currentSrc || a.getAttribute('src')), 'elemento <audio>', 1000);
      for (const s of a.querySelectorAll('source')) add(abs(s.getAttribute('src')), '<source>', 900);
    }
    varrer(RE_AUDIO, 'áudio no código da página');

    // Sem faixa de áudio isolada, o vídeo serve de origem e o áudio é extraído depois.
    for (const v of document.querySelectorAll('video')) {
      add(abs(v.currentSrc || v.getAttribute('src')), 'extrair do vídeo', 10);
    }
    varrer(RE_VIDEO, 'extrair do vídeo');
  }

  base.itens = itens.sort((a, b) => b.peso - a.peso).slice(0, 25);
  return base;
}