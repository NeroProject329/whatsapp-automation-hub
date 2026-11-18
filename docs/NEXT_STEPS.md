
# Retomada

1. Para reproduzir localmente, siga o README e execute a suíte de integração. O Windows tem o ambiente sintético em `.runtime/`.
2. Para Railway, obter endpoints acessíveis com TLS estrito ou rede privada, inspecionar metadados, identificar schema exclusivo, fazer backup e provar restore antes de rodar a migração versionada. Preserve o arquivo de credenciais existente.
3. Implantar homologação privada, sem habilitar envios inicialmente. Parear um aparelho de teste, confirmar reinício e revogação. Somente após autorização, habilitar envio para operação controlada.
4. Rodar piloto pequeno e registrar a semântica de recibos e LID, falhas, reconexão e entrega efetiva. Validar backup e restauração em destino isolado.
5. Tratar melhorias P1/P2 conforme a matriz. Resolver operações incertas por evidência do canal, sem reenfileirar automaticamente.
