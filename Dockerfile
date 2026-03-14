FROM postgres:18-alpine

ARG PGVECTOR_VERSION=v0.8.1
ARG PGTEXTSEARCH_VERSION=main   # oppure un tag, es: v0.4.0 se esiste nel repo
ARG DB_DUMP=dump_20260314_172549.dump

RUN apk add --no-cache --virtual .build-deps \
      build-base git \
      clang19 llvm19 \
  # workaround to use clang19 as default clang
  && ln -sf /usr/bin/clang /usr/local/bin/clang-19 \
  && ln -sf /usr/bin/clang++ /usr/local/bin/clang++-19 \
  \
  # pgvector
  && git clone --branch ${PGVECTOR_VERSION} --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
  && make -C /tmp/pgvector \
  && make -C /tmp/pgvector install \
  && rm -rf /tmp/pgvector \
  \
  # pg_textsearch
  && git clone --branch ${PGTEXTSEARCH_VERSION} --depth 1 https://github.com/timescale/pg_textsearch.git /tmp/pg_textsearch \
  && make -C /tmp/pg_textsearch \
  && make -C /tmp/pg_textsearch install \
  && rm -rf /tmp/pg_textsearch \
  \
  # ensure pg_textsearch is preloaded on first init
  && printf "\nshared_preload_libraries = 'pg_textsearch'\n" >> /usr/local/share/postgresql/postgresql.conf.sample \
  \
  && apk del .build-deps

# Initialize extensions on database creation
RUN printf "CREATE EXTENSION IF NOT EXISTS vector;\nCREATE EXTENSION IF NOT EXISTS pg_textsearch;\n" \
  > /docker-entrypoint-initdb.d/001_extensions.sql

# Seed database from dump on first init
COPY ${DB_DUMP} /docker-entrypoint-initdb.d/002_seed.dump
RUN printf '#!/bin/sh\nset -e\npg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" /docker-entrypoint-initdb.d/002_seed.dump\n' \
  > /docker-entrypoint-initdb.d/002_restore.sh \
  && chmod +x /docker-entrypoint-initdb.d/002_restore.sh
