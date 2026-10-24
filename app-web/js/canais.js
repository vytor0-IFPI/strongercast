/* Stronger Cast — Canais recomendados (rodada 2).
   Grade de 2 colunas: vídeos tocam no MESMO overlay dos episódios
   (SCApp.abrirVideo, sem duplicar player); links de canal abrem fora pelo
   plugin oficial @capacitor/browser — API real da v8: Browser.open({url}).

   Thumbnail de vídeo: https://img.youtube.com/vi/<id>/hqdefault.jpg, com o
   placeholder local em fallback. Canal usa o placeholder local + glifo
   dourado (sem API do YouTube).

   Serve no WebView (window.SCCanais) e no Node (module.exports), com
   documento/dados/extratores injetáveis para os testes. */
(function (raiz) {
  "use strict";

  var PLACEHOLDER = "assets/ep-placeholder.jpg";
  var BASE_THUMB = "https://img.youtube.com/vi/";

  function texto(valor) {
    if (valor === undefined || valor === null) return "";
    return String(valor);
  }

  function extrator(opcoes) {
    if (opcoes && opcoes.extratores) return opcoes.extratores;
    return raiz.SCExtratores || null;
  }

  /* Só vídeo consulta o extrator. Canal NUNCA chama idDoVideo. */
  function thumbDoVideo(item, ext) {
    if (!item || item.tipo !== "video") return PLACEHOLDER;
    if (!ext || typeof ext.idDoVideo !== "function") return PLACEHOLDER;

    var id = ext.idDoVideo(item.link);
    return id ? BASE_THUMB + id + "/hqdefault.jpg" : PLACEHOLDER;
  }

  function capaDe(item, ext) {
    return item && item.tipo === "video" ? thumbDoVideo(item, ext) : PLACEHOLDER;
  }

  /* ---------- plugin Browser (@capacitor/browser v8) ---------- */

  function pluginBrowser() {
    var cap = raiz.Capacitor;
    if (!cap) return null;
    if (cap.Plugins && cap.Plugins.Browser) return cap.Plugins.Browser;

    /* App sem bundler: o proxy do plugin não nasce sozinho. registerPlugin é
       o mesmo caminho que o import de @capacitor/browser faz por baixo. */
    if (typeof cap.registerPlugin === "function") {
      try {
        cap.Plugins = cap.Plugins || {};
        cap.Plugins.Browser = cap.registerPlugin("Browser");
        return cap.Plugins.Browser;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  /* Fallback web/navegador: o "_system" é o alvo legado do window.open. */
  function abrirNoSistema(url) {
    if (typeof raiz.open === "function") {
      try {
        raiz.open(url, "_system");
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  function abrirExterno(url) {
    var link = texto(url).trim();
    if (!link) return Promise.resolve(false);

    var browser = pluginBrowser();
    if (browser && typeof browser.open === "function") {
      return Promise.resolve()
        .then(function () {
          return browser.open({ url: link });
        })
        .then(
          function () {
            return true;
          },
          function () {
            return abrirNoSistema(link);
          }
        );
    }

    return Promise.resolve(abrirNoSistema(link));
  }

  /* ---------- controlador da vista ---------- */

  function criarCanais(opcoes) {
    opcoes = opcoes || {};

    var doc = opcoes.documento || raiz.document || null;
    var dados = opcoes.dados || raiz.SCDados || null;
    var ext = extrator(opcoes);
    var cliente =
      typeof opcoes.cliente === "function"
        ? opcoes.cliente
        : function () {
            var sessao = raiz.sessao;
            return sessao && typeof sessao.cliente === "function"
              ? sessao.cliente()
              : null;
          };
    var cache = opcoes.cache || (dados && dados.cacheCanais) || null;

    var aberta = false;
    var token = 0;

    function porId(id) {
      return doc ? doc.getElementById(id) : null;
    }

    function elemento(tag, classe) {
      var el = doc.createElement(tag);
      if (classe) el.className = classe;
      return el;
    }

    function botao(rotulo, classe) {
      var el = elemento("button", classe);
      el.setAttribute("type", "button");
      el.textContent = rotulo;
      return el;
    }

    function definirStatus(mensagem) {
      var alvo = porId("canais-status");
      if (!alvo) return;
      alvo.textContent = mensagem || "";
      alvo.hidden = !mensagem;
    }

    function limparConteudo() {
      var conteudo = porId("canais-conteudo");
      if (!conteudo) return null;
      conteudo.innerHTML = ""; // casa: limpar com innerHTML vazio, texto sempre por textContent
      return conteudo;
    }

    function obterCliente() {
      try {
        return cliente ? cliente() : null;
      } catch (e) {
        return null;
      }
    }

    /* ---------- cartões ---------- */

    function abrirVideo(item) {
      var app = raiz.SCApp;
      if (app && typeof app.abrirVideo === "function") {
        // Objeto compatível com player-video.js: ele lê ep.youtube.
        return app.abrirVideo({ titulo: item.titulo, youtube: item.link });
      }
      return abrirExterno(item.link);
    }

    function criarCard(item) {
      var tipo = item && item.tipo === "canal" ? "canal" : "video";
      var card = botao("", "canal-card");
      card.setAttribute("data-tipo", tipo);
      if (item && item.id) card.setAttribute("data-canal-id", texto(item.id));
      card.setAttribute(
        "aria-label",
        ((item && item.titulo) || "Canal") +
          (tipo === "video" ? " — assistir" : " — abrir canal")
      );

      var midia = elemento("span", "canal-card__midia");
      var img = elemento("img", "canal-card__capa");
      img.setAttribute("src", capaDe(item, ext));
      img.setAttribute(
        "alt",
        item && item.titulo ? "Capa: " + item.titulo : "Capa do canal"
      );
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
      img.addEventListener("error", function () {
        // Thumb remota indisponível: cai no placeholder local, sem quebrar.
        if (img.getAttribute("src") !== PLACEHOLDER) {
          img.setAttribute("src", PLACEHOLDER);
          img.className = "canal-card__capa canal-card__capa--fallback";
        }
      });
      midia.appendChild(img);

      var glifo = elemento("span", "canal-card__glifo");
      glifo.setAttribute("aria-hidden", "true");
      glifo.textContent = "▶";
      midia.appendChild(glifo);

      if (tipo === "canal") {
        var selo = elemento("span", "canal-card__selo");
        selo.textContent = "Canal";
        midia.appendChild(selo);
      }
      card.appendChild(midia);

      var titulo = elemento("span", "canal-card__titulo");
      titulo.textContent = (item && item.titulo) || "Canal sem título";
      card.appendChild(titulo);

      var subtitulo = elemento("span", "canal-card__canal");
      subtitulo.textContent = (item && item.canal) || "YouTube";
      card.appendChild(subtitulo);

      card.addEventListener("click", function () {
        if (tipo === "video") return abrirVideo(item);
        return abrirExterno(item.link);
      });
      return card;
    }

    function criarErro() {
      var bloco = elemento("div", "secao-erro");
      var mensagem = elemento("p", "secao-erro__texto");
      mensagem.textContent =
        "Não consegui carregar os canais. Verifique sua conexão.";
      bloco.appendChild(mensagem);

      var retry = botao("Tentar de novo", "botao botao--ouro secao-erro__retry");
      retry.addEventListener("click", function () {
        return aoEntrar();
      });
      bloco.appendChild(retry);
      return bloco;
    }

    function criarAvisoCache() {
      var aviso = elemento("div", "lista-aviso");
      var mensagem = elemento("p", "lista-aviso__texto");
      mensagem.textContent = "Sem conexão. Mostrando canais guardados.";
      aviso.appendChild(mensagem);

      var retry = botao("Tentar de novo", "lista-aviso__retry");
      retry.addEventListener("click", function () {
        return aoEntrar();
      });
      aviso.appendChild(retry);
      return aviso;
    }

    function renderizar(resultado) {
      definirStatus("");

      var conteudo = limparConteudo();
      if (!conteudo) return false;

      var itens = resultado && Array.isArray(resultado.canais) ? resultado.canais : [];
      var estado = resultado ? resultado.estado : null;

      if (estado === "vazio" || (estado === "ok" && itens.length === 0)) {
        var vazio = elemento("p", "secao__vazio");
        vazio.textContent = "Nenhum canal recomendado ainda.";
        conteudo.appendChild(vazio);
        return true;
      }

      if (estado === "erro" && itens.length === 0) {
        conteudo.appendChild(criarErro());
        return true;
      }

      if (estado === "ok" || estado === "erro") {
        var grade = elemento("div", "canais__grade");
        for (var i = 0; i < itens.length; i++) {
          grade.appendChild(criarCard(itens[i]));
        }
        conteudo.appendChild(grade);

        if (estado === "erro") conteudo.appendChild(criarAvisoCache());
        return true;
      }

      conteudo.appendChild(criarErro());
      return true;
    }

    function carregar() {
      var c = obterCliente();
      if (!dados || typeof dados.carregarCanais !== "function" || !c) {
        return Promise.resolve(
          renderizar({ canais: [], estado: "erro", veioDoCache: false })
        );
      }

      var meuToken = ++token;
      return Promise.resolve()
        .then(function () {
          return dados.carregarCanais(c, cache);
        })
        .then(function (resultado) {
          if (meuToken !== token || !aberta) return false;
          return renderizar(resultado);
        })
        .catch(function () {
          if (meuToken !== token || !aberta) return false;
          return renderizar({ canais: [], estado: "erro", veioDoCache: false });
        });
    }

    function aoEntrar() {
      aberta = true;
      if (!doc) return Promise.resolve(false);

      var conteudo = limparConteudo();
      if (conteudo) {
        var carregando = elemento("p", "secao__vazio");
        carregando.textContent = "Carregando canais…";
        conteudo.appendChild(carregando);
      }
      definirStatus("");

      return carregar();
    }

    function voltar() {
      if (!aberta) return false;

      fechar();
      var app = raiz.SCApp;
      if (app && typeof app.irPara === "function") app.irPara("lista");
      return "lista";
    }

    function fechar() {
      aberta = false;
      token++;
      definirStatus("");
      return true;
    }

    function recarregar() {
      return aberta ? aoEntrar() : Promise.resolve(false);
    }

    function estado() {
      return { aberta: aberta };
    }

    return {
      aoEntrar: aoEntrar,
      renderizar: renderizar,
      abrirExterno: abrirExterno,
      voltar: voltar,
      fechar: fechar,
      recarregar: recarregar,
      estado: estado,
      estaAberto: function () {
        return aberta;
      }
    };
  }

  var api = {
    criar: criarCanais,
    capaDe: capaDe,
    thumbDoVideo: thumbDoVideo,
    abrirExterno: abrirExterno,
    PLACEHOLDER: PLACEHOLDER
  };

  /* Instância da página (index.html): usada pelo app.js via window.SCCanais. */
  var padrao = criarCanais({});
  api.aoEntrar = padrao.aoEntrar;
  api.renderizar = padrao.renderizar;
  api.abrirExterno = padrao.abrirExterno;
  api.voltar = padrao.voltar;
  api.fechar = padrao.fechar;
  api.recarregar = padrao.recarregar;
  api.estado = padrao.estado;
  api.estaAberto = padrao.estaAberto;

  raiz.SCCanais = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
