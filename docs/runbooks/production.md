
# Implantação privada e recuperação

## Preparação

Use Node 24 para ferramentas e um VPS Linux com Docker/Compose. Use um ambiente de homologação independente; não coloque credenciais no Git, no frontend ou nos argumentos do shell. Exporte `HUB_ENV_FILE` apontando para o arquivo privado do ambiente e `HUB_CERT_DIR` para a pasta permissionada que contém `fullchain.pem` e `privkey.pem`. Renove os certificados pela rotina do host e recarregue o Nginx após a renovação.

Configure `HUB_MODE=production`, `PUBLIC_ORIGIN=https://dominio-confirmado`, `PROVIDER=baileys`, `REAL_SEND_ENABLED=false`, `BULL_PREFIX` exclusivo, um administrador e allowlist de números próprios para teste. O Redis deve oferecer persistência e `noeviction`. Um worker por schema é imposto por lock de sessão PostgreSQL; use endpoint direto, não um pooler em modo transação. Evite misturar FakeProvider com Baileys no mesmo schema.

### PostgreSQL e Redis Railway

Execute `node infra/check.mjs` com o arquivo privado referenciado em `HUB_ENV_FILE`; o probe não autentica em transporte sem TLS verificado. Quando validar PostgreSQL, o probe consulta somente contagens de tabelas por schema. Acrescente um schema exclusivo com prefixo `hub_` na configuração de aplicação. Fora de rede privada, exija `sslmode=require&sslaccept=strict`; se o serviço fornecer uma CA própria, configure também a raiz certificadora. Para Redis externo, obtenha uma URL `rediss:` com verificação de certificado funcional. Não reutilize URLs privadas em um VPS fora da rede da Railway.

Confirme permissões limitadas do usuário de aplicação e faça backup e restauração de ensaio. Só então execute:

```bash
docker compose -f compose.yaml -f compose.vps.yaml run --rm --build --no-deps -e HUB_BACKUP_CONFIRMED=true api node infra/migrate.mjs
docker compose -f compose.yaml -f compose.vps.yaml up -d --build
```

Valide HTTPS, login, readiness, health do worker na visão geral e o modo de envios na tela Configurações. Remova `ADMIN_PASSWORD` do ambiente depois da criação da conta. Nenhuma porta da API, Redis ou PostgreSQL é publicada por esses manifests.

## Backup e restore

Scripts `infra/backup.sh` e `infra/restore-verify.sh` usam `pg_dump`, `pg_restore`, `psql` e `age`. Use ferramentas PostgreSQL da mesma versão principal do servidor ou versão compatível mais recente. Defina `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` e, quando necessário, `PGSSLROOTCERT` sem imprimir credenciais. Os scripts exigem TLS em modo `verify-full`.

Armazene a chave de recuperação age e a chave de criptografia da aplicação separadas dos backups. A restauração exige um banco vazio com nome `hub_restore_*`; verifique tabelas, contagens, status de campanha e capacidade de decifrar uma credencial de teste. Desabilite envios reais no destino de restauração. Use disco temporário criptografado para o dump decifrado. Não aprove produção até ensaiar o restore com os binários do ambiente.

## Incidentes comuns

| Sintoma | Ação |
| --- | --- |
| HTTP 503 | Confirme conectividade/TLS PostgreSQL e Redis. A API omite URLs dos erros. |
| QR não aparece | Verifique heartbeat do worker e diagnóstico da conexão; confirme rede e abra novamente a conexão. |
| Sessão expirada ou duplicada | Revise aparelhos conectados no celular e revogue o vínculo incorreto. Pausas não retomam por conta própria após revogação. |
| Opt-out sem telefone | Campanhas ficam em pausa até o canal fornecer uma identidade telefônica vinculada ao mesmo endereço. Preserve o evento e revise o caso antes de retomar. |
| Job incerto | Verifique recibos/histórico e a caixa do aparelho. Uma reserva interrompida vira UNKNOWN. Não repita automaticamente. |
| Fila aparente indisponível | Verifique heartbeat e logs. O PostgreSQL retém as linhas pendentes mesmo se o Redis perder uma publicação. |
| Segredo comprometido | Pare os serviços, limite acesso e revogue sessões no canal. Rotacionar chaves de sessão invalida cookies; criptografia e HMAC exigem migração planejada. |
