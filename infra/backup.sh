
#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${HUB_BACKUP_RECIPIENT:?informe a chave pública age}"
: "${PGHOST:?}" "${PGDATABASE:?}" "${PGUSER:?}" "${PGPASSWORD:?}"
export PGSSLMODE=verify-full
export PGSSLROOTCERT="${PGSSLROOTCERT:-system}"
dest="${1:?informe o arquivo de saída .age}"
test ! -e "$dest"
partial=$(mktemp "${dest}.XXXXXXXX")
trap 'rm -f -- "$partial"' EXIT
pg_dump --format=custom --no-owner --no-acl | age -r "$HUB_BACKUP_RECIPIENT" > "$partial"
ln -- "$partial" "$dest"
