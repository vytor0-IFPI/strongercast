/* Stronger Cast — boot do app.
   Responsável por: splash da vinheta Pulso-B (toda abertura, nunca bloqueia),
   menu ☰ (rodada 2: Bíblia · Devocionais · Canais · Painel · Sua conta),
   troca de vistas (#conta / #lista / #biblia / #devocionais / #canais /
   #admin), formulário de conta, pré-busca e render da lista (#lista) com os
   quatro estados: ok, vazio, erro e cache. Também liga o card aos players: o
   clique abre o vídeo → #player-video (Task 7) primeiro; o áudio (Task 8, MP3
   — único formato que sobrevive à tela travada, com controles na notificação)
   é alcançado pelo botão "Ouvir áudio" dentro do player, e o player de áudio
   tem "Assistir vídeo" para voltar. Decisão do dono em 23/10, após teste real:
   MP3 primeiro deixava o vídeo inalcançável. Bíblia/Devocionais/Canais
   (rodada 2) são delegados aos módulos próprios; aqui ficam só as vistas, o
   menu e a árvore do voltar do Android. */
(function (raiz) {
  "use strict";

  var doc = raiz.document;
  var vista = "splash"; // "splash" | "conta" | "lista" | "biblia" | "devocionais" | "canais" | "admin"
  var modoConta = "criar"; // "criar" | "entrar"
  var splashEncerrada = false;
  var timeoutSplash = null;
  var promessaLista = null;
  var videosRadar = []; // vídeos "em breve" da renderização atual
  var observadorRadar = null;
  var contaAjustesAberta = false;
  var focoAntesConta = null;
  var menuAbertoFlag = false;
  var focoAntesMenu = null;

  function porId(id) {
    return doc ? doc.getElementById(id) : null;
  }

  function sessaoApi() {
    return raiz.sessao || null;
  }

  /* ---------- vistas ---------- */

  function definirVista(nome) {
    // Só seções entram no roteador: os itens do menu também carregam
    // data-vista (destino), mas nunca podem ser escondidos por esta troca.
    var secoes = doc.querySelectorAll("section[data-vista]");
    for (var i = 0; i < secoes.length; i++) {
      secoes[i].hidden = secoes[i].getAttribute("data-vista") !== nome;
    }
    vista = nome;
  }

  function irPara(nome) {
    fecharMenu(); // qualquer navegação fecha o menu antes de trocar de tela

    if (nome === "admin") return abrirAdmin();
    if (nome === "biblia") {
      definirVista("biblia");
      var biblia = raiz.SCBiblia;
      if (biblia && typeof biblia.aoEntrar === "function") return biblia.aoEntrar();
      return;
    }
    if (nome === "devocionais") {
      definirVista("devocionais");
      var devocionais = raiz.SCDevocionais;
      if (devocionais && typeof devocionais.aoEntrar === "function") {
        return devocionais.aoEntrar();
      }
      return;
    }
    if (nome === "canais") {
      definirVista("canais");
      var canais = raiz.SCCanais;
      if (canais && typeof canais.aoEntrar === "function") return canais.aoEntrar();
      return;
    }
    if (nome !== "conta" && nome !== "lista") return;
    definirVista(nome);
    if (nome === "lista") preBuscarLista();
  }

  function vistaAtual() {
    return vista;
  }

  /* ---------- painel do admin (Task 9) ---------- */

  /* A vista #admin só entra na tela se o painel confirmar eAdmin() (o
     admin.js chama sessao.eAdmin() de novo antes de qualquer escrita). */
  function abrirAdmin() {
    var painel = raiz.SCAdmin;
    if (!painel || typeof painel.abrir !== "function") return Promise.resolve(false);

    return Promise.resolve()
      .then(function () {
        return painel.abrir();
      })
      .then(function (abriu) {
        if (abriu === false) return false;
        definirVista("admin");
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function atualizarBotaoAdmin() {
    var botao = porId("admin-abrir");
    if (!botao) return;

    botao.hidden = true;
    var api = sessaoApi();
    if (!api || typeof api.eAdmin !== "function") return;

    Promise.resolve()
      .then(function () {
        return api.eAdmin();
      })
      .then(function (admin) {
        botao.hidden = admin !== true;
      })
      .catch(function () {
        botao.hidden = true;
      });
  }

  /* Sessão mudou: o atalho do painel acompanha. Se a sessão cair com o
     painel aberto, volta para a tela de conta (o gate de escrita continua). */
  function aoMudarSessao(usuario) {
    atualizarBotaoAdmin();
    atualizarBotaoConta(usuario);
    if (!usuario) {
      if (contaAjustesAberta) fecharContaAjustes();
      if (vista === "admin") irPara("conta");
    }
  }

  function atualizarBotaoConta(usuario) {
    var botao = porId("conta-abrir");
    if (!botao) return;
    botao.hidden = !usuario;
  }

  /* ---------- ajustes da conta (senha/e-mail) ---------- */

  function contaAjustesAberto() {
    return contaAjustesAberta;
  }

  function feedback(id, mensagem) {
    var el = porId(id);
    if (!el) return;
    el.textContent = mensagem || "";
    el.hidden = !mensagem;
  }

  function limparCamposContaAjustes() {
    var ids = [
      "conta-nova-senha",
      "conta-confirmar-senha",
      "conta-novo-email",
      "conta-confirmar-email"
    ];
    for (var i = 0; i < ids.length; i++) {
      var campo = porId(ids[i]);
      if (campo) campo.value = "";
    }
  }

  function limparFeedbackContaAjustes() {
    feedback("conta-senha-erro", "");
    feedback("conta-senha-sucesso", "");
    feedback("conta-email-erro", "");
    feedback("conta-email-sucesso", "");
  }

  function abrirContaAjustes() {
    var api = sessaoApi();
    if (!api || typeof api.usuarioAtual !== "function" || !api.usuarioAtual()) {
      return false; // deslogado não tem ajustes de conta
    }

    var overlay = porId("conta-ajustes");
    if (!overlay) return false;

    focoAntesConta = doc && doc.activeElement ? doc.activeElement : null;
    limparCamposContaAjustes();
    limparFeedbackContaAjustes();

    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");

    var corpo = doc && doc.body;
    if (corpo && corpo.classList) corpo.classList.add("conta-aberta");

    contaAjustesAberta = true;

    // Foco no primeiro campo: quem usa teclado/leitor de tela entra direto.
    var primeiro = porId("conta-nova-senha");
    if (primeiro && typeof primeiro.focus === "function") {
      try {
        primeiro.focus();
      } catch (e) {
        // WebView sem foco programático: segue sem focar
      }
    }
    return true;
  }

  function fecharContaAjustes() {
    var estavaAberta = contaAjustesAberta;
    var overlay = porId("conta-ajustes");

    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }

    var corpo = doc && doc.body;
    if (corpo && corpo.classList) corpo.classList.remove("conta-aberta");

    contaAjustesAberta = false;
    limparCamposContaAjustes();
    limparFeedbackContaAjustes();

    var foco = focoAntesConta;
    focoAntesConta = null;
    if (foco && typeof foco.focus === "function") {
      try {
        foco.focus(); // devolve o foco ao atalho que abriu
      } catch (e) {
        // elemento saiu da tela: segue sem focar
      }
    }
    return estavaAberta;
  }

  async function enviarAlterarSenha(evento) {
    if (evento) evento.preventDefault();

    var api = sessaoApi();
    var botao = porId("conta-senha-enviar");
    var campo = porId("conta-nova-senha");
    var confirmar = porId("conta-confirmar-senha");

    feedback("conta-senha-erro", "");
    feedback("conta-senha-sucesso", "");

    if (!api || typeof api.alterarSenha !== "function") {
      feedback("conta-senha-erro", "O app não carregou a sessão. Feche e abra de novo.");
      return;
    }

    var nova = campo ? campo.value : "";
    var repetida = confirmar ? confirmar.value : "";

    if (!nova) {
      feedback("conta-senha-erro", "Informe a nova senha.");
      return;
    }
    if (nova !== repetida) {
      feedback("conta-senha-erro", "As senhas não conferem.");
      return;
    }

    if (botao) {
      botao.disabled = true;
      botao.textContent = "Aguarde…";
    }

    try {
      var resultado = await api.alterarSenha(nova);
      if (!resultado || !resultado.ok) {
        feedback(
          "conta-senha-erro",
          (resultado && resultado.erro) || "Não consegui concluir agora. Tente de novo."
        );
        return;
      }
      if (campo) campo.value = "";
      if (confirmar) confirmar.value = "";
      feedback("conta-senha-sucesso", "Senha alterada.");
    } catch (e) {
      feedback("conta-senha-erro", "Não consegui concluir agora. Tente de novo.");
    } finally {
      if (botao) {
        botao.disabled = false;
        botao.textContent = "Alterar senha";
      }
    }
  }

  async function enviarAlterarEmail(evento) {
    if (evento) evento.preventDefault();

    var api = sessaoApi();
    var botao = porId("conta-email-enviar");
    var campo = porId("conta-novo-email");
    var confirmar = porId("conta-confirmar-email");

    feedback("conta-email-erro", "");
    feedback("conta-email-sucesso", "");

    if (!api || typeof api.alterarEmail !== "function") {
      feedback("conta-email-erro", "O app não carregou a sessão. Feche e abra de novo.");
      return;
    }

    var novo = campo ? String(campo.value).trim() : "";
    var repetido = confirmar ? String(confirmar.value).trim() : "";

    if (!novo) {
      feedback("conta-email-erro", "Informe o novo e-mail.");
      return;
    }
    if (novo.toLowerCase() !== repetido.toLowerCase()) {
      feedback("conta-email-erro", "Os e-mails não conferem.");
      return;
    }

    if (botao) {
      botao.disabled = true;
      botao.textContent = "Aguarde…";
    }

    try {
      var resultado = await api.alterarEmail(novo);
      if (!resultado || !resultado.ok) {
        feedback(
          "conta-email-erro",
          (resultado && resultado.erro) || "Não consegui concluir agora. Tente de novo."
        );
        return;
      }
      if (campo) campo.value = "";
      if (confirmar) confirmar.value = "";
      feedback(
        "conta-email-sucesso",
        resultado.aviso || "E-mail enviado para atualização."
      );
    } catch (e) {
      feedback("conta-email-erro", "Não consegui concluir agora. Tente de novo.");
    } finally {
      if (botao) {
        botao.disabled = false;
        botao.textContent = "Alterar e-mail";
      }
    }
  }

  function configurarContaAjustes() {
    var abrir = porId("conta-abrir");
    if (abrir) {
      abrir.addEventListener("click", function () {
        fecharMenu(); // "Sua conta" mora no menu: fecha antes de abrir o overlay
        abrirContaAjustes();
      });
    }

    var fechar = porId("conta-ajustes-fechar");
    if (fechar) fechar.addEventListener("click", fecharContaAjustes);

    var overlay = porId("conta-ajustes");
    if (overlay) {
      // Toque no fundo escuro (fora do quadro) também fecha.
      overlay.addEventListener("click", function (evento) {
        if (evento && evento.target === overlay) fecharContaAjustes();
      });
    }

    var formSenha = porId("form-alterar-senha");
    if (formSenha) formSenha.addEventListener("submit", enviarAlterarSenha);

    var formEmail = porId("form-alterar-email");
    if (formEmail) formEmail.addEventListener("submit", enviarAlterarEmail);

    if (doc && typeof doc.addEventListener === "function") {
      doc.addEventListener("keydown", function (evento) {
        if (!contaAjustesAberta || !evento) return;
        if (evento.key === "Escape" || evento.key === "Esc") fecharContaAjustes();
      });
    }
  }

  /* ---------- menu ☰ (rodada 2) ---------- */

  /* Overlay discreto no topo da home. Fecha no Fechar, no fundo, no Esc e no
     voltar do Android (esse tem precedência sobre todo o resto). Painel e
     Sua conta mantêm os IDs antigos, então os gates continuam os mesmos:
     Painel só aparece se sessao.eAdmin() disser true; Sua conta, se logado. */

  function menuAberto() {
    return menuAbertoFlag;
  }

  function abrirMenu() {
    if (menuAbertoFlag) return true;

    var overlay = porId("menu-painel");
    if (!overlay) return false;

    var api = sessaoApi();
    focoAntesMenu = doc && doc.activeElement ? doc.activeElement : null;

    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");

    var gatilho = porId("menu-abrir");
    if (gatilho) gatilho.setAttribute("aria-expanded", "true");

    var corpo = doc && doc.body;
    if (corpo && corpo.classList) corpo.classList.add("menu-aberto");

    menuAbertoFlag = true;

    // Estado fresco a cada abertura: o Painel acompanha a sessão sem esperar
    // um evento de login/logout.
    atualizarBotaoAdmin();
    atualizarBotaoConta(api ? api.usuarioAtual() : null);

    var primeiro = porId("menu-biblia");
    if (primeiro && typeof primeiro.focus === "function") {
      try {
        primeiro.focus();
      } catch (e) {
        // WebView sem foco programático: segue sem focar
      }
    }
    return true;
  }

  function fecharMenu() {
    var estavaAberto = menuAbertoFlag;

    var overlay = porId("menu-painel");
    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }

    var gatilho = porId("menu-abrir");
    if (gatilho) gatilho.setAttribute("aria-expanded", "false");

    var corpo = doc && doc.body;
    if (corpo && corpo.classList) corpo.classList.remove("menu-aberto");

    menuAbertoFlag = false;

    var foco = focoAntesMenu;
    focoAntesMenu = null;
    if (estavaAberto && foco && typeof foco.focus === "function") {
      try {
        foco.focus(); // devolve o foco ao ☰ de quem abriu
      } catch (e) {
        // elemento saiu da tela: segue sem focar
      }
    }
    return estavaAberto;
  }

  function configurarMenu() {
    var abrir = porId("menu-abrir");
    if (abrir) {
      abrir.addEventListener("click", function () {
        if (menuAbertoFlag) fecharMenu();
        else abrirMenu();
      });
    }

    var fechar = porId("menu-fechar");
    if (fechar) fechar.addEventListener("click", fecharMenu);

    var overlay = porId("menu-painel");
    if (overlay) {
      // Toque no fundo escuro (fora do quadro) também fecha.
      overlay.addEventListener("click", function (evento) {
        if (evento && evento.target === overlay) fecharMenu();
      });
    }

    var biblia = porId("menu-biblia");
    if (biblia) {
      biblia.addEventListener("click", function () {
        irPara("biblia");
      });
    }

    /* rodada 2: Devocionais e Canais têm vista própria; os itens do menu
       navegam como a Bíblia (o roteador fecha o menu antes de trocar). */
    var devocionais = porId("menu-devocionais");
    if (devocionais) {
      devocionais.addEventListener("click", function () {
        irPara("devocionais");
      });
    }

    var canais = porId("menu-canais");
    if (canais) {
      canais.addEventListener("click", function () {
        irPara("canais");
      });
    }

    if (doc && typeof doc.addEventListener === "function") {
      doc.addEventListener("keydown", function (evento) {
        if (!menuAbertoFlag || !evento) return;
        if (evento.key === "Escape" || evento.key === "Esc") fecharMenu();
      });
    }
  }

  function configurarBiblia() {
    var voltar = porId("biblia-voltar");
    if (voltar) {
      voltar.addEventListener("click", function () {
        var biblia = raiz.SCBiblia;
        if (biblia && typeof biblia.voltar === "function") biblia.voltar();
      });
    }
  }

  function configurarSecoes() {
    var devocionais = porId("devocionais-voltar");
    if (devocionais) {
      devocionais.addEventListener("click", function () {
        var modulo = raiz.SCDevocionais;
        if (modulo && typeof modulo.voltar === "function") modulo.voltar();
      });
    }

    var canais = porId("canais-voltar");
    if (canais) {
      canais.addEventListener("click", function () {
        var modulo = raiz.SCCanais;
        if (modulo && typeof modulo.voltar === "function") modulo.voltar();
      });
    }
  }

  /* ---------- splash ---------- */

  function esconderSplash() {
    if (splashEncerrada) return;
    splashEncerrada = true;

    if (timeoutSplash) {
      raiz.clearTimeout(timeoutSplash);
      timeoutSplash = null;
    }

    var splash = porId("splash");
    var video = porId("splash-video");
    if (video && typeof video.pause === "function") {
      try {
        video.pause();
      } catch (e) {
        // vídeo já parado/indisponível
      }
    }
    if (splash) splash.classList.add("splash--saindo");

    // Deixa o fade de 350 ms terminar e só então escolhe a vista de entrada.
    raiz.setTimeout(function () {
      if (splash) {
        splash.hidden = true;
        splash.setAttribute("aria-hidden", "true");
      }
      var api = sessaoApi();
      var usuario = api ? api.usuarioAtual() : null;
      definirVista(usuario ? "lista" : "conta");
    }, 350);
  }

  function configurarSplash() {
    var video = porId("splash-video");
    var pular = porId("splash-pular");

    // Teto absoluto: mesmo com vídeo travado, a splash nunca passa de 12 s.
    timeoutSplash = raiz.setTimeout(esconderSplash, 12000);

    if (pular) pular.addEventListener("click", esconderSplash);

    if (!video) {
      esconderSplash();
      return;
    }

    function agendarPeloVideo() {
      if (!isFinite(video.duration) || video.duration <= 0) return;
      // `ended` + 400 ms de folga; o teto de 12 s continua valendo.
      if (timeoutSplash) raiz.clearTimeout(timeoutSplash);
      timeoutSplash = raiz.setTimeout(
        esconderSplash,
        Math.min(video.duration * 1000 + 400, 12000)
      );
    }

    video.addEventListener("ended", esconderSplash);
    video.addEventListener("error", esconderSplash); // arquivo ausente/codec: não prende
    video.addEventListener("loadedmetadata", agendarPeloVideo);
    // Metadata pode ter chegado antes deste script rodar: agenda já.
    if (video.readyState >= 1) agendarPeloVideo();

    if (typeof video.play === "function") {
      try {
        var tentativa = video.play();
        if (tentativa && typeof tentativa.catch === "function") {
          tentativa.catch(function () {
            // autoplay bloqueado (economia de bateria etc.): segue sem splash
            esconderSplash();
          });
        }
      } catch (e) {
        esconderSplash();
      }
    }
  }

  /* ---------- conta ---------- */

  function limparErroConta() {
    var erro = porId("conta-erro");
    if (!erro) return;
    erro.textContent = "";
    erro.hidden = true;
  }

  function mostrarErroConta(mensagem) {
    var erro = porId("conta-erro");
    if (!erro) return;
    erro.textContent = mensagem || "Não consegui concluir agora. Tente de novo.";
    erro.hidden = false;
  }

  function rotuloEnviar() {
    return modoConta === "criar" ? "Criar conta" : "Entrar";
  }

  function definirModoConta(novo) {
    modoConta = novo === "entrar" ? "entrar" : "criar";

    var criar = modoConta === "criar";
    var titulo = porId("conta-titulo");
    var dica = porId("conta-dica");
    var enviar = porId("conta-enviar");
    var abaCriar = porId("aba-criar");
    var abaEntrar = porId("aba-entrar");
    var senha = porId("conta-senha");

    if (titulo) titulo.textContent = criar ? "Criar conta" : "Entrar";
    if (dica) {
      dica.textContent = criar
        ? "Crie sua conta para acompanhar os episódios do Stronger Cast."
        : "Entre com seu e-mail e senha para continuar.";
    }
    if (enviar) enviar.textContent = rotuloEnviar();
    if (senha) senha.setAttribute("autocomplete", criar ? "new-password" : "current-password");

    if (abaCriar) {
      abaCriar.setAttribute("aria-selected", criar ? "true" : "false");
      abaCriar.classList.toggle("aba--ativa", criar);
    }
    if (abaEntrar) {
      abaEntrar.setAttribute("aria-selected", criar ? "false" : "true");
      abaEntrar.classList.toggle("aba--ativa", !criar);
    }

    limparErroConta();
  }

  function alternarSenha() {
    var campo = porId("conta-senha");
    var botao = porId("conta-olho");
    if (!campo || !botao) return;

    var visivel = campo.type === "text";
    campo.type = visivel ? "password" : "text";
    botao.setAttribute("aria-pressed", visivel ? "false" : "true");
    botao.setAttribute("aria-label", visivel ? "Mostrar senha" : "Ocultar senha");
    botao.classList.toggle("campo-senha__olho--aberto", !visivel);

    try {
      campo.focus();
      var fim = campo.value.length;
      campo.setSelectionRange(fim, fim);
    } catch (e) {
      // alguns WebViews não expõem setSelectionRange em type=email
    }
  }

  async function enviarConta(evento) {
    if (evento) evento.preventDefault();

    var api = sessaoApi();
    var botao = porId("conta-enviar");
    var email = porId("conta-email");
    var senha = porId("conta-senha");

    limparErroConta();

    if (!api) {
      mostrarErroConta("O app não carregou a sessão. Feche e abra de novo.");
      return;
    }

    if (botao) {
      botao.disabled = true;
      botao.textContent = "Aguarde…";
    }

    try {
      var resultado =
        modoConta === "criar"
          ? await api.criarConta(email ? email.value : "", senha ? senha.value : "")
          : await api.entrar(email ? email.value : "", senha ? senha.value : "");

      if (!resultado || !resultado.ok) {
        mostrarErroConta(resultado && resultado.erro);
        return;
      }
      if (senha) senha.value = "";
      irPara("lista");
    } catch (e) {
      mostrarErroConta("Não consegui concluir agora. Tente de novo.");
    } finally {
      if (botao) {
        botao.disabled = false;
        botao.textContent = rotuloEnviar();
      }
    }
  }

  function configurarConta() {
    var form = porId("form-conta");
    var abaCriar = porId("aba-criar");
    var abaEntrar = porId("aba-entrar");
    var olho = porId("conta-olho");

    if (abaCriar) {
      abaCriar.addEventListener("click", function () {
        definirModoConta("criar");
      });
    }
    if (abaEntrar) {
      abaEntrar.addEventListener("click", function () {
        definirModoConta("entrar");
      });
    }
    if (olho) olho.addEventListener("click", alternarSenha);
    if (form) form.addEventListener("submit", enviarConta);
  }

  function configurarAdmin() {
    var abrir = porId("admin-abrir");
    if (abrir) {
      abrir.addEventListener("click", function () {
        irPara("admin");
      });
    }

    var voltar = porId("admin-voltar");
    if (voltar) {
      voltar.addEventListener("click", function () {
        irPara("lista");
      });
    }
  }

  /* ---------- player de vídeo (Task 7) ---------- */

  function playerVideo() {
    var player = raiz.SCPlayerVideo;
    return player && typeof player.abrirVideo === "function" ? player : null;
  }

  function abrirVideo(ep) {
    var player = playerVideo();
    if (!player) return false;
    fecharAudio(); // áudio e vídeo nunca tocam juntos
    return player.abrirVideo(ep);
  }

  function fecharVideo() {
    var player = playerVideo();
    return player ? player.fecharVideo() : false;
  }

  function videoAberto() {
    var player = playerVideo();
    return !!(player && typeof player.estaAberto === "function" && player.estaAberto());
  }

  /* ---------- player de áudio (Task 8) ---------- */

  function playerAudio() {
    var player = raiz.SCPlayerAudio;
    return player && typeof player.abrirAudio === "function" ? player : null;
  }

  function abrirAudio(ep) {
    var player = playerAudio();
    return player ? player.abrirAudio(ep) : false;
  }

  function fecharAudio() {
    var player = playerAudio();
    return player ? player.fecharAudio() : false;
  }

  function audioAberto() {
    var player = playerAudio();
    return !!(player && typeof player.estaAberto === "function" && player.estaAberto());
  }

  /* ---------- botão voltar do Android (Task 7, Step 3) ---------- */

  /* Sem o plugin (navegador, ou build sem @capacitor/app) não há o que
     configurar: o "voltar" continua sendo o do navegador/sistema. */
  function pluginApp() {
    var cap = raiz.Capacitor;
    if (!cap) return null;
    if (cap.Plugins && cap.Plugins.App) return cap.Plugins.App;

    /* App sem bundler: o proxy do plugin não nasce sozinho. registerPlugin é
       o mesmo caminho que o import de @capacitor/app faz por baixo. */
    if (typeof cap.registerPlugin === "function") {
      try {
        cap.Plugins = cap.Plugins || {};
        cap.Plugins.App = cap.registerPlugin("App");
        return cap.Plugins.App;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function configurarVoltarAndroid() {
    var App = pluginApp();
    if (!App || typeof App.addListener !== "function") return;

    try {
      var registro = App.addListener("backButton", function () {
        if (menuAberto()) {
          fecharMenu(); // menu aberto: fecha primeiro (precedência da rodada 2)
          return;
        }
        if (audioAberto()) {
          fecharAudio(); // áudio aberto: fecha e continua no app
          return;
        }
        if (videoAberto()) {
          fecharVideo(); // vídeo aberto: fecha e continua no app
          return;
        }
        if (contaAjustesAberto()) {
          fecharContaAjustes(); // ajustes da conta: fecha e volta pra lista
          return;
        }
        if (vista === "biblia") {
          var biblia = raiz.SCBiblia;
          if (biblia && typeof biblia.voltar === "function") biblia.voltar();
          return; // leitura → capítulos → livros → home (quem decide é o módulo)
        }
        if (vista === "devocionais") {
          var devocionais = raiz.SCDevocionais;
          if (devocionais && typeof devocionais.voltar === "function") {
            devocionais.voltar();
          }
          return; // leitura → lista → home (quem decide é o módulo)
        }
        if (vista === "canais") {
          var canais = raiz.SCCanais;
          if (canais && typeof canais.voltar === "function") canais.voltar();
          return; // grade → home
        }
        if (vista === "admin") {
          irPara("lista"); // painel do admin: volta pra lista
          return;
        }
        if (vista === "conta") {
          irPara("lista"); // formulário aberto: volta pra lista
          return;
        }
        /* Lista/splash: não prendemos o usuário — o padrão do Android é sair.
           Registrar o ouvinte desliga o "sair" automático do Capacitor, então
           chamamos exitApp() explicitamente (senão o voltar fica sem efeito). */
        if (typeof App.exitApp === "function") {
          try {
            App.exitApp();
          } catch (e) {
            // plugin indisponível: o sistema assume o padrão
          }
        }
      });
      if (registro && typeof registro.catch === "function") {
        registro.catch(function () {
          // registro nativo indisponível: o voltar padrão do Android segue
        });
      }
    } catch (e) {
      if (raiz.console && typeof raiz.console.warn === "function") {
        raiz.console.warn("Stronger Cast: botão voltar", e);
      }
    }
  }

  /* ---------- service worker (PWA web, rodada 3) ---------- */

  /* Só registra no navegador servido por http/https. No APK o esquema é
     capacitor:// e em file:// não existe service worker: nesses casos nem
     tentamos, para não deixar erro no console do app nativo. Qualquer falha
     no registro é silenciosa — o app funciona igual, só sem offline. */
  function registrarServiceWorker() {
    if (!raiz.navigator || !("serviceWorker" in raiz.navigator)) return;
    if (!/^https?:$/.test(raiz.location.protocol)) return;

    try {
      var registro = raiz.navigator.serviceWorker.register("sw.js");
      if (registro && typeof registro.catch === "function") {
        registro.catch(function () {
          // sem SW (modo privado, navegador antigo): segue sem offline
        });
      }
    } catch (e) {
      // registro indisponível: segue sem offline
    }
  }

  /* ---------- lista: render dos estados ---------- */

  function elemento(tag, classe) {
    var el = doc.createElement(tag);
    if (classe) el.className = classe;
    return el;
  }

  function urlDaCapa(ep) {
    if (ep && ep.capa) return ep.capa;

    var ext = raiz.SCExtratores;
    if (ext && ep && ep.youtube) {
      var id =
        typeof ext.idDoVideo === "function" ? ext.idDoVideo(ep.youtube) : ep.youtube;
      if (id && typeof ext.urlThumb === "function") return ext.urlThumb(id);
    }
    return "assets/ep-placeholder.jpg";
  }

  function formatarData(valor) {
    if (!valor || typeof valor !== "string") return "";
    var m = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + "/" + m[2] + "/" + m[1] : valor;
  }

  function notificarSelecao(ep) {
    var api = raiz.SCApp;
    if (!api || typeof api.episodioSelecionado !== "function") return;
    try {
      api.episodioSelecionado(ep); // Task 7 assina; nenhum player nasce aqui
    } catch (e) {
      // uma falha do player não pode quebrar a lista
      if (raiz.console && raiz.console.error) raiz.console.error("Stronger Cast: seleção", e);
    }
  }

  function criarCard(ep) {
    var card = elemento("button", "ep-card");
    card.setAttribute("type", "button");
    if (ep.id) card.setAttribute("data-ep-id", String(ep.id));
    card.setAttribute(
      "aria-label",
      (ep.titulo || "Episódio") + " — abrir"
    );
    card.addEventListener("click", function () {
      notificarSelecao(ep);
    });

    var midia = elemento("span", "ep-card__midia");
    var img = elemento("img", "ep-card__capa");
    img.setAttribute("src", urlDaCapa(ep));
    img.setAttribute("alt", ep.titulo ? "Capa: " + ep.titulo : "Capa do episódio");
    img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
    midia.appendChild(img);
    card.appendChild(midia);

    var texto = elemento("span", "ep-card__texto");
    var titulo = elemento("span", "ep-card__titulo");
    titulo.textContent = ep.titulo || "Episódio sem título";
    texto.appendChild(titulo);

    var metaPartes = [];
    if (ep.convidado) metaPartes.push("Com " + ep.convidado);
    if (ep.data) metaPartes.push(formatarData(ep.data));
    if (metaPartes.length) {
      var meta = elemento("span", "ep-card__meta");
      meta.textContent = metaPartes.join(" · ");
      texto.appendChild(meta);
    }

    var ouvir = elemento("span", "ep-card__ouvir");
    ouvir.textContent = "Abrir episódio";
    texto.appendChild(ouvir);

    card.appendChild(texto);
    return card;
  }

  function criarBlocoVazio() {
    var bloco = elemento("div", "radar");

    var video = elemento("video", "radar__video");
    video.setAttribute("src", "assets/ep-placeholder.mp4");
    video.setAttribute("preload", "metadata");
    video.setAttribute("autoplay", "");
    video.setAttribute("muted", "");
    video.setAttribute("loop", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("tabindex", "-1");
    video.setAttribute("aria-hidden", "true");
    video.setAttribute("data-espera", "");
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    bloco.appendChild(video);
    videosRadar.push(video);

    var texto = elemento("p", "radar__texto");
    texto.textContent = "Em breve novos episódios por aqui.";
    bloco.appendChild(texto);

    var dica = elemento("p", "radar__dica");
    dica.textContent = "Enquanto isso, acompanhe o Stronger Cast no YouTube.";
    bloco.appendChild(dica);

    return bloco;
  }

  function pararRadar() {
    if (observadorRadar && typeof observadorRadar.disconnect === "function") {
      try {
        observadorRadar.disconnect();
      } catch (e) {
        // observador já encerrado
      }
    }
    observadorRadar = null;

    for (var i = 0; i < videosRadar.length; i++) {
      var v = videosRadar[i];
      if (v && typeof v.pause === "function") {
        try {
          v.pause();
        } catch (e) {
          // vídeo já removido
        }
      }
    }
    videosRadar = [];
  }

  /* Mesma lógica do site (09-site/app.js:129-144): só o radar visível roda.
     Sem IntersectionObserver os vídeos simplesmente ficam pausados. */
  function observarRadar() {
    if (!videosRadar.length) return;
    if (typeof raiz.IntersectionObserver === "undefined") return;

    observadorRadar = new raiz.IntersectionObserver(
      function (entradas) {
        for (var i = 0; i < entradas.length; i++) {
          var entrada = entradas[i];
          var v = entrada && entrada.target;
          if (!v) continue;
          if (entrada.isIntersecting) {
            if (typeof v.play === "function") {
              try {
                var tentativa = v.play();
                if (tentativa && typeof tentativa.catch === "function") {
                  tentativa.catch(function () {});
                }
              } catch (e) {
                // autoplay bloqueado: segue sem animação
              }
            }
          } else if (typeof v.pause === "function") {
            try {
              v.pause();
            } catch (e) {
              // vídeo já removido
            }
          }
        }
      },
      { rootMargin: "150px 0px" }
    );

    for (var i = 0; i < videosRadar.length; i++) {
      observadorRadar.observe(videosRadar[i]);
    }
  }

  function definirStatus(texto) {
    var status = porId("lista-status");
    if (!status) return;
    status.textContent = texto || "";
    status.hidden = !texto;
  }

  function criarAvisoCache() {
    var aviso = elemento("div", "lista-aviso");
    var texto = elemento("p", "lista-aviso__texto");
    texto.textContent = "Sem conexão. Mostrando episódios guardados.";
    aviso.appendChild(texto);

    var retry = elemento("button", "botao lista-aviso__retry");
    retry.setAttribute("type", "button");
    retry.textContent = "Tentar de novo";
    retry.addEventListener("click", function () {
      return recarregarLista();
    });
    aviso.appendChild(retry);
    return aviso;
  }

  function criarBlocoErro() {
    var bloco = elemento("div", "lista-erro");
    var texto = elemento("p", "lista-erro__texto");
    texto.textContent = "Não consegui carregar os episódios. Verifique sua conexão.";
    bloco.appendChild(texto);

    var retry = elemento("button", "botao botao--ouro lista-erro__retry");
    retry.setAttribute("type", "button");
    retry.textContent = "Tentar de novo";
    retry.addEventListener("click", function () {
      return recarregarLista();
    });
    bloco.appendChild(retry);
    return bloco;
  }

  function renderizarLista(resultado) {
    var conteudo = porId("lista-conteudo");
    if (!conteudo) return false;

    var eps = resultado && Array.isArray(resultado.episodios) ? resultado.episodios : [];
    var estado = resultado ? resultado.estado : null;
    var veioDoCache = !!(resultado && resultado.veioDoCache);

    pararRadar();
    conteudo.innerHTML = "";
    definirStatus("");

    if (estado === "vazio" || (estado === "ok" && eps.length === 0)) {
      conteudo.appendChild(criarBlocoVazio());
      observarRadar();
      return true;
    }

    if (estado === "erro" && eps.length === 0) {
      // Erro de rede NUNCA vira "em breve" (Review Focus nº4).
      conteudo.appendChild(criarBlocoErro());
      return true;
    }

    if (estado === "ok" || estado === "erro") {
      var lista = elemento("div", "lista__cards");
      for (var i = 0; i < eps.length; i++) {
        lista.appendChild(criarCard(eps[i]));
      }
      conteudo.appendChild(lista);

      if (estado === "erro") {
        conteudo.appendChild(criarAvisoCache());
      } else if (veioDoCache) {
        definirStatus("Mostrando episódios guardados.");
      }
      return true;
    }

    // Estado inesperado: falha honesta, nunca uma lista falsa.
    conteudo.appendChild(criarBlocoErro());
    return true;
  }

  function recarregarLista() {
    var conteudo = porId("lista-conteudo");
    if (conteudo) {
      pararRadar();
      conteudo.innerHTML = "";
    }
    definirStatus("Carregando episódios…");

    promessaLista = null;
    var promessa = preBuscarLista();
    if (!promessa) {
      renderizarLista({ episodios: [], estado: "erro", veioDoCache: false });
      return null;
    }
    return promessa;
  }

  /* ---------- pré-busca da lista ---------- */

  /* Dispara a leitura pública em paralelo à splash e entrega o resultado ao
     render assim que chega (a vista #lista pode estar oculta: sem problema). */
  function preBuscarLista() {
    if (promessaLista) return promessaLista;

    var dados = raiz.SCDados;
    var api = sessaoApi();
    if (!dados || typeof dados.carregarEpisodios !== "function" || !api) return null;
    if (typeof api.cliente !== "function") return null;

    var cliente = api.cliente();
    if (!cliente) return null;

    promessaLista = dados.carregarEpisodios(cliente, dados.cache);
    if (promessaLista && typeof promessaLista.then === "function") {
      promessaLista.then(renderizarLista, function () {
        renderizarLista({ episodios: [], estado: "erro", veioDoCache: false });
      });
    }
    return promessaLista;
  }

  /* ---------- API para as próximas tasks ---------- */

  raiz.SCApp = {
    vistaAtual: vistaAtual,
    irPara: irPara,
    menuAberto: menuAberto,
    preBuscarLista: preBuscarLista,
    listaPreCarregada: function () {
      return promessaLista;
    },
    renderizarLista: renderizarLista,
    recarregarLista: recarregarLista,
    /* Painel do admin (rodada 2): atualiza também as vistas novas abertas. */
    recarregarSecoes: function () {
      var devocionais = raiz.SCDevocionais;
      if (devocionais && typeof devocionais.recarregar === "function") {
        devocionais.recarregar();
      }
      var canais = raiz.SCCanais;
      if (canais && typeof canais.recarregar === "function") canais.recarregar();
    },
    abrirVideo: abrirVideo,
    fecharVideo: fecharVideo,
    videoAberto: videoAberto,
    abrirAudio: abrirAudio,
    fecharAudio: fecharAudio,
    audioAberto: audioAberto,
    episodioSelecionado: function (ep) {
      // Card clicado na lista. VÍDEO primeiro: decisão do dono em 23/10, após
      // teste real — todo episódio publicado tem MP3, e o "MP3 primeiro"
      // anterior tornava o player de vídeo inalcançável. O áudio (único
      // formato que sobrevive à tela travada — Task 8) fica a um toque:
      // "Ouvir áudio" no player de vídeo faz a troca manual.
      return abrirVideo(ep);
    }
  };

  /* ---------- boot ---------- */

  try {
    configurarConta();
    configurarAdmin();
    configurarContaAjustes();
    configurarMenu();
    configurarBiblia();
    configurarSecoes();
    configurarSplash();
    configurarVoltarAndroid();
    registrarServiceWorker();

    // Sessão guardada + lista em paralelo, por trás da vinheta.
    var api = sessaoApi();
    if (api) {
      api.usuarioAtual();
      if (typeof api.aoMudar === "function") api.aoMudar(aoMudarSessao);
    }
    atualizarBotaoAdmin();
    atualizarBotaoConta(api ? api.usuarioAtual() : null);
    preBuscarLista();
  } catch (e) {
    // Qualquer falha de boot não pode deixar a splash presa na tela.
    if (raiz.console && raiz.console.error) raiz.console.error("Stronger Cast: boot", e);
    esconderSplash();
  }
})(typeof window !== "undefined" ? window : globalThis);
