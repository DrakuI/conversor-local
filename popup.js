import { converter, configurarCallbacks, carregarFFmpeg, RECEITAS } from './src/ffmpeg.js';
import { escanear } from './src/media-scan.js';
import { ehHls, pedirPermissao, nomeDaUrl } from './src/downloader.js';
import { paraPng, paraJpg, paraWebp, paraPdf } from './src/image.js';
import { extrairTexto, ehDocumento } from './src/texto.js';
import { textoParaDocx, textoParaPdf, textoParaHtml } from './src/documento.js';
import { trocarExtensao, nomeSeguro, extensaoDe, mb } from './src/utils.js';
import { precisaYtDlp, ehSpotify, ehPlaylist, montarComando, comandoSpotdl, DESCRICOES } from './src/ytdlp.js';
import { verificar } from './src/nativo.js';

const $ = (s) => document.querySelector(s);

let urlBlob = null;
let ocupado = false;
let paginaTexto = null;
let alvoNativo = null;     // { url, tipo } do último comando montado; tipo 'spotify' usa spotDL
let hostNativo = null;     // resposta do host nativo, ou null se não registrado
let destinoAtual = null;   // id do destino escolhido na aba Converter

// ================================================================== estado da UI

const setStatus = (msg, erro = false) => {
  $('#status').textContent = msg;
  $('#status').classList.toggle('erro', erro);
};

const setProgresso = (f) => {
  $('#barra').value = Math.round(Math.min(1, Math.max(0, f)) * 100);
};

function limparDownload() {
  if (urlBlob) { URL.revokeObjectURL(urlBlob); urlBlob = null; }
  $('#download').classList.add('oculto');
}

function oferecerDownload(blob, nome) {
  limparDownload();
  urlBlob = URL.createObjectURL(blob);
  const link = $('#download');
  link.href = urlBlob;
  link.download = nome;
  link.textContent = `⬇ ${nome} (${mb(blob.size)} MB)`;
  link.classList.remove('oculto');
}

/** dataset.travado marca botões que devem seguir desabilitados por contexto. */
function travar(estado) {
  ocupado = estado;
  document.querySelectorAll('button.acao').forEach((b) => {
    b.disabled = estado || b.dataset.travado === '1';
  });
}

async function tarefa(rotulo, fn) {
  if (ocupado) return;
  travar(true);
  limparDownload();
  setProgresso(0);
  setStatus(rotulo);
  try {
    const { blob, nome } = await fn();
    setProgresso(1);
    setStatus('Pronto.');
    oferecerDownload(blob, nome);
  } catch (erro) {
    console.error(erro);
    setProgresso(0);
    setStatus(erro.message || String(erro), true);
  } finally {
    travar(false);
  }
}

document.querySelectorAll('.aba').forEach((botao) => {
  botao.addEventListener('click', () => {
    document.querySelectorAll('.aba').forEach((b) => b.classList.remove('ativa'));
    document.querySelectorAll('.painel').forEach((p) => p.classList.remove('ativo'));
    botao.classList.add('ativa');
    $('#' + botao.dataset.alvo).classList.add('ativo');
  });
});

configurarCallbacks({ progresso: setProgresso, log: (l) => console.debug('[ffmpeg]', l) });

// Consulta o host nativo uma vez ao abrir o popup, para saber o que oferecer.
verificar().then((r) => { hostNativo = r; });

// ================================================================== aba Baixar

/** Traduz o tipo pedido, na URL encontrada, para uma ação da aba de trabalho. */
function acaoPara(tipo, url) {
  if (tipo === 'som') return /\.(mp3|m4a|aac|ogg|opus|wav)(\?|#|$)/i.test(url) ? 'baixar' : 'mp3';
  if (ehHls(url)) return 'remux';
  return 'baixar';
}

async function abrirTrabalho(url, acao) {
  // 'baixar' passa pelo chrome.downloads e dispensa permissão de host.
  // As demais precisam ler os bytes, e aí o domínio tem de ser autorizado.
  if (acao !== 'baixar' && !(await pedirPermissao(url))) {
    setStatus('Permissão negada para esse domínio.', true);
    return;
  }
  window.open(
    chrome.runtime.getURL(`trabalho.html?url=${encodeURIComponent(url)}&acao=${acao}`),
    '_blank'
  );
  setStatus('Abri uma aba para o download.');
}

function mostrarResultados(itens, tipo) {
  const lista = $('#resultados');
  lista.innerHTML = '';

  if (!itens.length) {
    lista.innerHTML = '<li class="vazio">Nada encontrado nesta página.</li>';
    return;
  }

  for (const item of itens) {
    const li = document.createElement('li');

    const info = document.createElement('div');
    info.className = 'info';
    const nome = document.createElement('strong');
    nome.textContent = nomeDaUrl(item.url);
    const rotulo = document.createElement('span');
    rotulo.textContent = item.rotulo;
    info.append(nome, rotulo);

    const botao = document.createElement('button');
    if (item.bloqueado) {
      botao.textContent = 'protegido';
      botao.disabled = true;
      botao.title = 'Stream via MediaSource: a URL real não fica exposta.';
    } else {
      botao.textContent = 'baixar';
      botao.addEventListener('click', () => abrirTrabalho(item.url, acaoPara(tipo, item.url)));
    }

    li.append(info, botao);
    lista.append(li);
  }
}

/** Estado comum do painel de comando externo, para yt-dlp e spotDL. */
function montarPainelNativo({ url, tipo, rotulo, comando, disponivel, dica }) {
  alvoNativo = { url, tipo };

  $('#rotuloYtDlp').textContent = rotulo;
  $('#comandoYtDlp').textContent = comando;
  $('#areaYtDlp').classList.remove('oculto');

  $('#btnExecutar').disabled = !disponivel;
  $('#btnExecutar').dataset.travado = disponivel ? '0' : '1';
  $('#dicaNativo').textContent = dica;
}

function mostrarYtDlp(url, tipo, motivo) {
  const aviso = ehPlaylist(url) ? ' A URL contém playlist: baixa todos os itens.' : '';
  const disponivel = Boolean(hostNativo?.ytdlp);

  montarPainelNativo({
    url,
    tipo,
    rotulo: `${motivo} — ${DESCRICOES[tipo]}.${aviso}`,
    comando: montarComando(url, tipo),
    disponivel,
    dica: !hostNativo
      ? 'Ponte nativa não registrada. Rode nativo\\instalar.ps1 e reabra o Chrome; por ora, copie o comando.'
      : !hostNativo.ytdlp
        ? 'Ponte ativa, mas o yt-dlp não foi encontrado: winget install yt-dlp.yt-dlp'
        : `Salva em ${hostNativo.pasta}`,
  });
}

function mostrarSpotdl(url) {
  const disponivel = Boolean(hostNativo?.spotdl);

  montarPainelNativo({
    url,
    tipo: 'spotify',
    rotulo: 'Spotify via spotDL: os metadados vêm do Spotify, o áudio vem do YouTube.',
    comando: comandoSpotdl(url),
    disponivel,
    dica: !hostNativo
      ? 'Ponte nativa não registrada. Rode nativo\\instalar.ps1 e reabra o Chrome; por ora, copie o comando.'
      : disponivel
        ? 'Salva em Music, organizado por artista e álbum.'
        : 'spotdl não encontrado. Instale com: pip install spotdl',
  });
}

// Handler único: o motor sai do tipo guardado em alvoNativo.
$('#btnExecutar').addEventListener('click', () => {
  if (!alvoNativo) return;
  const { url, tipo } = alvoNativo;
  const motor = tipo === 'spotify' ? 'spotdl' : 'ytdlp';

  window.open(
    chrome.runtime.getURL(`trabalho.html?motor=${motor}&url=${encodeURIComponent(url)}&tipo=${tipo}`),
    '_blank'
  );
  setStatus('Abri uma aba para acompanhar.');
});

$('#btnCopiar').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#comandoYtDlp').textContent);
    $('#btnCopiar').textContent = 'Copiado!';
    setTimeout(() => { $('#btnCopiar').textContent = 'Copiar comando'; }, 1500);
  } catch {
    setStatus('Não consegui copiar. Selecione o texto do comando manualmente.', true);
  }
});

document.querySelectorAll('.tipo').forEach((botao) => {
  botao.addEventListener('click', async () => {
    const tipo = botao.dataset.tipo;

    $('#resultados').innerHTML = '';
    $('#areaTexto').classList.add('oculto');
    $('#areaYtDlp').classList.add('oculto');
    limparDownload();
    setStatus('Varrendo a página...');

    try {
      const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!aba?.id) throw new Error('Nenhuma aba ativa.');

      if (aba.url && ehSpotify(aba.url)) {
        mostrarSpotdl(aba.url);
        setStatus('Comando pronto.');
        return;
      }

      // Sites com assinatura cifrada: a varredura do DOM não resolve, o yt-dlp resolve.
      if (aba.url && precisaYtDlp(aba.url)) {
        mostrarYtDlp(aba.url, tipo, 'Este site exige o yt-dlp');
        setStatus('Comando pronto.');
        return;
      }

      const [res] = await chrome.scripting.executeScript({
        target: { tabId: aba.id },
        func: escanear,
        args: [tipo],
      });

      const dados = res?.result;
      if (!dados) throw new Error('A página não respondeu.');

      if (tipo === 'texto') {
        paginaTexto = dados;
        $('#tituloTexto').textContent = dados.titulo;
        $('#previaTexto').textContent =
          dados.texto.slice(0, 600) + (dados.texto.length > 600 ? '…' : '');
        $('#areaTexto').classList.remove('oculto');
        setStatus(`${dados.texto.length.toLocaleString('pt-BR')} caracteres.`);
        return;
      }

      mostrarResultados(dados.itens, tipo);

      // Nada no DOM, ou só streams protegidos por MediaSource: sobra o yt-dlp.
      const utilizaveis = dados.itens.filter((i) => !i.bloqueado).length;
      if (!utilizaveis && aba.url) {
        mostrarYtDlp(aba.url, tipo, 'Nada utilizável no DOM');
        setStatus('Sem resultado direto. Alternativa abaixo.');
      } else {
        setStatus(`${utilizaveis} resultado(s).`);
      }
    } catch (erro) {
      console.error(erro);
      setStatus(erro.message || 'Páginas chrome:// e a Web Store não podem ser lidas.', true);
    }
  });
});

// ------------------------------------------------------------------ exportar o texto da página

const exigirTexto = () => {
  if (!paginaTexto) throw new Error('Clique em "Texto" primeiro.');
  return paginaTexto;
};

$('#btnTxt').addEventListener('click', () => tarefa('Gerando .txt...', async () => {
  const p = exigirTexto();
  const conteudo = `${p.titulo}\n${p.url}\n${'='.repeat(60)}\n\n${p.texto}\n`;
  return {
    blob: new Blob([conteudo], { type: 'text/plain;charset=utf-8' }),
    nome: `${nomeSeguro(p.titulo)}.txt`,
  };
}));

$('#btnDocx').addEventListener('click', () => tarefa('Gerando .docx...', async () => {
  const p = exigirTexto();
  return {
    blob: textoParaDocx(`${p.url}\n\n${p.texto}`, p.titulo),
    nome: `${nomeSeguro(p.titulo)}.docx`,
  };
}));

$('#btnHtml').addEventListener('click', () => tarefa('Gerando .html...', async () => {
  const p = exigirTexto();
  return {
    blob: textoParaHtml(`${p.url}\n\n${p.texto}`, p.titulo),
    nome: `${nomeSeguro(p.titulo)}.html`,
  };
}));

// ------------------------------------------------------------------ link direto

/** Ações plausíveis para cada família de arquivo apontada pela URL. */
const ACOES_URL = {
  video: [['baixar', 'Baixar'], ['mp3', 'Extrair MP3'], ['gif', 'Virar GIF']],
  audio: [['baixar', 'Baixar'], ['mp3', 'Converter p/ MP3']],
  imagem: [['baixar', 'Baixar'], ['png', 'Converter p/ PNG'], ['jpg', 'Converter p/ JPG']],
  documento: [['baixar', 'Baixar'], ['txt', 'Extrair texto']],
  hls: [['remux', 'Baixar e montar MP4'], ['mp3', 'Extrair MP3']],
  outro: [['baixar', 'Baixar']],
};

const NOMES_FAMILIA = {
  video: 'vídeo', audio: 'áudio', imagem: 'imagem',
  documento: 'documento', hls: 'stream HLS', outro: 'arquivo',
};

function familiaDaUrl(url) {
  if (ehHls(url)) return 'hls';

  // Usa só o pathname: query string cheia de parâmetros confunde a extensão.
  const caminho = (() => { try { return new URL(url).pathname; } catch { return url; } })();
  const ext = extensaoDe(caminho, '');

  if (/^(mp4|webm|mkv|mov|avi|m4v)$/.test(ext)) return 'video';
  if (/^(mp3|wav|m4a|aac|ogg|opus|flac)$/.test(ext)) return 'audio';
  if (/^(jpe?g|png|webp|gif|bmp|avif|svg)$/.test(ext)) return 'imagem';
  if (/^(pdf|docx|epub|srt|vtt|txt|json|html?)$/.test(ext)) return 'documento';
  return ext ? 'outro' : null;
}

/** Redesenha os botões conforme o usuário digita. */
function atualizarAcoesUrl() {
  const url = $('#campoUrl').value.trim();
  const caixa = $('#acoesUrl');
  caixa.innerHTML = '';

  if (!url) {
    $('#dicaUrl').textContent = 'Cole a URL do arquivo em si, não da página.';
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    $('#dicaUrl').textContent = 'A URL precisa começar com http:// ou https://';
    return;
  }

  const familia = familiaDaUrl(url);
  if (!familia) {
    $('#dicaUrl').textContent =
      'Sem extensão reconhecível — isso costuma ser endereço de página. Use os botões acima.';
    return;
  }

  $('#dicaUrl').textContent = `Detectado: ${NOMES_FAMILIA[familia]}.`;

  for (const [acao, rotulo] of ACOES_URL[familia]) {
    const b = document.createElement('button');
    b.className = 'acao secundaria';
    b.textContent = rotulo;
    b.addEventListener('click', () => abrirTrabalho(url, acao));
    caixa.append(b);
  }
}

$('#campoUrl').addEventListener('input', atualizarAcoesUrl);

// ================================================================== aba Converter

const DESTINOS = {
  video: [
    ['mp3', 'MP3'], ['wav', 'WAV'], ['mp4', 'MP4'], ['webm', 'WebM'],
    ['gif', 'GIF'], ['webpAnim', 'WebP animado'], ['quadro', 'PNG (1 quadro)'],
  ],
  audio: [['mp3', 'MP3'], ['wav', 'WAV'], ['ogg', 'OGG'], ['clipe', 'MP4 (fundo preto)']],
  gif: [['gifParaMp4', 'MP4'], ['webpAnim', 'WebP animado'], ['quadro', 'PNG (1 quadro)']],
  imagem: [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP'], ['pdf', 'PDF']],
  documento: [['txt', 'TXT'], ['docx', 'DOCX'], ['pdfTexto', 'PDF'], ['html', 'HTML']],
};

// Destinos que abrem os controles de recorte e escala.
const COM_OPCOES = new Set(['gif', 'webpAnim', 'quadro']);

// Destinos que passam por texto puro no meio do caminho.
const SO_TEXTO = new Set(['txt', 'docx', 'pdfTexto', 'html']);

function familiaDe(arquivo) {
  const ext = extensaoDe(arquivo.name);
  if (ext === 'gif') return 'gif';
  if (ehDocumento(arquivo.name)) return 'documento';

  const familia = arquivo.type.split('/')[0];
  if (familia === 'video') return 'video';
  if (familia === 'audio') return 'audio';
  if (familia === 'image') return 'imagem';

  // Arquivo sem MIME declarado: decide pela extensão.
  if (/^(mp4|webm|mkv|mov|avi|m4v|flv|wmv)$/.test(ext)) return 'video';
  if (/^(mp3|wav|m4a|aac|ogg|opus|flac|wma)$/.test(ext)) return 'audio';
  if (/^(jpe?g|png|webp|bmp|avif|tiff?)$/.test(ext)) return 'imagem';
  return null;
}

function opcoesGif() {
  return {
    largura: Number($('#gifLargura').value) || 480,
    fps: Number($('#gifFps').value) || 12,
    inicio: Number($('#gifInicio').value) || 0,
    duracao: Number($('#gifDuracao').value) || 0,
  };
}

function definirDestino(id) {
  destinoAtual = id;
  $('#btnConverter').disabled = !id;
  $('#btnConverter').dataset.travado = id ? '0' : '1';
  $('#opcoesGif').classList.toggle('oculto', !id || !COM_OPCOES.has(id));
}

$('#arquivos').addEventListener('change', () => {
  const arquivos = [...$('#arquivos').files];
  const caixa = $('#destinos');

  caixa.innerHTML = '';
  definirDestino(null);
  limparDownload();

  if (!arquivos.length) {
    $('#dicaConverter').textContent = 'Escolha um arquivo para ver os destinos possíveis.';
    return;
  }

  const familia = familiaDe(arquivos[0]);
  if (!familia) {
    $('#dicaConverter').textContent = `Tipo não reconhecido: ${arquivos[0].name}`;
    return;
  }

  // Só o PDF de imagens junta vários arquivos; o resto usa o primeiro.
  const nota = arquivos.length > 1 && familia !== 'imagem' ? ` (usa só ${arquivos[0].name})` : '';
  $('#dicaConverter').textContent =
    `${arquivos.length} arquivo(s), tipo ${familia}${nota}. Escolha o destino:`;

  for (const [id, rotulo] of DESTINOS[familia]) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = rotulo;
    chip.addEventListener('click', () => {
      caixa.querySelectorAll('.chip').forEach((c) => c.classList.remove('ativo'));
      chip.classList.add('ativo');
      definirDestino(id);
    });
    caixa.append(chip);
  }
});

$('#btnConverter').addEventListener('click', () => {
  if (!destinoAtual) return;

  const arquivos = [...$('#arquivos').files];
  const arquivo = arquivos[0];
  if (!arquivo) { setStatus('Escolha um arquivo.', true); return; }

  tarefa('Convertendo...', async () => {
    // ---- imagem, via Canvas
    if (destinoAtual === 'png') {
      return { blob: await paraPng(arquivo), nome: trocarExtensao(arquivo.name, 'png') };
    }
    if (destinoAtual === 'jpg') {
      return { blob: await paraJpg(arquivo), nome: trocarExtensao(arquivo.name, 'jpg') };
    }
    if (destinoAtual === 'webp') {
      return { blob: await paraWebp(arquivo), nome: trocarExtensao(arquivo.name, 'webp') };
    }
    if (destinoAtual === 'pdf') {
      return {
        blob: await paraPdf(arquivos, setProgresso),
        nome: arquivos.length === 1 ? trocarExtensao(arquivo.name, 'pdf') : 'imagens.pdf',
      };
    }

    // ---- documento
    if (SO_TEXTO.has(destinoAtual)) {
      setStatus('Extraindo texto...');
      const texto = await extrairTexto(arquivo);
      const titulo = arquivo.name.replace(/\.[^.]+$/, '');

      if (destinoAtual === 'txt') {
        return {
          blob: new Blob([texto], { type: 'text/plain;charset=utf-8' }),
          nome: trocarExtensao(arquivo.name, 'txt'),
        };
      }
      if (destinoAtual === 'docx') {
        return { blob: textoParaDocx(texto, titulo), nome: trocarExtensao(arquivo.name, 'docx') };
      }
      if (destinoAtual === 'pdfTexto') {
        return { blob: textoParaPdf(texto, titulo), nome: trocarExtensao(arquivo.name, 'pdf') };
      }
      return { blob: textoParaHtml(texto, titulo), nome: trocarExtensao(arquivo.name, 'html') };
    }

    // ---- ffmpeg
    const receita = RECEITAS[destinoAtual];
    if (!receita) throw new Error('Destino desconhecido: ' + destinoAtual);

    setStatus('Carregando o motor (só na primeira vez)...');
    await carregarFFmpeg();
    setStatus('Convertendo...');

    const bytes = await converter(arquivo, receita, COM_OPCOES.has(destinoAtual) ? opcoesGif() : {});
    return {
      blob: new Blob([bytes], { type: receita.tipo }),
      nome: trocarExtensao(arquivo.name, receita.ext),
    };
  });
});

window.addEventListener('unload', limparDownload);