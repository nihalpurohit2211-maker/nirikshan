FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LLM_PROVIDER=offline \
    PORT=8000

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# The demo city is deterministic; rebuild it at boot so a fresh container always
# serves the contracted numbers (the container filesystem is ephemeral).
CMD ["sh", "-c", "python seed.py && python -m uvicorn backend.app:app --host 0.0.0.0 --port ${PORT}"]
