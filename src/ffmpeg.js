import { FFmpeg } from '../vendor/ffmpeg/index.js';
import { arquivoParaBytes, extensaoDe } from './utils.js';

let instancia = null;
let carregando = null;
let aoProgresso = null;
let aoLog = null;

export function configurarCallbacks({ progresso, log } = {}) {
  aoProgresso = progresso || null;
  aoLog = log || null;
}

/**
 * Carrega o núcleo WebAssembly a partir dos arquivos locais da extensão.
 * Sem os três caminhos explícitos a biblioteca tentaria um CDN, o que o MV3 bloqueia.
 */
export async function carregarFFmpeg() {
  if (instancia) return instancia;
  if (carregando) return carregando;

  carregando = (async () => {
    const ff = new FFmpeg();
    ff.on('log', ({ message }) => aoLog?.(message));
    ff.on('progress', ({ progress }) =>
      aoProgresso?.(Math.min(1, Math.max(0, Number(progress) || 0)))
    );

    await ff.load({
      classWorkerURL: chrome.runtime.getURL('vendor/ffmpeg/worker.js'),
      coreURL: chrome.runtime.getURL('vendor/core/ffmpeg-core.js'),
      wasmURL: chrome.runtime.getURL('vendor/core/ffmpeg-core.wasm'),
    });

    instancia = ff;
    return ff;
  })();

  try {
    return await carregando;
  } finally {
    carregando = null;
  }
}

/**
 * @param {File}   arquivo
 * @param {object} receita  { saida, ext, tipo, passos[], temporarios[] }
 * @param {object} opcoes   parâmetros da receita (fps, largura, início, duração)
 */
export async function converter(arquivo, receita, opcoes = {}) {
  const ff = await carregarFFmpeg();
  const entrada = `entrada.${extensaoDe(arquivo.name)}`;

  await ff.writeFile(entrada, await arquivoParaBytes(arquivo));
  try {
    // Receitas de GIF rodam em dois passos: gerar paleta, depois aplicar.
    for (const montar of receita.passos) {
      await ff.exec(montar(entrada, receita.saida, opcoes));
    }

    const bytes = await ff.readFile(receita.saida);
    if (!bytes?.length) {
      throw new Error('O ffmpeg não gerou saída. Formato de entrada possivelmente não suportado.');
    }
    return bytes;
  } finally {
    for (const f of [entrada, receita.saida, ...(receita.temporarios || [])]) {
      await ff.deleteFile(f).catch(() => {});
    }
  }
}

/** -ss e -t antes do -i limitam a leitura na origem: muito mais rápido. */
const recorte = (o) => {
  const args = [];
  if (Number(o.inicio) > 0) args.push('-ss', String(o.inicio));
  if (Number(o.duracao) > 0) args.push('-t', String(o.duracao));
  return args;
};

const escalaGif = (o) => `fps=${o.fps || 12},scale=${o.largura || 480}:-1:flags=lanczos`;

export const RECEITAS = {
  mp3: {
    saida: 'saida.mp3', ext: 'mp3', tipo: 'audio/mpeg',
    passos: [(e, s) => ['-i', e, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', s]],
  },
  wav: {
    saida: 'saida.wav', ext: 'wav', tipo: 'audio/wav',
    passos: [(e, s) => ['-i', e, '-vn', '-c:a', 'pcm_s16le', s]],
  },
  ogg: {
    saida: 'saida.ogg', ext: 'ogg', tipo: 'audio/ogg',
    passos: [(e, s) => ['-i', e, '-vn', '-c:a', 'libopus', '-b:a', '128k', s]],
  },
  mp4: {
    saida: 'saida.mp4', ext: 'mp4', tipo: 'video/mp4',
    passos: [(e, s) => [
      '-i', e, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', s,
    ]],
  },
  webm: {
    saida: 'saida.webm', ext: 'webm', tipo: 'video/webm',
    passos: [(e, s) => [
      '-i', e, '-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8',
      '-c:a', 'libopus', '-b:a', '128k', s,
    ]],
  },
  gif: {
    saida: 'saida.gif', ext: 'gif', tipo: 'image/gif',
    temporarios: ['paleta.png'],
    passos: [
      // Passo 1: escolhe as 256 melhores cores do trecho.
      (e, s, o) => ['-y', ...recorte(o), '-i', e,
        '-vf', `${escalaGif(o)},palettegen=stats_mode=diff`, 'paleta.png'],
      // Passo 2: aplica a paleta. Sem isso o GIF fica com aspecto sujo.
      (e, s, o) => ['-y', ...recorte(o), '-i', e, '-i', 'paleta.png',
        '-lavfi', `${escalaGif(o)}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
        '-loop', '0', s],
    ],
  },
  webpAnim: {
    saida: 'saida.webp', ext: 'webp', tipo: 'image/webp',
    passos: [(e, s, o) => [
      '-y', ...recorte(o), '-i', e, '-vf', escalaGif(o),
      '-c:v', 'libwebp', '-lossless', '0', '-q:v', '70', '-loop', '0', '-an', '-vsync', '0', s,
    ]],
  },
  quadro: {
    saida: 'saida.png', ext: 'png', tipo: 'image/png',
    passos: [(e, s, o) => ['-y', '-ss', String(o.inicio || 0), '-i', e, '-frames:v', '1', s]],
  },
  gifParaMp4: {
    saida: 'saida.mp4', ext: 'mp4', tipo: 'video/mp4',
    passos: [(e, s) => [
      '-i', e,
      // yuv420p exige dimensões pares, e GIF frequentemente tem lado ímpar.
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264', '-crf', '23', '-movflags', '+faststart', s,
    ]],
  },
  clipe: {
    saida: 'saida.mp4', ext: 'mp4', tipo: 'video/mp4',
    passos: [(e, s) => [
      '-f', 'lavfi', '-i', 'color=c=black:s=1080x1080:r=5',
      '-i', e, '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
      '-shortest', '-movflags', '+faststart', s,
    ]],
  },
  remux: {
    saida: 'saida.mp4', ext: 'mp4', tipo: 'video/mp4',
    passos: [(e, s) => ['-i', e, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', s]],
  },
};