/* Stronger Cast — Devocionais (rodada 2).
   Lista pública (mais recente primeiro) e tela de leitura. Os dados vêm da
   tabela `devotionals` pela camada dados.js (SELECT público, mesma postura da
   RLS de episodes); o painel do admin é quem escreve.

   Estados da casa: ok · vazio ("Nenhum devocional publicado ainda") · erro
   ("Não consegui carregar…", nunca "em breve") · cache com aviso discreto.
   Todo texto remoto entra por textContent — nunca innerHTML.

   Serve no WebView (window.SCDevocionais) e no Node (module.exports), com
   documento/dados/cliente injetáveis para os testes. */
(function (raiz) {
  "use strict";

  /* ---------- utilidades puras ---------- */

  function texto(valor) {
    if (valor === undefined || valor === null) return "";
    return String(valor);
  }

  function formatarData(valor) {
    var t = texto(valor);
    var m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + "/" + m[2] + "/" + m[1] : t;
  }

  /* Primeira frase do texto, para o resumo da lista. */
  function resumo(valor) {
    var t = texto(valor).replace(/\s+/g, " ").trim();
    if (!t) return "";

    var m = t.match(/^(.+?[.!?])(?:\s|$)/);
    var frase = m ? m[1] : t;
    if (frase.length > 140) {
      frase = frase.slice(0, 137).replace(/\s+\S*$/, "") + "…";
    }
    return frase;
  }

  function ordenarPorDataDesc(lista) {
    var copia = Array.isArray(lista) ? lista.slice() : [];
    copia.sort(function (a, b) {
      var da = (a && a.data) || "";
      var db = (b && b.data) || "";
      if (da === db) return 0;
      return da < db ? 1 : -1;
    });
    return copia;
  }

  /* Texto do devocional em parágrafos: uma linha em branco separa; um único
     bloco sem quebras continua sendo um parágrafo. */
  function paragrafos(valor) {
    var bruto = texto(valor).replace(/\r\n/g, "\n");
    var partes = bruto.split(/\n\s*\n/);
    var lista = [];

    for (var i = 0; i < partes.length; i++) {
      var parte = partes[i].trim();
      if (parte) lista.push(parte);
    }
    if (!lista.length && bruto.trim()) lista.push(bruto.trim());
    return lista;
  }

  /* ---------- controlador da vista ---------- */

  function criarDevocionais(opcoes) {
    opcoes = opcoes || {};

    var doc = opcoes.documento || raiz.document || null;
    var dados = opcoes.dados || raiz.SCDados || null;
    var cliente =
      typeof opcoes.cliente === "function"
        ? opcoes.cliente
        : function () {
            var sessao = raiz.sessao;
            return sessao && typeof sessao.cliente === "function"
              ? sessao.cliente()
              : null;
          };
    var cache = opcoes.cache || (dados && dados.cacheDevocionais) || null;

    var aberta = false;
    var nivel = "lista"; // "lista" | "leitura"
    var atual = null;
    var ultimo = null; // último resultado carregado (voltar do leitor não refaz a rede)
    var token = 0;

    function porId(id) {
      return doc ? doc.getElementById(id) : null;
    }

    function elemento(tag, classe) {
      var el = doc.createElement(tag);
      if (classe) el.className = classe;
      return el;
    }

    function botao(rotulo, classe) {
      var el = elemento("button", classe);
      el.setAttribute("type", "button");
      el.textContent = rotulo;
      return el;
    }

    function definirStatus(mensagem) {
      var alvo = porId("devocionais-status");
      if (!alvo) return;
      alvo.textContent = mensagem || "";
      alvo.hidden = !mensagem;
    }

    function definirTitulo(mensagem) {
      var alvo = porId("devocionais-titulo");
      if (alvo) alvo.textContent = mensagem || "Devocionais";
    }

    function limparConteudo() {
      var conteudo = porId("devocionais-conteudo");
      if (!conteudo) return null;
      conteudo.innerHTML = ""; // casa: limpar com innerHTML vazio, texto sempre por textContent
      return conteudo;
    }

    function obterCliente() {
      try {
        return cliente ? cliente() : null;
      } catch (e) {
        return null;
      }
    }

    /* ---------- lista ---------- */

    function criarItem(item) {
      var linha = botao("", "dev-item");
      linha.setAttribute("data-dev-id", texto(item && item.id));

      var data = elemento("span", "dev-item__data");
      data.textContent = formatarData(item && item.data);
      linha.appendChild(data);

      var titulo = elemento("span", "dev-item__titulo");
      titulo.textContent = (item && item.titulo) || "Devocional sem título";
      linha.appendChild(titulo);

      var chamada = elemento("span", "dev-item__resumo");
      chamada.textContent = resumo(item && item.texto);
      linha.appendChild(chamada);

      linha.addEventListener("click", function () {
        return abrirLeitura(item);
      });
      return linha;
    }

    function criarErro() {
      var bloco = elemento("div", "secao-erro");
      var mensagem = elemento("p", "secao-erro__texto");
      mensagem.textContent =
        "Não consegui carregar os devocionais. Verifique sua conexão.";
      bloco.appendChild(mensagem);

      var retry = botao("Tentar de novo", "botao botao--ouro secao-erro__retry");
      retry.addEventListener("click", function () {
        return aoEntrar();
      });
      bloco.appendChild(retry);
      return bloco;
    }

    function criarAvisoCache() {
      var aviso = elemento("div", "lista-aviso");
      var mensagem = elemento("p", "lista-aviso__texto");
      mensagem.textContent = "Sem conexão. Mostrando devocionais guardados.";
      aviso.appendChild(mensagem);

      var retry = botao("Tentar de novo", "lista-aviso__retry");
      retry.addEventListener("click", function () {
        return aoEntrar();
      });
      aviso.appendChild(retry);
      return aviso;
    }

    function renderizar(resultado) {
      ultimo = resultado || null;
      nivel = "lista";
      atual = null;
      definirTitulo("Devocionais");
      definirStatus("");

      var conteudo = limparConteudo();
      if (!conteudo) return false;

      var itens = ordenarPorDataDesc(resultado && resultado.devocionais);
      var estado = resultado ? resultado.estado : null;

      if (estado === "vazio" || (estado === "ok" && itens.length === 0)) {
        var vazio = elemento("p", "secao__vazio");
        vazio.textContent = "Nenhum devocional publicado ainda.";
        conteudo.appendChild(vazio);
        return true;
      }

      if (estado === "erro" && itens.length === 0) {
        conteudo.appendChild(criarErro());
        return true;
      }

      if (estado === "ok" || estado === "erro") {
        var lista = elemento("div", "dev-lista");
        for (var i = 0; i < itens.length; i++) {
          lista.appendChild(criarItem(itens[i]));
        }
        conteudo.appendChild(lista);

        if (estado === "erro") conteudo.appendChild(criarAvisoCache());
        return true;
      }

      // Estado inesperado: falha honesta, nunca uma lista falsa.
      conteudo.appendChild(criarErro());
      return true;
    }

    /* ---------- leitura ---------- */

    function renderizarLeitura(item) {
      atual = item || null;
      nivel = "leitura";
      definirTitulo("Devocional");
      definirStatus("");

      var conteudo = limparConteudo();
      if (!conteudo) return false;

      var artigo = elemento("article", "dev-leitura");

      var titulo = elemento("h2", "dev-leitura__titulo");
      titulo.textContent = (item && item.titulo) || "Devocional sem título";
      artigo.appendChild(titulo);

      var data = elemento("p", "dev-leitura__data");
      data.textContent = formatarData(item && item.data);
      artigo.appendChild(data);

      var versiculo = elemento("blockquote", "dev-leitura__versiculo");
      versiculo.textContent = (item && item.versiculo) || "";
      artigo.appendChild(versiculo);

      var corpo = elemento("div", "dev-leitura__texto");
      var lista = paragrafos(item && item.texto);
      for (var i = 0; i < lista.length; i++) {
        var paragrafo = elemento("p", "dev-leitura__paragrafo");
        paragrafo.textContent = lista[i];
        corpo.appendChild(paragrafo);
      }
      artigo.appendChild(corpo);

      conteudo.appendChild(artigo);
      return true;
    }

    function abrirLeitura(item) {
      if (!item) return false;
      return renderizarLeitura(item);
    }

    /* ---------- navegação ---------- */

    function carregar() {
      var c = obterCliente();
      if (!dados || typeof dados.carregarDevocionais !== "function" || !c) {
        return Promise.resolve(
          renderizar({ devocionais: [], estado: "erro", veioDoCache: false })
        );
      }

      var meuToken = ++token;
      return Promise.resolve()
        .then(function () {
          return dados.carregarDevocionais(c, cache);
        })
        .then(function (resultado) {
          if (meuToken !== token || !aberta) return false;
          return renderizar(resultado);
        })
        .catch(function () {
          if (meuToken !== token || !aberta) return false;
          return renderizar({ devocionais: [], estado: "erro", veioDoCache: false });
        });
    }

    function aoEntrar() {
      aberta = true;
      if (!doc) return Promise.resolve(false);

      var conteudo = limparConteudo();
      if (conteudo) {
        var carregando = elemento("p", "secao__vazio");
        carregando.textContent = "Carregando devocionais…";
        conteudo.appendChild(carregando);
      }
      definirTitulo("Devocionais");
      definirStatus("");

      return carregar();
    }

    /* Leitura → lista → home; quem decide o nível é este módulo. */
    function voltar() {
      if (!aberta) return false;

      if (nivel === "leitura") {
        renderizar(ultimo);
        return "lista";
      }

      fechar();
      var app = raiz.SCApp;
      if (app && typeof app.irPara === "function") app.irPara("lista");
      return "lista";
    }

    function fechar() {
      aberta = false;
      token++;
      definirStatus("");
      return true;
    }

    function recarregar() {
      return aberta ? aoEntrar() : Promise.resolve(false);
    }

    function estado() {
      return {
        aberta: aberta,
        nivel: nivel,
        id: atual ? atual.id : null
      };
    }

    return {
      aoEntrar: aoEntrar,
      renderizar: renderizar,
      abrirLeitura: abrirLeitura,
      voltar: voltar,
      fechar: fechar,
      recarregar: recarregar,
      estado: estado,
      estaAberto: function () {
        return aberta;
      }
    };
  }

  var api = {
    criar: criarDevocionais,
    formatarData: formatarData,
    resumo: resumo,
    ordenarPorDataDesc: ordenarPorDataDesc,
    paragrafos: paragrafos
  };

  /* Instância da página (index.html): usada pelo app.js via window.SCDevocionais. */
  var padrao = criarDevocionais({});
  api.aoEntrar = padrao.aoEntrar;
  api.renderizar = padrao.renderizar;
  api.abrirLeitura = padrao.abrirLeitura;
  api.voltar = padrao.voltar;
  api.fechar = padrao.fechar;
  api.recarregar = padrao.recarregar;
  api.estado = padrao.estado;
  api.estaAberto = padrao.estaAberto;

  raiz.SCDevocionais = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
