
# Matriz de rastreabilidade

Status “local” indica código executado com FakeProvider/infraestrutura isolada ou cobertura por inspeção; não certifica o canal Baileys. As prioridades são as do Markdown de referência.

| RF | Prioridade | Resultado |
| --- | --- | --- |
| 001 | P0 | Login, sessão opaca revogável, CSRF por origem e rotas administrativas protegidas. |
| 002 | P0 | Cadastro de remetente e escolha explícita na campanha. |
| 003 | P0 | Polling, estado, atividade, QR temporário e diagnóstico por conexão. |
| 004 | P0 | AuthState cifrado no Prisma, credenciais e chaves Signal; restauração do pareamento real a validar. |
| 005 | P0 | CSV/XLSX, posição das colunas, relatório por linha, prévia e confirmação. |
| 006 | P0 | Validação canônica E.164 com libphonenumber. |
| 007 | P0 | Índice único e deduplicação na prévia e no commit. |
| 008 | P0 | Fonte, evidência, finalidade MARKETING, data, revogação e trilha. |
| 009 | P0 | Editor, variáveis nativas/customizadas, amostra e bloqueio de lacunas. |
| 010 | P0 | Fila individual de teste somente para allowlist. |
| 011 | P0 | Rascunho, edição, remetente, público e texto/modelo. |
| 012 | P0 | Confirmação da amostra e contagem, agendamento e janela com fuso. |
| 013 | P0 | Pausa, retomada, cancelamento durável e rechecagem do worker. |
| 014 | P0 | Dispatch no PostgreSQL como outbox; BullMQ e republicação. |
| 015 | P0 | Uma tarefa por campanha/contato e chaves de deduplicação. |
| 016 | P0 | Aceite e recibos separados; sem entrega presumida. Mapeamento real a validar no piloto. |
| 017 | P0 | Eventos de socket normalizados e deduplicados; recepção real a validar. |
| 018 | P0 | SAIR, PARAR, CANCELAR e DESCADASTRAR em texto direto. |
| 019 | P0 | Supressão por número, revogação e bloqueio de pendências; retenção conservadora de LID sem número. |
| 020 | P0 | Confirmação única persistente; teste de concorrência/replay. |
| 021 | P0 | Trilha administrativa, eventos, resultados individuais e relatórios. |
| 022 | P0 | Recuperação de fila, reserva interrompida em UNKNOWN, pausa após cinco falhas/incertezas. |
| 023 | P0 | Gate de envios reais, aceite explícito, audiência com consentimento e janela. Teste de conformidade do piloto ainda necessário. |
| 024 | P0 | Anonimização de cadastro, consentimentos, histórico ligado e supressão conservada. Política formal de retenção, anexos de evidência e backups por aprovar. |
| 025 | P1 | Histórico recebido disponível. Resposta manual e agrupamento por conversa pendentes. |
| 026 | P1 | Etiquetas, atributos e filtros. Listas salvas e segmentações compostas pendentes. |
| 027 | P1 | Modelos versionados e seleção da versão em campanha. |
| 028 | P1 | Conexões múltiplas no modelo e seleção explícita. Operação simultânea real a validar. |
| 029 | P1 | Anexos fora do MVP de texto. |
| 030 | P2 | Fluxos condicionais fora do MVP. |
| 031 | P2 | Um administrador inicial. Equipe, MFA e RBAC granular pendentes. |
