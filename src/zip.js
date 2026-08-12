const enc = new TextEncoder();

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP pelo método "store". Suficiente para OOXML. */
export function criarZip(entradas, mimeType = 'application/zip') {
  const agora = new Date();
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
  const data = (((agora.getFullYear() - 1980) & 0x7f) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();

  const locais = [];
  const central = [];
  let deslocamento = 0;

  for (const entrada of entradas) {
    const nome = enc.encode(entrada.nome);
    const dados = typeof entrada.dados === 'string' ? enc.encode(entrada.dados) : entrada.dados;
    const crc = crc32(dados);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(10, hora, true);
    local.setUint16(12, data, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dados.length, true);
    local.setUint32(22, dados.length, true);
    local.setUint16(26, nome.length, true);
    locais.push(new Uint8Array(local.buffer), nome, dados);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(12, hora, true);
    cd.setUint16(14, data, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, dados.length, true);
    cd.setUint32(24, dados.length, true);
    cd.setUint16(28, nome.length, true);
    cd.setUint32(42, deslocamento, true);
    central.push(new Uint8Array(cd.buffer), nome);

    deslocamento += 30 + nome.length + dados.length;
  }

  let tamanhoCentral = 0;
  for (const p of central) tamanhoCentral += p.length;

  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, entradas.length, true);
  fim.setUint16(10, entradas.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, deslocamento, true);

  return new Blob([...locais, ...central, new Uint8Array(fim.buffer)], { type: mimeType });
}

/**
 * Leitor de ZIP. Suporta store e deflate (DOCX e EPUB usam deflate).
 * Descompressão via DecompressionStream, nativo do navegador.
 */
export async function lerZip(arquivo) {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // O fim do diretório central fica nos últimos 64 KB; varre de trás para frente.
  let eocd = -1;
  const limite = Math.max(0, bytes.length - 65558);
  for (let i = bytes.length - 22; i >= limite; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Não parece um arquivo ZIP válido.');

  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entradas = new Map();

  for (let n = 0; n < total; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) break;

    const metodo = dv.getUint16(p + 10, true);
    const tamComprimido = dv.getUint32(p + 20, true);
    const tamNome = dv.getUint16(p + 28, true);
    const tamExtra = dv.getUint16(p + 30, true);
    const tamComentario = dv.getUint16(p + 32, true);
    const offsetLocal = dv.getUint32(p + 42, true);
    const nome = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + tamNome));

    // O cabeçalho local repete nome e extra com tamanhos próprios.
    const nl = dv.getUint16(offsetLocal + 26, true);
    const el = dv.getUint16(offsetLocal + 28, true);
    const inicio = offsetLocal + 30 + nl + el;

    entradas.set(nome, { metodo, dados: bytes.subarray(inicio, inicio + tamComprimido) });
    p += 46 + tamNome + tamExtra + tamComentario;
  }

  return {
    nomes: () => [...entradas.keys()],
    async texto(nome) {
      const e = entradas.get(nome);
      if (!e) return null;
      if (e.metodo === 0) return new TextDecoder().decode(e.dados);
      const fluxo = new Blob([e.dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(fluxo).text();
    },
  };
}