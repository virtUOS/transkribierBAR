# Stage 1: Build frontend
FROM node:26-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=$VITE_BASE_PATH
RUN npm run build

# Stage 2: Python backend + static files
FROM python:3.15-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r requirements.txt
COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ./static
RUN mkdir -p /app/tmp/transcription-files && chown -R nobody:nogroup /app/tmp
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
USER nobody
EXPOSE 8000
HEALTHCHECK CMD curl --fail http://localhost:8000/api/health || exit 1
ENTRYPOINT ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
