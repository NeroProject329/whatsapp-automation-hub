
# Status · 18/11/2026

Blocos A–D implementados para o MVP local. O painel, a API e o worker foram validados com PostgreSQL e Redis isolados. A prontidão para produção permanece condicionada às dependências externas e ao piloto.

| Bloco | Fases | Entrega | Validação e correções | Status |
| --- | --- | --- | --- | --- |
| A | 0–3 | Monorepo, migração, login, contatos, consentimento, filtros, supressão e importação | Migração no schema local e schemas E2E; login, falha sem sessão, CSRF, CSV e XLSX (dedupe, colunas remapeadas e fórmula rejeitada) | Aprovado localmente |
| B | 4–6 | Interface de provedor, Fake e Baileys 7.0.0-rc14, chaves e QR privados, editor, modelos e campanhas | Contrato Fake, preview e aprovação, allowlist, disparo simulado e edição invalida aprovação. Baileys compila e carrega, sem sessão real | Aprovado com ressalva de canal |
| C | 7–9 | PostgreSQL/BullMQ, estados, opt-out, dashboard e histórico | Worker reiniciado sem perder envio; reserva interrompida vira UNKNOWN; ordem de recibos, pausa/cancelamento, replay, supressão e LID resolvido; revisão desktop e mobile | Aprovado localmente |
| D | 10–11 | Hardening de sessão e isolamento, manifests de VPS, scripts de backup/restore, documentação | Lint, TypeScript, build de produção, 6 testes unitários, E2E em Edge com serviços reais locais. Auditoria de dependências de produção sem vulnerabilidades conhecidas na consulta. Bash validado por sintaxe; Compose Linux e teste de restauração ficam para homologação | Aprovado localmente, produção pendente |

## Decisões vigentes

- O PostgreSQL é a fonte durável. Cada linha de Dispatch é criada com sua campanha ou evento de origem na mesma transação; a publicação BullMQ pode ser refeita.
- O worker reserva de forma durável e inicia a chamada do provedor sob uma última verificação serializada. Não espera a resposta do canal com o lock. Operações já em trânsito não podem ser desfeitas.
- Estado incerto nunca volta a pendente por timeout de envio. Recibos guardam fatos independentes do status de campanha.
- Descadastro desconhecido bloqueia novas campanhas até que o canal vincule o endereço ao número. Um operador pode retomar depois que a supressão for resolvida; não há retomada automática.
- Conexões reais, envios reais, push remoto e publicação não foram executados.

Próxima ação: validar as conexões Railway com transporte confiável, ensaiar backup/restore e vincular um aparelho autorizado em homologação. Consulte [pendências](BLOCKERS.md) e a [matriz dos requisitos](ROADMAP.md).
