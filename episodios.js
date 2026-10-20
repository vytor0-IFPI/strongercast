/* ============================================================
   EPISÓDIOS — Stronger Cast
   ------------------------------------------------------------
   PRA LANÇAR UM EPISÓDIO NOVO: copie um bloco { ... } inteiro,
   cole na lista (o mais recente PRIMEIRO), e edite:

     num        → número do episódio ("02", "03"...)
     titulo     → título do episódio
     convidado  → nome do convidado (ou "" se não tiver)
     data       → data de lançamento (dia/mês/ano)
     youtubeId  → só o ID do vídeo do YouTube. É o trecho que
                  aparece depois de "v=" no link, ex.:
                  https://www.youtube.com/watch?v=AbC123dEfGh
                                      ^^^^^^^^^^^^^^^^^ ID
                  Enquanto o vídeo não existir, deixe "" que o
                  site mostra "em breve".
     spotifyId  → só o ID da página do episódio no Spotify, o
                  trecho depois de "episode/" no link:
                  https://open.spotify.com/episode/6Jabc...
                                ^^^^^^^^^^^^^ ID
                  Deixe "" se ainda não tiver.
   ============================================================ */

window.EPISODIOS = [
  {
    num: "01",
    titulo: "Como ser um jovem forte nessa geração?",
    convidado: "Pastora Vanessa",
    data: "22/10/2026",
    youtubeId: "HdGmrx2ysAVSyhLn",   // ex.: "dQw4w9WgXcQ"
    spotifyId: "",   // ex.: "6Jabc123XYZ"
  },

  /* ---------- SLOTS: EP02 a EP08 ----------
     Já estão criados e JÁ APARECEM no site como "em breve"
     (animação do radar no vídeo). Quando for lançar, preencha
     título/convidado/data; assim que o `titulo` estiver
     preenchido os botões aparecem. Coloque o `youtubeId` e o
     vídeo real substitui a animação.
     Ordem da lista = ordem de exibição (de cima pra baixo).
     Mantenha o EP01 no topo enquanto for a estreia. */
  { num: "02", titulo: "", convidado: "", data: "", youtubeId: "", spotifyId: "" },
  { num: "03", titulo: "", convidado: "", data: "", youtubeId: "", spotifyId: "" },
  { num: "04", titulo: "", convidado: "", data: "", youtubeId: "", spotifyId: "" },
  { num: "05", titulo: "", convidado: "", data: "", youtubeId: "", spotifyId: "" },
  { num: "06", titulo: "", convidado: "", data: "", youtubeId: "", spotifyId: "" },
  { num: "07", titulo: "", convidado: "", data: "", youtubeId: "", spotifyId: "" },
  { num: "08", titulo: "", convidado: "", data: "", youtubeId: "", spotifyId: "" },
];

/* Links gerais do podcast (rodapé + botões). Troque quando tiver. */
window.LINKS = {
  youtube:  "",   // ex.: "https://www.youtube.com/@StrongerCast"
  spotify:  "",   // ex.: "https://open.spotify.com/show/abc123"
  instagram:"",   // ex.: "https://instagram.com/strongercast"
  email:    "",   // ex.: "contato@strongercast.com.br"
};
