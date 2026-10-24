/* Stronger Cast — extratores de IDs.
   Serve no WebView (window.SCExtratores) e no Node (module.exports). */
(function () {
  "use strict";

  /* Mesma lógica de 09-site/app.js:13-24, com as adaptações exigidas pela
     interface do app:
       - devolve null em vez de "" (o app trata "sem vídeo" como null);
       - regexes case-insensitive, para link colado em MAIÚSCULAS;
       - nos links, o ID pode ter qualquer tamanho (o mínimo de 6 do site
         continua valendo para ID puro, que é o que evita aceitar "nada"). */
  function idDoVideo(link) {
    if (!link) return null;
    var s = String(link).trim();
    var m =
      s.match(/[?&]v=([\w-]+)/i) ||                 // youtube.com/watch?v=...
      s.match(/youtu\.be\/([\w-]+)/i) ||            // youtu.be/...
      s.match(/(?:shorts|embed|live)\/([\w-]+)/i);  // Shorts, embed, live
    if (m) return m[1];
    if (/^[\w-]{6,}$/.test(s)) return s;            // já é só o ID
    return null;
  }

  function urlThumb(id) {
    return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
  }

  var api = { idDoVideo: idDoVideo, urlThumb: urlThumb };

  if (typeof window !== "undefined") window.SCExtratores = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
