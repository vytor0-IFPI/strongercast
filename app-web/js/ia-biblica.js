/* Stronger Cast — IA Bíblica (chat com a API REST do Gemini).
   Fala direto com `generativelanguage.googleapis.com` via fetch, sem SDK:
   o mesmo código roda no WebView do Android e no PWA do navegador.

   A chave vem de config.js (SC_IA) e vai embutida no app por decisão do dono
   em 26/10 — não existe servidor próprio para intermediar a chamada.

   Disponibilidade: o modelo gratuito muda de resposta com frequência (404
   para modelos aposentados, 503 em picos). Por isso os modelos são tentados
   em cascata, com 30 s de timeout por tentativa. HTTP 200 renderiza
   `candidates[0].content.parts[0].text`; 429/5xx/timeout caem para o próximo;
   se todos falharem, a tela mostra um erro honesto (nunca fica travada).

   Serve no WebView (window.SCIA) e no Node (module.exports), com
   documento/config/cliente injetáveis para os testes. */
(function (raiz) {
  "use strict";

  var ERRO_INDISPONIVEL =
    "A IA está indisponível agora (muita gente usando). Tente de novo em instantes.";
  var ERRO_SEM_INTERNET = "Você parece estar sem internet.";
  var LIMITE_MENSAGENS = 20; // 10 pares pergunta/resposta
  var TIMEOUT_PADRAO = 30000;

  /* Instrução fixa: define tom, idioma, citação de passagens e limites.
     Texto remoto NUNCA entra aqui — só a pergunta do usuário e o histórico. */
  var INSTRUCAO = [
    "Você é a IA Bíblica do Stronger Cast, um podcast de fé para jovens.",
    "Responda sempre em português do Brasil, com base na Bíblia.",
    'Sempre que usar uma passagem, cite livro, capítulo e versículo (ex.: "João 3.16").',
    "Use um tom pastoral, próximo e simples.",
    "Se a pergunta não for sobre fé, Bíblia ou vida cristã, recuse com educação e sugira voltar ao tema.",
    "Se não tiver certeza de uma referência bíblica, diga que não tem certeza em vez de inventar.",
    "Responda em no máximo ~200 palavras."
  ].join(" ");

  function texto(valor) {
    if (valor === undefined || valor === null) return "";
    return String(valor);
  }

  /* Resposta do Gemini: candidates[0].content.parts[*].text (o caso normal
     tem uma parte só; juntar todas é mais seguro). */
  function extrairTexto(dados) {
    if (!dados || !Array.isArray(dados.candidates) || !dados.candidates.length) {
      return "";
    }
    var conteudo = dados.candidates[0] && dados.candidates[0].content;
    var partes = conteudo && Array.isArray(conteudo.parts) ? conteudo.parts : [];
    var pedacos = [];

    for (var i = 0; i < partes.length; i++) {
      var pedaco = partes[i] && partes[i].text;
      if (pedaco) pedacos.push(texto(pedaco));
    }
    return pedacos.join("").trim();
  }

  function criar(opcoes) {
    opcoes = opcoes || {};

    var doc = opcoes.documento || raiz.document || null;
    var config = opcoes.config || raiz.SC_IA || {};
    var timeoutMs =
      typeof opcoes.timeoutMs === "number" && opcoes.timeoutMs > 0
        ? opcoes.timeoutMs
        : TIMEOUT_PADRAO;
    var cliente =
      typeof opcoes.cliente === "function"
        ? opcoes.cliente
        : typeof opcoes.fetch === "function"
          ? opcoes.fetch
          : typeof raiz.fetch === "function"
            ? function (url, init) {
                return raiz.fetch(url, init);
              }
            : null;

    var historico = []; // [{ role: "user" | "model", parts: [{ text }] }]
    var aberta = false;
    var ocupado = false;
    var token = 0; // invalida respostas que chegam depois de "Limpar conversa"
    var erroAtual = null;

    function porId(id) {
      return doc ? doc.getElementById(id) : null;
    }

    function elemento(tag, classe) {
      var el = doc.createElement(tag);
      if (classe) el.className = classe;
      return el;
    }

    function remover(no) {
      if (!no || !no.parentNode) return;
      var pai = no.parentNode;
      try {
        if (typeof pai.removeChild === "function") pai.removeChild(no);
      } catch (e) {
        // já saiu da tela
      }
    }

    function anexar(no) {
      var area = porId("ia-mensagens");
      if (!area) return null;
      area.appendChild(no);
      // Rola para a última mensagem quando o navegador expõe as medidas.
      if (typeof area.scrollHeight === "number") area.scrollTop = area.scrollHeight;
      return no;
    }

    function renderizarMensagem(papel, conteudo) {
      var classe = papel === "user" ? "ia-msg ia-msg--usuario" : "ia-msg ia-msg--ia";
      var bolha = elemento("div", classe);
      bolha.setAttribute("data-papel", papel);
      bolha.textContent = texto(conteudo);
      anexar(bolha);
      return bolha;
    }

    function mostrarPensando() {
      var bolha = elemento("div", "ia-msg ia-msg--ia ia-msg--pensando");
      bolha.textContent = "pensando…";
      anexar(bolha);
      return bolha;
    }

    function mostrarErro(mensagem) {
      if (erroAtual) remover(erroAtual);
      var banner = elemento("div", "ia-erro");
      banner.setAttribute("role", "alert");
      banner.textContent = mensagem;
      anexar(banner);
      erroAtual = banner;
      return banner;
    }

    function definirOcupado(valor) {
      ocupado = !!valor;
      var botao = porId("ia-enviar");
      if (botao) botao.disabled = ocupado;
      var area = porId("ia-mensagens");
      if (area) area.setAttribute("aria-busy", ocupado ? "true" : "false");
    }

    function limpar() {
      token++;
      historico = [];
      erroAtual = null;

      var area = porId("ia-mensagens");
      if (area) {
        area.innerHTML = ""; // casa: esvaziar com innerHTML; texto sempre por textContent
        area.setAttribute("aria-busy", ocupado ? "true" : "false");
      }

      var entrada = porId("ia-pergunta");
      if (entrada) entrada.value = "";
      return true;
    }

    function urlDoModelo(modelo) {
      var base = texto(config.url);
      if (base && base.charAt(base.length - 1) !== "/") base += "/";
      return base + encodeURIComponent(modelo) + ":generateContent";
    }

    function montarCorpo(pergunta) {
      var contents = historico.slice();
      contents.push({ role: "user", parts: [{ text: pergunta }] });
      return {
        contents: contents,
        system_instruction: { parts: [{ text: INSTRUCAO }] },
        generationConfig: { maxOutputTokens: 700, temperature: 0.6 }
      };
    }

    /* Uma tentativa. Resolve com o texto; rejeita com erro.status (HTTP) ou
       erro.rede (fetch rejeitado) ou erro.name = "AbortError" (timeout). */
    function requisitar(modelo, corpo) {
      return new Promise(function (resolve, reject) {
        var controlador =
          typeof raiz.AbortController === "function" ? new raiz.AbortController() : null;
        var timer = null;

        function encerrarTimer() {
          if (timer !== null) {
            raiz.clearTimeout(timer);
            timer = null;
          }
        }

        timer = raiz.setTimeout(function () {
          if (controlador && typeof controlador.abort === "function") {
            try {
              controlador.abort();
            } catch (e) {
              // aborto indisponível: a rejeição abaixo encerra do mesmo jeito
            }
          }
          var erro = new Error("tempo esgotado");
          erro.name = "AbortError";
          erro.timeout = true;
          reject(erro);
        }, timeoutMs);

        var init = {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": texto(config.chave)
          },
          body: JSON.stringify(corpo)
        };
        if (controlador) init.signal = controlador.signal;

        var promessa;
        try {
          promessa = cliente(urlDoModelo(modelo), init);
        } catch (e) {
          encerrarTimer();
          var falha = e instanceof Error ? e : new Error("fetch indisponível");
          falha.rede = true;
          reject(falha);
          return;
        }

        Promise.resolve(promessa).then(
          function (resposta) {
            encerrarTimer();

            if (!resposta || resposta.status !== 200) {
              var erroHttp = new Error("HTTP " + (resposta && resposta.status));
              erroHttp.status = resposta && resposta.status;
              reject(erroHttp);
              return;
            }

            Promise.resolve(resposta.json()).then(function (dados) {
              var respostaTexto = extrairTexto(dados);
              if (!respostaTexto) {
                var vazia = new Error("resposta vazia");
                vazia.status = 200;
                reject(vazia);
                return;
              }
              resolve(respostaTexto);
            }, reject);
          },
          function (erro) {
            encerrarTimer();
            if (erro && erro.name === "AbortError") {
              reject(erro); // timeout: a cascata tenta o próximo modelo
              return;
            }
            var rede = erro instanceof Error ? erro : new Error("falha de rede");
            rede.rede = true; // sem internet: não adianta insistir nos outros
            reject(rede);
          }
        );
      });
    }

    function perguntar(pergunta) {
      var textoPergunta = texto(pergunta).trim();
      if (!textoPergunta || ocupado) return Promise.resolve(false);

      var modelos = Array.isArray(config.modelos)
        ? config.modelos.filter(function (modelo) {
            return !!texto(modelo).trim();
          })
        : [];

      if (!cliente || !config.url || !modelos.length) {
        mostrarErro(ERRO_INDISPONIVEL);
        return Promise.resolve(false);
      }

      var meuToken = token;
      definirOcupado(true);
      renderizarMensagem("user", textoPergunta);

      var entrada = porId("ia-pergunta");
      if (entrada) entrada.value = "";

      var pensando = mostrarPensando();
      var corpo = montarCorpo(textoPergunta);
      var indice = 0;

      function falhar(mensagem) {
        remover(pensando);
        if (meuToken === token) mostrarErro(mensagem);
        return false;
      }

      function tentarProximo() {
        if (indice >= modelos.length) return falhar(ERRO_INDISPONIVEL);

        var modelo = modelos[indice++];
        return requisitar(modelo, corpo).then(
          function (respostaTexto) {
            remover(pensando);
            if (meuToken !== token) return true; // limpou: descarta a resposta

            historico.push({ role: "user", parts: [{ text: textoPergunta }] });
            historico.push({ role: "model", parts: [{ text: respostaTexto }] });
            while (historico.length > LIMITE_MENSAGENS) historico.shift();

            // Sucesso limpa qualquer aviso de erro antigo (o banner não pode
            // conviver com uma resposta boa em seguida).
            if (erroAtual) {
              remover(erroAtual);
              erroAtual = null;
            }

            renderizarMensagem("ia", respostaTexto);
            return true;
          },
          function (erro) {
            if (erro && erro.rede) return falhar(ERRO_SEM_INTERNET);
            // 429/5xx/404/timeout: tenta o próximo modelo da cascata.
            return tentarProximo();
          }
        );
      }

      return Promise.resolve()
        .then(tentarProximo)
        .catch(function () {
          return falhar(ERRO_INDISPONIVEL);
        })
        .then(function (ok) {
          definirOcupado(false); // sempre reabilita, mesmo em erro
          return ok;
        });
    }

    function aoEntrar() {
      aberta = true;
      var entrada = porId("ia-pergunta");
      if (entrada && typeof entrada.focus === "function") {
        try {
          entrada.focus();
        } catch (e) {
          // WebView sem foco programático: segue sem focar
        }
      }
      return true;
    }

    function fechar() {
      aberta = false;
      return true;
    }

    /* Voltar do Android / botão de seção: retorna à lista. */
    function voltar() {
      if (!aberta) return false;
      fechar();
      var app = raiz.SCApp;
      if (app && typeof app.irPara === "function") app.irPara("lista");
      return "lista";
    }

    function estado() {
      return {
        aberta: aberta,
        ocupado: ocupado,
        historico: historico.slice()
      };
    }

    /* Listeners ligados uma vez; a vista pode ser aberta e fechada à vontade
       sem perder a conversa (o histórico vive em memória até "Limpar"). */
    if (doc) {
      var enviar = porId("ia-enviar");
      if (enviar) {
        enviar.addEventListener("click", function () {
          var entrada = porId("ia-pergunta");
          return perguntar(entrada ? entrada.value : "");
        });
      }

      var limparBotao = porId("ia-limpar");
      if (limparBotao) {
        limparBotao.addEventListener("click", function () {
          return limpar();
        });
      }

      var campo = porId("ia-pergunta");
      if (campo) {
        campo.addEventListener("keydown", function (evento) {
          if (!evento || (evento.key !== "Enter" && evento.key !== "NumpadEnter")) return;
          if (evento.preventDefault) evento.preventDefault();
          return perguntar(campo.value);
        });
      }
    }

    return {
      aoEntrar: aoEntrar,
      enviar: perguntar,
      perguntar: perguntar,
      limpar: limpar,
      fechar: fechar,
      voltar: voltar,
      estado: estado,
      estaAberto: function () {
        return aberta;
      }
    };
  }

  var api = {
    criar: criar,
    INSTRUCAO: INSTRUCAO,
    extrairTexto: extrairTexto
  };

  /* Instância da página (index.html): usada pelo app.js via window.SCIA. */
  var padrao = criar({});
  api.aoEntrar = padrao.aoEntrar;
  api.enviar = padrao.enviar;
  api.perguntar = padrao.perguntar;
  api.limpar = padrao.limpar;
  api.fechar = padrao.fechar;
  api.voltar = padrao.voltar;
  api.estado = padrao.estado;
  api.estaAberto = padrao.estaAberto;

  raiz.SCIA = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
