/* Stronger Cast — service worker da PWA (rodada 3).
   Escopo relativo ao próprio arquivo: funciona tanto na raiz quanto em
   /strongercast/app-web/ (GitHub Pages).

   Estratégia: precache do app shell + Bíblia inteira no install; cache-first
   para GET same-origin com fallback de rede. Requisições de terceiros
   (Supabase, YouTube, MP3s) passam direto pela rede — nada de API alheia
   no cache. Vídeos .mp4 ficam de fora de propósito (peso); offline a splash
   cai no fallback de CSS que já existe. */
"use strict";

var CACHE = "sc-v1";

/* Tudo que o app precisa para abrir (e ler a Bíblia) sem rede.
   Caminhos relativos ao sw.js; "./" é a raiz do escopo (start_url). */
var PRECACHE = [
  "./",
  "index.html",
  "css/style.css",
  "css/app.css",
  "js/config.js",
  "js/extratores.js",
  "js/dados.js",
  "js/validacao.js",
  "js/sessao.js",
  "js/admin.js",
  "js/biblia.js",
  "js/devocionais.js",
  "js/canais.js",
  "js/player-video.js",
  "js/player-audio.js",
  "js/app.js",
  "vendor/supabase.js",
  "manifest.webmanifest",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/apple-touch-icon.png",
  "assets/logo.png",
  "assets/ep-placeholder.jpg",
  "dados/biblia/indice.json",
  "dados/biblia/LICENCA.md",
  "dados/biblia/blivre-1co.json",
  "dados/biblia/blivre-1cr.json",
  "dados/biblia/blivre-1jo.json",
  "dados/biblia/blivre-1pe.json",
  "dados/biblia/blivre-1rs.json",
  "dados/biblia/blivre-1sm.json",
  "dados/biblia/blivre-1tm.json",
  "dados/biblia/blivre-1ts.json",
  "dados/biblia/blivre-2co.json",
  "dados/biblia/blivre-2cr.json",
  "dados/biblia/blivre-2jo.json",
  "dados/biblia/blivre-2pe.json",
  "dados/biblia/blivre-2rs.json",
  "dados/biblia/blivre-2sm.json",
  "dados/biblia/blivre-2tm.json",
  "dados/biblia/blivre-2ts.json",
  "dados/biblia/blivre-3jo.json",
  "dados/biblia/blivre-ag.json",
  "dados/biblia/blivre-am.json",
  "dados/biblia/blivre-ap.json",
  "dados/biblia/blivre-at.json",
  "dados/biblia/blivre-cl.json",
  "dados/biblia/blivre-ct.json",
  "dados/biblia/blivre-dn.json",
  "dados/biblia/blivre-dt.json",
  "dados/biblia/blivre-ec.json",
  "dados/biblia/blivre-ed.json",
  "dados/biblia/blivre-ef.json",
  "dados/biblia/blivre-et.json",
  "dados/biblia/blivre-ex.json",
  "dados/biblia/blivre-ez.json",
  "dados/biblia/blivre-fm.json",
  "dados/biblia/blivre-fp.json",
  "dados/biblia/blivre-gl.json",
  "dados/biblia/blivre-gn.json",
  "dados/biblia/blivre-hb.json",
  "dados/biblia/blivre-hc.json",
  "dados/biblia/blivre-is.json",
  "dados/biblia/blivre-jd.json",
  "dados/biblia/blivre-jl.json",
  "dados/biblia/blivre-jn.json",
  "dados/biblia/blivre-job.json",
  "dados/biblia/blivre-jo.json",
  "dados/biblia/blivre-jr.json",
  "dados/biblia/blivre-js.json",
  "dados/biblia/blivre-jz.json",
  "dados/biblia/blivre-lc.json",
  "dados/biblia/blivre-lm.json",
  "dados/biblia/blivre-lv.json",
  "dados/biblia/blivre-mc.json",
  "dados/biblia/blivre-ml.json",
  "dados/biblia/blivre-mq.json",
  "dados/biblia/blivre-mt.json",
  "dados/biblia/blivre-na.json",
  "dados/biblia/blivre-ne.json",
  "dados/biblia/blivre-nm.json",
  "dados/biblia/blivre-ob.json",
  "dados/biblia/blivre-os.json",
  "dados/biblia/blivre-pv.json",
  "dados/biblia/blivre-rm.json",
  "dados/biblia/blivre-rt.json",
  "dados/biblia/blivre-sf.json",
  "dados/biblia/blivre-sl.json",
  "dados/biblia/blivre-tg.json",
  "dados/biblia/blivre-tt.json",
  "dados/biblia/blivre-zc.json"
];

/* install: baixa o app shell inteiro e assume o controle sem esperar que
   todas as abas antigas fechem. Se um arquivo faltar, o install falha e o
   SW antigo continua — preferimos isso a um cache pela metade. */
self.addEventListener("install", function (evento) {
  evento.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(PRECACHE);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* activate: remove versões antigas (bump do CACHE a cada publicação). */
self.addEventListener("activate", function (evento) {
  evento.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(
        nomes.map(function (nome) {
          if (nome === CACHE) return null;
          return caches.delete(nome);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* fetch: só GET da própria origem. Cache primeiro; sem cache, rede.
   Se a rede falhar e não houver cache, a falha segue natural (nada de HTML
   de erro inventado). Cross-origin (Supabase, YouTube, MP3s) passa direto. */
self.addEventListener("fetch", function (evento) {
  var pedido = evento.request;
  if (pedido.method !== "GET") return;

  var url;
  try {
    url = new URL(pedido.url);
  } catch (e) {
    return; // URL que o navegador não entende: deixa passar
  }
  if (url.origin !== self.location.origin) return;

  evento.respondWith(
    caches.match(pedido).then(function (emCache) {
      if (emCache) return emCache;
      return fetch(pedido);
    })
  );
});
