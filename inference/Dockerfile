# SPEC §6: AI service (FastAPI + OpenVINO). Build context = repository root:
#   docker build -f inference/Dockerfile -t pavement-pinn-inference .
# Large models (CLIP, SLM) are not in git; they live in the mounted /app/models volume and are
# fetched once with inference/scripts/fetch_clip.py, build_clip_scenes.py and fetch_slm.py.
FROM python:3.11.9-slim-bookworm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY inference/requirements.lock /tmp/requirements.lock
# PyTorch is not needed to serve (only for PINN-1 research training/eval), so it is left out.
RUN pip install --no-cache-dir -r /tmp/requirements.lock
COPY inference ./inference
COPY eval ./eval
COPY bench ./bench
WORKDIR /app/inference
ENV MODELS_DIR=/app/models SLM_DIR=/app/models/slm/qwen2.5-1.5b-instruct-int4-ov
EXPOSE 8100
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
