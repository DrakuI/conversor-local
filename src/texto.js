import { lerZip } from './zip.js';
import { extensaoDe } from './utils.js';

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const desescapar = (s) =>
  s.replace(/&(?:([a-z]+)|#(\d+)|#x([0-9a-f]+));/gi, (m, nome, dec, hex) => {
    if (nome) return ENTIDADES[nome.toLowerCase()] ?? m;
    return String.fromCodePoint(parseInt(dec || hex, dec ? 10 : 16));
  });

/** Remove marcação preservando quebras onde havia bloco. */
function tirarTags(marcacao) {
  return desescapar(
    marcacao
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  ).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ------------------------------------------------------------------ PDF

async function inflar(bytes) {
  for (const formato of ['deflate', 'deflate-raw']) {
    try {
      const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(formato));
      return new Uint8Array(await new Response(fluxo).arrayBuffer());
    } catch { /* tenta o próximo */ }
  }
  return null;
}

function decodificarLiteral(s) {
  const mapa = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (m, g) =>
    mapa[g] !== undefined ? mapa[g] : String.fromCharCode(parseInt(g, 8))
  );
}

/** Lê os operadores de texto de um fluxo de conteúdo PDF. */
function operadoresDeTexto(conteudo) {
  let saida = '';
  const re = /(\((?:\\.|[^\\()])*\))\s*Tj|(\[[^\]]*\])\s*TJ|\bT\*|\bTd\b|\bTD\b/g;
  let m;

  while ((m = re.exec(conteudo))) {
    if (m[1]) {
      saida += decodificarLiteral(m[1].slice(1, -1));
    } else if (m[2]) {
      // Array do TJ: strings intercaladas com ajustes de kerning.
      for (const t of m[2].matchAll(/\((?:\\.|[^\\()])*\)|-?\d+(?:\.\d+)?/g)) {
        if (t[0][0] === '(') saida += decodificarLiteral(t[0].slice(1, -1));
        else if (Number(t[0]) < -150) saida += ' ';
      }
    } else {
      saida += '\n';
    }
  }
  return saida;
}

async function pdfParaTexto(arquivo) {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  // latin1: 1 byte = 1 caractere, então índices de string e de byte coincidem.
  const cru = new TextDecoder('latin1').decode(bytes);
  const partes = [];
  let i = 0;

  for (;;) {
    const marca = cru.indexOf('stream', i);
    if (marca < 0) break;

    const dicionario = cru.slice(Math.max(0, marca - 500), marca);
    let inicio = marca + 6;
    if (cru[inicio] === '\r') inicio++;
    if (cru[inicio] === '\n') inicio++;

    const fim = cru.indexOf('endstream', inicio);
    if (fim < 0) break;
    i = fim + 9;

    if (!/\/FlateDecode/.test(dicionario)) continue;
    if (/\/Subtype\s*\/Image|\/FontFile|\/Metadata/.test(dicionario)) continue;

    const inflado = await inflar(bytes.subarray(inicio, fim));
    if (inflado) partes.push(new TextDecoder('latin1').decode(inflado));
  }

  const texto = partes.map(operadoresDeTexto).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!texto) {
    throw new Error('Sem camada de texto. PDF escaneado precisa de OCR, que esta extensão não faz.');
  }
  return texto;
}

// ------------------------------------------------------------------ DOCX / EPUB

async function docxParaTexto(arquivo) {
  const zip = await lerZip(arquivo);
  const xml = await zip.texto('word/document.xml');
  if (!xml) throw new Error('Não achei word/document.xml. O arquivo não parece um .docx.');

  return desescapar(
    xml
      .replace(/<w:p(?=[ >/])/g, '\n<w:p')
      .replace(/<w:tab\s*\/>/g, '\t')
      .replace(/<w:br\s*\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
  ).replace(/\n{3,}/g, '\n\n').trim();
}

async function epubParaTexto(arquivo) {
  const zip = await lerZip(arquivo);

  // A ordem de leitura está no spine do OPF, não na ordem alfabética dos arquivos.
  let capitulos = null;
  const container = await zip.texto('META-INF/container.xml');
  const caminhoOpf = /full-path="([^"]+)"/.exec(container || '')?.[1];

  if (caminhoOpf) {
    const opf = await zip.texto(caminhoOpf);
    const base = caminhoOpf.includes('/') ? caminhoOpf.replace(/\/[^/]+$/, '/') : '';
    const manifesto = new Map(
      [...(opf || '').matchAll(/<item\b[^>]*>/g)].map((t) => [
        /id="([^"]+)"/.exec(t[0])?.[1],
        /href="([^"]+)"/.exec(t[0])?.[1],
      ])
    );
    capitulos = [...(opf || '').matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)]
      .map((m) => manifesto.get(m[1]))
      .filter(Boolean)
      .map((h) => base + h.replace(/^\.\//, ''));
  }

  if (!capitulos?.length) {
    capitulos = zip.nomes().filter((n) => /\.x?html?$/i.test(n)).sort();
  }

  const blocos = [];
  for (const nome of capitulos) {
    const html = await zip.texto(nome);
    if (html) blocos.push(tirarTags(html));
  }
  if (!blocos.length) throw new Error('Nenhum capítulo legível encontrado no EPUB.');
  return blocos.join('\n\n');
}

// ------------------------------------------------------------------ legendas

function legendaParaTexto(bruto) {
  const linhas = bruto
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      if (!t) return false;
      if (/^WEBVTT/.test(t)) return false;
      if (/^\d+$/.test(t)) return false;                        // índice do bloco
      if (/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(t)) return false; // tempo
      if (/^(NOTE|STYLE|Kind:|Language:)/.test(t)) return false;
      return true;
    })
    .map((l) => l.replace(/<[^>]+>/g, '').trim());

  // Legenda automática repete a linha anterior a cada quadro.
  const saida = [];
  for (const l of linhas) if (l !== saida[saida.length - 1]) saida.push(l);
  return saida.join('\n');
}

// ------------------------------------------------------------------ despacho

export function ehDocumento(nome) {
  return /^(pdf|docx|epub|srt|vtt|json|txt|md|markdown|html?|xml|csv|log)$/.test(extensaoDe(nome));
}

/** @returns {Promise<string>} */
export async function extrairTexto(arquivo) {
  const ext = extensaoDe(arquivo.name);

  if (ext === 'pdf') return pdfParaTexto(arquivo);
  if (ext === 'docx') return docxParaTexto(arquivo);
  if (ext === 'epub') return epubParaTexto(arquivo);

  const bruto = await arquivo.text();

  if (ext === 'srt' || ext === 'vtt') return legendaParaTexto(bruto);
  if (ext === 'json') {
    try { return JSON.stringify(JSON.parse(bruto), null, 2); } catch { return bruto; }
  }
  if (ext === 'html' || ext === 'htm' || ext === 'xml') return tirarTags(bruto);

  return bruto;
}