import { criarZip } from './zip.js';
import { escaparXml, escaparHtml } from './utils.js';

const enc = new TextEncoder();
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ------------------------------------------------------------------ DOCX

const paragrafo = (texto, negrito = false) =>
  `<w:p><w:r>${negrito ? '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr>' : ''}` +
  `<w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r></w:p>`;

export function textoParaDocx(texto, titulo = '') {
  const corpo = [];
  if (titulo) corpo.push(paragrafo(titulo, true), '<w:p/>');
  for (const linha of String(texto).split(/\r?\n/)) corpo.push(paragrafo(linha));

  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${corpo.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="${MIME_DOCX}.main+xml"/></Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  // [Content_Types].xml precisa ser a primeira entrada do pacote.
  return criarZip([
    { nome: '[Content_Types].xml', dados: contentTypes },
    { nome: '_rels/.rels', dados: rels },
    { nome: 'word/document.xml', dados: documento },
  ], MIME_DOCX);
}

// ------------------------------------------------------------------ HTML

export function textoParaHtml(texto, titulo = '') {
  const corpo = String(texto)
    .split(/\n{2,}/)
    .map((b) => `<p>${escaparHtml(b).replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  return new Blob([`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${escaparHtml(titulo)}</title>
<style>body{max-width:42rem;margin:2rem auto;padding:0 1rem;font-family:Georgia,serif;line-height:1.65}</style>
</head><body>${titulo ? `<h1>${escaparHtml(titulo)}</h1>` : ''}
${corpo}</body></html>`], { type: 'text/html;charset=utf-8' });
}

// ------------------------------------------------------------------ PDF

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 56;
const CORPO = 11;
const ENTRELINHA = 15;

const LINHAS_POR_PAGINA = Math.floor((A4.altura - MARGEM * 2) / ENTRELINHA);
// Helvetica tem largura média em torno de 0,5 em. Estimativa conservadora.
const COLUNAS = Math.floor((A4.largura - MARGEM * 2) / (CORPO * 0.5));

function quebrar(linha) {
  if (linha.length <= COLUNAS) return [linha];
  const saida = [];
  let atual = '';
  for (const palavra of linha.split(' ')) {
    if (atual && (atual + ' ' + palavra).length > COLUNAS) { saida.push(atual); atual = palavra; }
    else atual = atual ? atual + ' ' + palavra : palavra;
    // Palavra única maior que a linha (URL, por exemplo).
    while (atual.length > COLUNAS) { saida.push(atual.slice(0, COLUNAS)); atual = atual.slice(COLUNAS); }
  }
  if (atual) saida.push(atual);
  return saida;
}

const escaparPdf = (s) =>
  s.replace(/([\\()])/g, '\\$1').replace(/[^\x20-\xFF]/g, '?');

/**
 * Usa Helvetica, uma das 14 fontes que todo leitor de PDF já tem —
 * assim não é preciso embutir arquivo de fonte.
 */
export function textoParaPdf(texto, titulo = '') {
  const linhas = [];
  if (titulo) linhas.push(...quebrar(titulo), '');
  for (const l of String(texto).split(/\r?\n/)) linhas.push(...quebrar(l));

  const paginas = [];
  for (let i = 0; i < linhas.length; i += LINHAS_POR_PAGINA) {
    paginas.push(linhas.slice(i, i + LINHAS_POR_PAGINA));
  }
  if (!paginas.length) paginas.push(['']);

  const partes = [];
  const offsets = [];
  let tamanho = 0;

  const escrever = (d) => {
    const bytes = typeof d === 'string' ? enc.encode(d) : d;
    partes.push(bytes);
    tamanho += bytes.length;
  };
  const objeto = (n, dic, fluxo) => {
    offsets[n] = tamanho;
    escrever(`${n} 0 obj\n${dic}\n`);
    if (fluxo) { escrever('stream\n'); escrever(fluxo); escrever('\nendstream\n'); }
    escrever('endobj\n');
  };

  escrever('%PDF-1.4\n');
  escrever(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // 1 catálogo, 2 páginas, 3 fonte; depois pares página/conteúdo.
  const ids = paginas.map((_, i) => 4 + i * 2);

  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objeto(2, `<< /Type /Pages /Kids [${ids.map((id) => `${id} 0 R`).join(' ')}] /Count ${paginas.length} >>`);
  objeto(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  paginas.forEach((linhasDaPagina, i) => {
    const idPagina = 4 + i * 2;
    const idConteudo = idPagina + 1;

    const corpo =
      `BT\n/F1 ${CORPO} Tf\n${ENTRELINHA} TL\n${MARGEM} ${A4.altura - MARGEM} Td\n` +
      linhasDaPagina.map((l) => `(${escaparPdf(l)}) Tj T*`).join('\n') +
      '\nET\n';

    // latin1: WinAnsiEncoding cobre os acentos do português.
    const bytes = Uint8Array.from(corpo, (c) => c.charCodeAt(0) & 0xff);

    objeto(idPagina,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.largura} ${A4.altura}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${idConteudo} 0 R >>`);
    objeto(idConteudo, `<< /Length ${bytes.length} >>`, bytes);
  });

  const totalObjetos = 3 + paginas.length * 2;
  const inicioXref = tamanho;

  escrever(`xref\n0 ${totalObjetos + 1}\n`);
  escrever('0000000000 65535 f \n');
  for (let n = 1; n <= totalObjetos; n++) {
    escrever(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  }
  escrever(`trailer\n<< /Size ${totalObjetos + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);

  return new Blob(partes, { type: 'application/pdf' });
}