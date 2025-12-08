$REMOTE_HOST = "ds.sionzee.cz"
$REMOTE_USER = "sionzee"
$REMOTE_FILE = "/home/sionzee/evobug_api_dump.sql"
$LOCAL_FILE = "evobug_api_dump.sql"
$DB = "evobug_api"
$PG_USER = "postgres"
$CONTAINER = "postgres"

# Run dump script on remote server
ssh "${REMOTE_USER}@${REMOTE_HOST}" "~/evobug_api_dump.sh"

# Download the dump
scp "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_FILE}" $LOCAL_FILE

# Drop and recreate database
docker exec $CONTAINER psql -U $PG_USER -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);"
docker exec $CONTAINER psql -U $PG_USER -c "CREATE DATABASE $DB;"

# Import into local docker postgres
docker cp $LOCAL_FILE "${CONTAINER}:/tmp/${LOCAL_FILE}"
docker exec $CONTAINER psql -U $PG_USER -d $DB -f "/tmp/${LOCAL_FILE}"

# Reset all sequences to match actual data
$SQL = @'
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT sequencename, schemaname FROM pg_sequences WHERE schemaname = 'public'
    ) LOOP
        EXECUTE format(
            'SELECT setval(''%I.%I'', COALESCE((SELECT MAX(id) FROM %I), 1))',
            r.schemaname, r.sequencename,
            replace(r.sequencename, '_id_seq', '')
        );
    END LOOP;
END $$;
'@

docker exec $CONTAINER psql -U $PG_USER -d $DB -c $SQL

# Cleanup
docker exec $CONTAINER rm "/tmp/${LOCAL_FILE}"
Remove-Item $LOCAL_FILE

Write-Host "Sync complete"