/* Stronger Cast — áudio em segundo plano (Task 8).
   O MP3 é o ÚNICO formato que sobrevive à tela travada; o vídeo (Task 7) para,
   por construção, quando o iframe sai da árvore. Quem garante a notificação
   com play/pause é o plugin nativo.
   Desde 23/10 o clique no card abre o vídeo (decisão do dono); o overlay de
   áudio traz o botão "Assistir vídeo" para a troca manual no mesmo episódio.

   ---------- Caminho do plugin (Step 1 — registro obrigatório) ----------

   1) Tentado PRIMEIRO, como manda o plano: @capawesome-team/capacitor-audio-player
      (README: https://github.com/capawesome-team/capacitor-plugins/tree/main/packages/audio-player).
      BLOQUEADO por licença: o README diz "This plugin is only available to
      Capawesome Insiders" e manda configurar o registry privado
      (npm.registry.capawesome.io + _authToken de licença paga). Verificado:
      o pacote não existe no registry público (npm E404) e não há licença
      neste ambiente. Também NÃO instalamos @capawesome-team/capacitor-media-session:
      o próprio FAQ do pacote diz "combining it with the Media Session plugin is
      not recommended. Use the built-in media session integration (see the
      metadata option of the play(...) method) instead".

   2) USADO: @mediagrid/capacitor-native-audio 3.0.0 (MIT, peer @capacitor/core >=8).
      README: "Play audio in a Capacitor app natively (Android/iOS) from a URL/web
      source simultaneously with background audio. Also supports background
      playing with an OS notification."
      API usada (README/API do pacote): create({audioId, audioSource,
      friendlyTitle, artistName, artworkSource, useForNotification}) →
      initialize({audioId}) → play/pause/seek({timeInSeconds}) →
      getCurrentTime/getDuration → onPlaybackStatusChange
      (play/pause vindos da notificação/tela de bloqueio).
      Duas divergências entre README e código do pacote 3.0.0, conferidas no
      fonte instalado (android/src/main/java/.../AudioPlayerPlugin.java):
        a) getCurrentTime/getDuration devolvem SEGUNDOS (float, /1000.0f),
           embora o README diga "in milliseconds" — seguimos o código;
        b) create() REJEITA um audioId repetido ("An audio source with the ID x
           already exists"), então trocar de episódio usa
           changeAudioSource + changeMetadata, não create de novo.
      Duração: getDuration é relido em onAudioReady (a doc manda "Should be
      called once the audio is ready") e, enquanto duracao === 0 e tocando, a
      cada segundo no relógio — sem timeline o plugin devolve -1 (→ 0) e a
      barra ficaria morta.
      Manifest exigido pelo README: service AudioPlayerService
      (foregroundServiceType="mediaPlayback") + FOREGROUND_SERVICE +
      FOREGROUND_SERVICE_MEDIA_PLAYBACK + WAKE_LOCK.
      No Android o plugin é exposto como Capacitor.Plugins.AudioPlayer.

   ---------- Interface (Task 9+ consomem) ----------

   criarEngine(): AudioEngine, com tocar(ep), pausar(), alternar(),
   estado() → {tocando, segundos, duracao}, aoMudar(cb) → cancelar.
   Duas implementações TROCÁVEIS com o MESMO contrato:
     engineWeb — <audio> (dev no navegador);
     engineNat — plugin nativo (APK).
   criarEngine() escolhe por window.Capacitor?.isNativePlatform().
   Extra usado pela barra: buscar(segundos) e nome ("web" | "nat"). */
(function (raiz) {
  "use strict";

  var doc = raiz.document;

  function porId(id) {
    return doc ? doc.getElementById(id) : null;
  }

  function avisar(mensagem) {
    if (raiz.console && typeof raiz.console.warn === "function") {
      raiz.console.warn("Stronger Cast: " + mensagem);
    }
  }

  /* Número finito e positivo; qualquer outra coisa (NaN, Infinity, negativo) → 0. */
  function numero(valor) {
    var n = Number(valor);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /* 0 → "00:00"; 65 → "01:05"; 3725 → "1:02:05" (hora só aparece se houver). */
  function formatarTempo(valor) {
    var total = Math.floor(numero(valor));
    var horas = Math.floor(total / 3600);
    var minutos = Math.floor((total % 3600) / 60);
    var segundos = total % 60;
    var dois = function (n) {
      return n < 10 ? "0" + n : String(n);
    };
    if (horas > 0) return horas + ":" + dois(minutos) + ":" + dois(segundos);
    return dois(minutos) + ":" + dois(segundos);
  }

  /* Capa do episódio (ou thumb do YouTube, ou placeholder) — vira o artwork
     da notificação e a imagem do overlay. */
  function arteDe(ep) {
    if (ep && ep.capa) return String(ep.capa);

    var ext = raiz.SCExtratores;
    if (ext && ep && ep.youtube) {
      try {
        var id =
          typeof ext.idDoVideo === "function" ? ext.idDoVideo(ep.youtube) : ep.youtube;
        if (id && typeof ext.urlThumb === "function") return ext.urlThumb(id);
      } catch (e) {
        // link estranho: cai no placeholder
      }
    }
    return "assets/ep-placeholder.jpg";
  }

  function ehNativo() {
    var cap = raiz.Capacitor;
    return !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
  }

  /* Instância do plugin nativo. Sem bundler o proxy não nasce sozinho:
     registerPlugin é o mesmo caminho que o import do pacote faz por baixo. */
  function resolverPlugin() {
    var cap = raiz.Capacitor;
    if (!cap) return null;
    try {
      if (typeof cap.isPluginAvailable === "function" && !cap.isPluginAvailable("AudioPlayer")) {
        return null;
      }
      if (cap.Plugins && cap.Plugins.AudioPlayer) return cap.Plugins.AudioPlayer;
      if (typeof cap.registerPlugin === "function") {
        cap.Plugins = cap.Plugins || {};
        cap.Plugins.AudioPlayer = cap.registerPlugin("AudioPlayer");
        return cap.Plugins.AudioPlayer;
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  /* ---------- motor web: <audio> (dev no navegador) ---------- */

  function engineWeb(opcoes) {
    opcoes = opcoes || {};

    var audio = opcoes.audio || null;
    var ouvintes = [];
    var episodio = null;
    var origemAtual = null;
    var tocando = false;

    function elemento() {
      if (audio) return audio;
      var d = opcoes.document || doc;
      if (!d || typeof d.createElement !== "function") return null;
      audio = d.createElement("audio");
      audio.setAttribute("preload", "metadata");
      audio.setAttribute("playsinline", "");
      audio.preload = "metadata";
      ligar(audio);
      return audio;
    }

    function ligar(el) {
      if (!el || typeof el.addEventListener !== "function") return;
      el.addEventListener("timeupdate", emitir);
      el.addEventListener("durationchange", emitir);
      el.addEventListener("loadedmetadata", emitir);
      el.addEventListener("play", function () {
        tocando = true;
        emitir();
      });
      el.addEventListener("pause", function () {
        tocando = false;
        emitir();
      });
      el.addEventListener("ended", function () {
        tocando = false;
        try {
          el.currentTime = 0; // "tocar" depois do fim recomeça do zero
        } catch (e) {
          // elemento descarregado
        }
        emitir();
      });
    }

    function estado() {
      var el = audio;
      return {
        tocando: tocando,
        segundos: el ? numero(el.currentTime) : 0,
        duracao: el ? numero(el.duration) : 0
      };
    }

    function emitir() {
      if (!ouvintes.length) return;
      var est = estado();
      var copia = ouvintes.slice();
      for (var i = 0; i < copia.length; i++) {
        try {
          copia[i](est);
        } catch (e) {
          avisar("ouvinte de áudio falhou: " + (e && e.message));
        }
      }
    }

    /* Espelha a notificação do APK no navegador (quando o browser suporta). */
    function definirMediaSession(ep) {
      try {
        var nav = raiz.navigator;
        if (!nav || !nav.mediaSession || typeof raiz.MediaMetadata !== "function") return;
        nav.mediaSession.metadata = new raiz.MediaMetadata({
          title: (ep && ep.titulo) || "Stronger Cast",
          artist: (ep && ep.convidado) || "Stronger Cast",
          album: "Stronger Cast",
          artwork: [{ src: arteDe(ep), sizes: "512x512" }]
        });
      } catch (e) {
        // navegador sem Media Session: segue sem metadados
      }
    }

    function tocar(ep) {
      var el = elemento();
      var mp3 = ep && ep.mp3 ? String(ep.mp3) : null;
      if (!el || !mp3) return Promise.reject(new Error("episódio sem mp3"));

      episodio = ep;

      // Mesma faixa: retoma do ponto atual (não recomeça).
      if (origemAtual !== mp3) {
        origemAtual = mp3;
        el.src = mp3;
        try {
          if (typeof el.load === "function") el.load();
        } catch (e) {
          // alguns WebViews não expõem load(): o src já basta
        }
        definirMediaSession(ep);
      }

      tocando = true;
      emitir();

      var tentativa;
      try {
        tentativa = el.play();
      } catch (e) {
        tocando = false;
        emitir();
        return Promise.reject(e);
      }

      return Promise.resolve(tentativa).catch(function (e) {
        tocando = false;
        emitir();
        throw e;
      });
    }

    function pausar() {
      tocando = false;
      if (audio && typeof audio.pause === "function") {
        try {
          audio.pause();
        } catch (e) {
          // elemento já descarregado
        }
      }
      emitir();
      return Promise.resolve();
    }

    function alternar() {
      if (tocando) return pausar();
      if (episodio) return tocar(episodio);
      return Promise.resolve();
    }

    function buscar(valor) {
      var el = elemento();
      if (!el) return Promise.resolve();
      var alvo = numero(valor);
      var teto = estado().duracao;
      if (teto > 0 && alvo > teto) alvo = teto;
      el.currentTime = alvo;
      emitir();
      return Promise.resolve();
    }

    function aoMudar(cb) {
      if (typeof cb !== "function") return function () {};
      ouvintes.push(cb);
      var cancelado = false;
      return function () {
        if (cancelado) return;
        cancelado = true;
        var i = ouvintes.indexOf(cb);
        if (i !== -1) ouvintes.splice(i, 1);
      };
    }

    if (audio) ligar(audio);

    return {
      nome: "web",
      tocar: tocar,
      pausar: pausar,
      alternar: alternar,
      estado: estado,
      aoMudar: aoMudar,
      buscar: buscar
    };
  }

  /* ---------- motor nativo: plugin (APK) ---------- */

  function engineNat(opcoes) {
    opcoes = opcoes || {};
    var plugin = opcoes.plugin || resolverPlugin();
    if (!plugin) return null; // quem chama decide o fallback

    var audioId = opcoes.audioId || "strongercast-episodio";
    var ouvintes = [];
    var episodio = null;
    var origemAtual = null;
    var tocando = false;
    var segundos = 0;
    var duracao = 0;
    var inscrito = false;
    var inscritoPronto = false;
    var criado = false;
    var timer = null;

    function chamar(nome, args) {
      if (!plugin || typeof plugin[nome] !== "function") {
        return Promise.reject(new Error("plugin sem " + nome + "()"));
      }
      try {
        return Promise.resolve(plugin[nome].apply(plugin, args || []));
      } catch (e) {
        return Promise.reject(e);
      }
    }

    function estado() {
      return { tocando: tocando, segundos: segundos, duracao: duracao };
    }

    function emitir() {
      if (!ouvintes.length) return;
      var est = estado();
      var copia = ouvintes.slice();
      for (var i = 0; i < copia.length; i++) {
        try {
          copia[i](est);
        } catch (e) {
          avisar("ouvinte de áudio falhou: " + (e && e.message));
        }
      }
    }

    function parametros(ep) {
      return {
        audioId: audioId,
        audioSource: String(ep.mp3),
        friendlyTitle: ep.titulo || "Stronger Cast",
        artistName: ep.convidado || "Stronger Cast",
        albumTitle: "Stronger Cast",
        artworkSource: arteDe(ep),
        useForNotification: true,
        showSeekBackward: true,
        showSeekForward: true,
        seekBackwardTime: 15,
        seekForwardTime: 30
      };
    }

    function criarFonte(ep, mp3) {
      return chamar("create", [parametros(ep)])
        .then(inscrever) // doc: registrar callbacks antes de initialize
        .then(inscreverPronto)
        .then(function () {
          return chamar("initialize", [{ audioId: audioId }]);
        })
        .then(function () {
          criado = true;
          origemAtual = mp3;
        });
    }

    /* O mesmo audioId já existe: create() rejeitaria. Troca a faixa e os
       metadados (a notificação é republicada); o play() seguinte toca. */
    function trocarFonte(ep, mp3) {
      var p = parametros(ep);
      return chamar("changeAudioSource", [{ audioId: audioId, source: mp3 }])
        .then(function () {
          return chamar("changeMetadata", [
            {
              audioId: audioId,
              albumTitle: p.albumTitle,
              artistName: p.artistName,
              friendlyTitle: p.friendlyTitle,
              artworkSource: p.artworkSource
            }
          ]);
        })
        .then(function () {
          origemAtual = mp3;
        });
    }

    function iniciarRelogio() {
      if (timer != null || typeof raiz.setInterval !== "function") return;
      timer = raiz.setInterval(atualizarPosicao, 1000);
    }

    function pararRelogio() {
      if (timer == null) return;
      if (typeof raiz.clearInterval === "function") {
        try {
          raiz.clearInterval(timer);
        } catch (e) {
          // timer já encerrado
        }
      }
      timer = null;
    }

    function atualizarPosicao() {
      if (!tocando) return Promise.resolve();

      var leituras = [
        chamar("getCurrentTime", [{ audioId: audioId }])
          .then(function (r) {
            if (!r) return;
            segundos = numero(r.currentTime); // segundos (ver cabeçalho)
            emitir();
          })
          .catch(function () {
            // leitura de posição é otimização: falha não derruba a reprodução
          })
      ];

      /* ExoPlayer sem timeline devolve -1 (→ 0) nos primeiros instantes de um
         MP3 de rede. Sem total a barra fica morta; enquanto não houver duração,
         o relógio de 1 s tenta de novo (cobre também um onAudioReady perdido). */
      if (duracao === 0) leituras.push(recarregarDuracao());

      return Promise.all(leituras);
    }

    function recarregarDuracao() {
      return chamar("getDuration", [{ audioId: audioId }])
        .then(function (r) {
          if (!r) return;
          duracao = numero(r.duration); // segundos (ver cabeçalho)
          emitir();
        })
        .catch(function () {});
    }

    /* Play/pause vindos da notificação ou da tela de bloqueio. */
    function inscrever() {
      if (inscrito || typeof plugin.onPlaybackStatusChange !== "function") {
        return Promise.resolve();
      }
      inscrito = true;
      return chamar("onPlaybackStatusChange", [
        { audioId: audioId },
        function (resultado) {
          var status = resultado && resultado.status;
          if (status !== "playing" && status !== "paused" && status !== "stopped") return;
          tocando = status === "playing";
          if (tocando) iniciarRelogio();
          else pararRelogio();
          emitir();
        }
      ]).catch(function (e) {
        inscrito = false;
        avisar("sem escuta dos controles do sistema: " + (e && e.message));
      });
    }

    /* A doc do plugin manda ler getDuration "once the audio is ready
       (onAudioReady)": logo após play() o ExoPlayer ainda não tem timeline e
       devolve -1 (→ 0), o que deixaria a barra morta. Callbacks são
       registrados antes do initialize (mesma exigência da doc). */
    function inscreverPronto() {
      if (inscritoPronto || typeof plugin.onAudioReady !== "function") {
        return Promise.resolve();
      }
      inscritoPronto = true;
      return chamar("onAudioReady", [
        { audioId: audioId },
        function () {
          return recarregarDuracao();
        }
      ]).catch(function (e) {
        inscritoPronto = false;
        avisar("sem aviso de áudio pronto: " + (e && e.message));
      });
    }

    function tocar(ep) {
      var mp3 = ep && ep.mp3 ? String(ep.mp3) : null;
      if (!mp3) return Promise.resolve();

      episodio = ep;
      var preparo = Promise.resolve();
      if (!criado) {
        segundos = 0;
        duracao = 0;
        preparo = criarFonte(ep, mp3);
      } else if (origemAtual !== mp3) {
        segundos = 0;
        duracao = 0;
        preparo = trocarFonte(ep, mp3);
      }

      return preparo
        .then(function () {
          return chamar("play", [{ audioId: audioId }]);
        })
        .then(function () {
          tocando = true;
          emitir();
          iniciarRelogio();
          return recarregarDuracao();
        })
        .catch(function (e) {
          tocando = false;
          emitir();
          throw e;
        });
    }

    function pausar() {
      tocando = false;
      pararRelogio();
      emitir();
      return chamar("pause", [{ audioId: audioId }]).catch(function (e) {
        avisar("pausa nativa falhou: " + (e && e.message));
      });
    }

    function alternar() {
      if (tocando) return pausar();
      if (episodio) return tocar(episodio);
      return Promise.resolve();
    }

    function buscar(valor) {
      var alvo = numero(valor);
      var teto = duracao;
      if (teto > 0 && alvo > teto) alvo = teto;
      segundos = alvo;
      emitir();
      return chamar("seek", [{ audioId: audioId, timeInSeconds: alvo }]).catch(function (e) {
        avisar("seek nativo falhou: " + (e && e.message));
      });
    }

    function aoMudar(cb) {
      if (typeof cb !== "function") return function () {};
      ouvintes.push(cb);
      var cancelado = false;
      return function () {
        if (cancelado) return;
        cancelado = true;
        var i = ouvintes.indexOf(cb);
        if (i !== -1) ouvintes.splice(i, 1);
      };
    }

    return {
      nome: "nat",
      tocar: tocar,
      pausar: pausar,
      alternar: alternar,
      estado: estado,
      aoMudar: aoMudar,
      buscar: buscar
    };
  }

  /* ---------- escolha do motor ---------- */

  function criarEngine(opcoes) {
    opcoes = opcoes || {};
    if (opcoes.engine) return opcoes.engine; // injeção (testes/uso avançado)

    if (ehNativo()) {
      var nat = engineNat(opcoes);
      if (nat) return nat;
      // Nativo sem o plugin (build sem sync): toca no <audio>, mas NÃO
      // sobrevive à tela travada. Avisar é melhor que fingir que funciona.
      avisar("plugin de áudio nativo ausente: usando <audio> (não sobrevive à tela travada)");
    }
    return engineWeb(opcoes);
  }

  /* ---------- overlay #player-audio ---------- */

  var motorAtual = null;
  var aberto = false;
  var episodioAtual = null;
  var cancelarMudanca = null;
  var arrastando = false;

  function motor() {
    if (!motorAtual) motorAtual = criarEngine();
    return motorAtual;
  }

  function atualizarUi(est) {
    if (!est) return;
    var tocando = !!est.tocando;

    var barra = porId("player-audio-barra");
    if (barra) {
      if (!arrastando) {
        barra.value =
          est.duracao > 0
            ? String(Math.round((est.segundos / est.duracao) * 1000))
            : "0";
      }
      barra.setAttribute(
        "aria-valuetext",
        formatarTempo(est.segundos) + " de " + formatarTempo(est.duracao)
      );
    }

    var atual = porId("player-audio-atual");
    if (atual) atual.textContent = formatarTempo(est.segundos);

    var total = porId("player-audio-duracao");
    if (total) total.textContent = formatarTempo(est.duracao);

    var botao = porId("player-audio-play");
    if (botao) {
      botao.textContent = tocando ? "Pausar" : "Tocar";
      botao.setAttribute("aria-label", tocando ? "Pausar áudio" : "Tocar áudio");
      if (botao.classList) botao.classList.toggle("player-audio__play--tocando", tocando);
    }
  }

  function preencher(ep) {
    var capa = porId("player-audio-capa");
    if (capa) {
      capa.setAttribute("src", arteDe(ep));
      capa.setAttribute("alt", ep.titulo ? "Capa: " + ep.titulo : "Capa do episódio");
    }

    var titulo = porId("player-audio-titulo");
    if (titulo) titulo.textContent = ep.titulo || "Episódio";

    var artista = porId("player-audio-artista");
    if (artista) {
      var partes = [];
      if (ep.convidado) partes.push("Com " + ep.convidado);
      if (ep.data) partes.push(String(ep.data));
      artista.textContent = partes.join(" · ");
      artista.hidden = partes.length === 0;
    }

    var barra = porId("player-audio-barra");
    if (barra) barra.value = "0";

    var atual = porId("player-audio-atual");
    if (atual) atual.textContent = "00:00";

    var total = porId("player-audio-duracao");
    if (total) total.textContent = "00:00";
  }

  function focar(id) {
    var el = porId(id);
    if (el && typeof el.focus === "function") {
      try {
        el.focus();
      } catch (e) {
        // WebView sem foco programático
      }
    }
  }

  /* O botão "Assistir vídeo" só aparece quando o episódio tem YouTube. */
  function atualizarTroca(ep) {
    var botao = porId("player-audio-troca");
    if (!botao) return;
    botao.hidden = !(ep && ep.youtube);
  }

  /* Troca manual para o vídeo (23/10): fecha o áudio (pausa e guarda o ponto)
     e abre o vídeo no MESMO episódio. Resolvido no clique porque
     player-video.js é carregado antes, mas a API só é usada em runtime. */
  function trocarParaVideo() {
    var ep = episodioAtual;
    if (!ep || !ep.youtube) return false;

    // Link quebrado não pode fechar o áudio e deixar o usuário sem nada.
    var ext = raiz.SCExtratores;
    if (ext && typeof ext.idDoVideo === "function" && !ext.idDoVideo(ep.youtube)) {
      avisar("link do YouTube não entendido — o áudio continua aberto");
      return false;
    }

    var video = raiz.SCPlayerVideo;
    if (!video || typeof video.abrirVideo !== "function") {
      avisar("player de vídeo indisponível nesta página");
      return false;
    }

    fecharAudio();
    return video.abrirVideo(ep);
  }

  function abrirAudio(ep) {
    if (!ep || !ep.mp3) {
      avisar("episódio sem mp3 — o áudio é só para episódios com MP3");
      return false;
    }

    var overlay = porId("player-audio");
    if (!overlay) {
      avisar("overlay #player-audio não existe nesta página");
      return false;
    }

    var eng = motor();
    if (!cancelarMudanca) cancelarMudanca = eng.aoMudar(atualizarUi);

    preencher(ep);

    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    if (doc && doc.body && doc.body.classList) doc.body.classList.add("player-aberto");
    aberto = true;
    episodioAtual = ep;
    atualizarTroca(ep);

    eng.tocar(ep).catch(function (e) {
      avisar("não consegui tocar o áudio: " + (e && e.message));
      atualizarUi(eng.estado());
    });

    atualizarUi(eng.estado());
    focar("player-audio-fechar");
    return true;
  }

  function fecharAudio() {
    var overlay = porId("player-audio");
    var estavaAberto = aberto;

    if (motorAtual && typeof motorAtual.pausar === "function") {
      try {
        motorAtual.pausar(); // pausa e guarda o ponto; não destroi a faixa
      } catch (e) {
        // motor já encerrado
      }
    }

    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }

    var videoAberto = !!(
      raiz.SCPlayerVideo &&
      typeof raiz.SCPlayerVideo.estaAberto === "function" &&
      raiz.SCPlayerVideo.estaAberto()
    );
    if (!videoAberto && doc && doc.body && doc.body.classList) {
      doc.body.classList.remove("player-aberto");
    }

    aberto = false;
    episodioAtual = null;
    atualizarTroca(null);
    return estavaAberto;
  }

  function estaAberto() {
    return aberto;
  }

  function definirEngine(engine) {
    if (cancelarMudanca) {
      cancelarMudanca();
      cancelarMudanca = null;
    }
    motorAtual = engine || null;
    if (aberto && motorAtual) cancelarMudanca = motorAtual.aoMudar(atualizarUi);
  }

  /* ---------- eventos do overlay ---------- */

  function ligarUi() {
    var botao = porId("player-audio-play");
    if (botao && typeof botao.addEventListener === "function") {
      botao.addEventListener("click", function () {
        var tentativa = motor().alternar();
        if (tentativa && typeof tentativa.catch === "function") {
          tentativa.catch(function (e) {
            avisar("play/pause falhou: " + (e && e.message));
          });
        }
      });
    }

    var fechar = porId("player-audio-fechar");
    if (fechar && typeof fechar.addEventListener === "function") {
      fechar.addEventListener("click", fecharAudio);
    }

    var troca = porId("player-audio-troca");
    if (troca && typeof troca.addEventListener === "function") {
      troca.addEventListener("click", trocarParaVideo);
    }

    var overlay = porId("player-audio");
    if (overlay && typeof overlay.addEventListener === "function") {
      overlay.addEventListener("click", function (evento) {
        if (evento && evento.target === overlay) fecharAudio();
      });
    }

    var barra = porId("player-audio-barra");
    if (barra && typeof barra.addEventListener === "function") {
      barra.addEventListener("input", function () {
        var eng = motor();
        var est = eng.estado();
        var valor = Number(barra.value);
        arrastando = true;
        if (est.duracao > 0 && isFinite(valor)) {
          var alvo = (Math.min(1000, Math.max(0, valor)) / 1000) * est.duracao;
          try {
            eng.buscar(alvo);
          } catch (e) {
            avisar("seek falhou: " + (e && e.message));
          }
        }
        arrastando = false;
      });
      barra.addEventListener("change", function () {
        arrastando = false;
      });
    }

    if (doc && typeof doc.addEventListener === "function") {
      doc.addEventListener("keydown", function (evento) {
        if (!aberto || !evento) return;
        if (evento.key === "Escape" || evento.key === "Esc") fecharAudio();
      });
    }
  }

  var apiPlayer = {
    abrirAudio: abrirAudio,
    fecharAudio: fecharAudio,
    estaAberto: estaAberto,
    definirEngine: definirEngine,
    engine: function () {
      return motorAtual;
    }
  };

  ligarUi();

  var api = {
    criarEngine: criarEngine,
    engineWeb: engineWeb,
    engineNat: engineNat,
    formatarTempo: formatarTempo,
    arteDe: arteDe,
    SCPlayerAudio: apiPlayer
  };

  raiz.SCPlayerAudio = apiPlayer;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
