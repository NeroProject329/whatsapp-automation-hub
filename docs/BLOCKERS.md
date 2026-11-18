
# Pendências para operação

1. **Railway:** o PostgreSQL chegou a responder, mas a verificação TLS rejeitou uma cadeia com certificado autoassinado. O Redis fornecido usa `redis:` e não completou o TLS. Para uso externo, obtenha a CA confiável do PostgreSQL e um endpoint Redis `rediss:` com certificado verificável, ou utilize os endpoints privados na rede da Railway. Não houve escrita, autenticação ou migração na Railway.
2. **WhatsApp:** QR, reconexão após reinício, envio individual, entrega e recebimento de texto foram confirmados no ambiente HTTPS local. A revogação real do vínculo, campanhas reais, leitura e o comportamento em produção ainda precisam de validação controlada.
3. **Segurança de produção:** aprovação do ambiente VPS, certificados/domínio, backup autorizado e restauração de recuperação. Docker não está disponível na estação Windows do desenvolvimento; manifesto preparado, execução Linux pendente.
4. **Privacidade:** definir e operar retenção de conteúdo, evidências, auditoria e backups. A supressão depende da chave usada no HMAC; não substitua `APP_ENCRYPTION_KEY` durante operação sem migração planejada.
5. **Canal não oficial:** a biblioteca pode mudar ou desconectar independentemente do Hub. Nenhum volume ou disponibilidade foi validado com o canal.
