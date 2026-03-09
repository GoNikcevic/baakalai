FROM n8nio/n8n:latest

# Switch to root for setup
USER root

# Create directories for persistent data and workflow imports
RUN mkdir -p /home/node/.n8n/workflows /home/node/.n8n/credentials \
    && chown -R node:node /home/node/.n8n

# Copy workflow definitions for import
COPY workflows/ /home/node/workflows/

# Set ownership
RUN chown -R node:node /home/node/workflows

# Switch back to non-root user
USER node

# N8N configuration via environment variables
ENV N8N_HOST=0.0.0.0
ENV N8N_PORT=5678
ENV N8N_PROTOCOL=https
ENV N8N_SECURE_COOKIE=true
ENV GENERIC_TIMEZONE=Europe/Paris
ENV N8N_DIAGNOSTICS_ENABLED=false
ENV N8N_HIRING_BANNER_ENABLED=false
ENV N8N_PERSONALIZATION_ENABLED=false
ENV N8N_VERSION_NOTIFICATIONS_ENABLED=false
ENV N8N_TEMPLATES_ENABLED=true
ENV EXECUTIONS_DATA_PRUNE=true
ENV EXECUTIONS_DATA_MAX_AGE=168

# Use SQLite by default (Railway volume for persistence)
# Override with DB_TYPE=postgresdb + DB_POSTGRESDB_* env vars for Postgres
ENV DB_TYPE=sqlite
ENV DB_SQLITE_DATABASE=/home/node/.n8n/database.sqlite

EXPOSE 5678

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:5678/healthz || exit 1

# Default entrypoint from base image starts n8n
