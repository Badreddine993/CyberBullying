# Cyberbullying detection API (FastAPI) - the model is trained in the notebook
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_HOME=/app \
    MONGO_URI=mongodb://mongo:27017

WORKDIR /app

# Exact library versions written by the notebook -> the pickled model loads safely
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

COPY api/ api/
COPY models/ models/
COPY data/clean_cyberbullying.csv data/clean_cyberbullying.csv

RUN useradd --create-home appuser && chown -R appuser /app
USER appuser

# Cloud platforms (Render, Cloud Run, Railway...) pass the port in $PORT; locally it defaults to 8000.
ENV PORT=8000
EXPOSE 8000
WORKDIR /app/api
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://localhost:{os.environ[\"PORT\"]}/health')" || exit 1
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
