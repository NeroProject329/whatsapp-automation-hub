# ADR 0002 — Publicação e idempotência

**Decisão:** a linha Dispatch em PostgreSQL registra simultaneamente o destinatário e a intenção de publicar. Consulte-a novamente no worker; Redis transporta apenas o ID. A publicação BullMQ usa ID estável, e o banco impede uma segunda reserva do mesmo envio. Um lease PostgreSQL limita a um worker por schema.

**Limite de atomicidade:** confirme reserva no banco, serialize o início da chamada com as mutações de campanha/supressão e expire a espera fora da transação. Se a chamada ou gravação do resultado ficar incerta, registre UNKNOWN e aguarde evidência do canal. A ausência de recibo não é permissão para reenviar. A reexecução é segura apenas antes da fronteira de envio. O opt-out revoga o consentimento e atualiza a supressão e as pendências numa única transação curta.
