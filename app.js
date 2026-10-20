/* Stronger Cast — renderiza episódios e links a partir de episodios.js */
(function () {
  "use strict";

  var eps = window.EPISODIOS || [];
  var links = window.LINKS || {};
  var lista = document.getElementById("lista-eps");

  /* ---------- episódios ---------- */
  eps.forEach(function (ep) {
    var art = document.createElement("article");
    art.className = "ep";

    /* vídeo: embed do YouTube se tiver ID; senão, cartão "em breve" */
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
        '<span class="ep__em-breve">EM BREVE</span>' +
        '<span style="color:#9a9a9a;font-size:.9rem">O vídeo do EP. ' + ep.num + ' entra aqui</span>' +
        '</div>';
    }

    /* botões de ação */
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

    art.innerHTML =
      video +
      '<div class="ep__corpo">' +
        '<div class="ep__meta">' +
          '<span class="ep__num">EP. ' + ep.num + '</span>' +
          (ep.data ? '<span class="ep__data">' + ep.data + '</span>' : '') +
        '</div>' +
        '<h3 class="ep__titulo">' + ep.titulo + '</h3>' +
        (ep.convidado ? '<p class="ep__convidado">com ' + ep.convidado + '</p>' : '') +
        '<div class="ep__acoes">' +
          btn(ytUrl, "btn--ouro", "Assistir no YouTube") +
          btn(spUrl, "btn--fantasma", "Ouvir no Spotify") +
          btn(ep.youtubeId ? ytUrl : "", "btn--fantasma", "Compartilhar") +
        '</div>' +
      '</div>';

    lista.appendChild(art);
  });

  if (eps.length === 0) {
    lista.innerHTML =
      '<p style="color:#9a9a9a">Nenhum episódio cadastrado ainda. ' +
      'Edite <code>episodios.js</code> para adicionar.</p>';
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
