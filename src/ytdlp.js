/**
 * Monta comandos yt-dlp para os casos fora do alcance de uma extensão MV3:
 * sites cujas URLs de mídia dependem de decifrar assinaturas via código remoto.
 */

// Qualquer domínio aqui pula a varredura do DOM e vai direto ao comando.
const SITES = [
  'youtube.com', 'youtu.be',
  'twitter.com', 'x.com',
  'instagram.com', 'tiktok.com', 'facebook.com',
  'twitch.tv', 'vimeo.com', 'soundcloud.com', 'reddit.com',
];

export function precisaYtDlp(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SITES.some((s) => host === s || host.endsWith('.' + s));
  } catch {
    return false;
  }
}

export function ehPlaylist(url) {
  try {
    const u = new URL(url);
    return u.searchParams.has('list') || /\/(playlist|sets|album|channel|@[^/]+\/videos)/i.test(u.pathname);
  } catch {
    return false;
  }
}

// Sintaxe PowerShell. No CMD, troque por %USERPROFILE%\Videos.
const PASTA = '$HOME\\Videos';

/**
 * Cria uma subpasta com o nome da playlist e numera os itens na ordem original.
 * Vídeo avulso cai solto na raiz, sem pasta nem número.
 *
 * Se a sua versão do yt-dlp reclamar da sintaxe condicional `&...|`,
 * troque a constante inteira por: '%(title)s.%(ext)s'
 */
const SAIDA = '%(playlist_title&{}/|)s%(playlist_index&{} - |)s%(title)s.%(ext)s';

const FLAGS = {
  video: ['-f "bv*+ba/b"', '--merge-output-format mp4'],
  som: ['-x', '--audio-format mp3', '--audio-quality 0', '--embed-thumbnail', '--embed-metadata'],
  imagem: ['--write-thumbnail', '--convert-thumbnails jpg', '--skip-download'],
  texto: ['--write-subs', '--write-auto-subs', '--sub-langs "pt.*,en.*"', '--convert-subs srt', '--skip-download'],
};

export const DESCRICOES = {
  video: 'vídeo + áudio na melhor qualidade, unidos em MP4',
  som: 'só o áudio em MP3, com capa e metadados',
  imagem: 'miniaturas em JPG, sem o vídeo',
  texto: 'legendas (pt e en) em SRT, sem o vídeo',
};

export function montarComando(url, tipo) {
  return [
    'yt-dlp',
    ...(FLAGS[tipo] || FLAGS.video),

    // Numa URL de vídeo com "&list=", o padrão do yt-dlp é baixar só o vídeo.
    // Esta flag força a playlist inteira.
    '--yes-playlist',

    // Playlist longa costuma ter item removido ou privado no meio; sem isto tudo para.
    '-i',

    // Registra o que já veio; rodar de novo continua de onde parou, sem repetir.
    `--download-archive "${PASTA}\\baixados-${tipo}.txt"`,

    `-P "${PASTA}"`,
    `-o "${SAIDA}"`,
    `"${url}"`,
  ].join(' ');
}

export function ehSpotify(url) {
  try {
    return /(^|\.)(open\.)?spotify\.com$/.test(new URL(url).hostname.replace(/^www\./, ''));
  } catch {
    return false;
  }
}

/**
 * spotDL usa o Spotify apenas como catálogo: lê os metadados da faixa e
 * busca o áudio equivalente no YouTube. O arquivo não vem do Spotify.
 */
/** Tira a query de rastreio e o segmento de idioma da URL do Spotify. */
export function normalizarSpotify(url) {
  return url.split('?')[0].replace(/\/intl-[A-Za-z-]+\//, '/');
}

/**
 * spotDL usa o Spotify apenas como catálogo: lê os metadados da faixa e
 * busca o áudio equivalente no YouTube. O arquivo não vem do Spotify.
 */
export function comandoSpotdl(url) {
  return `spotdl download "${normalizarSpotify(url)}" --output "$HOME\\Music/{artist}/{album}/{title}.{output-ext}"`;
}