
# WhatsApp Automation Hub

Painel privado para gerenciar conexões, contatos com consentimento, campanhas de texto, envios e descadastros. Web Next.js, API REST NestJS, worker BullMQ, Prisma/PostgreSQL e Redis. O adaptador Baileys está isolado no worker; o ambiente local usa um simulador.

## Ambiente local no Windows

A instalação desta estação já tem PostgreSQL e Redis no loopback em portas próprias. Para abrir ou reiniciar o painel a partir da raiz:

```powershell
node infra/local-windows.mjs
node infra/launch-local.mjs
```

Abra **http://localhost:3000**. O e-mail e a senha inicial da instância local estão em `.runtime/local.env` nas variáveis `ADMIN_EMAIL` e `ADMIN_PASSWORD`. O arquivo está ignorado pelo Git. Os bancos, o Redis e os logs da instalação ficam em `.runtime/`. Não confunda essas variáveis locais com o arquivo privado da Railway, que fica fora deste repositório.

Após alterar código, execute `pnpm db:generate` quando o modelo mudar e `pnpm build`; reinicie os processos do painel. Para a instalação Windows avulsa, o script espera `embedded-postgres@18.6.0-beta.19` em `.runtime/node_modules` e o Redis Windows extraído em `.runtime/redis`. A referência para outras estações é o Compose abaixo.

Nesta estação, o painel real em `https://localhost:3443` usa a API e o worker locais com PostgreSQL e Redis do projeto `zap-api` via túneis SSH. Após reiniciar o computador, abra o PowerShell na raiz do repositório e execute:

```powershell
pwsh -NoProfile -File infra/start-railway-tunnels.ps1
node infra/launch-whatsapp-test.mjs
```

O modo local permite apenas envios de teste aos números de `TEST_NUMBERS`. Em **Recebidas**, o painel identifica o tipo do anexo e mostra a legenda quando existir. Preserve a configuração privada em `.runtime/`, que inclui os arquivos de ambiente, TLS e SSH. A versão simulada continua em `http://localhost:3000` com seus bancos locais.

## Ambiente local com Docker Compose

1. Copie `.env.example` para `.env.local`. Troque os exemplos por uma chave de 32 bytes em hex, um segredo de sessão e senha exclusivos. Ajuste `DATABASE_URL` para `postgresql://hub:local_only@postgres:5432/hub?schema=hub_local&sslmode=disable` e `REDIS_URL` para `redis://redis:6379`. Mantenha `HUB_MODE=local` e `PROVIDER=fake`.
2. Exporte `HUB_ENV_FILE` com o caminho absoluto de `.env.local`.
3. Execute:

```bash
docker compose -f compose.yaml -f compose.local.yaml up -d postgres redis
docker compose -f compose.yaml -f compose.local.yaml run --rm --build --no-deps api node infra/migrate.mjs
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

Acesse `http://localhost:3000`. O primeiro login é criado a partir de `ADMIN_EMAIL` e `ADMIN_PASSWORD` se o banco estiver vazio. Uma mudança no arquivo de ambiente não altera uma senha já criada. Não publique o perfil local.

## Validação e API

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pnpm typecheck
pnpm lint
pnpm test
# Aponte HUB_ENV_FILE para o arquivo da infraestrutura local; nunca use Railway no E2E.
pnpm test:e2e
```

O E2E cria um schema isolado `hub_e2e_*` e usa um prefixo Redis próprio por execução. Exige PostgreSQL/Redis no loopback e Chrome/Chromium via Playwright (usa Edge instalado no Windows, quando disponível). Os schemas de teste são mantidos para diagnóstico; não são usados pelo aplicativo. O OpenAPI é servido autenticado em `/api/openapi.json`; endpoints públicos são `/api/health/live` e `/api/health/ready` (estado das dependências).

- [Status e evidências](docs/PROJECT_STATUS.md)
- [Matriz RF-001 a RF-031](docs/ROADMAP.md)
- [Implantação, backup e operação](docs/runbooks/production.md)
- [Pendências conhecidas](docs/BLOCKERS.md)
