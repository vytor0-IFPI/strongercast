/* Stronger Cast — painel do admin (Task 9).
   Publica, edita e tira episódios do ar DENTRO do app, sem recarregar a
   página (SPA). O gate tem duas camadas: a vista #admin só abre quando
   sessao.eAdmin() é true (app.js + abrir()) e publicar/editar/tirarDoAr
   checam de novo — mesmo que a UI fosse burlada, a RLS do Supabase (Task 4)
   é a barreira real.

   Fluxo de publicação: valida → sobe o MP3 (OPCIONAL) em mp3s/{uuid}.mp3 →
   sobe a capa (opcional) em capas/{uuid}.{ext} → insert em episodes. Sem MP3,
   o episódio fica só com o vídeo e a coluna mp3 recebe null. Se o insert
   falhar, os arquivos recém-enviados são removidos (rollback best-effort);
   como o caminho é único por uuid, um órfão eventual nunca sobrescreve outro
   arquivo e não fica visível em nenhum episódio.

   Progresso: o supabase-js v2 não emite evento de progresso no upload (o
   `onUploadProgress` da v1 saiu). No WebView usamos o endpoint REST do
   Storage com XMLHttpRequest e `upload.onprogress` (progresso real); em
   Node/testes, sem XMLHttpRequest, o mesmo contrato cai no storage.upload do
   SDK. As duas rotas usam a sessão do admin — a política de escrita do bucket
   é a mesma.

   Serve no WebView (window.SCAdmin / window.admin) e no Node
   (module.exports.criarAdmin), com as dependências injetadas para os testes
   não tocarem a rede. */
(function (raiz) {
  "use strict";

  var SEM_PERMISSAO = "Sem permissão";
  var SEM_CONEXAO =
    "Não consegui falar com o servidor. Verifique a internet e tente de novo.";
  var BUCKET = "midias";
  var EXT_CAPA = /\.(jpe?g|png|webp|gif)$/i;

  var doc = raiz.document || null;

  /* ---------- utilidades ---------- */

  function texto(valor) {
    if (valor === undefined || valor === null) return "";
    return String(valor).trim();
  }

  function textoOuNulo(valor) {
    var t = texto(valor);
    return t ? t : null;
  }

  function falha(campo, erro) {
    return { ok: false, campo: campo, erro: erro };
  }

  function falhaGeral(erro) {
    return { ok: false, erro: erro };
  }

  function tamanhoMb(arquivo) {
    if (!arquivo || typeof arquivo.size !== "number") return null;
    return arquivo.size / (1024 * 1024);
  }

  function nomeDoCaminho(caminho) {
    var partes = texto(caminho).split("/");
    return partes.length ? partes[partes.length - 1] : "";
  }

  function extensaoCapa(arquivo) {
    var nome = texto(arquivo && arquivo.name);
    var m = nome.match(EXT_CAPA);
    if (m) return m[1].toLowerCase().replace("jpeg", "jpg");
    var tipo = texto(arquivo && arquivo.type).toLowerCase();
    if (tipo.indexOf("png") !== -1) return "png";
    if (tipo.indexOf("webp") !== -1) return "webp";
    if (tipo.indexOf("gif") !== -1) return "gif";
    return "jpg";
  }

  function novoId() {
    var c = raiz.crypto;
    if (c && typeof c.randomUUID === "function") {
      try {
        return c.randomUUID();
      } catch (e) {
        // segue para o fallback
      }
    }
    var saida = "";
    for (var i = 0; i < 32; i++) {
      saida += Math.floor(Math.random() * 16).toString(16);
    }
    return saida;
  }

  function mensagem(erro) {
    if (!erro) return "";
    if (typeof erro === "string") return erro;
    return String(erro.message || erro.error_description || erro.erro || "");
  }

  function mensagemUpload(status, corpo) {
    if (status === 401 || status === 403) {
      return "Sem permissão para enviar o arquivo. Confirme se sua conta é admin.";
    }
    if (status === 413) {
      return "O arquivo passa do limite de upload do servidor.";
    }
    var detalhe = texto(corpo);
    return (
      "Não consegui enviar o arquivo (HTTP " + status + ")" +
      (detalhe ? ": " + detalhe.slice(0, 160) : ".")
    );
  }

  /* ---------- fábrica (dependências injetáveis) ---------- */

  function criarAdmin(opcoes) {
    var o = opcoes || {};
    var config = o.config || {};

    var deps = {
      sessao: o.sessao || null,
      cliente:
        typeof o.cliente === "function"
          ? o.cliente
          : function () {
              return null;
            },
      validacao: o.validacao || null,
      config: config,
      limiteMb: typeof o.limiteMb === "number" ? o.limiteMb : null,
      novoId: typeof o.novoId === "function" ? o.novoId : novoId,
      enviar: typeof o.enviar === "function" ? o.enviar : null,
      remover: typeof o.remover === "function" ? o.remover : null
    };

    /* ---------- backend ---------- */

    function permitido() {
      if (!deps.sessao || typeof deps.sessao.eAdmin !== "function") {
        return Promise.resolve(false);
      }
      return Promise.resolve()
        .then(function () {
          return deps.sessao.eAdmin();
        })
        .then(
          function (valor) {
            return valor === true;
          },
          function () {
            return false;
          }
        );
    }

    function obterCliente() {
      try {
        return deps.cliente ? deps.cliente() : null;
      } catch (e) {
        return null;
      }
    }

    function bucketDe(cliente) {
      if (!cliente || !cliente.storage || typeof cliente.storage.from !== "function") {
        return null;
      }
      return cliente.storage.from(BUCKET);
    }

    function limiteMb() {
      if (deps.limiteMb !== null) return deps.limiteMb;
      if (config && typeof config.limiteMp3Mb === "number") return config.limiteMp3Mb;
      return null;
    }

    /* Preenche os campos que a validação conhece. O tamanho da capa SEMPRE
       vem do File (capa.size/(1024*1024)): validarPublicacao rejeita capa com
       tamanho desconhecido por segurança (ruling da Task 3). */
    function preparar(form, arquivos, editando) {
      var dados = {
        titulo: texto(form.titulo),
        convidado: texto(form.convidado),
        data: texto(form.data),
        youtube: texto(form.youtube),
        publicado: form.publicado !== false
      };

      if (arquivos.mp3) {
        dados.mp3Nome = texto(arquivos.mp3.name);
        dados.mp3TamanhoMb = tamanhoMb(arquivos.mp3);
      } else if (editando) {
        // Sem MP3 novo: o arquivo já publicado foi validado na época. O nome
        // sentinela só satisfaz a checagem de extensão; 0 só satisfaz o limite.
        dados.mp3Nome = "existente.mp3";
        dados.mp3TamanhoMb = 0;
      } else {
        // Publicação sem arquivo escolhido: MP3 é opcional e pode vir vazio.
        dados.mp3Nome = texto(form.mp3Nome);
        dados.mp3TamanhoMb = form.mp3TamanhoMb;
      }

      if (arquivos.capa) {
        dados.capaNome = texto(arquivos.capa.name);
        dados.capaTamanhoMb = tamanhoMb(arquivos.capa);
      }

      var validacao = deps.validacao;
      if (!validacao || typeof validacao.validarPublicacao !== "function") {
        return falhaGeral("O app não carregou a validação do formulário.");
      }

      var resultado = validacao.validarPublicacao(dados, limiteMb());
      if (!resultado || !resultado.ok) {
        return falha(
          (resultado && resultado.campo) || "",
          (resultado && resultado.erro) || "Confira os dados do episódio."
        );
      }

      return { ok: true, form: dados };
    }

    /* Devocional: texto puro, sem arquivos. A data-padrão (hoje) é preenchida
       pela UI; aqui ela precisa vir válida no formato do banco. */
    function prepararDevocional(form) {
      var dados = {
        titulo: texto(form.titulo),
        versiculo: texto(form.versiculo),
        texto: texto(form.texto),
        data: texto(form.data),
        publicado: form.publicado !== false
      };

      var validacao = deps.validacao;
      if (!validacao || typeof validacao.validarDevocional !== "function") {
        return falhaGeral("O app não carregou a validação do formulário.");
      }

      var resultado = validacao.validarDevocional(dados);
      if (!resultado || !resultado.ok) {
        return falha(
          (resultado && resultado.campo) || "",
          (resultado && resultado.erro) || "Confira os dados do devocional."
        );
      }

      return { ok: true, form: dados };
    }

    /* Canal: o tipo NUNCA é digitado — vem do link pela validação. */
    function prepararCanal(form) {
      var dados = {
        titulo: texto(form.titulo),
        canal: textoOuNulo(form.canal),
        link: texto(form.link),
        publicado: form.publicado !== false
      };

      var validacao = deps.validacao;
      if (!validacao || typeof validacao.validarCanal !== "function") {
        return falhaGeral("O app não carregou a validação do formulário.");
      }

      var resultado = validacao.validarCanal(dados);
      if (!resultado || !resultado.ok) {
        return falha(
          (resultado && resultado.campo) || "",
          (resultado && resultado.erro) || "Confira os dados do canal."
        );
      }

      dados.tipo = resultado.tipo;
      return { ok: true, form: dados };
    }

    function tarefasDe(arquivos) {
      var tarefas = [];
      if (arquivos.mp3) {
        tarefas.push({
          campo: "mp3",
          caminho: "mp3s/" + deps.novoId() + ".mp3",
          arquivo: arquivos.mp3,
          tipo: texto(arquivos.mp3.type) || "audio/mpeg"
        });
      }
      if (arquivos.capa) {
        tarefas.push({
          campo: "capa",
          caminho: "capas/" + deps.novoId() + "." + extensaoCapa(arquivos.capa),
          arquivo: arquivos.capa,
          tipo: texto(arquivos.capa.type) || "image/jpeg"
        });
      }
      return tarefas;
    }

    function caminhosDe(tarefas) {
      var caminhos = [];
      for (var i = 0; i < tarefas.length; i++) caminhos.push(tarefas[i].caminho);
      return caminhos;
    }

    function urlsDe(tarefas, cliente) {
      var urls = {};
      for (var i = 0; i < tarefas.length; i++) {
        urls[tarefas[i].campo] = urlPublica(cliente, tarefas[i].caminho);
      }
      return urls;
    }

    function urlPublica(cliente, caminho) {
      var bucket = bucketDe(cliente);
      if (bucket && typeof bucket.getPublicUrl === "function") {
        try {
          var resposta = bucket.getPublicUrl(caminho);
          var url = resposta && resposta.data && resposta.data.publicUrl;
          if (url) return url;
        } catch (e) {
          // monta pela config abaixo
        }
      }
      var base = texto(deps.config && deps.config.url).replace(/\/+$/, "");
      if (!base) return caminho;
      return base + "/storage/v1/object/public/" + BUCKET + "/" + caminho;
    }

    function temXHR() {
      return (
        typeof raiz.XMLHttpRequest !== "undefined" &&
        !!deps.config &&
        !!deps.config.url &&
        !!deps.config.anonKey
      );
    }

    function tokenDaSessao(cliente) {
      return Promise.resolve()
        .then(function () {
          return cliente.auth.getSession();
        })
        .then(function (resposta) {
          var sessao = resposta && resposta.data && resposta.data.session;
          if (!sessao || !sessao.access_token) {
            throw new Error("Sua sessão expirou. Entre de novo para publicar.");
          }
          return sessao.access_token;
        });
    }

    /* Upload direto no endpoint REST do Storage, com progresso real. */
    function enviarXHR(cliente, tarefa, aoProgresso) {
      return tokenDaSessao(cliente).then(function (token) {
        return new Promise(function (resolver, rejeitar) {
          var base = texto(deps.config.url).replace(/\/+$/, "");
          var ultimaPorcentagem = -1;
          var url =
            base +
            "/storage/v1/object/" +
            BUCKET +
            "/" +
            tarefa.caminho
              .split("/")
              .map(encodeURIComponent)
              .join("/");

          var xhr = new raiz.XMLHttpRequest();
          xhr.open("POST", url, true);
          xhr.setRequestHeader("apikey", deps.config.anonKey);
          xhr.setRequestHeader("authorization", "Bearer " + token);
          xhr.setRequestHeader("x-upsert", "false");

          if (xhr.upload) {
            xhr.upload.onprogress = function (evento) {
              if (!evento || !evento.lengthComputable) return;
              if (typeof aoProgresso !== "function") return;
              var porcentagem = Math.round((evento.loaded / evento.total) * 100);
              ultimaPorcentagem = porcentagem;
              aoProgresso({
                etapa: "upload",
                campo: tarefa.campo,
                caminho: tarefa.caminho,
                porcentagem: porcentagem
              });
            };
          }

          xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
              if (typeof aoProgresso === "function" && ultimaPorcentagem < 100) {
                aoProgresso({
                  etapa: "upload",
                  campo: tarefa.campo,
                  caminho: tarefa.caminho,
                  porcentagem: 100
                });
              }
              resolver({ path: tarefa.caminho });
              return;
            }
            rejeitar(new Error(mensagemUpload(xhr.status, xhr.responseText)));
          };

          xhr.onerror = function () {
            rejeitar(new Error(SEM_CONEXAO));
          };
          xhr.ontimeout = function () {
            rejeitar(new Error("O envio demorou demais. Tente de novo."));
          };

          var corpo = new raiz.FormData();
          corpo.append("cacheControl", "3600");
          corpo.append("", tarefa.arquivo); // mesmo formato do SDK (campo vazio)
          xhr.send(corpo);
        });
      });
    }

    function enviarPadrao(cliente, tarefa, aoProgresso) {
      if (temXHR()) return enviarXHR(cliente, tarefa, aoProgresso);

      var bucket = bucketDe(cliente);
      if (!bucket || typeof bucket.upload !== "function") {
        return Promise.reject(new Error("O app não carregou o envio de arquivos."));
      }

      return Promise.resolve()
        .then(function () {
          return bucket.upload(tarefa.caminho, tarefa.arquivo, {
            contentType: tarefa.tipo,
            cacheControl: "3600",
            upsert: false,
            // Inerte no supabase-js v2; o progresso real vem do caminho XHR.
            onUploadProgress: aoProgresso
          });
        })
        .then(function (resposta) {
          if (resposta && resposta.error) {
            throw new Error(mensagem(resposta.error));
          }
          return resposta && resposta.data;
        });
    }

    function removerArquivos(cliente, caminhos) {
      if (!caminhos || !caminhos.length) return Promise.resolve();
      if (deps.remover) {
        return Promise.resolve()
          .then(function () {
            return deps.remover(cliente, caminhos.slice());
          })
          .catch(function () {});
      }
      var bucket = bucketDe(cliente);
      if (!bucket || typeof bucket.remove !== "function") return Promise.resolve();
      return Promise.resolve()
        .then(function () {
          return bucket.remove(caminhos.slice());
        })
        .catch(function () {});
    }

    /* Sobe os arquivos na ordem MP3 → capa. Qualquer falha desfaz o que já
       subiu antes de devolver o erro para a UI. */
    function enviarTarefas(cliente, tarefas, aoProgresso) {
      var enviar = deps.enviar || enviarPadrao;
      var feitos = [];
      var cadeia = Promise.resolve();

      for (var i = 0; i < tarefas.length; i++) {
        (function (tarefa) {
          cadeia = cadeia.then(function () {
            return Promise.resolve()
              .then(function () {
                return enviar(cliente, tarefa, aoProgresso);
              })
              .catch(function (erro) {
                if (erro && typeof erro === "object" && !erro.campo) {
                  erro.campo = tarefa.campo;
                }
                throw erro;
              })
              .then(function () {
                feitos.push(tarefa.caminho);
              });
          });
        })(tarefas[i]);
      }

      return cadeia.then(
        function () {
          return { ok: true };
        },
        function (erro) {
          return removerArquivos(cliente, feitos).then(function () {
            return {
              ok: false,
              campo: (erro && erro.campo) || "",
              erro: mensagem(erro) || "Não consegui enviar o arquivo."
            };
          });
        }
      );
    }

    function linhaNova(form, urls) {
      return {
        titulo: form.titulo,
        convidado: form.convidado || null,
        data: form.data,
        youtube: form.youtube,
        // Episódio só com vídeo é válido: sem upload, o banco recebe null.
        mp3: textoOuNulo(urls.mp3),
        capa: urls.capa || null,
        publicado: form.publicado !== false
      };
    }

    function linhaEditada(form, urls) {
      var linha = {
        titulo: form.titulo,
        convidado: form.convidado || null,
        data: form.data,
        youtube: form.youtube,
        publicado: form.publicado !== false
      };
      // Só troca os arquivos quando o admin escolheu novos: o que não veio
      // continua no storage e no episódio.
      if (urls.mp3) linha.mp3 = urls.mp3;
      if (urls.capa) linha.capa = urls.capa;
      return linha;
    }

    function inserir(cliente, linha) {
      return inserirEm(cliente, "episodes", linha);
    }

    function inserirEm(cliente, tabela, linha) {
      return Promise.resolve()
        .then(function () {
          return cliente.from(tabela).insert(linha).select().single();
        })
        .then(function (resposta) {
          if (resposta && resposta.error) {
            throw new Error(mensagem(resposta.error));
          }
          return (resposta && resposta.data) || linha;
        });
    }

    function atualizar(cliente, id, dados) {
      return atualizarEm(cliente, "episodes", id, dados);
    }

    function atualizarEm(cliente, tabela, id, dados) {
      return Promise.resolve()
        .then(function () {
          return cliente.from(tabela).update(dados).eq("id", id);
        })
        .then(function (resposta) {
          if (resposta && resposta.error) {
            throw new Error(mensagem(resposta.error));
          }
          return true;
        });
    }

    /* Apagar de vez (rodada 3.1): DELETE de verdade, só pelo id. A RLS do
       Supabase é a barreira final — o gate de admin continua aqui também. */
    function excluirEm(cliente, tabela, id) {
      return Promise.resolve()
        .then(function () {
          return cliente.from(tabela).delete().eq("id", id);
        })
        .then(function (resposta) {
          if (resposta && resposta.error) {
            throw new Error(mensagem(resposta.error));
          }
          return true;
        });
    }

    /* Lista crua do painel (inclui rascunhos): order desc pela coluna dada. */
    function listarRegistros(cliente, tabela, coluna) {
      return Promise.resolve()
        .then(function () {
          return cliente.from(tabela).select("*").order(coluna, {
            ascending: false
          });
        })
        .then(function (resposta) {
          if (resposta && resposta.error) {
            return falhaGeral(mensagem(resposta.error));
          }
          return {
            ok: true,
            itens: Array.isArray(resposta && resposta.data) ? resposta.data : []
          };
        });
    }

    function carregar(cliente) {
      return listarRegistros(cliente, "episodes", "data").then(function (resultado) {
        if (!resultado.ok) return resultado;
        return { ok: true, episodios: resultado.itens };
      });
    }

    /* ---------- API de dados ---------- */

    function publicar(form, arquivos) {
      arquivos = arquivos || {};

      return permitido()
        .then(function (admin) {
          if (!admin) return falhaGeral(SEM_PERMISSAO);

          var preparado = preparar(form || {}, arquivos, false);
          if (!preparado.ok) return preparado;

          var cliente = obterCliente();
          if (!cliente) return falhaGeral(SEM_CONEXAO);

          var tarefas = tarefasDe(arquivos);

          return enviarTarefas(cliente, tarefas, arquivos.aoProgresso).then(
            function (envio) {
              if (!envio.ok) return falha(envio.campo || "", envio.erro);

              var urls = urlsDe(tarefas, cliente);
              var linha = linhaNova(preparado.form, urls);

              return inserir(cliente, linha).then(
                function (ep) {
                  return { ok: true, ep: ep };
                },
                function (erro) {
                  // Insert falhou: remove os arquivos recém-enviados para não
                  // deixar lixo pago no bucket sem episódio apontando pra ele.
                  return removerArquivos(cliente, caminhosDe(tarefas)).then(
                    function () {
                      return falhaGeral(
                        "Não consegui salvar o episódio: " + mensagem(erro)
                      );
                    }
                  );
                }
              );
            }
          );
        })
        .catch(function (erro) {
          return falhaGeral(mensagem(erro) || SEM_CONEXAO);
        });
    }

    function editar(id, form, arquivos) {
      arquivos = arquivos || {};

      return permitido()
        .then(function (admin) {
          if (!admin) return falhaGeral(SEM_PERMISSAO);
          if (!texto(id)) return falhaGeral("Episódio inválido.");

          var preparado = preparar(form || {}, arquivos, true);
          if (!preparado.ok) return preparado;

          var cliente = obterCliente();
          if (!cliente) return falhaGeral(SEM_CONEXAO);

          var tarefas = tarefasDe(arquivos);

          return enviarTarefas(cliente, tarefas, arquivos.aoProgresso).then(
            function (envio) {
              if (!envio.ok) return falha(envio.campo || "", envio.erro);

              var urls = urlsDe(tarefas, cliente);
              var dados = linhaEditada(preparado.form, urls);

              return atualizar(cliente, id, dados).then(
                function () {
                  var ep = { id: id };
                  for (var chave in dados) {
                    if (Object.prototype.hasOwnProperty.call(dados, chave)) {
                      ep[chave] = dados[chave];
                    }
                  }
                  return { ok: true, ep: ep };
                },
                function (erro) {
                  return removerArquivos(cliente, caminhosDe(tarefas)).then(
                    function () {
                      return falhaGeral(
                        "Não consegui salvar as alterações: " + mensagem(erro)
                      );
                    }
                  );
                }
              );
            }
          );
        })
        .catch(function (erro) {
          return falhaGeral(mensagem(erro) || SEM_CONEXAO);
        });
    }

    function tirarDoAr(id) {
      return permitido().then(function (admin) {
        if (!admin) throw new Error(SEM_PERMISSAO);
        if (!texto(id)) throw new Error("Episódio inválido.");

        var cliente = obterCliente();
        if (!cliente) throw new Error(SEM_CONEXAO);

        // Escolha do dono registrada no spec: sai do ar, o histórico fica.
        return atualizar(cliente, id, { publicado: false }).then(function () {
          return undefined;
        });
      });
    }

    /* Diferente de tirarDoAr: aqui o episódio some do banco. Sem voltar atrás,
       a UI exige confirmação antes de chamar esta função. */
    function excluirEpisodio(id) {
      return permitido().then(function (admin) {
        if (!admin) throw new Error(SEM_PERMISSAO);
        if (!texto(id)) throw new Error("Episódio inválido.");

        var cliente = obterCliente();
        if (!cliente) throw new Error(SEM_CONEXAO);

        return excluirEm(cliente, "episodes", id).then(function () {
          return true;
        });
      });
    }

    function listar() {
      return permitido()
        .then(function (admin) {
          if (!admin) return falhaGeral(SEM_PERMISSAO);
          var cliente = obterCliente();
          if (!cliente) return falhaGeral(SEM_CONEXAO);
          return carregar(cliente);
        })
        .catch(function (erro) {
          return falhaGeral(mensagem(erro) || SEM_CONEXAO);
        });
    }

    /* ---------- API de dados — devocionais ---------- */

    function publicarDevocional(form) {
      return permitido()
        .then(function (admin) {
          if (!admin) return falhaGeral(SEM_PERMISSAO);

          var preparado = prepararDevocional(form || {});
          if (!preparado.ok) return preparado;

          var cliente = obterCliente();
          if (!cliente) return falhaGeral(SEM_CONEXAO);

          return inserirEm(cliente, "devotionals", preparado.form).then(
            function (devocional) {
              return { ok: true, devocional: devocional };
            },
            function (erro) {
              return falhaGeral("Não consegui salvar o devocional: " + mensagem(erro));
            }
          );
        })
        .catch(function (erro) {
          return falhaGeral(mensagem(erro) || SEM_CONEXAO);
        });
    }

    function editarDevocional(id, form) {
      return permitido()
        .then(function (admin) {
          if (!admin) return falhaGeral(SEM_PERMISSAO);
          if (!texto(id)) return falhaGeral("Devocional inválido.");

          var preparado = prepararDevocional(form || {});
          if (!preparado.ok) return preparado;

          var cliente = obterCliente();
          if (!cliente) return falhaGeral(SEM_CONEXAO);

          return atualizarEm(cliente, "devotionals", id, preparado.form).then(
            function () {
              var devocional = { id: id };
              for (var chave in preparado.form) {
                if (Object.prototype.hasOwnProperty.call(preparado.form, chave)) {
                  devocional[chave] = preparado.form[chave];
                }
              }
              return { ok: true, devocional: devocional };
            },
            function (erro) {
              return falhaGeral(
                "Não consegui salvar as alterações: " + mensagem(erro)
              );
            }
          );
        })
        .catch(function (erro) {
          return falhaGeral(mensagem(erro) || SEM_CONEXAO);
        });
    }

    function tirarDevocionalDoAr(id) {
      return permitido().then(function (admin) {
        if (!admin) throw new Error(SEM_PERMISSAO);
        if (!texto(id)) throw new Error("Devocional inválido.");

        var cliente = obterCliente();
        if (!cliente) throw new Error(SEM_CONEXAO);

        return atualizarEm(cliente, "devotionals", id, { publicado: false }).then(
          function () {
            return undefined;
          }
        );
      });
    }

    function listarDevocionais() {
      return permitido()
        .then(function (admin) {
          if (!admin) return falhaGeral(SEM_PERMISSAO);
          var cliente = obterCliente();
          if (!cliente) return falhaGeral(SEM_CONEXAO);

          return listarRegistros(cliente, "devotionals", "data").then(function (resultado) {
            if (!resultado.ok) return resultado;
            return { ok: true, devocionais: resultado.itens };
          });
        })
        .catch(function (erro) {
          return falhaGeral(mensagem(erro) || SEM_CONEXAO);
        });
    }

    /* ---------- API de dados — canais recomendados ---------- */

    function publicarCanal(form) {
      return permitido()
        .then(function (admin) {
          if (!admin) return falhaGeral(SEM_PERMISSAO);

          var preparado = prepararCanal(form || {});
          if (!preparado.ok) return preparado;

          var cliente = obterCliente();
          if (!cliente) return falhaGeral(SEM_CONEXAO);

          return inserirEm(cliente, "recommended_channels", preparado.form).then(
            function (canal) {
              return { ok: true, canal: canal };
            },
            function (erro) {
              return falhaGeral("Não consegui salvar o canal: " + mensagem(erro));
            }
          );
        })
        .catch(function (erro) {
          return falhaGeral(mensagem(erro) || SEM_CONEXAO);
        });
    }

    function editarCanal(id, form) {
      return permitido()
        .then(function (admin) {
          if (!admin) return falhaGeral(SEM_PERMISSAO);
          if (!texto(id)) return falhaGeral("Canal inválido.");

          var preparado = prepararCanal(form || {});
          if (!preparado.ok) return preparado;

          var cliente = obterCliente();
          if (!cliente) return falhaGeral(SEM_CONEXAO);

          return atualizarEm(
            cliente,
            "recommended_channels",
            id,
            preparado.form
          ).then(
            function () {
              var canal = { id: id };
              for (var chave in preparado.form) {
                if (Object.prototype.hasOwnProperty.call(preparado.form, chave)) {
                  canal[chave] = preparado.form[chave];
                }
              }
              return { ok: true, canal: canal };
            },
            function (erro) {
              return falhaGeral(
                "Não consegui salvar as alterações: " + mensagem(erro)
              );
            }
          );
        })
        .catch(function (erro) {
          return falhaGeral(mensagem(erro) || SEM_CONEXAO);
        });
    }

    function tirarCanalDoAr(id) {
      return permitido().then(function (admin) {
        if (!admin) throw new Error(SEM_PERMISSAO);
        if (!texto(id)) throw new Error("Canal inválido.");

        var cliente = obterCliente();
        if (!cliente) throw new Error(SEM_CONEXAO);

        return atualizarEm(cliente, "recommended_channels", id, {
          publicado: false
        }).then(function () {
          return undefined;
        });
      });
    }

    function listarCanais() {
      return permitido()
        .then(function (admin) {
          if (!admin) return falhaGeral(SEM_PERMISSAO);
          var cliente = obterCliente();
          if (!cliente) return falhaGeral(SEM_CONEXAO);

          return listarRegistros(cliente, "recommended_channels", "criado_em").then(
            function (resultado) {
              if (!resultado.ok) return resultado;
              return { ok: true, canais: resultado.itens };
            }
          );
        })
        .catch(function (erro) {
          return falhaGeral(mensagem(erro) || SEM_CONEXAO);
        });
    }

    /* ---------- UI (só no navegador) ---------- */

    var emEdicao = null;
    var ocupado = false;
    var emEdicaoDev = null;
    var ocupadoDev = false;
    var emEdicaoCanal = null;
    var ocupadoCanal = false;
    var abaAtual = "episodios";

    function porId(id) {
      return doc ? doc.getElementById(id) : null;
    }

    function campo(nome) {
      return porId("admin-" + nome);
    }

    function erroDe(nome) {
      return porId("admin-erro-" + nome);
    }

    function limparErros() {
      var nomes = ["titulo", "data", "youtube", "mp3", "capa"];
      for (var i = 0; i < nomes.length; i++) {
        var alvo = erroDe(nomes[i]);
        if (alvo) {
          alvo.textContent = "";
          alvo.hidden = true;
        }
      }
      definirStatus("");
    }

    function mostrarErro(resultado) {
      var mensagemErro = (resultado && resultado.erro) || "Não consegui concluir agora.";
      var alvo = resultado && resultado.campo ? erroDe(resultado.campo) : null;
      if (alvo) {
        alvo.textContent = mensagemErro;
        alvo.hidden = false;
        alvo.scrollIntoView({ block: "nearest" });
        return;
      }
      definirStatus(mensagemErro, "erro");
    }

    function definirStatus(mensagemTexto, tipo) {
      var alvo = porId("admin-status");
      if (!alvo) return;
      alvo.textContent = texto(mensagemTexto);
      alvo.hidden = !mensagemTexto;
      alvo.className =
        "admin__status" + (tipo ? " admin__status--" + tipo : "");
    }

    function mostrarEmail() {
      var alvo = porId("admin-sessao");
      if (!alvo) return;
      var sessao = deps.sessao;
      var usuario = null;
      try {
        usuario =
          sessao && typeof sessao.usuarioAtual === "function"
            ? sessao.usuarioAtual()
            : null;
      } catch (e) {
        usuario = null;
      }
      alvo.textContent = usuario && usuario.email ? usuario.email : "";
      alvo.hidden = !alvo.textContent;
    }

    function hojeIso() {
      var agora = new Date();
      var mes = String(agora.getMonth() + 1).padStart(2, "0");
      var dia = String(agora.getDate()).padStart(2, "0");
      return agora.getFullYear() + "-" + mes + "-" + dia;
    }

    function bloquear(estado) {
      ocupado = estado;
      var enviar = porId("admin-enviar");
      if (enviar) {
        enviar.disabled = estado;
        enviar.textContent = estado
          ? "Enviando…"
          : emEdicao
            ? "Salvar alterações"
            : "Publicar episódio";
      }
      var lista = porId("admin-lista");
      if (lista) {
        var botoes = lista.querySelectorAll("button");
        for (var i = 0; i < botoes.length; i++) botoes[i].disabled = estado;
      }
    }

    function aoProgresso(evento) {
      var barra = porId("admin-progresso");
      var rotulo = porId("admin-progresso-texto");
      var porcentagem = evento && typeof evento.porcentagem === "number"
        ? evento.porcentagem
        : 0;
      var etapa = evento && evento.campo === "capa" ? "capa" : "MP3";

      if (barra) {
        barra.hidden = false;
        barra.value = porcentagem;
      }
      if (rotulo) {
        rotulo.hidden = false;
        rotulo.textContent = "Enviando " + etapa + "… " + porcentagem + "%";
      }
    }

    function esconderProgresso() {
      var barra = porId("admin-progresso");
      var rotulo = porId("admin-progresso-texto");
      if (barra) {
        barra.hidden = true;
        barra.value = 0;
      }
      if (rotulo) {
        rotulo.hidden = true;
        rotulo.textContent = "";
      }
    }

    function lerFormulario() {
      return {
        titulo: campo("titulo") ? campo("titulo").value : "",
        convidado: campo("convidado") ? campo("convidado").value : "",
        data: campo("data") ? campo("data").value : "",
        youtube: campo("youtube") ? campo("youtube").value : "",
        publicado: campo("publicado") ? campo("publicado").checked : true
      };
    }

    function lerArquivos() {
      var mp3 = campo("mp3");
      var capa = campo("capa");
      return {
        mp3: mp3 && mp3.files && mp3.files[0] ? mp3.files[0] : null,
        capa: capa && capa.files && capa.files[0] ? capa.files[0] : null,
        aoProgresso: aoProgresso
      };
    }

    function limparFormulario() {
      emEdicao = null;

      var form = porId("form-admin");
      if (form) form.reset();

      var id = porId("admin-id");
      if (id) id.value = "";

      var publicado = campo("publicado");
      if (publicado) publicado.checked = true;

      var mp3Campo = campo("mp3");
      if (mp3Campo) {
        // MP3 é opcional: o episódio pode ser publicado só com o vídeo.
        mp3Campo.required = false;
        mp3Campo.value = "";
      }

      var capaCampo = campo("capa");
      if (capaCampo) capaCampo.value = "";

      var data = campo("data");
      if (data) data.value = hojeIso();

      var atualMp3 = porId("admin-mp3-atual");
      var atualCapa = porId("admin-capa-atual");
      if (atualMp3) {
        atualMp3.textContent = "";
        atualMp3.hidden = true;
      }
      if (atualCapa) {
        atualCapa.textContent = "";
        atualCapa.hidden = true;
      }

      var tituloForm = porId("admin-form-titulo");
      if (tituloForm) tituloForm.textContent = "Novo episódio";

      var cancelar = porId("admin-cancelar");
      if (cancelar) cancelar.hidden = true;

      var enviar = porId("admin-enviar");
      if (enviar) enviar.textContent = "Publicar episódio";

      limparErros();
      esconderProgresso();
    }

    function preencher(ep) {
      if (!ep) return;
      emEdicao = ep;

      var id = porId("admin-id");
      if (id) id.value = ep.id || "";

      var campos = {
        titulo: ep.titulo || "",
        convidado: ep.convidado || "",
        data: ep.data || "",
        youtube: ep.youtube || ""
      };
      for (var nome in campos) {
        if (Object.prototype.hasOwnProperty.call(campos, nome)) {
          var alvo = campo(nome);
          if (alvo) alvo.value = campos[nome];
        }
      }

      var publicado = campo("publicado");
      if (publicado) publicado.checked = ep.publicado !== false;

      var mp3Campo = campo("mp3");
      if (mp3Campo) {
        mp3Campo.required = false;
        mp3Campo.value = "";
      }

      var capaCampo = campo("capa");
      if (capaCampo) capaCampo.value = "";

      var atualMp3 = porId("admin-mp3-atual");
      if (atualMp3) {
        atualMp3.textContent = ep.mp3
          ? "Atual: " + nomeDoCaminho(ep.mp3) + " (escolha outro para trocar)"
          : "";
        atualMp3.hidden = !atualMp3.textContent;
      }

      var atualCapa = porId("admin-capa-atual");
      if (atualCapa) {
        atualCapa.textContent = ep.capa
          ? "Atual: " + nomeDoCaminho(ep.capa) + " (escolha outra para trocar)"
          : "";
        atualCapa.hidden = !atualCapa.textContent;
      }

      var tituloForm = porId("admin-form-titulo");
      if (tituloForm) tituloForm.textContent = "Editar episódio";

      var cancelar = porId("admin-cancelar");
      if (cancelar) cancelar.hidden = false;

      var enviar = porId("admin-enviar");
      if (enviar) enviar.textContent = "Salvar alterações";

      limparErros();

      var form = porId("form-admin");
      if (form && typeof form.scrollIntoView === "function") {
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    function elemento(tag, classe) {
      var el = doc.createElement(tag);
      if (classe) el.className = classe;
      return el;
    }

    function botaoAcao(rotulo, classe, aoClicar) {
      var botao = elemento("button", "admin-ep__botao" + (classe ? " " + classe : ""));
      botao.setAttribute("type", "button");
      botao.textContent = rotulo;
      botao.addEventListener("click", aoClicar);
      return botao;
    }

    function renderizar(episodios) {
      var lista = porId("admin-lista");
      if (!lista) return;
      lista.innerHTML = "";

      if (!episodios || !episodios.length) {
        var vazio = elemento("p", "admin__vazio");
        vazio.textContent = "Nenhum episódio ainda. Publique o primeiro acima.";
        lista.appendChild(vazio);
        return;
      }

      for (var i = 0; i < episodios.length; i++) {
        lista.appendChild(criarLinha(episodios[i]));
      }
    }

    function criarLinha(ep) {
      var linha = elemento("article", "admin-ep");

      var info = elemento("div", "admin-ep__info");
      var titulo = elemento("h3", "admin-ep__titulo");
      titulo.textContent = ep.titulo || "Episódio sem título";
      info.appendChild(titulo);

      var metaPartes = [];
      if (ep.data) metaPartes.push(ep.data);
      if (ep.convidado) metaPartes.push(ep.convidado);
      var meta = elemento("p", "admin-ep__meta");
      meta.textContent = metaPartes.join(" · ");
      info.appendChild(meta);

      var publicado = ep.publicado !== false;
      var selo = elemento(
        "span",
        "admin-ep__selo " +
          (publicado ? "admin-ep__selo--publicado" : "admin-ep__selo--rascunho")
      );
      selo.textContent = publicado ? "Publicado" : "Fora do ar";
      info.appendChild(selo);
      linha.appendChild(info);

      var acoes = elemento("div", "admin-ep__acoes");
      acoes.appendChild(
        botaoAcao("Editar", "", function () {
          preencher(ep);
        })
      );

      if (publicado) {
        acoes.appendChild(
          botaoAcao("Tirar do ar", "admin-ep__botao--perigo", function () {
            tirarDaLista(ep);
          })
        );
      } else {
        acoes.appendChild(
          botaoAcao("Publicar", "admin-ep__botao--ouro", function () {
            publicarDaLista(ep);
          })
        );
      }

      acoes.appendChild(
        botaoAcao(
          "Apagar",
          "admin-ep__botao--perigo admin-ep__botao--apagar",
          function () {
            apagarDaLista(ep);
          }
        )
      );

      linha.appendChild(acoes);
      return linha;
    }

    function atualizarLista() {
      var cliente = obterCliente();
      if (!cliente) {
        definirStatus(SEM_CONEXAO, "erro");
        return Promise.resolve(false);
      }

      return carregar(cliente).then(function (resultado) {
        if (!resultado.ok) {
          definirStatus(resultado.erro, "erro");
          return false;
        }
        renderizar(resultado.episodios);
        return true;
      });
    }

    function tirarDaLista(ep) {
      var pergunta =
        'Tirar "' +
        (ep.titulo || "este episódio") +
        '" do ar? Ele some da lista pública, mas continua aqui no painel.';
      var confirmou =
        typeof raiz.confirm === "function" ? raiz.confirm(pergunta) : true;
      if (!confirmou) return;

      bloquear(true);
      tirarDoAr(ep.id)
        .then(function () {
          definirStatus('"' + (ep.titulo || "Episódio") + '" saiu do ar.', "ok");
          return atualizarLista();
        })
        .then(function () {
          recarregarPublica();
        })
        .catch(function (erro) {
          definirStatus(mensagem(erro) || SEM_CONEXAO, "erro");
        })
        .then(function () {
          bloquear(false);
        });
    }

    function publicarDaLista(ep) {
      bloquear(true);
      permitido()
        .then(function (admin) {
          if (!admin) throw new Error(SEM_PERMISSAO);
          var cliente = obterCliente();
          if (!cliente) throw new Error(SEM_CONEXAO);
          return atualizar(cliente, ep.id, { publicado: true });
        })
        .then(function () {
          definirStatus('"' + (ep.titulo || "Episódio") + '" está publicado.', "ok");
          return atualizarLista();
        })
        .then(function () {
          recarregarPublica();
        })
        .catch(function (erro) {
          definirStatus(mensagem(erro) || SEM_CONEXAO, "erro");
        })
        .then(function () {
          bloquear(false);
        });
    }

    /* Apaga de vez (rodada 3.1). Primeiro toque só pergunta; nada de delete
       sem confirmação. Sem confirm() disponível, a resposta segura é "não". */
    function apagarDaLista(ep) {
      var pergunta = "Apagar este episódio? Não dá pra desfazer.";
      var confirmou =
        typeof raiz.confirm === "function" ? raiz.confirm(pergunta) : false;
      if (!confirmou) return;

      bloquear(true);
      excluirEpisodio(ep.id)
        .then(function () {
          definirStatus('"' + (ep.titulo || "Episódio") + '" foi apagado.', "ok");
          return atualizarLista();
        })
        .then(function () {
          recarregarPublica();
        })
        .catch(function (erro) {
          definirStatus(mensagem(erro) || SEM_CONEXAO, "erro");
        })
        .then(function () {
          bloquear(false);
        });
    }

    function recarregarPublica() {
      var app = raiz.SCApp;
      if (app && typeof app.recarregarLista === "function") {
        try {
          app.recarregarLista();
        } catch (e) {
          // a lista pública se atualiza na próxima abertura
        }
      }
      // Rodada 2: as vistas abertas de Devocionais/Canais também acompanham.
      if (app && typeof app.recarregarSecoes === "function") {
        try {
          app.recarregarSecoes();
        } catch (e) {
          // as seções se atualizam na próxima abertura
        }
      }
    }

    function aoEnviar(evento) {
      if (evento) evento.preventDefault();
      if (ocupado) return;

      limparErros();
      bloquear(true);

      var form = lerFormulario();
      var arquivos = lerArquivos();
      var editando = emEdicao && emEdicao.id ? emEdicao.id : null;
      var acao = editando
        ? editar(editando, form, arquivos)
        : publicar(form, arquivos);

      acao
        .then(function (resultado) {
          if (!resultado || !resultado.ok) {
            mostrarErro(resultado);
            return;
          }

          definirStatus(
            editando ? "Episódio atualizado." : "Episódio publicado.",
            "ok"
          );
          limparFormulario();
          return atualizarLista().then(function () {
            recarregarPublica();
          });
        })
        .catch(function (erro) {
          definirStatus(mensagem(erro) || SEM_CONEXAO, "erro");
        })
        .then(function () {
          bloquear(false);
          esconderProgresso();
        });
    }

    function abrir() {
      if (!doc) return Promise.resolve(false);

      return permitido()
        .then(function (admin) {
          if (!admin) return false;
          mostrarEmail();

          var data = campo("data");
          if (!emEdicao && data && !data.value) data.value = hojeIso();

          var dataDev = campoDev("data");
          if (!emEdicaoDev && dataDev && !dataDev.value) dataDev.value = hojeIso();

          // Episódios é a aba padrão, como antes da rodada 2.
          mostrarAba("episodios", false);

          return atualizarLista().then(function () {
            return true;
          });
        })
        .catch(function () {
          return false;
        });
    }

    /* ---------- abas do painel (rodada 2) ---------- */

    function definirClasseAtiva(el, classe, ativa) {
      if (!el) return;
      var atual = String(el.className || "")
        .split(/\s+/)
        .filter(function (c) {
          return !!c;
        });
      var indice = atual.indexOf(classe);
      if (ativa && indice === -1) atual.push(classe);
      if (!ativa && indice !== -1) atual.splice(indice, 1);
      el.className = atual.join(" ");
    }

    function mostrarAba(nome, carregar) {
      abaAtual =
        nome === "devocionais" || nome === "canais" ? nome : "episodios";

      var abas = {
        episodios: porId("admin-aba-episodios"),
        devocionais: porId("admin-aba-devocionais"),
        canais: porId("admin-aba-canais")
      };
      var paineis = {
        episodios: porId("admin-painel-episodios"),
        devocionais: porId("admin-painel-devocionais"),
        canais: porId("admin-painel-canais")
      };

      for (var chave in abas) {
        if (!Object.prototype.hasOwnProperty.call(abas, chave)) continue;
        var ativa = chave === abaAtual;
        var botaoAba = abas[chave];
        if (botaoAba) {
          botaoAba.setAttribute("aria-selected", ativa ? "true" : "false");
          definirClasseAtiva(botaoAba, "admin__aba--ativa", ativa);
        }
        var painel = paineis[chave];
        if (painel) painel.hidden = !ativa;
      }

      if (carregar === false) return Promise.resolve(true);
      if (abaAtual === "devocionais") return atualizarListaDevocionais();
      if (abaAtual === "canais") return atualizarListaCanais();
      return atualizarLista();
    }

    function configurarAbas() {
      var episodios = porId("admin-aba-episodios");
      if (episodios) {
        episodios.addEventListener("click", function () {
          return mostrarAba("episodios");
        });
      }

      var devocionais = porId("admin-aba-devocionais");
      if (devocionais) {
        devocionais.addEventListener("click", function () {
          return mostrarAba("devocionais");
        });
      }

      var canais = porId("admin-aba-canais");
      if (canais) {
        canais.addEventListener("click", function () {
          return mostrarAba("canais");
        });
      }
    }

    /* ---------- campos e erros das abas novas ---------- */

    function campoDev(nome) {
      return porId("admin-dev-" + nome);
    }

    function erroDev(nome) {
      return porId("admin-dev-erro-" + nome);
    }

    function campoCanal(nome) {
      return porId("admin-canal-" + nome);
    }

    function erroCanal(nome) {
      return porId("admin-canal-erro-" + nome);
    }

    function limparErrosDe(erros, nomes) {
      for (var i = 0; i < nomes.length; i++) {
        var alvo = erros(nomes[i]);
        if (!alvo) continue;
        alvo.textContent = "";
        alvo.hidden = true;
      }
    }

    function limparErrosDev() {
      limparErrosDe(erroDev, ["titulo", "versiculo", "texto", "data"]);
    }

    function limparErrosCanal() {
      limparErrosDe(erroCanal, ["titulo", "link"]);
    }

    function mostrarErroEm(resultado, erros) {
      var mensagemErro =
        (resultado && resultado.erro) || "Não consegui concluir agora.";
      var alvo =
        resultado && resultado.campo ? erros(resultado.campo) : null;
      if (alvo) {
        alvo.textContent = mensagemErro;
        alvo.hidden = false;
        if (typeof alvo.scrollIntoView === "function") {
          alvo.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      definirStatus(mensagemErro, "erro");
    }

    /* ---------- formulário e lista de devocionais ---------- */

    function lerFormularioDevocional() {
      return {
        titulo: campoDev("titulo") ? campoDev("titulo").value : "",
        versiculo: campoDev("versiculo") ? campoDev("versiculo").value : "",
        texto: campoDev("texto") ? campoDev("texto").value : "",
        data: campoDev("data") ? campoDev("data").value : "",
        publicado: campoDev("publicado") ? campoDev("publicado").checked : true
      };
    }

    function bloquearDev(estado) {
      ocupadoDev = estado;
      var enviar = porId("admin-dev-enviar");
      if (enviar) {
        enviar.disabled = estado;
        enviar.textContent = estado
          ? "Salvando…"
          : emEdicaoDev
            ? "Salvar alterações"
            : "Publicar devocional";
      }
      var lista = porId("admin-dev-lista");
      if (lista) {
        var botoes = lista.querySelectorAll("button");
        for (var i = 0; i < botoes.length; i++) botoes[i].disabled = estado;
      }
    }

    function limparFormularioDevocional() {
      emEdicaoDev = null;

      var form = porId("form-admin-devocional");
      if (form && typeof form.reset === "function") form.reset();

      var id = porId("admin-dev-id");
      if (id) id.value = "";

      var publicado = campoDev("publicado");
      if (publicado) publicado.checked = true;

      var data = campoDev("data");
      if (data) data.value = hojeIso();

      var tituloForm = porId("admin-dev-form-titulo");
      if (tituloForm) tituloForm.textContent = "Novo devocional";

      var cancelar = porId("admin-dev-cancelar");
      if (cancelar) cancelar.hidden = true;

      var enviar = porId("admin-dev-enviar");
      if (enviar) enviar.textContent = "Publicar devocional";

      limparErrosDev();
    }

    function preencherDevocional(dev) {
      if (!dev) return;
      emEdicaoDev = dev;

      var id = porId("admin-dev-id");
      if (id) id.value = dev.id || "";

      var campos = {
        titulo: dev.titulo || "",
        versiculo: dev.versiculo || "",
        texto: dev.texto || "",
        data: dev.data || ""
      };
      for (var nome in campos) {
        if (Object.prototype.hasOwnProperty.call(campos, nome)) {
          var alvo = campoDev(nome);
          if (alvo) alvo.value = campos[nome];
        }
      }

      var publicado = campoDev("publicado");
      if (publicado) publicado.checked = dev.publicado !== false;

      var tituloForm = porId("admin-dev-form-titulo");
      if (tituloForm) tituloForm.textContent = "Editar devocional";

      var cancelar = porId("admin-dev-cancelar");
      if (cancelar) cancelar.hidden = false;

      var enviar = porId("admin-dev-enviar");
      if (enviar) enviar.textContent = "Salvar alterações";

      limparErrosDev();

      var form = porId("form-admin-devocional");
      if (form && typeof form.scrollIntoView === "function") {
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    function metaDevocional(dev) {
      var partes = [];
      if (dev.data) partes.push(dev.data);
      if (dev.versiculo) partes.push(dev.versiculo);
      return partes.join(" · ");
    }

    function renderizarDevocionais(devocionais) {
      var lista = porId("admin-dev-lista");
      if (!lista) return;
      lista.innerHTML = "";

      if (!devocionais || !devocionais.length) {
        var vazio = elemento("p", "admin__vazio");
        vazio.textContent = "Nenhum devocional ainda. Publique o primeiro acima.";
        lista.appendChild(vazio);
        return;
      }

      for (var i = 0; i < devocionais.length; i++) {
        lista.appendChild(
          criarLinhaAdmin(devocionais[i], {
            fallback: "Devocional sem título",
            meta: metaDevocional,
            editar: preencherDevocional,
            publicar: publicarDevDaLista,
            tirar: tirarDevDaLista
          })
        );
      }
    }

    function atualizarListaDevocionais() {
      var cliente = obterCliente();
      if (!cliente) {
        definirStatus(SEM_CONEXAO, "erro");
        return Promise.resolve(false);
      }

      return listarRegistros(cliente, "devotionals", "data").then(function (resultado) {
        if (!resultado.ok) {
          definirStatus(resultado.erro, "erro");
          return false;
        }
        renderizarDevocionais(resultado.itens);
        return true;
      });
    }

    function aoEnviarDevocional(evento) {
      if (evento) evento.preventDefault();
      if (ocupadoDev) return;

      limparErrosDev();
      bloquearDev(true);

      var form = lerFormularioDevocional();
      var editando = emEdicaoDev && emEdicaoDev.id ? emEdicaoDev.id : null;
      var acao = editando
        ? editarDevocional(editando, form)
        : publicarDevocional(form);

      acao
        .then(function (resultado) {
          if (!resultado || !resultado.ok) {
            mostrarErroEm(resultado, erroDev);
            return;
          }

          definirStatus(
            editando ? "Devocional atualizado." : "Devocional publicado.",
            "ok"
          );
          limparFormularioDevocional();
          return atualizarListaDevocionais().then(function () {
            recarregarPublica();
          });
        })
        .catch(function (erro) {
          definirStatus(mensagem(erro) || SEM_CONEXAO, "erro");
        })
        .then(function () {
          bloquearDev(false);
        });
    }

    function tirarDevDaLista(dev) {
      var pergunta =
        'Tirar "' +
        (dev.titulo || "este devocional") +
        '" do ar? Ele some da lista pública, mas continua aqui no painel.';
      var confirmou =
        typeof raiz.confirm === "function" ? raiz.confirm(pergunta) : true;
      if (!confirmou) return;

      bloquearDev(true);
      tirarDevocionalDoAr(dev.id)
        .then(function () {
          definirStatus(
            '"' + (dev.titulo || "Devocional") + '" saiu do ar.',
            "ok"
          );
          return atualizarListaDevocionais();
        })
        .then(function () {
          recarregarPublica();
        })
        .catch(function (erro) {
          definirStatus(mensagem(erro) || SEM_CONEXAO, "erro");
        })
        .then(function () {
          bloquearDev(false);
        });
    }

    function publicarDevDaLista(dev) {
      bloquearDev(true);
      permitido()
        .then(function (admin) {
          if (!admin) throw new Error(SEM_PERMISSAO);
          var cliente = obterCliente();
          if (!cliente) throw new Error(SEM_CONEXAO);
          return atualizarEm(cliente, "devotionals", dev.id, { publicado: true });
        })
        .then(function () {
          definirStatus(
            '"' + (dev.titulo || "Devocional") + '" está publicado.',
            "ok"
          );
          return atualizarListaDevocionais();
        })
        .then(function () {
          recarregarPublica();
        })
        .catch(function (erro) {
          definirStatus(mensagem(erro) || SEM_CONEXAO, "erro");
        })
        .then(function () {
          bloquearDev(false);
        });
    }

    /* ---------- formulário e lista de canais ---------- */

    function lerFormularioCanal() {
      return {
        titulo: campoCanal("titulo") ? campoCanal("titulo").value : "",
        link: campoCanal("link") ? campoCanal("link").value : "",
        canal: campoCanal("autor") ? campoCanal("autor").value : "",
        publicado: campoCanal("publicado")
          ? campoCanal("publicado").checked
          : true
      };
    }

    function bloquearCanal(estado) {
      ocupadoCanal = estado;
      var enviar = porId("admin-canal-enviar");
      if (enviar) {
        enviar.disabled = estado;
        enviar.textContent = estado
          ? "Salvando…"
          : emEdicaoCanal
            ? "Salvar alterações"
            : "Publicar canal";
      }
      var lista = porId("admin-canal-lista");
      if (lista) {
        var botoes = lista.querySelectorAll("button");
        for (var i = 0; i < botoes.length; i++) botoes[i].disabled = estado;
      }
    }

    function limparFormularioCanal() {
      emEdicaoCanal = null;

      var form = porId("form-admin-canal");
      if (form && typeof form.reset === "function") form.reset();

      var id = porId("admin-canal-id");
      if (id) id.value = "";

      var publicado = campoCanal("publicado");
      if (publicado) publicado.checked = true;

      var tituloForm = porId("admin-canal-form-titulo");
      if (tituloForm) tituloForm.textContent = "Novo canal ou vídeo";

      var cancelar = porId("admin-canal-cancelar");
      if (cancelar) cancelar.hidden = true;

      var enviar = porId("admin-canal-enviar");
      if (enviar) enviar.textContent = "Publicar canal";

      limparErrosCanal();
    }

    function preencherCanal(canal) {
      if (!canal) return;
      emEdicaoCanal = canal;

      var id = porId("admin-canal-id");
      if (id) id.value = canal.id || "";

      var campos = {
        titulo: canal.titulo || "",
        link: canal.link || "",
        autor: canal.canal || ""
      };
      for (var nome in campos) {
        if (Object.prototype.hasOwnProperty.call(campos, nome)) {
          var alvo = campoCanal(nome);
          if (alvo) alvo.value = campos[nome];
        }
      }

      var publicado = campoCanal("publicado");
      if (publicado) publicado.checked = canal.publicado !== false;

      var tituloForm = porId("admin-canal-form-titulo");
      if (tituloForm) tituloForm.textContent = "Editar canal ou vídeo";

      var cancelar = porId("admin-canal-cancelar");
      if (cancelar) cancelar.hidden = false;

      var enviar = porId("admin-canal-enviar");
      if (enviar) enviar.textContent = "Salvar alterações";

      limparErrosCanal();

      var form = porId("form-admin-canal");
      if (form && typeof form.scrollIntoView === "function") {
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    function metaCanal(canal) {
      var partes = [canal.tipo === "canal" ? "Canal" : "Vídeo"];
      if (canal.canal) partes.push(canal.canal);
      if (canal.link) partes.push(canal.link);
      return partes.join(" · ");
    }

    function renderizarCanais(canais) {
      var lista = porId("admin-canal-lista");
      if (!lista) return;
      lista.innerHTML = "";

      if (!canais || !canais.length) {
        var vazio = elemento("p", "admin__vazio");
        vazio.textContent = "Nenhum canal recomendado ainda. Adicione o primeiro acima.";
        lista.appendChild(vazio);
        return;
      }

      for (var i = 0; i < canais.length; i++) {
        lista.appendChild(
          criarLinhaAdmin(canais[i], {
            fallback: "Canal sem título",
            meta: metaCanal,
            editar: preencherCanal,
            publicar: publicarCanalDaLista,
            tirar: tirarCanalDaLista
          })
        );
      }
    }

    function atualizarListaCanais() {
      var cliente = obterCliente();
      if (!cliente) {
        definirStatus(SEM_CONEXAO, "erro");
        return Promise.resolve(false);
      }

      return listarRegistros(cliente, "recommended_channels", "criado_em").then(
        function (resultado) {
          if (!resultado.ok) {
            definirStatus(resultado.erro, "erro");
            return false;
          }
          renderizarCanais(resultado.itens);
          return true;
        }
      );
    }

    function aoEnviarCanal(evento) {
      if (evento) evento.preventDefault();
      if (ocupadoCanal) return;

      limparErrosCanal();
      bloquearCanal(true);

      var form = lerFormularioCanal();
      var editando = emEdicaoCanal && emEdicaoCanal.id ? emEdicaoCanal.id : null;
      var acao = editando ? editarCanal(editando, form) : publicarCanal(form);

      acao
        .then(function (resultado) {
          if (!resultado || !resultado.ok) {
            mostrarErroEm(resultado, erroCanal);
            return;
          }

          definirStatus(
            editando ? "Canal atualizado." : "Canal publicado.",
            "ok"
          );
          limparFormularioCanal();
          return atualizarListaCanais().then(function () {
            recarregarPublica();
          });
        })
        .catch(function (erro) {
          definirStatus(mensagem(erro) || SEM_CONEXAO, "erro");
        })
        .then(function () {
          bloquearCanal(false);
        });
    }

    function tirarCanalDaLista(canal) {
      var pergunta =
        'Tirar "' +
        (canal.titulo || "este canal") +
        '" do ar? Ele some da grade pública, mas continua aqui no painel.';
      var confirmou =
        typeof raiz.confirm === "function" ? raiz.confirm(pergunta) : true;
      if (!confirmou) return;

      bloquearCanal(true);
      tirarCanalDoAr(canal.id)
        .then(function () {
          definirStatus(
            '"' + (canal.titulo || "Canal") + '" saiu do ar.',
            "ok"
          );
          return atualizarListaCanais();
        })
        .then(function () {
          recarregarPublica();
        })
        .catch(function (erro) {
          definirStatus(mensagem(erro) || SEM_CONEXAO, "erro");
        })
        .then(function () {
          bloquearCanal(false);
        });
    }

    function publicarCanalDaLista(canal) {
      bloquearCanal(true);
      permitido()
        .then(function (admin) {
          if (!admin) throw new Error(SEM_PERMISSAO);
          var cliente = obterCliente();
          if (!cliente) throw new Error(SEM_CONEXAO);
          return atualizarEm(cliente, "recommended_channels", canal.id, {
            publicado: true
          });
        })
        .then(function () {
          definirStatus(
            '"' + (canal.titulo || "Canal") + '" está publicado.',
            "ok"
          );
          return atualizarListaCanais();
        })
        .then(function () {
          recarregarPublica();
        })
        .catch(function (erro) {
          definirStatus(mensagem(erro) || SEM_CONEXAO, "erro");
        })
        .then(function () {
          bloquearCanal(false);
        });
    }

    /* Linha compartilhada das abas novas (mesmo visual de admin-ep). */
    function criarLinhaAdmin(item, opcoes) {
      var linha = elemento("article", "admin-ep");

      var info = elemento("div", "admin-ep__info");
      var titulo = elemento("h3", "admin-ep__titulo");
      titulo.textContent = (item && item.titulo) || opcoes.fallback;
      info.appendChild(titulo);

      var meta = elemento("p", "admin-ep__meta");
      meta.textContent = opcoes.meta(item || {});
      info.appendChild(meta);

      var publicado = item.publicado !== false;
      var selo = elemento(
        "span",
        "admin-ep__selo " +
          (publicado ? "admin-ep__selo--publicado" : "admin-ep__selo--rascunho")
      );
      selo.textContent = publicado ? "Publicado" : "Fora do ar";
      info.appendChild(selo);
      linha.appendChild(info);

      var acoes = elemento("div", "admin-ep__acoes");
      acoes.appendChild(
        botaoAcao("Editar", "", function () {
          opcoes.editar(item);
        })
      );

      if (publicado) {
        acoes.appendChild(
          botaoAcao("Tirar do ar", "admin-ep__botao--perigo", function () {
            opcoes.tirar(item);
          })
        );
      } else {
        acoes.appendChild(
          botaoAcao("Publicar", "admin-ep__botao--ouro", function () {
            opcoes.publicar(item);
          })
        );
      }

      linha.appendChild(acoes);
      return linha;
    }

    function configurarFormularioDevocional() {
      var form = porId("form-admin-devocional");
      if (form) form.addEventListener("submit", aoEnviarDevocional);

      var cancelar = porId("admin-dev-cancelar");
      if (cancelar) {
        cancelar.addEventListener("click", function () {
          limparFormularioDevocional();
          definirStatus("Edição cancelada.");
        });
      }

      var nomes = ["titulo", "versiculo", "texto", "data"];
      for (var i = 0; i < nomes.length; i++) {
        var alvo = campoDev(nomes[i]);
        if (!alvo) continue;
        (function (nome) {
          alvo.addEventListener("input", function () {
            var erro = erroDev(nome);
            if (erro) {
              erro.textContent = "";
              erro.hidden = true;
            }
          });
        })(nomes[i]);
      }
    }

    function configurarFormularioCanal() {
      var form = porId("form-admin-canal");
      if (form) form.addEventListener("submit", aoEnviarCanal);

      var cancelar = porId("admin-canal-cancelar");
      if (cancelar) {
        cancelar.addEventListener("click", function () {
          limparFormularioCanal();
          definirStatus("Edição cancelada.");
        });
      }

      var nomes = ["titulo", "link"];
      for (var i = 0; i < nomes.length; i++) {
        var alvo = campoCanal(nomes[i]);
        if (!alvo) continue;
        (function (nome) {
          alvo.addEventListener("input", function () {
            var erro = erroCanal(nome);
            if (erro) {
              erro.textContent = "";
              erro.hidden = true;
            }
          });
        })(nomes[i]);
      }
    }

    function configurarUI() {
      if (!doc) return;

      configurarAbas();
      configurarFormularioDevocional();
      configurarFormularioCanal();

      var form = porId("form-admin");
      var cancelar = porId("admin-cancelar");

      if (form) form.addEventListener("submit", aoEnviar);
      if (cancelar) {
        cancelar.addEventListener("click", function () {
          limparFormulario();
          definirStatus("Edição cancelada.");
        });
      }

      var nomes = ["titulo", "data", "youtube", "mp3", "capa"];
      for (var i = 0; i < nomes.length; i++) {
        var alvo = campo(nomes[i]);
        if (!alvo) continue;
        (function (nome) {
          alvo.addEventListener("input", function () {
            var erro = erroDe(nome);
            if (erro) {
              erro.textContent = "";
              erro.hidden = true;
            }
          });
        })(nomes[i]);
      }
    }

    var api = {
      publicar: publicar,
      editar: editar,
      tirarDoAr: tirarDoAr,
      excluirEpisodio: excluirEpisodio,
      listar: listar,
      publicarDevocional: publicarDevocional,
      editarDevocional: editarDevocional,
      tirarDevocionalDoAr: tirarDevocionalDoAr,
      listarDevocionais: listarDevocionais,
      publicarCanal: publicarCanal,
      editarCanal: editarCanal,
      tirarCanalDoAr: tirarCanalDoAr,
      listarCanais: listarCanais,
      abrir: abrir,
      mostrarAba: mostrarAba,
      // Expostos para o app.js e para depuração.
      abaAtual: function () {
        return abaAtual;
      },
      emEdicao: function () {
        return emEdicao;
      },
      limparFormulario: limparFormulario,
      limparFormularioDevocional: limparFormularioDevocional,
      limparFormularioCanal: limparFormularioCanal
    };

    if (doc) configurarUI();

    return api;
  }

  /* ---------- singleton do navegador ---------- */

  var instancia = null;

  function padrao() {
    if (instancia) return instancia;

    instancia = criarAdmin({
      sessao: raiz.sessao || null,
      cliente: function () {
        var sessao = raiz.sessao;
        return sessao && typeof sessao.cliente === "function"
          ? sessao.cliente()
          : null;
      },
      validacao: raiz.SCValidacao || null,
      config: raiz.SC_SUPABASE || {}
    });
    return instancia;
  }

  var apiPublica = {
    criarAdmin: criarAdmin,
    publicar: function (form, arquivos) {
      return padrao().publicar(form, arquivos);
    },
    editar: function (id, form, arquivos) {
      return padrao().editar(id, form, arquivos);
    },
    tirarDoAr: function (id) {
      return padrao().tirarDoAr(id);
    },
    excluirEpisodio: function (id) {
      return padrao().excluirEpisodio(id);
    },
    listar: function () {
      return padrao().listar();
    },
    publicarDevocional: function (form) {
      return padrao().publicarDevocional(form);
    },
    editarDevocional: function (id, form) {
      return padrao().editarDevocional(id, form);
    },
    tirarDevocionalDoAr: function (id) {
      return padrao().tirarDevocionalDoAr(id);
    },
    listarDevocionais: function () {
      return padrao().listarDevocionais();
    },
    publicarCanal: function (form) {
      return padrao().publicarCanal(form);
    },
    editarCanal: function (id, form) {
      return padrao().editarCanal(id, form);
    },
    tirarCanalDoAr: function (id) {
      return padrao().tirarCanalDoAr(id);
    },
    listarCanais: function () {
      return padrao().listarCanais();
    },
    abrir: function () {
      return padrao().abrir();
    }
  };

  if (typeof window !== "undefined") {
    window.SCAdmin = apiPublica;
    window.admin = apiPublica;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = apiPublica;
  }
})(typeof window !== "undefined" ? window : globalThis);
