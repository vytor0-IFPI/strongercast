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
    youtubeId: "",   // ex.: "dQw4w9WgXcQ"
    spotifyId: "",   // ex.: "6Jabc123XYZ"
  },

  /* ---------- SLOTS PRONTOS: EP02 a EP08 ----------
     Já estão criados pra você só preencher. Enquanto o
     `titulo` estiver vazio, o episódio fica INVISÍVEL no
     site (não aparece card vazio). Coloque o título que ele
     aparece sozinho, com a animação "em breve" rodando no
     lugar do vídeo até você colar o youtubeId.
     Ordem: o mais recente PRIMEIRO (EP08 no topo quando for
     lançando — ou mantenha a ordem 01→08, tanto faz). */
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
