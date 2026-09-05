# -------- Stage 1: Build --------
FROM python:3.11-slim AS builder

WORKDIR /app

# sentence-transformers/torch need a C toolchain to build a couple of
# transitive deps on some platforms - confined to this stage so the
# runtime image doesn't ship a compiler.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirnments.txt .
# torch's default PyPI wheel for linux/arm64 pulls in the full CUDA
# toolkit (cublas, cudnn, cusolver, nccl, triton, ...) - several GB of
# packages meant for GPU inference. This service runs CPU-only on an
# Oracle Ampere VM with no GPU, and that download+layer-export was
# blowing past the GitHub Actions runner's disk. Installing the CPU-only
# build from PyTorch's own index first means later requirements
# (sentence-transformers depends on "torch") are already satisfied and
# never pull the GPU variant.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirnments.txt

# -------- Stage 2: Runtime --------
FROM python:3.11-slim

# Non-root - a compromised dependency (this service pulls in a large,
# fast-moving LLM/ML stack) shouldn't get root inside its own container
# just because nothing here said otherwise. --create-home matters: the
# HuggingFace embeddings model downloads/caches under $HOME/.cache by
# default (see services/rag_service.py), which needs to exist and be
# writable by this user.
RUN groupadd --system app \
    && useradd --system --gid app --home-dir /home/app --create-home app

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

COPY --chown=app:app . .

USER app

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
