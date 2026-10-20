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

  /* Exemplo de como fica o próximo episódio (apague ao usar):
  {
    num: "02",
    titulo: "Título do EP02 aqui",
    convidado: "Nome do convidado",
    data: "29/10/2026",
    youtubeId: "",
    spotifyId: "",
  },
  */
];

/* Links gerais do podcast (rodapé + botões). Troque quando tiver. */
window.LINKS = {
  youtube:  "",   // ex.: "https://www.youtube.com/@StrongerCast"
  spotify:  "",   // ex.: "https://open.spotify.com/show/abc123"
  instagram:"",   // ex.: "https://instagram.com/strongercast"
  email:    "",   // ex.: "contato@strongercast.com.br"
};
