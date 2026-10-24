/* Stronger Cast — sessão (Supabase Auth + perfil admin).
   Serve no WebView (window.sessao / window.SCSessao) e no Node (module.exports).
   O cliente nasce sob demanda a partir de window.SC_SUPABASE (config.js) e
   window.supabase (vendor/supabase.js, UMD). Sem cliente, os métodos devolvem
   erro amigável em PT-BR — nunca estouram exceção para a UI. */
(function (raiz) {
  "use strict";

  var SEM_CONEXAO =
    "Não consegui falar com o servidor. Verifique a internet e tente de novo.";

  var clienteInstancia = null;
  var usuario = null; // {id, email} de quem está logado, ou null
  var ouvintes = []; // callbacks notificados quando a sessão muda

  /* ---------- cliente ---------- */

  function definirUsuario(novo) {
    var anterior = usuario;
    usuario = novo;
    if (anterior === null && novo === null) return;
    for (var i = 0; i < ouvintes.length; i++) {
      try {
        ouvintes[i](usuario ? { email: usuario.email } : null);
      } catch (e) {
        // ouvinte da UI não pode derrubar a sessão
      }
    }
  }

  function usuarioDaSessao(sessao) {
    var u = sessao && sessao.user;
    if (!u || !u.email) return null;
    return { id: u.id || null, email: u.email };
  }

  function observarAuth(cliente) {
    var auth = cliente && cliente.auth;
    if (!auth) return;

    if (typeof auth.onAuthStateChange === "function") {
      try {
        auth.onAuthStateChange(function (evento, sessao) {
          if (sessao) {
            definirUsuario(usuarioDaSessao(sessao));
          } else if (evento === "SIGNED_OUT") {
            definirUsuario(null);
          }
        });
      } catch (e) {
        // SDK antigo/sem listener: segue com o fluxo normal
      }
    }

    // Restaura a sessão salva (splash cobre o tempo do round-trip).
    if (typeof auth.getSession === "function") {
      Promise.resolve()
        .then(function () {
          return auth.getSession();
        })
        .then(function (resposta) {
          if (usuario) return; // login já aconteceu enquanto isso
          var sessao = resposta && resposta.data && resposta.data.session;
          if (sessao) definirUsuario(usuarioDaSessao(sessao));
        })
        .catch(function () {
          // sem sessão guardada: segue deslogado
        });
    }
  }

  function criarCliente() {
    if (clienteInstancia) return clienteInstancia;

    var config = raiz.SC_SUPABASE;
    var lib = raiz.supabase;
    if (!config || !config.url || !config.anonKey) return null;
    if (!lib || typeof lib.createClient !== "function") return null;

    try {
      clienteInstancia = lib.createClient(config.url, config.anonKey);
      observarAuth(clienteInstancia);
    } catch (e) {
      clienteInstancia = null;
    }
    return clienteInstancia;
  }

  /* ---------- mensagens ---------- */

  function textoErro(erro) {
    if (!erro) return "";
    if (typeof erro === "string") return erro;
    return String(erro.message || erro.error_description || "");
  }

  function mensagemDeErro(erro) {
    var m = textoErro(erro).toLowerCase();

    if (m.indexOf("already registered") !== -1 || m.indexOf("already been registered") !== -1) {
      return "Já existe uma conta com este e-mail";
    }
    if (m.indexOf("invalid login credentials") !== -1) {
      return "E-mail ou senha incorretos.";
    }
    if (m.indexOf("email not confirmed") !== -1) {
      return "Confirme seu e-mail antes de entrar.";
    }
    if (m.indexOf("password should be at least") !== -1) {
      return "A senha precisa ter pelo menos 6 caracteres.";
    }
    if (m.indexOf("unable to validate email") !== -1 || m.indexOf("invalid email") !== -1) {
      return "Informe um e-mail válido.";
    }
    if (m.indexOf("rate limit") !== -1 || m.indexOf("too many") !== -1) {
      return "Muitas tentativas. Aguarde um pouco e tente de novo.";
    }
    if (m.indexOf("fetch") !== -1 || m.indexOf("network") !== -1) {
      return SEM_CONEXAO;
    }
    return "Não consegui concluir agora. Tente de novo.";
  }

  function emailLimpo(email) {
    if (email === undefined || email === null) return "";
    return String(email).trim();
  }

  /* O atalho do admin ("stronger") vale só para o valor exato de
     config.adminUsuario, sem diferenciar caixa nem espaços nas pontas.
     Qualquer outro texto segue intacto para o backend. */
  function resolverEmail(email) {
    var endereco = emailLimpo(email);
    var config = raiz.SC_SUPABASE || {};
    var atalho = config.adminUsuario ? emailLimpo(config.adminUsuario).toLowerCase() : "";

    if (atalho && endereco.toLowerCase() === atalho) {
      return { endereco: emailLimpo(config.adminEmail), atalho: true };
    }
    return { endereco: endereco, atalho: false };
  }

  function exigirSessao(acao) {
    if (usuario) return null;
    return "Entre na sua conta para " + acao + ".";
  }

  /* ---------- API ---------- */

  function criarConta(email, senha) {
    var endereco = emailLimpo(email);
    if (!endereco) return Promise.resolve({ ok: false, erro: "Informe seu e-mail." });
    if (!senha) return Promise.resolve({ ok: false, erro: "Informe sua senha." });
    if (String(senha).length < 6) {
      return Promise.resolve({ ok: false, erro: "A senha precisa ter pelo menos 6 caracteres." });
    }

    var cliente = criarCliente();
    if (!cliente) return Promise.resolve({ ok: false, erro: SEM_CONEXAO });

    return Promise.resolve()
      .then(function () {
        return cliente.auth.signUp({ email: endereco, password: senha });
      })
      .then(function (resposta) {
        if (resposta && resposta.error) {
          return { ok: false, erro: mensagemDeErro(resposta.error) };
        }
        var dados = (resposta && resposta.data) || {};
        // "Confirm email" está desligado no backend: o signUp já devolve sessão.
        definirUsuario(usuarioDaSessao(dados.session) || usuarioDaSessao({ user: dados.user }));
        return { ok: true };
      })
      .catch(function () {
        return { ok: false, erro: SEM_CONEXAO };
      });
  }

  function entrar(email, senha) {
    var resolvido = resolverEmail(email);
    var endereco = resolvido.endereco;

    if (resolvido.atalho && !endereco) {
      return Promise.resolve({
        ok: false,
        erro:
          'O atalho "stronger" ainda não está configurado. ' +
          "Fale com o responsável pelo app."
      });
    }
    if (!endereco) return Promise.resolve({ ok: false, erro: "Informe seu e-mail." });
    if (!senha) return Promise.resolve({ ok: false, erro: "Informe sua senha." });

    var cliente = criarCliente();
    if (!cliente) return Promise.resolve({ ok: false, erro: SEM_CONEXAO });

    return Promise.resolve()
      .then(function () {
        return cliente.auth.signInWithPassword({ email: endereco, password: senha });
      })
      .then(function (resposta) {
        if (resposta && resposta.error) {
          return { ok: false, erro: mensagemDeErro(resposta.error) };
        }
        var dados = (resposta && resposta.data) || {};
        definirUsuario(usuarioDaSessao(dados.session) || usuarioDaSessao({ user: dados.user }));
        return { ok: true };
      })
      .catch(function () {
        return { ok: false, erro: SEM_CONEXAO };
      });
  }

  function sair() {
    var cliente = criarCliente();
    definirUsuario(null); // UI responde na hora; o servidor confirma em seguida

    if (!cliente || !cliente.auth || typeof cliente.auth.signOut !== "function") {
      return Promise.resolve({ ok: true });
    }

    return Promise.resolve()
      .then(function () {
        return cliente.auth.signOut();
      })
      .then(function (resposta) {
        if (resposta && resposta.error) {
          return { ok: false, erro: mensagemDeErro(resposta.error) };
        }
        return { ok: true };
      })
      .catch(function () {
        return { ok: false, erro: SEM_CONEXAO };
      });
  }

  function usuarioAtual() {
    return usuario ? { email: usuario.email } : null;
  }

  /* ---------- ajustes da própria conta ---------- */

  var AVISO_EMAIL =
    "Pedido de troca de e-mail enviado. Dependendo das configurações do " +
    "servidor, pode ser preciso confirmar pelo link enviado ao novo endereço. " +
    'Se o e-mail mudar, o atalho "stronger" deixa de funcionar: entre com o ' +
    "e-mail completo e avise a equipe para atualizar a configuração do app.";

  function alterarSenha(novaSenha) {
    var semSessao = exigirSessao("alterar a senha");
    if (semSessao) return Promise.resolve({ ok: false, erro: semSessao });
    if (!novaSenha) {
      return Promise.resolve({ ok: false, erro: "Informe a nova senha." });
    }
    if (String(novaSenha).length < 6) {
      return Promise.resolve({
        ok: false,
        erro: "A senha precisa ter pelo menos 6 caracteres."
      });
    }

    var cliente = criarCliente();
    if (!cliente) return Promise.resolve({ ok: false, erro: SEM_CONEXAO });

    return Promise.resolve()
      .then(function () {
        return cliente.auth.updateUser({ password: novaSenha });
      })
      .then(function (resposta) {
        if (resposta && resposta.error) {
          return { ok: false, erro: mensagemDeErro(resposta.error) };
        }
        return { ok: true };
      })
      .catch(function () {
        return { ok: false, erro: SEM_CONEXAO };
      });
  }

  function alterarEmail(novoEmail) {
    var semSessao = exigirSessao("alterar o e-mail");
    if (semSessao) return Promise.resolve({ ok: false, erro: semSessao });

    var endereco = emailLimpo(novoEmail);
    if (!endereco) return Promise.resolve({ ok: false, erro: "Informe o novo e-mail." });

    var cliente = criarCliente();
    if (!cliente) return Promise.resolve({ ok: false, erro: SEM_CONEXAO });

    return Promise.resolve()
      .then(function () {
        return cliente.auth.updateUser({ email: endereco });
      })
      .then(function (resposta) {
        if (resposta && resposta.error) {
          return { ok: false, erro: mensagemDeErro(resposta.error) };
        }
        return { ok: true, aviso: AVISO_EMAIL };
      })
      .catch(function () {
        return { ok: false, erro: SEM_CONEXAO };
      });
  }

  function eAdmin() {
    if (!usuario || !usuario.id) return Promise.resolve(false);

    var cliente = criarCliente();
    if (!cliente) return Promise.resolve(false);

    return Promise.resolve()
      .then(function () {
        return cliente
          .from("profiles")
          .select("admin")
          .eq("id", usuario.id)
          .maybeSingle();
      })
      .then(function (resposta) {
        if (!resposta || resposta.error || !resposta.data) return false;
        return resposta.data.admin === true;
      })
      .catch(function () {
        return false; // sem perfil/erro: nunca promove ninguém a admin
      });
  }

  /* Seam para a camada de dados (Tasks 6/9): mesmo cliente autenticado. */
  function cliente() {
    return criarCliente();
  }

  function aoMudar(callback) {
    if (typeof callback !== "function") return function () {};
    ouvintes.push(callback);
    return function () {
      var i = ouvintes.indexOf(callback);
      if (i !== -1) ouvintes.splice(i, 1);
    };
  }

  var api = {
    criarConta: criarConta,
    entrar: entrar,
    sair: sair,
    alterarSenha: alterarSenha,
    alterarEmail: alterarEmail,
    usuarioAtual: usuarioAtual,
    eAdmin: eAdmin,
    cliente: cliente,
    aoMudar: aoMudar
  };

  if (typeof window !== "undefined") {
    window.SCSessao = api;
    window.sessao = api; // nome curto usado pelos consumidores (Tasks 6-9)
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
