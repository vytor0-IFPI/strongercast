/* Stronger Cast — validação do formulário de publicação.
   Serve no WebView (window.SCValidacao) e no Node (module.exports).
   Usa o mesmo extrator de vídeo do app (extratores.js). */
(function () {
  "use strict";

  var CAPA_LIMITE_MB = 5;

  /* Extrator: require no Node; no WebView, o global carregado antes. */
  function extrator() {
    if (typeof module !== "undefined" && module.exports) {
      return require("./extratores.js");
    }
    return typeof window !== "undefined" ? window.SCExtratores : null;
  }

  function texto(valor) {
    if (valor === undefined || valor === null) return "";
    return String(valor).trim();
  }

  function numero(valor) {
    if (typeof valor === "number") return isFinite(valor) ? valor : null;
    if (typeof valor === "string" && valor.trim() !== "") {
      var n = Number(valor.trim().replace(",", "."));
      return isFinite(n) ? n : null;
    }
    return null;
  }

  function falha(campo, erro) {
    return { ok: false, campo: campo, erro: erro };
  }

  function tamanhoLegivel(mb) {
    return Number.isInteger(mb) ? String(mb) : String(mb).replace(".", ",");
  }

  /* Data no formato do banco (AAAA-MM-DD) e existente no calendário:
     2026-02-31 não passa, 2026-02-28 passa. */
  function dataIsoValida(valor) {
    var t = texto(valor);
    var m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;

    var ano = Number(m[1]);
    var mes = Number(m[2]);
    var dia = Number(m[3]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;

    var data = new Date(Date.UTC(ano, mes - 1, dia));
    return (
      data.getUTCFullYear() === ano &&
      data.getUTCMonth() === mes - 1 &&
      data.getUTCDate() === dia
    );
  }

  /* Devolve {host, caminho, consulta} de um link do YouTube. Aceita link
     colado sem "https://" (teclado do celular costuma colar assim). */
  function partesDoLink(link) {
    var t = texto(link);
    if (!t) return null;

    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = "https://" + t;

    var m = t.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i);
    if (!m) return null;

    var host = m[1].toLowerCase().replace(/^.*@/, "").replace(/:\d+$/, "");
    var caminho = m[2] || "";
    return { host: host, caminho: caminho, consulta: m[3] || "" };
  }

  /* Vídeo × canal é derivado do link (decisão do design da rodada 2):
       youtu.be/… · watch?v=… · /shorts/…  → "video"
       /@… · /channel/… · /c/… · /user/…   → "canal"
     Qualquer outra coisa (inclusive domínio que não é YouTube) → null. */
  function tipoDoLink(link) {
    var partes = partesDoLink(link);
    if (!partes) return null;

    if (partes.host === "youtu.be") {
      var ext = extrator();
      var id = ext && typeof ext.idDoVideo === "function" ? ext.idDoVideo(link) : null;
      return id ? "video" : null;
    }

    if (!/^(www\.|m\.|music\.)?youtube\.com$/.test(partes.host)) return null;

    var caminho = partes.caminho.toLowerCase();
    if (caminho === "/watch" && /[?&]v=[\w-]+/i.test(partes.consulta)) return "video";
    if (/^\/shorts\/[\w-]+/i.test(caminho)) return "video";
    if (/^\/@[^/]+/i.test(caminho)) return "canal";
    if (/^\/channel\/[^/]+/i.test(caminho)) return "canal";
    if (/^\/c\/[^/]+/i.test(caminho)) return "canal";
    if (/^\/user\/[^/]+/i.test(caminho)) return "canal";
    return null;
  }

  /* form: {titulo, versiculo, texto, data}. A data-padrão (hoje) é
     responsabilidade do admin.js; aqui só se valida o que veio. */
  function validarDevocional(form) {
    form = form || {};

    if (!texto(form.titulo)) {
      return falha("titulo", "Informe o título do devocional.");
    }
    if (!texto(form.versiculo)) {
      return falha("versiculo", "Informe o versículo (ex.: Hebreus 11.1).");
    }
    if (!texto(form.texto)) {
      return falha("texto", "Escreva o texto do devocional.");
    }
    if (!texto(form.data)) {
      return falha("data", "Informe a data do devocional.");
    }
    if (!dataIsoValida(form.data)) {
      return falha("data", "Informe uma data válida (dia, mês e ano).");
    }

    return { ok: true };
  }

  /* form: {titulo, link, canal?}. `tipo` NÃO é digitado: vem do link. */
  function validarCanal(form) {
    form = form || {};

    if (!texto(form.titulo)) {
      return falha("titulo", "Informe o título do canal ou vídeo.");
    }

    var link = texto(form.link);
    if (!link) {
      return falha("link", "Cole o link do vídeo ou do canal do YouTube.");
    }

    var tipo = tipoDoLink(link);
    if (!tipo) {
      return falha(
        "link",
        "Cole um link válido do YouTube (vídeo ou canal)."
      );
    }

    return { ok: true, tipo: tipo };
  }

  /* form: {titulo, convidado, data, youtube, mp3Nome, mp3TamanhoMb,
            capaNome?, capaTamanhoMb?}
     Devolve {ok:true} ou {ok:false, campo, erro} (mensagem em PT-BR). */
  function validarPublicacao(form, limiteMb) {
    form = form || {};

    if (!texto(form.titulo)) {
      return falha("titulo", "Informe o título do episódio.");
    }

    if (!texto(form.data)) {
      return falha("data", "Informe a data de publicação.");
    }

    var link = texto(form.youtube);
    var ext = extrator();
    if (!link || !ext || !ext.idDoVideo(link)) {
      return falha("youtube", "Cole um link válido do YouTube (watch, youtu.be ou Shorts).");
    }

    // MP3 é opcional: o episódio pode ser só vídeo (YouTube). Só valida
    // quando o formulário traz um arquivo; sem arquivo, pula todas as
    // checagens de MP3 (extensão, limite, tamanho).
    var mp3Nome = texto(form.mp3Nome);
    if (mp3Nome) {
      if (!/\.mp3$/i.test(mp3Nome)) {
        return falha("mp3", "Envie o arquivo do episódio em MP3 (extensão .mp3).");
      }

      var limite = numero(limiteMb);
      if (limite === null) {
        return falha("mp3", "Limite de upload não configurado.");
      }

      var tamanho = numero(form.mp3TamanhoMb);
      if (tamanho === null) {
        return falha("mp3", "Não consegui ler o tamanho do MP3.");
      }
      if (tamanho > limite) {
        return falha(
          "mp3",
          "O MP3 tem " + tamanhoLegivel(tamanho) + " MB; o limite é " +
            tamanhoLegivel(limite) + " MB."
        );
      }
    }

    // Capa é opcional: só valida quando o formulário traz um arquivo.
    // Fail-safe: capa presente sem tamanho válido NUNCA passa (senão uma
    // capa acima de 5 MB escaparia da validação em silêncio).
    if (texto(form.capaNome)) {
      var tamanhoCapa = numero(form.capaTamanhoMb);
      if (tamanhoCapa === null || tamanhoCapa <= 0) {
        return falha(
          "capa",
          "O tamanho da capa não foi informado ou é inválido; informe o tamanho em MB."
        );
      }
      if (tamanhoCapa > CAPA_LIMITE_MB) {
        return falha(
          "capa",
          "A capa tem " + tamanhoLegivel(tamanhoCapa) + " MB; o limite é " +
            CAPA_LIMITE_MB + " MB."
        );
      }
    }

    return { ok: true };
  }

  var api = {
    validarPublicacao: validarPublicacao,
    validarDevocional: validarDevocional,
    validarCanal: validarCanal,
    tipoDoLink: tipoDoLink,
    dataIsoValida: dataIsoValida
  };

  if (typeof window !== "undefined") window.SCValidacao = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
