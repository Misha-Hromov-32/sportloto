# VK-бот (bots/). Контекст сборки — корень репозитория (см. docker-compose.yml, сервис vk-bot).
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app/bots
COPY bots/pyproject.toml bots/uv.lock bots/.python-version ./
# Сначала только зависимости: слой кэшируется, пока не меняется uv.lock. Extra server — шифрование ключей.
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --extra server --no-install-project
COPY bots/ ./

FROM python:3.12-slim
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app app \
    && mkdir -p /data && chown app:app /data && chmod 700 /data
WORKDIR /app
COPY --from=build --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    BOT_DB_PATH=/data/vk-bot.sqlite
USER app
VOLUME /data
CMD ["python", "-m", "bots.vk"]
