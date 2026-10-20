/* ============================================================
   EPISÓDIOS — Stronger Cast
   ------------------------------------------------------------
   PRA LANÇAR UM EPISÓDIO NOVO: copie um bloco { ... } inteiro,
   cole na lista, e edite:

     num       → número do episódio ("02", "03"...)
     titulo    → título do episódio
     convidado → nome do convidado (ou "" se não tiver)
     data      → data de lançamento (dia/mês/ano)

     youtube   → COLE O LINK DO VÍDEO INTEIRO, do jeito que
                 aparece no navegador ou no botão "Compartilhar":
                   "https://www.youtube.com/watch?v=AbC123dEfGh"
                   "https://youtu.be/AbC123dEfGh"
                   "https://www.youtube.com/shorts/AbC123dEfGh"
                 O site extrai o ID sozinho (se colar o ID puro,
                 também funciona). Enquanto estiver "", o card
                 mostra a animação "em breve".

     spotify   → COLE O LINK DO EPISÓDIO no Spotify:
                   "https://open.spotify.com/episode/6Jabc..."
                 Deixe "" se ainda não tiver.

   IMPORTANTE: depois de editar, dê Ctrl+S pra salvar — senão
   nada muda no site.
   ============================================================ */

window.EPISODIOS = [
  {
    num: "01",
    titulo: "Como ser um jovem forte nessa geração?",
    convidado: "Pastora Vanessa",
    data: "22/10/2026",
    youtube: "https://youtu.be/1scRVOgYCq8?is=ZsmtTq2KrEvvsb2m",   // ex.: "https://www.youtube.com/watch?v=AbC123dEfGh"
    spotify: "",   // ex.: "https://open.spotify.com/episode/6Jabc123XYZ"
  },

  /* ---------- SLOTS: EP02 a EP08 ----------
     Já estão criados e JÁ APARECEM no site como "em breve"
     (animação do radar no vídeo). Quando for lançar, preencha
     título/convidado/data; assim que o `titulo` estiver
     preenchido os botões aparecem. Cole o `youtube` e o vídeo
     real substitui a animação.
     Ordem da lista = ordem de exibição (de cima pra baixo).
     Mantenha o EP01 no topo enquanto for a estreia. */
  { num: "02", titulo: "", convidado: "", data: "", youtube: "", spotify: "" },
  { num: "03", titulo: "", convidado: "", data: "", youtube: "", spotify: "" },
  { num: "04", titulo: "", convidado: "", data: "", youtube: "", spotify: "" },
  { num: "05", titulo: "", convidado: "", data: "", youtube: "", spotify: "" },
  { num: "06", titulo: "", convidado: "", data: "", youtube: "", spotify: "" },
  { num: "07", titulo: "", convidado: "", data: "", youtube: "", spotify: "" },
  { num: "08", titulo: "", convidado: "", data: "", youtube: "", spotify: "" },
];

/* Links gerais do podcast (rodapé + botões). Troque quando tiver. */
window.LINKS = {
  youtube:   "",   // ex.: "https://www.youtube.com/@StrongerCast"
  spotify:   "https://open.spotify.com/show/5pI64OXBjqYYL5hbeM9loA",   // ← link do show (seu)
  instagram: "",   // ex.: "https://instagram.com/strongercast"
  email:     "",   // ex.: "contato@strongercast.com.br"
};
