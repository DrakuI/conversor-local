export const HOST = 'com.conversor.local';

/** Porta de longa duração: o yt-dlp pode levar minutos e manda progresso pelo caminho. */
export function conectar() {
  return chrome.runtime.connectNative(HOST);
}

/** Retorna null quando o host não está registrado ou o Chrome não foi reiniciado. */
export async function verificar() {
  try {
    return await chrome.runtime.sendNativeMessage(HOST, { acao: 'verificar' });
  } catch {
    return null;
  }
}