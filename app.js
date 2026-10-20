/* Stronger Cast — renderiza episódios e links a partir de episodios.js */
(function () {
  "use strict";

  var eps = window.EPISODIOS || [];
  var links = window.LINKS || {};
  var lista = document.getElementById("lista-eps");

  /* ---------- episódios ----------
     Sem título = episódio ainda não lançado: o card aparece
     assim mesmo, já como "em breve" (animação do radar +
     título apagado), e os botões ficam ocultos até a pessoa
     preencher o título em episodios.js. */
  eps.forEach(function (ep) {
    var art = document.createElement("article");
    art.className = "ep";
    var esperando = !ep.titulo;

    /* vídeo: embed do YouTube se tiver ID; senão, animação
       "em breve" (assets/ep-placeholder.mp4) tocando até o
       vídeo real ser linkado */
    var video;
    if (ep.youtubeId) {
      video =
        '<div class="ep__video">' +
        '<iframe ' +
        'src="https://www.youtube-nocookie.com/embed/' + ep.youtubeId + '" ' +
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
    var ytUrl = ep.youtubeId
      ? "https://www.youtube.com/watch?v=" + ep.youtubeId
      : (links.youtube || "");
    var spUrl = ep.spotifyId
      ? "https://open.spotify.com/episode/" + ep.spotifyId
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
          btn(ep.youtubeId ? ytUrl : "", "btn--fantasma", "Compartilhar") +
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
