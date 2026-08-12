const enc = new TextEncoder();

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 28.35;

async function paraBitmapCanvas(arquivo, fundoBranco = false) {
  const bitmap = await createImageBitmap(arquivo);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (fundoBranco) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, bitmap.width, bitmap.height); }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

export async function paraPng(arquivo) {
  return (await paraBitmapCanvas(arquivo)).convertToBlob({ type: 'image/png' });
}

// JPG não tem transparência: sem o fundo branco, o alfa vira preto.
export async function paraJpg(arquivo, qualidade = 0.9) {
  return (await paraBitmapCanvas(arquivo, true)).convertToBlob({ type: 'image/jpeg', quality: qualidade });
}

export async function paraWebp(arquivo, qualidade = 0.85) {
  return (await paraBitmapCanvas(arquivo)).convertToBlob({ type: 'image/webp', quality: qualidade });
}

const ehJpeg = (a) => a.type === 'image/jpeg' || /\.jpe?g$/i.test(a.name || '');

/** CompressionStream('deflate') produz o formato zlib, que é o que /FlateDecode espera. */
async function comprimir(bytes) {
  const fluxo = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

async function prepararImagem(arquivo) {
  const bitmap = await createImageBitmap(arquivo);
  const largura = bitmap.width;
  const altura = bitmap.height;

  // JPEG entra no PDF sem recodificar: arquivo menor e sem perda adicional.
  if (ehJpeg(arquivo)) {
    bitmap.close();
    return { largura, altura, dados: new Uint8Array(await arquivo.arrayBuffer()), filtro: '/DCTDecode' };
  }

  const canvas = new OffscreenCanvas(largura, altura);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, largura, altura);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const rgba = ctx.getImageData(0, 0, largura, altura).data;
  const rgb = new Uint8Array(largura * altura * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) {
    rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2];
  }

  return { largura, altura, dados: await comprimir(rgb), filtro: '/FlateDecode' };
}

/**
 * Monta um PDF do zero: objetos numerados + tabela xref com o byte inicial de cada um.
 * Uma página A4 por imagem, centralizada e escalada mantendo a proporção.
 */
export async function paraPdf(arquivos, aoProgresso) {
  if (!arquivos.length) throw new Error('Nenhuma imagem selecionada.');

  const imagens = [];
  for (let i = 0; i < arquivos.length; i++) {
    imagens.push(await prepararImagem(arquivos[i]));
    aoProgresso?.((i + 1) / arquivos.length);
  }

  const partes = [];
  const offsets = [];
  let tamanho = 0;

  const escrever = (dado) => {
    const bytes = typeof dado === 'string' ? enc.encode(dado) : dado;
    partes.push(bytes);
    tamanho += bytes.length;
  };

  const objeto = (numero, dicionario, fluxo) => {
    offsets[numero] = tamanho;
    escrever(`${numero} 0 obj\n${dicionario}\n`);
    if (fluxo) { escrever('stream\n'); escrever(fluxo); escrever('\nendstream\n'); }
    escrever('endobj\n');
  };

  escrever('%PDF-1.4\n');
  escrever(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // marca o arquivo como binário

  const total = imagens.length;
  const idsPagina = Array.from({ length: total }, (_, i) => 3 + i * 3);

  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objeto(2, `<< /Type /Pages /Kids [${idsPagina.map((id) => `${id} 0 R`).join(' ')}] /Count ${total} >>`);

  for (let i = 0; i < total; i++) {
    const img = imagens[i];
    const idPagina = 3 + i * 3;
    const idConteudo = idPagina + 1;
    const idImagem = idPagina + 2;

    const escala = Math.min(
      (A4.largura - MARGEM * 2) / img.largura,
      (A4.altura - MARGEM * 2) / img.altura
    );
    const w = img.largura * escala;
    const h = img.altura * escala;
    const x = (A4.largura - w) / 2;
    const y = (A4.altura - h) / 2;

    const conteudo = enc.encode(
      `q\n${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`
    );

    objeto(idPagina,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.largura} ${A4.altura}] ` +
      `/Resources << /XObject << /Im0 ${idImagem} 0 R >> >> /Contents ${idConteudo} 0 R >>`);
    objeto(idConteudo, `<< /Length ${conteudo.length} >>`, conteudo);
    objeto(idImagem,
      `<< /Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${img.filtro} /Length ${img.dados.length} >>`,
      img.dados);
  }

  const totalObjetos = 2 + total * 3;
  const inicioXref = tamanho;

  // Cada linha da xref tem exatamente 20 bytes.
  escrever(`xref\n0 ${totalObjetos + 1}\n`);
  escrever('0000000000 65535 f \n');
  for (let n = 1; n <= totalObjetos; n++) {
    escrever(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  }
  escrever(`trailer\n<< /Size ${totalObjetos + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);

  return new Blob(partes, { type: 'application/pdf' });
}