# Intelligence Service Dockerfile - Multi-stage build
FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies
FROM base AS system-deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    gdal-bin \
    libgdal-dev \
    proj-bin \
    libproj-dev \
    libgeos-dev \
    libspatialindex-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
FROM system-deps AS deps
WORKDIR /app

COPY pyproject.toml ./
RUN pip install --no-cache-dir -e .

# Development stage
FROM deps AS development
WORKDIR /app
COPY . .
EXPOSE 8001
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]

# Production stage
FROM deps AS production
WORKDIR /app
COPY --chown=1000:1000 src ./src
COPY --chown=1000:1000 tests ./tests

RUN addgroup --system --gid 1000 appgroup && \
    adduser --system --uid 1000 --ingroup appgroup appuser

USER appuser

EXPOSE 8001

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "4"]