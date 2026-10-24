/* Stronger Cast — player de vídeo (Task 7).
   O YouTube toca POR DENTRO do app: overlay #player-video com um iframe do
   youtube-nocookie. Fechar o player remove o iframe da árvore, e o WebView
   descarrega o player junto (o áudio do vídeo morre — comportamento esperado;
   áudio em segundo plano é a Task 8).
   Desde 23/10 o clique no card abre o VÍDEO primeiro (decisão do dono após
   teste real: todo episódio publicado tem MP3, então o vídeo ficava
   inalcançável). O botão "Ouvir áudio" faz a troca manual para o MP3 do mesmo
   episódio — o único formato que sobrevive à tela travada.
   Exposto como window.SCPlayerVideo.abrirVideo(ep) / fecharVideo() /
   estaAberto(); o app.js reexporta em SCApp e assina episodioSelecionado. */
(function (raiz) {
  "use strict";

  var doc = raiz.document;
  var aberto = false;
  var episodioAtual = null;

  function porId(id) {
    return doc ? doc.getElementById(id) : null;
  }

  function avisar(mensagem) {
    if (raiz.console && typeof raiz.console.warn === "function") {
      raiz.console.warn("Stronger Cast: " + mensagem);
    }
  }

  /* Aceita link inteiro (watch/youtu.be/Shorts/&t=) ou ID puro; quem valida
     é o mesmo extrator do site. Sem YouTube válido → null. */
  function idDoVideo(ep) {
    var ext = raiz.SCExtratores;
    if (!ext || typeof ext.idDoVideo !== "function") return null;
    var bruto = ep && (ep.youtube || ep.youtubeId);
    return ext.idDoVideo(bruto);
  }

  function palcoDe(overlay) {
    return porId("player-video-palco") || overlay;
  }

  /* Monta o embed com a mesma técnica do site (09-site/app.js), mais
     autoplay/playsinline: o toque no card já é a intenção de tocar. */
  function urlEmbed(id) {
    return "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&playsinline=1";
  }

  function tituloIframe(ep) {
    var titulo = ep && ep.titulo ? String(ep.titulo) : "Episódio";
    return "Stronger Cast — " + titulo;
  }

  /* Remover o iframe é o que para o vídeo (e o áudio) de verdade. */
  function limparPalco(palco) {
    if (!palco) return;
    palco.innerHTML = "";
    while (palco.firstChild) {
      palco.removeChild(palco.firstChild);
    }
  }

  /* O botão de troca só faz sentido quando o episódio atual tem MP3. */
  function atualizarTroca(ep) {
    var botao = porId("player-video-ouvir");
    if (!botao) return;
    botao.hidden = !(ep && ep.mp3);
  }

  /* "Ouvir áudio": fecha o vídeo (iframe fora → o vídeo para) e abre o áudio
     no MESMO episódio. O player de áudio é resolvido no clique porque
     player-audio.js carrega depois deste arquivo. */
  function trocarParaAudio() {
    var ep = episodioAtual;
    if (!ep || !ep.mp3) return false;

    var audio = raiz.SCPlayerAudio;
    if (!audio || typeof audio.abrirAudio !== "function") {
      avisar("player de áudio indisponível nesta página");
      return false;
    }

    fecharVideo();
    return audio.abrirAudio(ep);
  }

  function fecharVideo() {
    var overlay = porId("player-video");
    var estavaAberto = aberto;

    limparPalco(overlay ? palcoDe(overlay) : null);

    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }

    var corpo = doc && doc.body;
    if (corpo && corpo.classList) corpo.classList.remove("player-aberto");

    aberto = false;
    episodioAtual = null;
    atualizarTroca(null);
    return estavaAberto;
  }

  function abrirVideo(ep) {
    var id = idDoVideo(ep);
    if (!id) {
      avisar(
        "link do YouTube não entendido — o episódio fica \"em breve\": " +
          ((ep && (ep.youtube || ep.youtubeId)) || "(sem link)")
      );
      return false;
    }

    var overlay = porId("player-video");
    if (!overlay) {
      avisar("overlay #player-video não existe nesta página");
      return false;
    }

    // Trocar de episódio com o player aberto não pode empilhar dois iframes.
    fecharVideo();

    var palco = palcoDe(overlay);
    var iframe = doc.createElement("iframe");
    iframe.className = "player-video__iframe";
    iframe.setAttribute("src", urlEmbed(id));
    iframe.setAttribute("title", tituloIframe(ep));
    iframe.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    );
    iframe.setAttribute("allowfullscreen", "true");
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    iframe.setAttribute("frameborder", "0");
    palco.appendChild(iframe);

    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");

    var corpo = doc && doc.body;
    if (corpo && corpo.classList) corpo.classList.add("player-aberto");

    aberto = true;
    episodioAtual = ep;
    atualizarTroca(ep);

    // Foco no fechar: quem usa leitor de tela/teclado não fica preso no iframe.
    var fechar = porId("player-video-fechar");
    if (fechar && typeof fechar.focus === "function") {
      try {
        fechar.focus();
      } catch (e) {
        // WebView sem foco programático: segue sem focar
      }
    }

    return true;
  }

  function estaAberto() {
    return aberto;
  }

  /* ---------- eventos do overlay ---------- */

  var botaoFechar = porId("player-video-fechar");
  if (botaoFechar) {
    botaoFechar.addEventListener("click", function () {
      fecharVideo();
    });
  }

  var botaoOuvir = porId("player-video-ouvir");
  if (botaoOuvir) {
    botaoOuvir.addEventListener("click", trocarParaAudio);
  }

  var overlayInicial = porId("player-video");
  if (overlayInicial) {
    // Toque no fundo escuro (fora do quadro) também fecha.
    overlayInicial.addEventListener("click", function (evento) {
      if (evento && evento.target === overlayInicial) fecharVideo();
    });
  }

  if (doc && typeof doc.addEventListener === "function") {
    doc.addEventListener("keydown", function (evento) {
      if (!aberto || !evento) return;
      if (evento.key === "Escape" || evento.key === "Esc") fecharVideo();
    });
  }

  var api = {
    abrirVideo: abrirVideo,
    fecharVideo: fecharVideo,
    estaAberto: estaAberto
  };

  raiz.SCPlayerVideo = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
