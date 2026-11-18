# Decisões

- Baileys 7.0.0-rc14, fixado no lockfile; ESM, eventos normalizados e identificação PN/LID restrita a mapeamentos confiáveis. Fake é o padrão local.
- API e worker compartilham regras e Prisma. PostgreSQL possui o estado durável; BullMQ sinaliza trabalho recuperável. Reservas ambíguas não são reenviadas.
- PostgreSQL remoto deve usar schema exclusivo, com backup prévio. Segredos permanecem no arquivo privado original. Manifestos não expõem Redis nem PostgreSQL.
- Escopo inicial: texto e consentimento explícito de marketing. As prioridades RF-025 a RF-031 são tratadas separadamente do núcleo P0.
