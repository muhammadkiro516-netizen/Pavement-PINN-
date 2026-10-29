# Hugging Face Space (Docker SDK): web app + API + AI service in one container, port 7860.
# Built by Hugging Face from the files uploaded by scripts/deploy_hf.py.
FROM python:3.11.9-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends curl xz-utils ca-certificates libgl1 libglib2.0-0 \
 && curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1 \
 && rm -rf /var/lib/apt/lists/*

# Hugging Face runs the container as uid 1000.
RUN useradd -m -u 1000 user
WORKDIR /home/user/app
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH

COPY --chown=user inference/requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir -r /tmp/requirements.lock

COPY --chown=user package.json package-lock.json ./
RUN npm ci

COPY --chown=user . .
ENV VITE_BASE_PATH=/
RUN npx vite build \
 && npx esbuild server/index.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs \
 && npm prune --omit=dev

# Local SLM (OpenVINO INT4, pinned revision) fetched inside Hugging Face's network.
RUN python inference/scripts/fetch_slm.py && chown -R user /home/user/app

USER user
ENV NODE_ENV=production PORT=7860 DATA_DIR=/home/user/app/.data INFERENCE_URL=http://127.0.0.1:8100 DEMO_AUTH=false
EXPOSE 7860
CMD ["bash", "hf/start.sh"]
