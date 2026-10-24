/* Stronger Cast — camada de dados (Supabase → Episodio + cache local).
   Serve no WebView (window.SCDados) e no Node (module.exports).
   Não importa supabase: o cliente chega como parâmetro. */
(function () {
  "use strict";

  var CHAVE_CACHE = "sc_episodios_v1";
  var CHAVE_CACHE_DEVOCIONAIS = "sc_devocionais_v1";
  var CHAVE_CACHE_CANAIS = "sc_canais_v1";

  /* Campo ausente, null ou "" vira null (o app trata "sem dado" como null). */
  function campo(linha, nome) {
    var valor = linha == null ? null : linha[nome];
    if (valor === undefined || valor === null || valor === "") return null;
    return valor;
  }

  /* Linha da tabela `episodes` → Episodio consumido pela UI. */
  function mapearEpisodio(linha) {
    return {
      id: campo(linha, "id"),
      titulo: campo(linha, "titulo"),
      convidado: campo(linha, "convidado"),
      data: campo(linha, "data"),
      youtube: campo(linha, "youtube"),
      spotify: campo(linha, "spotify"),
      mp3: campo(linha, "mp3"),
      capa: campo(linha, "capa"),
      publicado: campo(linha, "publicado")
    };
  }

  /* Linha da tabela `devotionals` → Devocional consumido pela UI. */
  function mapearDevocional(linha) {
    return {
      id: campo(linha, "id"),
      titulo: campo(linha, "titulo"),
      versiculo: campo(linha, "versiculo"),
      texto: campo(linha, "texto"),
      data: campo(linha, "data"),
      publicado: campo(linha, "publicado")
    };
  }

  /* Linha da tabela `recommended_channels` → canal/vídeo da grade. */
  function mapearCanal(linha) {
    return {
      id: campo(linha, "id"),
      titulo: campo(linha, "titulo"),
      canal: campo(linha, "canal"),
      link: campo(linha, "link"),
      tipo: campo(linha, "tipo"),
      publicado: campo(linha, "publicado")
    };
  }

  /* ---------- cache (localStorage) ---------- */

  function lerCacheChave(chave) {
    try {
      if (typeof localStorage === "undefined" || !localStorage) return null;
      var bruto = localStorage.getItem(chave);
      if (!bruto) return null;
      var lista = JSON.parse(bruto);
      return Array.isArray(lista) ? lista : null;
    } catch (e) {
      return null; // cache corrompido ou storage indisponível: ignora
    }
  }

  function salvarCacheChave(chave, lista) {
    try {
      if (typeof localStorage === "undefined" || !localStorage) return false;
      localStorage.setItem(chave, JSON.stringify(lista || []));
      return true;
    } catch (e) {
      return false; // storage cheio/indisponível: seguir sem cache
    }
  }

  function lerCache() {
    return lerCacheChave(CHAVE_CACHE);
  }

  function salvarCache(episodios) {
    return salvarCacheChave(CHAVE_CACHE, episodios);
  }

  function lerCacheDevocionais() {
    return lerCacheChave(CHAVE_CACHE_DEVOCIONAIS);
  }

  function salvarCacheDevocionais(devocionais) {
    return salvarCacheChave(CHAVE_CACHE_DEVOCIONAIS, devocionais);
  }

  function lerCacheCanais() {
    return lerCacheChave(CHAVE_CACHE_CANAIS);
  }

  function salvarCacheCanais(canais) {
    return salvarCacheChave(CHAVE_CACHE_CANAIS, canais);
  }

  /* Objetos passados como 2º argumento dos carregadores. */
  var cache = { ler: lerCache, salvar: salvarCache };
  var cacheDevocionais = { ler: lerCacheDevocionais, salvar: salvarCacheDevocionais };
  var cacheCanais = { ler: lerCacheCanais, salvar: salvarCacheCanais };

  function normalizarCache(objeto, padrao) {
    if (objeto && typeof objeto.ler === "function" && typeof objeto.salvar === "function") {
      return objeto;
    }
    return padrao || cache;
  }

  /* ---------- leitura ---------- */

  function porDataDesc(a, b) {
    var da = a.data || "";
    var db = b.data || "";
    if (da === db) return 0;
    return da < db ? 1 : -1; // datas YYYY-MM-DD: ordem lexicográfica = cronológica
  }

  /* Erro de rede: com cache, mostra o guardado; sem cache, lista vazia.
     `estado: "erro"` é o que a UI usa para NUNCA parecer "em breve". */
  function resultadoDeErro(c, campo) {
    var salvo = null;
    try {
      salvo = c.ler();
    } catch (e) {
      salvo = null;
    }

    var resultado = { estado: "erro", veioDoCache: false };
    resultado[campo] = [];
    if (Array.isArray(salvo) && salvo.length > 0) {
      resultado[campo] = salvo;
      resultado.veioDoCache = true;
    }
    return resultado;
  }

  /* Leitura comum das três tabelas públicas: SELECT * where publicado. */
  async function carregarTabela(cliente, tabela, campo, mapear, ordenar, cacheInformado, cachePadrao) {
    var c = normalizarCache(cacheInformado, cachePadrao);
    var resposta;

    try {
      resposta = await cliente.from(tabela).select("*").eq("publicado", true);
    } catch (e) {
      return resultadoDeErro(c, campo);
    }

    if (!resposta || resposta.error) return resultadoDeErro(c, campo);

    var linhas = Array.isArray(resposta.data) ? resposta.data : [];
    var itens = linhas.map(mapear);
    if (typeof ordenar === "function") itens.sort(ordenar);

    if (itens.length === 0) {
      // Vazio é vazio (nunca confundir com falha); o cache existente fica intacto.
      var vazio = { estado: "vazio", veioDoCache: false };
      vazio[campo] = [];
      return vazio;
    }

    try {
      c.salvar(itens);
    } catch (e) {
      // cache é otimização: falha ao gravar não invalida a leitura
    }

    var ok = { estado: "ok", veioDoCache: false };
    ok[campo] = itens;
    return ok;
  }

  async function carregarEpisodios(cliente, cacheInformado) {
    return carregarTabela(
      cliente,
      "episodes",
      "episodios",
      mapearEpisodio,
      porDataDesc,
      cacheInformado,
      cache
    );
  }

  async function carregarDevocionais(cliente, cacheInformado) {
    return carregarTabela(
      cliente,
      "devotionals",
      "devocionais",
      mapearDevocional,
      porDataDesc,
      cacheInformado,
      cacheDevocionais
    );
  }

  async function carregarCanais(cliente, cacheInformado) {
    return carregarTabela(
      cliente,
      "recommended_channels",
      "canais",
      mapearCanal,
      null,
      cacheInformado,
      cacheCanais
    );
  }

  var api = {
    mapearEpisodio: mapearEpisodio,
    mapearDevocional: mapearDevocional,
    mapearCanal: mapearCanal,
    carregarEpisodios: carregarEpisodios,
    carregarDevocionais: carregarDevocionais,
    carregarCanais: carregarCanais,
    salvarCache: salvarCache,
    lerCache: lerCache,
    salvarCacheDevocionais: salvarCacheDevocionais,
    lerCacheDevocionais: lerCacheDevocionais,
    salvarCacheCanais: salvarCacheCanais,
    lerCacheCanais: lerCacheCanais,
    cache: cache,
    cacheDevocionais: cacheDevocionais,
    cacheCanais: cacheCanais
  };

  if (typeof window !== "undefined") window.SCDados = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
