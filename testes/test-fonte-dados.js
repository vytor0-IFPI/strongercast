/* Testes da fonte de dados do site — `node testes/test-fonte-dados.js`.
   Roda o app.js de verdade num DOM mínimo e com `fetch` stubado: sem rede.
   Regra do spec: o site NUNCA fica vazio — qualquer falha (rede, HTTP, JSON,
   timeout) E também lista vazia caem no arquivo `episodios.js`. */
"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var RAIZ = path.join(__dirname, "..");
var FONTE_CONFIG = fs.readFileSync(path.join(RAIZ, "supabase-config.js"), "utf8");
var FONTE_EPISODIOS = fs.readFileSync(path.join(RAIZ, "episodios.js"), "utf8");
var FONTE_APP = fs.readFileSync(path.join(RAIZ, "app.js"), "utf8");

var total = 0;
var fila = [];

function teste(nome, fn) {
  fila.push({ nome: nome, fn: fn });
}

/* ---------- DOM mínimo ---------- */

function criarElemento(tag) {
  return {
    tagName: tag,
    className: "",
    innerHTML: "",
    textContent: "",
    hidden: false,
    children: [],
    appendChild: function (filho) {
      this.children.push(filho);
      return filho;
    },
    play: function () {
      return Promise.resolve();
    },
    pause: function () {}
  };
}

/* Monta um "mundo" novo: window, document, fetch e roda os 3 scripts.
   Devolve o que o teste precisa observar. */
function criarMundo(fetchStub) {
  var elementos = {
    "lista-eps": criarElemento("div"),
    "rodape-links": criarElemento("nav"),
    "ano": criarElemento("span")
  };

  var janela = {};

  var contexto = {
    window: janela,
    document: {
      getElementById: function (id) {
        return Object.prototype.hasOwnProperty.call(elementos, id)
          ? elementos[id]
          : null;
      },
      createElement: criarElemento,
      querySelectorAll: function () {
        return [];
      }
    },
    fetch: fetchStub,
    console: console,
    Promise: Promise,
    Date: Date,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };

  vm.createContext(contexto);
  vm.runInContext(FONTE_CONFIG, contexto, { filename: "supabase-config.js" });
  vm.runInContext(FONTE_EPISODIOS, contexto, { filename: "episodios.js" });
  vm.runInContext(FONTE_APP, contexto, { filename: "app.js" });

  return {
    janela: janela,
    lista: elementos["lista-eps"],
    pronto: janela.SCAppPronto
  };
}

/* ---------- fetch falso ---------- */

function fetchOk(linhas) {
  var chamadas = [];
  var stub = function (url, opcoes) {
    chamadas.push({ url: url, opcoes: opcoes });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: function () {
        return Promise.resolve(linhas);
      }
    });
  };
  stub.chamadas = chamadas;
  return stub;
}

function fetchFalha() {
  return function () {
    return Promise.reject(new Error("rede fora"));
  };
}

function fetchNunca() {
  return function () {
    return new Promise(function () {});
  };
}

/* ---------- linhas no formato do Supabase ---------- */

function linha(opcoes) {
  opcoes = opcoes || {};
  return {
    id: opcoes.id || "11111111-1111-4111-8111-111111111111",
    titulo: opcoes.titulo || "Episódio remoto",
    convidado: opcoes.convidado === undefined ? "Convidado" : opcoes.convidado,
    data: opcoes.data || "2026-10-22",
    youtube: opcoes.youtube === undefined ? "https://youtu.be/AbC123dEfGh" : opcoes.youtube,
    spotify: opcoes.spotify === undefined ? null : opcoes.spotify,
    mp3: opcoes.mp3 || "https://exemplo.supabase.co/storage/v1/object/public/midias/mp3s/ep.mp3",
    capa: opcoes.capa === undefined ? null : opcoes.capa,
    publicado: opcoes.publicado !== false
  };
}

/* ---------- 1. REST ok com 2 linhas ---------- */

teste("REST ok com 2 linhas: render usa as linhas remotas", async function () {
  var fetch = fetchOk([
    linha({ titulo: "Remoto novo", data: "2026-11-05" }),
    linha({ titulo: "Remoto antigo", data: "2026-01-10", convidado: "Outra Pessoa" })
  ]);
  var mundo = criarMundo(fetch);
  assert.ok(mundo.pronto, "app.js deve expor window.SCAppPronto");
  await mundo.pronto;

  assert.strictEqual(mundo.lista.children.length, 2);
  var primeiro = mundo.lista.children[0];
  var segundo = mundo.lista.children[1];
  assert.ok(primeiro.innerHTML.indexOf("Remoto novo") !== -1, "primeiro = mais recente");
  assert.ok(primeiro.innerHTML.indexOf("05/11/2026") !== -1, "data ISO vira dd/mm/aaaa");
  assert.ok(segundo.innerHTML.indexOf("Remoto antigo") !== -1);
  assert.ok(primeiro.innerHTML.indexOf("EP. 02") !== -1, "numeração: mais antigo = 01");
  assert.ok(segundo.innerHTML.indexOf("EP. 01") !== -1);
  assert.ok(
    mundo.lista.innerHTML.indexOf("Como ser um jovem forte") === -1,
    "arquivo local não deve ser usado quando o remoto vem cheio"
  );

  /* a chamada usa a tabela certa, o filtro e a chave publishable */
  assert.strictEqual(fetch.chamadas.length, 1);
  var url = fetch.chamadas[0].url;
  var opcoes = fetch.chamadas[0].opcoes || {};
  assert.ok(url.indexOf("/rest/v1/episodes") !== -1, "endpoint episodes");
  assert.ok(url.indexOf("publicado=eq.true") !== -1, "só publicados");
  assert.ok(url.indexOf("order=data.desc") !== -1, "mais recentes primeiro");
  assert.strictEqual(
    opcoes.headers.apikey,
    mundo.janela.SUPABASE_CONFIG.anonKey,
    "header apikey = chave publishable da config"
  );
  assert.strictEqual(opcoes.headers["Accept-Profile"], "public");
});

/* ---------- 2. REST falha ---------- */

teste("REST falha: cai no arquivo e mantém os 8 cards", async function () {
  var mundo = criarMundo(fetchFalha());
  await mundo.pronto;

  assert.strictEqual(mundo.lista.children.length, 8);
  var html = mundo.lista.children
    .map(function (c) { return c.innerHTML; })
    .join("\n");
  assert.ok(html.indexOf("Como ser um jovem forte nessa geração?") !== -1, "EP01 do arquivo");
  assert.ok(html.indexOf("Pastora Vanessa") !== -1, "convidado do arquivo");
  var vazios = mundo.lista.children.filter(function (c) {
    return c.innerHTML.indexOf("ep__video--vazio") !== -1;
  });
  assert.strictEqual(vazios.length, 7, "7 slots em breve continuam no ar");
});

/* ---------- 3. REST ok com lista vazia ---------- */

teste("REST vazio ([]): também cai no arquivo, nunca esvazia o site", async function () {
  var mundo = criarMundo(fetchOk([]));
  await mundo.pronto;

  assert.strictEqual(mundo.lista.children.length, 8);
  assert.ok(
    mundo.lista.children[0].innerHTML.indexOf("Como ser um jovem forte nessa geração?") !== -1,
    "primeiro card é o EP01 do arquivo"
  );
});

/* ---------- 4. REST demora mais de 3 s ---------- */

teste("REST demora > 3 s: timeout e fallback pro arquivo", async function () {
  var inicio = Date.now();
  var mundo = criarMundo(fetchNunca());
  await mundo.pronto;
  var decorrido = Date.now() - inicio;

  assert.strictEqual(mundo.lista.children.length, 8);
  assert.ok(decorrido >= 2900, "esperou o timeout de 3 s (levou " + decorrido + " ms)");
  assert.ok(
    mundo.lista.children[0].innerHTML.indexOf("Como ser um jovem forte nessa geração?") !== -1
  );
});

/* ---------- 5. link youtu.be do Supabase ---------- */

teste("linha remota com youtu.be: embed resolve pelo extrator do site", async function () {
  var mundo = criarMundo(
    fetchOk([linha({ titulo: "Com link curto", youtube: "https://youtu.be/AbC123dEfGh?t=42" })])
  );
  await mundo.pronto;

  assert.strictEqual(mundo.lista.children.length, 1);
  var html = mundo.lista.children[0].innerHTML;
  assert.ok(
    html.indexOf("https://www.youtube-nocookie.com/embed/AbC123dEfGh") !== -1,
    "embed com o ID extraído do youtu.be"
  );
  assert.ok(
    html.indexOf("https://www.youtube.com/watch?v=AbC123dEfGh") !== -1,
    "botão Assistir aponta para o vídeo"
  );
});

/* ---------- 6. dados remotos hostis não viram HTML ---------- */

teste("linha remota com HTML no título/convidado/data: escapa na migração", async function () {
  var tituloMau = '<img src=x onerror="alert(\'x\')">';
  var convidadoMau = '<script>alert("x")</script>';
  var dataMau = '22/10/2026<script>alert(2)</script>';
  var mundo = criarMundo(
    fetchOk([linha({ titulo: tituloMau, convidado: convidadoMau, data: dataMau })])
  );
  await mundo.pronto;

  assert.strictEqual(mundo.lista.children.length, 1);
  var html = mundo.lista.children[0].innerHTML;

  assert.ok(html.indexOf("<img") === -1, "nenhuma tag <img> injetada");
  assert.ok(html.indexOf("<script") === -1, "nenhuma tag <script> injetada");
  assert.ok(
    html.indexOf("&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;") !== -1,
    "título escapado (inclui aspas simples e duplas)"
  );
  assert.ok(
    html.indexOf("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;") !== -1,
    "convidado escapado"
  );
  assert.ok(
    html.indexOf("22/10/2026&lt;script&gt;alert(2)&lt;/script&gt;") !== -1,
    "data fora do formato ISO também é escapada"
  );
});

/* ---------- execução sequencial ---------- */

(async function () {
  for (var i = 0; i < fila.length; i++) {
    total++;
    try {
      await fila[i].fn();
      console.log("ok " + total + " - " + fila[i].nome);
    } catch (e) {
      console.log("FALHOU: " + fila[i].nome);
      console.log("  " + e.message);
      process.exit(1);
    }
  }
  console.log("OK: " + total + " testes");
})().catch(function (e) {
  console.log("FALHOU: execução");
  console.log("  " + e.message);
  process.exit(1);
});
