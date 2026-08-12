# Extensão: Conversor Local - WIN

Extensão do Chrome que **baixa e converte áudio, vídeo, imagem e documentos**.
Nenhum arquivo é enviado para servidor nenhum.

---

## Instalação

### 1. Baixe a última versão

Baixe o Node.js
Vá em **[Releases](../../releases/latest)** e baixe o arquivo `conversor-local-x.x.zip`.

### 2. Extraia e execute

Extraia o zip em qualquer lugar e dê **duplo clique em `INSTALAR.bat`**.

O instalador vai:

- copiar a extensão para `C:\dev\conversor-local` (pergunta antes)
- instalar `yt-dlp`, `ffmpeg` e `spotDL` se você ainda não tiver
- registrar a ponte que permite baixar de YouTube e Spotify
- copiar o caminho da pasta para o Ctrl+V e abrir a página de extensões

Leva alguns minutos na primeira vez.

### 3. Carregue no Chrome

Quando a página `chrome://extensions` abrir:

1. Ligue **Modo do desenvolvedor** (canto superior direito)
2. Clique em **Carregar sem compactação**
3. Na janela que abrir, aperte **Ctrl+V** e confirme / Ou selecione manualmente a extensão

### 4. Reinicie o Chrome

Feche **todas** as janelas e abra de novo. Sem isso, o botão *Executar agora*
fica cinza.

> O Chrome vai avisar sobre extensões em modo de desenvolvedor toda vez que abrir.
> **Não clique em "Desativar"** — isso desliga a extensão. É só fechar o aviso.

---

## Praticidade

Abra a página que tem a mídia, clique no ícone da extensão e escolha
**Vídeo**, **Imagem**, **Som** ou **Texto**. A extensão varre a página e lista
o que encontrou, com um botão de download em cada item.

Em YouTube, Instagram, TikTok e Spotify a varredura não funciona — aparece o
botão **Executar agora**, que usa o yt-dlp ou o spotDL por baixo.

O download roda em uma aba separada e continua em segundo plano.
**Não feche essa aba antes de terminar.**

### Converter

| De | Para |
|---|---|
| MP4, WebM, MKV, MOV | MP3, WAV, MP4, WebM, **GIF**, WebP animado, PNG |
| MP3, WAV, M4A, OGG | MP3, WAV, OGG, MP4 com fundo preto |
| GIF | MP4, WebP animado, PNG |
| JPG, PNG, WebP | PNG, JPG, WebP, PDF |
| PDF, DOCX, EPUB, SRT, VTT, JSON, HTML | TXT, DOCX, PDF, HTML |
| Página aberta no navegador | TXT, DOCX, HTML |

Escolha o arquivo e os destinos compatíveis aparecem sozinhos.
GIF e WebP animado têm controles de largura, FPS e recorte.

---

## Onde os arquivos caem

| Origem | Pasta |
|---|---|
| Conversão no navegador | Downloads |
| yt-dlp | Vídeos |
| spotDL | Músicas, em `Artista/Álbum/Faixa.mp3` |

---

## Problemas comuns

<details>
<summary><b>"não está assinado digitalmente" ao rodar o instalador</b></summary>

A política do PowerShell está bloqueando. Abra o PowerShell na pasta e rode:

```powershell
powershell -ExecutionPolicy Bypass -File .\nativo\instalar-tudo.ps1
```
</details>

<details>
<summary><b>Botão "Executar agora" está cinza</b></summary>

O Chrome não foi reiniciado depois da instalação. Feche todas as janelas —
confira no Gerenciador de Tarefas se sobrou processo — e abra de novo.

Se persistir, teste no PowerShell: `yt-dlp --version`. Se não responder,
rode o `INSTALAR.bat` de novo.
</details>

<details>
<summary><b>"Nada utilizável no DOM"</b></summary>

O site entrega o vídeo em pedaços por MediaSource e a URL real não fica exposta.
Use o comando yt-dlp que aparece na tela.
</details>

<details>
<summary><b>"Sem camada de texto" ao converter PDF</b></summary>

O PDF é escaneado: só tem imagem dentro. Precisaria de OCR, que a extensão não faz.
</details>

<details>
<summary><b>O GIF ficou gigante</b></summary>

Reduza a duração antes da largura — dobrar o tempo dobra o arquivo.
Comece com 480 px, 12 FPS e 5 segundos.
</details>

<details>
<summary><b>Conversão para WebM demorando muito</b></summary>

O ffmpeg roda dentro do navegador, em uma thread só. Para vídeo longo, prefira MP4.
</details>

<details>
<summary><b>Acentos aparecendo como <code>invÃ¡lida</code></b></summary>

Rode o `INSTALAR.bat` de novo — ele corrige o encoding do script da ponte.
</details>

---

## Sobre o YouTube e o Spotify

**YouTube não funciona pelo navegador.** O Manifest V3 proíbe executar código
remoto, e é exatamente disso que o YouTube depende para decifrar as URLs dos
streams. Por isso a extensão delega ao `yt-dlp`, que roda fora do navegador.

**O spotDL não baixa do Spotify.** Ele lê os metadados da faixa (nome, artista,
capa) e busca o áudio equivalente **no YouTube**. A qualidade depende do que
existe lá, e faixas ao vivo, remixes e versões estendidas às vezes casam com a
versão errada.

Baixe apenas conteúdo que você tem direito de baixar.

---

## Privacidade

A extensão **não faz nenhuma requisição de rede por conta própria**.
Todo processamento acontece no seu computador.

| Permissão | Para quê |
|---|---|
| `activeTab` | Ler a página — só no instante em que você clica no ícone, e só naquela aba |
| `scripting` | Executar a varredura dentro da página |
| `downloads` | Gravar direto no disco, sem carregar o arquivo na memória |
| `nativeMessaging` | Falar com o yt-dlp e o spotDL |
| Acesso a um site | Pedido **por domínio**, na hora, só quando a conversão precisa ler os bytes |

A ponte nativa não recebe comandos da extensão: ela recebe uma URL e um tipo,
valida os dois, e monta o comando a partir de uma lista fixa dentro do próprio
script ([`nativo/host.ps1`](nativo/host.ps1)).

---

## Créditos

- [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [spotDL](https://github.com/spotDL/spotify-downloader)
