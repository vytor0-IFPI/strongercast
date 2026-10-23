/* Stronger Cast — configuração pública do Supabase usada pelo site.
   A chave publishable (anon) é pública por design: vai no site e é versionada.
   Quem protege os dados é a RLS definida no banco — a chave sozinha só lê o
   que for público (episódios com publicado = true) e não escreve nada.

   Mesmos valores do app (10-app/www/js/config.js). */
(function (raiz) {
  "use strict";

  var config = {
    url: "https://jucsueavrdltgaxypoyg.supabase.co",
    anonKey: "sb_publishable_-LkakXZwDxeGNffxIPvuXg_z7_sODC-",
    limiteMp3Mb: 50
  };

  raiz.SUPABASE_CONFIG = config; // no navegador: window.SUPABASE_CONFIG

  if (typeof module !== "undefined" && module.exports) module.exports = config;
})(typeof window !== "undefined" ? window : globalThis);
