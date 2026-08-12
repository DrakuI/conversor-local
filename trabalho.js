import { converter, configurarCallbacks, carregarFFmpeg, RECEITAS } from './src/ffmpeg.js';
import { baixarArquivo, baixarHls, ehHls } from './src/downloader.js';
import { trocarExtensao, nomeSeguro, mb } from './src/utils.js';
import { paraPng, paraJpg } from './src/image.js';
import { extrairTexto } from './src/texto.js';
import { conectar } from './src/nativo.js';

const $ = (s) => document.querySelector(s);

const params = new URLSearchParams(location.search);
const url = params.get('url') || '';
const acao = params.get('acao') || 'baixar';
const motor = params.get('motor') || '';
const tipo = params.get('tipo') || 'video';

const controlador = new AbortController();
let trabalhando = true;
let urlBlob = null;

// ================================================================== interface

const log = (m) => {
  $('#log').textContent += m + '\n';
  $('#log').scrollTop = $('#log').scrollHeight;
};

const status = (m, erro = false) => {
  $('#status').textContent = m;
  $('#status').classList.toggle('erro', erro);
};

const progresso = (f) => {
  if (f < 0) $('#barra').removeAttribute('value');   // barra indeterminada
  else $('#barra').value = Math.round(Math.min(1, Math.max(0, f)) * 100);
};

const encerrar = (mensagem, erro = false) => {
  trabalhando = false;
  status(mensagem, erro);
};

window.addEventListener('beforeunload', (e) => {
  if (trabalhando) { e.preventDefault(); e.returnValue = ''; }
});

window.addEventListener('unload', () => { if (urlBlob) URL.revokeObjectURL(urlBlob); });

configurarCallbacks({ progresso, log: (l) => console.debug('[ffmpeg]', l) });

async function salvar(blob, nome) {
  if (urlBlob) URL.revokeObjectURL(urlBlob);
  urlBlob = URL.createObjectURL(blob);

  const link = $('#download');
  link.href = urlBlob;
  link.download = nome;
  link.textContent = `⬇ ${nome} (${mb(blob.size)} MB)`;
  link.classList.remove('oculto');

  try {
    await chrome.downloads.download({ url: urlBlob, filename: nomeSeguro(nome), saveAs: false });
    log('Enviado para a pasta de downloads.');
  } catch (e) {
    log('Salvamento automático falhou: ' + e.message);
  }
}

// ================================================================== motor nativo (yt-dlp / spotDL)

function modoNativo() {
  $('#alvo').textContent = motor === 'spotdl' ? `${url} (spotDL)` : `${url} (${tipo})`;
  progresso(-1);

  const porta = conectar();

  porta.onMessage.addListener((m) => {
    if (m.tipo === 'inicio') {
      log(m.comando);
      status('Executando…');
      return;
    }

    if (m.tipo === 'log') {
      log(m.linha);

      // yt-dlp: [download]  42.3% of ...
      const pct = /^\[download\]\s+([\d.]+)%/.exec(m.linha);
      if (pct) { progresso(Number(pct[1]) / 100); status(m.linha.trim()); return; }

      // spotDL: Downloaded "Artista - Faixa"
      const faixa = /Downloaded\s+"(.+)"/.exec(m.linha);
      if (faixa) { status('Baixado: ' + faixa[1]); }
      return;
    }

    if (m.tipo === 'fim') {
      progresso(1);
      encerrar(
        m.codigo === 0 ? 'Concluído.' : `Terminou com código ${m.codigo}.`,
        m.codigo !== 0
      );
      porta.disconnect();
      return;
    }

    if (m.tipo === 'erro') encerrar(m.mensagem, true);
  });

  porta.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError && trabalhando) {
      encerrar('Ponte nativa caiu: ' + chrome.runtime.lastError.message, true);
    }
  });

  // Cancelar mata o PowerShell; o processo filho pode levar alguns segundos para sair.
  $('#btnCancelar').addEventListener('click', () => {
    encerrar('Cancelado.', true);
    porta.disconnect();
  });

  porta.postMessage(
    motor === 'spotdl' ? { acao: 'spotdl', url } : { acao: 'baixar', url, tipo }
  );
}

// ================================================================== motor web (fetch + ffmpeg.wasm)

/** Conversões que rodam por Canvas ou leitura de texto, sem ffmpeg. */
async function converterSemFFmpeg(baixado) {
  const entrada = new File([baixado.blob], baixado.nome);

  if (acao === 'txt') {
    const texto = await extrairTexto(entrada);
    await salvar(
      new Blob([texto], { type: 'text/plain;charset=utf-8' }),
      trocarExtensao(baixado.nome, 'txt')
    );
    return;
  }

  const blob = acao === 'png' ? await paraPng(entrada) : await paraJpg(entrada);
  await salvar(blob, trocarExtensao(baixado.nome, acao));
}

async function modoWeb() {
  $('#alvo').textContent = url;
  $('#btnCancelar').addEventListener('click', () => {
    controlador.abort();
    encerrar('Cancelado.', true);
  });

  if (!/^https?:\/\//i.test(url)) {
    encerrar('URL inválida.', true);
    return;
  }

  try {
    // Sem conversão e sem HLS: o Chrome grava direto no disco, sem passar pela memória.
    if (acao === 'baixar' && !ehHls(url)) {
      const id = await chrome.downloads.download({ url, saveAs: false });
      log('Download #' + id + ' iniciado.');
      progresso(1);
      encerrar('Pronto. Veja em Ctrl+J.');
      return;
    }

    // ---- baixar os bytes
    let baixado;
    if (ehHls(url)) {
      status('Baixando stream…');
      baixado = await baixarHls(
        url,
        (f, i, t) => { progresso(f); status(`Segmento ${i}/${t}`); },
        controlador.signal,
        log
      );
    } else {
      status('Baixando…');
      baixado = await baixarArquivo(
        url,
        (f, r, t) => { progresso(f); status(t ? `${mb(r)} / ${mb(t)} MB` : `${mb(r)} MB`); },
        controlador.signal
      );
    }
    log(`${baixado.nome} — ${mb(baixado.blob.size)} MB`);

    // ---- imagem e documento não passam pelo ffmpeg
    if (['png', 'jpg', 'txt'].includes(acao)) {
      status('Convertendo…');
      await converterSemFFmpeg(baixado);
      progresso(1);
      encerrar('Pronto.');
      return;
    }

    // ---- ffmpeg. 'baixar' só chega aqui quando é HLS, e aí precisa virar MP4.
    const chave = acao === 'baixar' ? 'remux' : acao;
    const receita = RECEITAS[chave];
    if (!receita) throw new Error('Ação desconhecida: ' + acao);

    status('Carregando o motor (só na primeira vez)…');
    await carregarFFmpeg();

    status('Convertendo…');
    progresso(0);

    const opcoes = chave === 'gif' ? { largura: 480, fps: 12, duracao: 8 } : {};
    const bytes = await converter(new File([baixado.blob], baixado.nome), receita, opcoes);

    await salvar(new Blob([bytes], { type: receita.tipo }), trocarExtensao(baixado.nome, receita.ext));
    progresso(1);
    encerrar('Pronto.');
  } catch (erro) {
    console.error(erro);
    if (erro.name === 'AbortError') {
      encerrar('Cancelado.', true);
    } else {
      encerrar('Erro: ' + (erro.message || erro), true);
      log('FALHA: ' + (erro.stack || erro));
    }
  }
}

// ==================================================================

if (motor === 'ytdlp' || motor === 'spotdl') modoNativo();
else modoWeb();