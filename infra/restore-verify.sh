
#!/usr/bin/env bash
set -euo pipefail
umask 077
dump="${1:?informe um backup .age}"
key="${2:?informe a identidade age}"
: "${PGHOST:?}" "${PGDATABASE:?}" "${PGUSER:?}" "${PGPASSWORD:?}"
[[ "$PGDATABASE" == hub_restore_* ]] || { echo "Necessário um banco isolado hub_restore_*" >&2; exit 1; }
export PGSSLMODE=verify-full
export PGSSLROOTCERT="${PGSSLROOTCERT:-system}"
[[ $(psql -X -Atqc "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('information_schema','pg_catalog')") == 0 ]]
temp=$(mktemp)
trap 'rm -f -- "$temp"' EXIT
age --decrypt -i "$key" "$dump" > "$temp"
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="$PGDATABASE" "$temp"
psql -X -v ON_ERROR_STOP=1 -c "SELECT schemaname, count(*) FROM pg_tables WHERE schemaname LIKE 'hub_%' GROUP BY 1"
