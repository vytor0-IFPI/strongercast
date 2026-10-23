/* Stronger Cast — renderiza episódios e links.
   A fonte é o Supabase (episódios publicados); se o servidor falhar, demorar
   mais de 3 s ou devolver lista vazia, cai no arquivo episodios.js. */

/* Interface do site: Promise<Array|null>. `null` em QUALQUER falha e também
   para lista vazia — quem chama decide o fallback (window.EPISODIOS). */
function carregarEpisodiosRemotos() {
  var TEMPO_LIMITE_MS = 3000;

  function texto(valor) {
    if (valor === undefined || valor === null) return "";
    return String(valor).trim();
  }

  /* O Supabase guarda `data` como 2026-10-22; o site mostra 22/10/2026. */
  function dataDoSite(valor) {
    var s = texto(valor);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + "/" + m[2] + "/" + m[1];
    return s;
  }

  function doisDigitos(numero) {
    return numero < 10 ? "0" + numero : String(numero);
  }

  /* O render (inalterado) injeta título, convidado e data como HTML. Esses
     valores vêm do banco, então são escapados AQUI — a migração é a fronteira.
     `&` primeiro, senão as entidades geradas depois seriam reescapadas.
     URLs (youtube/spotify) NÃO passam por aqui: são link, não HTML. */
  function escaparHtml(valor) {
    return String(valor === undefined || valor === null ? "" : valor)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* Converte a linha do Supabase no formato que o render já consome
     (mesmos campos de episodios.js). A tabela não tem `num`: a numeração
     vem da ordem — a consulta é data.desc, então a linha mais antiga é a 01. */
  function migrarLinhas(linhas) {
    var migradas = [];
    for (var i = 0; i < linhas.length; i++) {
      var linha = linhas[i];
      if (!linha || typeof linha !== "object") continue;
      migradas.push({
        titulo: escaparHtml(texto(linha.titulo)),
        convidado: escaparHtml(texto(linha.convidado)),
        data: escaparHtml(dataDoSite(linha.data)),
        youtube: texto(linha.youtube),
        spotify: texto(linha.spotify),
        mp3: texto(linha.mp3),
        capa: texto(linha.capa),
        publicado: linha.publicado !== false
      });
    }
    if (!migradas.length) return null;

    var total = migradas.length;
    for (var j = 0; j < total; j++) migradas[j].num = doisDigitos(total - j);
    return migradas;
  }

  var config = (typeof window !== "undefined" && window.SUPABASE_CONFIG) || {};
  var base = texto(config.url).replace(/\/+$/, "");
  var chave = texto(config.anonKey);
  if (!base || !chave || typeof fetch !== "function") {
    return Promise.resolve(null);
  }

  var endereco =
    base + "/rest/v1/episodes?select=*&publicado=eq.true&order=data.desc";

  var busca = Promise.resolve()
    .then(function () {
      return fetch(endereco, {
        headers: {
          apikey: chave,
          "Accept-Profile": "public"
        }
      });
    })
    .then(function (resposta) {
      if (!resposta || !resposta.ok) return null;
      return resposta.json();
    })
    .then(function (linhas) {
      // Vazio NUNCA pode esvaziar o site: trata como falha e cai no arquivo.
      if (!Array.isArray(linhas) || linhas.length === 0) return null;
      return migrarLinhas(linhas);
    })
    .catch(function () {
      return null; // rede, JSON inválido, resposta estranha...
    });

  var limite = new Promise(function (_, rejeitar) {
    setTimeout(function () {
      rejeitar(new Error("Tempo esgotado ao buscar os episódios."));
    }, TEMPO_LIMITE_MS);
  });

  return Promise.race([busca, limite]).then(
    function (valor) {
      return valor;
    },
    function () {
      return null; // timeout
    }
  );
}

var pronto = (async function () {
  "use strict";

  var remotas = await carregarEpisodiosRemotos();
  var eps = remotas || window.EPISODIOS || [];
  var links = window.LINKS || {};
  var lista = document.getElementById("lista-eps");

  /* ---------- links do YouTube/Spotify ----------
     Nos campos `youtube` e `spotify` você cola o LINK INTEIRO
     do jeito que veio do navegador ou do botão "Compartilhar"
     — o site extrai o ID sozinho. ID puro também funciona. */
  function idDoVideo(link) {
    if (!link) return "";
    var s = String(link).trim();
    var m =
      s.match(/[?&]v=([\w-]{6,})/) ||               // youtube.com/watch?v=...
      s.match(/youtu\.be\/([\w-]{6,})/) ||          // youtu.be/...
      s.match(/(?:shorts|embed|live)\/([\w-]{6,})/); // Shorts, embed, live
    if (m) return m[1];
    if (/^[\w-]{6,}$/.test(s)) return s;            // já é só o ID
    console.warn("Stronger Cast: link do YouTube não entendi:", link);
    return "";
  }

  function idDoEpisodioSpotify(link) {
    if (!link) return "";
    var s = String(link).trim();
    var m = s.match(/episode\/([\w-]+)/);
    if (m) return m[1];
    if (/^[\w-]{16,}$/.test(s)) return s;           // ID puro (~22 caracteres)
    console.warn("Stronger Cast: link do Spotify não entendi:", link);
    return "";
  }

  /* ---------- episódios ----------
     Sem título = episódio ainda não lançado: o card aparece
     assim mesmo, já como "em breve" (animação do radar +
     título apagado), e os botões ficam ocultos até a pessoa
     preencher o título em episodios.js. */
  eps.forEach(function (ep) {
    var art = document.createElement("article");
    art.className = "ep";
    var esperando = !ep.titulo;

    /* aceita o LINK inteiro (watch, youtu.be, Shorts) ou o ID
       puro — quem extrai é a função idDoVideo lá em cima. O
       campo antigo (youtubeId/spotifyId) também ainda vale. */
    var idYt = idDoVideo(ep.youtube || ep.youtubeId);
    var idSp = idDoEpisodioSpotify(ep.spotify || ep.spotifyId);

    /* vídeo: embed do YouTube se tiver link; senão, animação
       "em breve" (assets/ep-placeholder.mp4) tocando até o
       vídeo real ser linkado */
    var video;
    if (idYt) {
      video =
        '<div class="ep__video">' +
        '<iframe ' +
        'src="https://www.youtube-nocookie.com/embed/' + idYt + '" ' +
        'title="EP. ' + ep.num + ' — ' + ep.titulo + '" ' +
        'loading="lazy" ' +
        'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ' +
        'allowfullscreen></iframe>' +
        '</div>';
    } else {
      video =
        '<div class="ep__video ep__video--vazio">' +
        '<video src="assets/ep-placeholder.mp4" ' +
        'poster="assets/ep-placeholder.jpg" ' +
        'muted loop playsinline preload="none" data-espera ' +
        'aria-label="Vídeo do EP. ' + ep.num + ' em breve"></video>' +
        '<span class="ep__em-breve">EM BREVE</span>' +
        '</div>';
    }

    /* botões de ação (só quando o episódio já foi anunciado
       com título — slots "em breve" ficam sem botões) */
    var ytUrl = idYt
      ? "https://www.youtube.com/watch?v=" + idYt
      : (links.youtube || "");
    var spUrl = idSp
      ? "https://open.spotify.com/episode/" + idSp
      : (links.spotify || "");

    function btn(url, classe, texto) {
      if (url) {
        return '<a class="btn ' + classe + '" href="' + url +
               '" target="_blank" rel="noopener">' + texto + '</a>';
      }
      return '<span class="btn ' + classe + ' btn--off">' + texto + '</span>';
    }

    var acoes = esperando
      ? ""
      : '<div class="ep__acoes">' +
          btn(ytUrl, "btn--ouro", "Assistir no YouTube") +
          btn(spUrl, "btn--fantasma", "Ouvir no Spotify") +
          btn(idYt ? ytUrl : "", "btn--fantasma", "Compartilhar") +
        '</div>';

    art.innerHTML =
      video +
      '<div class="ep__corpo">' +
        '<div class="ep__meta">' +
          '<span class="ep__num">EP. ' + ep.num + '</span>' +
          (ep.data ? '<span class="ep__data">' + ep.data + '</span>' : '') +
        '</div>' +
        '<h3 class="ep__titulo' + (esperando ? ' ep__titulo--espera' : '') + '">' +
          (ep.titulo || 'Em breve') +
        '</h3>' +
        (ep.convidado ? '<p class="ep__convidado">com ' + ep.convidado + '</p>' : '') +
        acoes +
      '</div>';

    lista.appendChild(art);
  });

  if (eps.length === 0) {
    lista.innerHTML =
      '<p style="color:#9a9a9a">Nenhum episódio cadastrado ainda. ' +
      'Edite <code>episodios.js</code> para adicionar.</p>';
  }

  /* ---------- animação do placeholder ----------
     Só roda quando o card está na tela e para quando sai
     (assim N cards "em breve" não tocam juntos e não
     engasgam máquinas mais fracas). */
  var esperas = document.querySelectorAll("video[data-espera]");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entradas) {
        entradas.forEach(function (e) {
          var v = e.target;
          if (e.isIntersecting) { v.play().catch(function () {}); }
          else { v.pause(); }
        });
      },
      { rootMargin: "150px 0px" }
    );
    esperas.forEach(function (v) { io.observe(v); });
  } else {
    esperas.forEach(function (v) { v.play().catch(function () {}); });
  }

  /* ---------- rodapé ---------- */
  var rl = document.getElementById("rodape-links");
  var itens = [
    ["YouTube", links.youtube],
    ["Spotify", links.spotify],
    ["Instagram", links.instagram],
    ["E-mail", links.email ? "mailto:" + links.email : ""],
  ].filter(function (i) { return i[1]; });

  rl.innerHTML = itens.length
    ? itens.map(function (i) {
        return '<a href="' + i[1] + '" target="_blank" rel="noopener">' +
               i[0] + "</a>";
      }).join("")
    : '<a href="#episodios">Links em breve</a>';

  /* ---------- ano ---------- */
  document.getElementById("ano").textContent = new Date().getFullYear();
})();

if (typeof window !== "undefined") {
  window.carregarEpisodiosRemotos = carregarEpisodiosRemotos;
  window.SCAppPronto = pronto; // os testes esperam o render terminar
}
