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

  /* IA Bíblica (26/10): chat com a API REST do Gemini, sem SDK e sem servidor
     intermediário. Por decisão do dono, a chave vai embutida no app — o mesmo
     código roda no WebView do Android e no PWA do navegador. A lista é uma
     cascata: se um modelo estiver sem cota/sobrecarregado, o próximo assume.
     `gemini-3.5-flash-lite` foi o que respondeu 200 no teste real de 26/10. */
  var ia = {
    chave: "AQ.Ab8RN6Lavsp855f_XUrdz8v_iBTx7ox7a6jpqXc2RDZypqb_NA",
    url: "https://generativelanguage.googleapis.com/v1beta/models/",
    modelos: ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash"]
  };

  raiz.SC_SUPABASE = config; // no navegador: window.SC_SUPABASE
  raiz.SC_IA = ia; // no navegador: window.SC_IA

  if (typeof module !== "undefined" && module.exports) {
    module.exports = config;
    module.exports.SC_IA = ia; // Node: require(…).SC_IA
  }
})(typeof window !== "undefined" ? window : globalThis);
