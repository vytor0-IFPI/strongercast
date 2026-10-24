/* Stronger Cast — Bíblia offline (Bíblia Livre, CC BY 3.0 — crédito exigido
   pela licença no rodapé do leitor; texto com ortografia moderna).
   Os dados moram em www/dados/biblia: indice.json (66 livros) e um JSON por
   livro (blivre-<sigla>.json). Nada de rede: o fetch é relativo ao pacote
   local do app, então funciona em modo avião dentro do WebView.

   Regra de ouro: carrega UM livro por vez, só quando o capítulo é aberto.
   O índice é pequeno e vem uma vez; os ~4,6 MB de texto nunca são pré-carregados.

   Serve no WebView (window.SCBiblia) e no Node (module.exports). O `criar`
   aceita `documento` e `carregador` injetados: é a costura usada pelos testes
   (mesmo padrão de dados.js com o cliente/cache). */
(function (raiz) {
  "use strict";

  var ARQUIVO_INDICE = "dados/biblia/indice.json";
  var PASTA_LIVROS = "dados/biblia/";
  var CREDITO = "Bíblia Livre · CC BY 3.0 · github.com/blivre/BibliaLivre";

  /* ---------- utilidades puras (testáveis sem DOM) ---------- */

  /* Busca sem acento: "genesis" acha "Gênesis" (teclado mobile nem sempre
     tem acento à mão). A decisão é documentada aqui e no relatório. */
  function semAcento(valor) {
    var texto = String(valor == null ? "" : valor);
    if (typeof texto.normalize === "function") {
      texto = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    return texto.toLowerCase();
  }

  function numeroInteiro(valor) {
    var n = parseInt(valor, 10);
    return isFinite(n) ? n : null;
  }

  /* Linha do indice.json → livro consumido pela UI. Item inválido é ignorado
     (nunca inventa livro nem capítulo). */
  function normalizarIndice(bruto) {
    if (!Array.isArray(bruto)) return [];

    var lista = [];
    for (var i = 0; i < bruto.length; i++) {
      var linha = bruto[i];
      if (!linha || !linha.sigla || !linha.nome) continue;

      var caps = numeroInteiro(linha.caps);
      if (caps === null || caps < 1) continue;

      lista.push({
        sigla: String(linha.sigla),
        nome: String(linha.nome),
        caps: caps,
        testamento: linha.testamento === "nt" ? "nt" : "at"
      });
    }
    return lista;
  }

  function contarPorTestamento(indice) {
    var lista = Array.isArray(indice) ? indice : [];
    var at = 0;
    for (var i = 0; i < lista.length; i++) {
      if (lista[i] && lista[i].testamento === "at") at++;
    }
    return { total: lista.length, at: at, nt: lista.length - at };
  }

  function filtrarLivros(indice, termo) {
    var lista = Array.isArray(indice) ? indice : [];
    var busca = semAcento(termo).trim();
    if (!busca) return lista.slice();

    var achados = [];
    for (var i = 0; i < lista.length; i++) {
      if (semAcento(lista[i].nome).indexOf(busca) !== -1) achados.push(lista[i]);
    }
    return achados;
  }

  function capitulosDoLivro(livroOuTotal) {
    var total = typeof livroOuTotal === "number" ? livroOuTotal : livroOuTotal && livroOuTotal.caps;
    total = numeroInteiro(total);
    if (total === null || total < 1) return [];

    var lista = [];
    for (var n = 1; n <= total; n++) lista.push(n);
    return lista;
  }

  /* Presa em 1 e no último capítulo: usado pelos botões ‹/› e pelo estado. */
  function limitarCapitulo(numero, total) {
    var t = numeroInteiro(total);
    if (t === null || t < 1) return 1;

    var n = numeroInteiro(numero);
    if (n === null || n < 1) return 1;
    if (n > t) return t;
    return n;
  }

  function urlDoLivro(sigla) {
    return PASTA_LIVROS + "blivre-" + String(sigla || "") + ".json";
  }

  /* JSON do livro → estrutura da UI, com texto sempre string. */
  function normalizarLivro(bruto) {
    if (!bruto || !Array.isArray(bruto.chapters)) return null;

    var capitulos = [];
    for (var i = 0; i < bruto.chapters.length; i++) {
      var capitulo = bruto.chapters[i];
      if (!capitulo) continue;

      var numero = numeroInteiro(capitulo.number);
      if (numero === null) numero = capitulos.length + 1;

      var versos = [];
      var lista = Array.isArray(capitulo.verses) ? capitulo.verses : [];
      for (var j = 0; j < lista.length; j++) {
        var verso = lista[j];
        if (!verso) continue;
        var numeroVerso = numeroInteiro(verso.number);
        versos.push({
          number: numeroVerso === null ? j + 1 : numeroVerso,
          text: verso.text == null ? "" : String(verso.text)
        });
      }
      capitulos.push({ number: numero, verses: versos });
    }

    if (!capitulos.length) return null;
    return {
      name: bruto.name == null ? "" : String(bruto.name),
      abbrev: bruto.abbrev == null ? "" : String(bruto.abbrev),
      chapters: capitulos
    };
  }

  /* ---------- carregador padrão (asset local, nenhuma URL remota) ---------- */

  function carregadorPadrao(url) {
    if (typeof raiz.fetch !== "function") {
      return Promise.reject(new Error("fetch indisponível neste WebView"));
    }
    return raiz.fetch(url).then(function (resposta) {
      if (!resposta || resposta.ok === false || typeof resposta.json !== "function") {
        throw new Error("resposta inválida para " + url);
      }
      return resposta.json();
    });
  }

  /* ---------- controlador da vista ---------- */

  function criarBiblia(opcoes) {
    opcoes = opcoes || {};

    var doc = opcoes.documento || raiz.document || null;
    var carregar =
      typeof opcoes.carregador === "function" ? opcoes.carregador : carregadorPadrao;

    var aberta = false;
    var nivel = "livros"; // "livros" | "capitulos" | "leitura"
    var indice = null;
    var promessaIndice = null;
    var livro = null; // linha do índice
    var dadosLivro = null; // JSON normalizado do livro aberto
    var capitulo = 1;
    var termo = "";
    var cacheLivros = {}; // um livro já lido fica na memória da sessão
    var token = 0; // descarta resposta atrasada depois de voltar/trocar

    function porId(id) {
      return doc ? doc.getElementById(id) : null;
    }

    function elemento(tag, classe) {
      var el = doc.createElement(tag);
      if (classe) el.className = classe;
      return el;
    }

    function botao(texto, classe) {
      var el = elemento("button", classe);
      el.setAttribute("type", "button");
      el.textContent = texto;
      return el;
    }

    function definirStatus(texto) {
      var status = porId("biblia-status");
      if (!status) return;
      status.textContent = texto || "";
      status.hidden = !texto;
    }

    function definirTitulo(texto) {
      var titulo = porId("biblia-titulo");
      if (titulo) titulo.textContent = texto || "";
    }

    function limparConteudo() {
      var conteudo = porId("biblia-conteudo");
      if (!conteudo) return null;
      conteudo.innerHTML = ""; // casa: limpar com innerHTML vazio, texto sempre por textContent
      return conteudo;
    }

    function acharNoIndice(sigla) {
      if (!indice) return null;
      for (var i = 0; i < indice.length; i++) {
        if (indice[i].sigla === sigla) return indice[i];
      }
      return null;
    }

    function acharCapitulo(numero) {
      if (!dadosLivro) return null;
      for (var i = 0; i < dadosLivro.chapters.length; i++) {
        if (dadosLivro.chapters[i].number === numero) return dadosLivro.chapters[i];
      }
      return null;
    }

    /* ---------- carregamento sob demanda ---------- */

    function obterIndice() {
      if (indice) return Promise.resolve(indice);
      if (promessaIndice) return promessaIndice;

      promessaIndice = Promise.resolve()
        .then(function () {
          return carregar(ARQUIVO_INDICE);
        })
        .then(function (bruto) {
          var lista = normalizarIndice(bruto);
          if (!lista.length) throw new Error("índice vazio");
          indice = lista;
          promessaIndice = null;
          return indice;
        })
        .catch(function (erro) {
          promessaIndice = null; // permite o "Tentar de novo"
          throw erro;
        });
      return promessaIndice;
    }

    function obterLivro(sigla) {
      if (cacheLivros[sigla]) return Promise.resolve(cacheLivros[sigla]);

      return Promise.resolve()
        .then(function () {
          return carregar(urlDoLivro(sigla));
        })
        .then(function (bruto) {
          var dados = normalizarLivro(bruto);
          if (!dados || !dados.chapters.length) throw new Error("livro vazio");
          cacheLivros[sigla] = dados;
          return dados;
        });
    }

    /* ---------- tela 1: livros ---------- */

    function adicionarGrupo(grupos, titulo, testamento, lista) {
      var doGrupo = [];
      for (var i = 0; i < lista.length; i++) {
        if (lista[i].testamento === testamento) doGrupo.push(lista[i]);
      }
      if (!doGrupo.length) return;

      var cabecalho = elemento("h2", "biblia__grupo");
      cabecalho.textContent = titulo;
      grupos.appendChild(cabecalho);

      var bloco = elemento("div", "biblia__livros");
      for (var j = 0; j < doGrupo.length; j++) {
        var alvo = doGrupo[j];
        var item = botao("", "biblia__livro");
        item.setAttribute("data-sigla", alvo.sigla);
        item.setAttribute("aria-label", alvo.nome + " — abrir capítulos");

        var nome = elemento("span", "biblia__livro-nome");
        nome.textContent = alvo.nome;
        item.appendChild(nome);

        var seta = elemento("span", "biblia__seta");
        seta.setAttribute("aria-hidden", "true");
        seta.textContent = "›";
        item.appendChild(seta);

        item.addEventListener(
          "click",
          (function (sigla) {
            return function () {
              return abrirLivro(sigla);
            };
          })(alvo.sigla)
        );
        bloco.appendChild(item);
      }
      grupos.appendChild(bloco);
    }

    function atualizarGrupos(grupos) {
      grupos.innerHTML = "";
      var filtrados = filtrarLivros(indice || [], termo);

      if (!filtrados.length) {
        var vazio = elemento("p", "biblia__vazio");
        vazio.textContent = "Nenhum livro encontrado.";
        grupos.appendChild(vazio);
        return;
      }

      adicionarGrupo(grupos, "Antigo Testamento", "at", filtrados);
      adicionarGrupo(grupos, "Novo Testamento", "nt", filtrados);
    }

    function renderizarLivros() {
      nivel = "livros";
      dadosLivro = null;
      definirTitulo("Bíblia");

      var conteudo = limparConteudo();
      if (!conteudo) return;

      var busca = elemento("input", "biblia__busca");
      busca.setAttribute("type", "search");
      busca.setAttribute("placeholder", "buscar livro…");
      busca.setAttribute("aria-label", "Buscar livro");
      busca.setAttribute("autocomplete", "off");
      busca.setAttribute("spellcheck", "false");
      busca.value = termo;
      conteudo.appendChild(busca);

      var grupos = elemento("div", "biblia__grupos");
      conteudo.appendChild(grupos);

      busca.addEventListener("input", function () {
        termo = busca.value;
        atualizarGrupos(grupos);
      });

      atualizarGrupos(grupos);
      definirStatus("");
    }

    /* ---------- tela 2: capítulos ---------- */

    function renderizarCapitulos() {
      if (!livro) {
        renderizarLivros();
        return;
      }

      nivel = "capitulos";
      definirTitulo(
        livro.nome + " — " + livro.caps + (livro.caps === 1 ? " capítulo" : " capítulos")
      );

      var conteudo = limparConteudo();
      if (!conteudo) return;

      var grade = elemento("div", "biblia__grade");
      var numeros = capitulosDoLivro(livro);
      for (var i = 0; i < numeros.length; i++) {
        var n = numeros[i];
        var item = botao(String(n), "biblia__capitulo");
        item.setAttribute("aria-label", "Capítulo " + n);
        if (n === capitulo) {
          item.className = item.className + " biblia__capitulo--atual";
          item.setAttribute("aria-current", "true");
        }
        item.addEventListener(
          "click",
          (function (numero) {
            return function () {
              return abrirCapitulo(numero);
            };
          })(n)
        );
        grade.appendChild(item);
      }
      conteudo.appendChild(grade);
      definirStatus("");
    }

    /* ---------- tela 3: leitura ---------- */

    function renderizarLeitura() {
      var capituloDados = acharCapitulo(capitulo);
      if (!livro || !capituloDados) {
        renderizarErro();
        return;
      }

      nivel = "leitura";
      definirTitulo(livro.nome + " " + capitulo);

      var conteudo = limparConteudo();
      if (!conteudo) return;

      var corpoTexto = elemento("div", "biblia__texto");
      for (var i = 0; i < capituloDados.verses.length; i++) {
        var verso = capituloDados.verses[i];
        var linha = elemento("p", "biblia__versiculo");

        var numero = elemento("span", "biblia__numero");
        numero.textContent = String(verso.number);

        var texto = elemento("span", "biblia__texto-versiculo");
        texto.textContent = verso.text; // nunca innerHTML: o texto é dado externo

        linha.appendChild(numero);
        linha.appendChild(texto);
        corpoTexto.appendChild(linha);
      }
      conteudo.appendChild(corpoTexto);

      var rodape = elemento("nav", "biblia__rodape");
      rodape.setAttribute("aria-label", "Navegação de capítulos");

      var anterior = botao(
        "‹ Cap. " + limitarCapitulo(capitulo - 1, livro.caps),
        "biblia__anterior"
      );
      anterior.setAttribute("aria-label", "Capítulo anterior");
      anterior.disabled = capitulo <= 1;
      anterior.addEventListener("click", function () {
        return abrirCapitulo(capitulo - 1);
      });

      var proximo = botao(
        "Cap. " + limitarCapitulo(capitulo + 1, livro.caps) + " ›",
        "biblia__proximo"
      );
      proximo.setAttribute("aria-label", "Próximo capítulo");
      proximo.disabled = capitulo >= livro.caps;
      proximo.addEventListener("click", function () {
        return abrirCapitulo(capitulo + 1);
      });

      rodape.appendChild(anterior);
      rodape.appendChild(proximo);
      conteudo.appendChild(rodape);

      var credito = elemento("p", "biblia__credito");
      credito.textContent = CREDITO;
      conteudo.appendChild(credito);

      definirStatus("");
    }

    function renderizarErro() {
      nivel = "leitura";
      var conteudo = limparConteudo();
      if (!conteudo) return;

      var bloco = elemento("div", "biblia__erro");
      var texto = elemento("p", "biblia__erro-texto");
      texto.textContent = "Não consegui abrir o livro agora. Tente de novo.";
      bloco.appendChild(texto);

      var retry = botao("Tentar de novo", "botao botao--ouro biblia__retry");
      retry.addEventListener("click", function () {
        return abrirCapitulo(capitulo);
      });
      bloco.appendChild(retry);

      conteudo.appendChild(bloco);
      definirStatus("");
    }

    function renderizarErroIndice() {
      nivel = "livros";
      definirTitulo("Bíblia");

      var conteudo = limparConteudo();
      if (!conteudo) return;

      var bloco = elemento("div", "biblia__erro");
      var texto = elemento("p", "biblia__erro-texto");
      texto.textContent = "Não consegui abrir a Bíblia agora. Tente de novo.";
      bloco.appendChild(texto);

      var retry = botao("Tentar de novo", "botao botao--ouro biblia__retry");
      retry.addEventListener("click", function () {
        return aoEntrar();
      });
      bloco.appendChild(retry);

      conteudo.appendChild(bloco);
      definirStatus("");
    }

    /* ---------- navegação ---------- */

    function renderizarNivelAtual() {
      if (nivel === "leitura" && dadosLivro) renderizarLeitura();
      else if (nivel === "capitulos" && livro) renderizarCapitulos();
      else renderizarLivros();
    }

    function aoEntrar() {
      aberta = true;
      if (!doc) return Promise.resolve(false);

      if (indice) {
        renderizarNivelAtual();
        return Promise.resolve(true);
      }

      definirTitulo("Bíblia");
      limparConteudo();
      definirStatus("Carregando a Bíblia…");

      return obterIndice()
        .then(function () {
          if (!aberta) return false;
          definirStatus("");
          renderizarLivros();
          return true;
        })
        .catch(function () {
          if (!aberta) return false;
          renderizarErroIndice();
          return false;
        });
    }

    function abrirLivro(sigla) {
      var alvo = acharNoIndice(sigla);
      if (!alvo) return Promise.resolve(false);

      token++; // cancela um capítulo ainda carregando
      var anterior = livro;
      livro = alvo;
      if (!anterior || anterior.sigla !== alvo.sigla) capitulo = 1;
      dadosLivro = cacheLivros[alvo.sigla] || null;

      renderizarCapitulos();
      return Promise.resolve(true);
    }

    function abrirCapitulo(numero) {
      if (!livro) return Promise.resolve(false);

      var alvo = livro;
      capitulo = limitarCapitulo(numero, alvo.caps);

      var salvo = cacheLivros[alvo.sigla];
      if (salvo) {
        dadosLivro = salvo;
        renderizarLeitura();
        return Promise.resolve(true);
      }

      var meuToken = ++token;
      nivel = "leitura";
      definirTitulo(alvo.nome + " " + capitulo);
      limparConteudo();
      definirStatus("Carregando " + alvo.nome + "…");

      return obterLivro(alvo.sigla)
        .then(function (dados) {
          if (meuToken !== token || !aberta) return false;
          dadosLivro = dados;
          definirStatus("");
          renderizarLeitura();
          return true;
        })
        .catch(function () {
          if (meuToken !== token || !aberta) return false;
          renderizarErro();
          return false;
        });
    }

    function fechar() {
      aberta = false;
      token++;
      definirStatus("");
      return true;
    }

    /* Fluxo do botão "voltar" (botão da tela e voltar do Android):
       leitura → capítulos → livros → home. */
    function voltar() {
      if (!aberta) return false;

      if (nivel === "leitura") {
        token++;
        renderizarCapitulos();
        return "capitulos";
      }
      if (nivel === "capitulos") {
        token++;
        renderizarLivros();
        return "livros";
      }

      fechar();
      var app = raiz.SCApp;
      if (app && typeof app.irPara === "function") app.irPara("lista");
      return "lista";
    }

    function estado() {
      return {
        aberta: aberta,
        nivel: nivel,
        sigla: livro ? livro.sigla : null,
        capitulo: capitulo,
        carregando: !!promessaIndice
      };
    }

    return {
      aoEntrar: aoEntrar,
      abrirLivro: abrirLivro,
      abrirCapitulo: abrirCapitulo,
      voltar: voltar,
      fechar: fechar,
      estado: estado,
      estaAberto: function () {
        return aberta;
      }
    };
  }

  var api = {
    criar: criarBiblia,
    normalizarIndice: normalizarIndice,
    contarPorTestamento: contarPorTestamento,
    filtrarLivros: filtrarLivros,
    capitulosDoLivro: capitulosDoLivro,
    limitarCapitulo: limitarCapitulo,
    urlDoLivro: urlDoLivro,
    normalizarLivro: normalizarLivro,
    carregadorPadrao: carregadorPadrao
  };

  /* Instância da página (index.html): usada pelo app.js via window.SCBiblia. */
  var padrao = criarBiblia({});
  api.aoEntrar = padrao.aoEntrar;
  api.abrirLivro = padrao.abrirLivro;
  api.abrirCapitulo = padrao.abrirCapitulo;
  api.voltar = padrao.voltar;
  api.fechar = padrao.fechar;
  api.estado = padrao.estado;
  api.estaAberto = padrao.estaAberto;

  raiz.SCBiblia = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
