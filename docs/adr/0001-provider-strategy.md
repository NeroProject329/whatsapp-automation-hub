# ADR 0001 — Provedor de mensageria

**Decisão:** Baileys 7.0.0-rc14 no worker, fixado no lockfile. A camada de negócios conhece apenas `MessagingProvider` e eventos normalizados. O FakeProvider é o padrão local e nunca se conecta ao canal.

**Consequências:** emparelhamento real exige homologação HTTPS e leitura de QR por um operador. Credenciais e chaves Signal são persistidas com AES-GCM e contexto por conexão/categoria/chave. O banco só permite um registro ativo da mesma identidade telefônica; vínculo duplicado é fechado quando a identidade do socket é reconhecida. Eventos de grupo e histórico retroativo não acionam descadastro. A biblioteca não é um canal oficial e a versão será reavaliada antes de cada release.
