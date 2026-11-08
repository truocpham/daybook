#!/bin/sh
set -e
# With LITESTREAM_REPLICA_URL set (for example s3://bucket/daybook), the database is restored
# on first start and then streamed continuously to object storage.
if [ -n "$LITESTREAM_REPLICA_URL" ]; then
  if [ ! -f "$DAYBOOK_DATA/daybook.db" ]; then
    litestream restore -if-replica-exists -o "$DAYBOOK_DATA/daybook.db" "$LITESTREAM_REPLICA_URL"
  fi
  exec litestream replicate -exec "daybook serve" "$DAYBOOK_DATA/daybook.db" "$LITESTREAM_REPLICA_URL"
fi
exec daybook serve
