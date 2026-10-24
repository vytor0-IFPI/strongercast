/* Stronger Cast — configuração do backend (Supabase).
   A chave publishable (anon) é pública por design: vai no app e é versionada.
   Quem protege os dados é a RLS definida em banco/schema.sql — a chave sozinha
   só lê o que for público e não escreve nada.

   limiteMp3Mb: tamanho máximo de arquivo por upload no plano Free do Supabase
   Storage = 50 MB. Fonte oficial:
   https://supabase.com/docs/guides/storage/uploads/file-limits
   (e https://supabase.com/pricing — "Max file upload size: 50 MB" no Free). */
(function (raiz) {
  "use strict";

  var config = {
    url: "https://jucsueavrdltgaxypoyg.supabase.co",
    anonKey: "sb_publishable_-LkakXZwDxeGNffxIPvuXg_z7_sODC-",
    limiteMp3Mb: 50,

    /* Atalho de login do admin: sessao.entrar() converte "stronger" (sem
       diferenciar caixa/espaços) para adminEmail. Preenchido em 23/10 com o
       e-mail real fornecido pelo dono. */
    adminUsuario: "stronger",
    adminEmail: "vytorcarvalho372@gmail.com"
  };

  raiz.SC_SUPABASE = config; // no navegador: window.SC_SUPABASE

  if (typeof module !== "undefined" && module.exports) module.exports = config;
})(typeof window !== "undefined" ? window : globalThis);
