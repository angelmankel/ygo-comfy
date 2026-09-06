# ComfyUI image for the Yu-Gi-Oh card-art pipeline (RTX 5090 / Blackwell ready).
# CUDA 12.8 + torch 2.8.0 cu128 wheels; ComfyUI and every custom node pinned to a commit.
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common curl ca-certificates gnupg \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-venv python3.11-dev \
        git aria2 nginx-light openssl build-essential \
        libgl1 libglib2.0-0 libgomp1 libsm6 libxext6 \
    && rm -rf /var/lib/apt/lists/* \
    && python3.11 -m venv /opt/venv \
    && pip install --upgrade pip wheel setuptools

# Torch first, from the cu128 index, so nothing below can drag in a CPU/other-CUDA build.
RUN pip install torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0 \
        --index-url https://download.pytorch.org/whl/cu128

# ---- ComfyUI (pinned) -------------------------------------------------------
ARG COMFYUI_REF=v0.34.5
RUN git clone --depth 1 --branch ${COMFYUI_REF} https://github.com/Comfy-Org/ComfyUI /opt/ComfyUI \
    && cd /opt/ComfyUI \
    && pip install -r requirements.txt \
    && git rev-parse HEAD > /opt/ComfyUI/.pinned-commit

# ---- Custom node packs (pinned commits) --------------------------------------
COPY install-node.sh /usr/local/bin/install-node
RUN chmod +x /usr/local/bin/install-node \
    && install-node https://github.com/evanspearman/ComfyMath           c01177221c31b8e5fbc062778fc8254aeb541638 ComfyMath \
    && install-node https://github.com/1038lab/ComfyUI-RMBG              58f1947a11567a9f8b707223185570850e773856 ComfyUI-RMBG \
    && install-node https://github.com/chflame163/ComfyUI_LayerStyle     5ba939099b33f998ecfbd63dcbbf089925b64a47 ComfyUI_LayerStyle \
    && install-node https://github.com/Fannovel16/comfyui_controlnet_aux 59b1fc411ede8623b2997855b8018f0b3b6cf49f comfyui_controlnet_aux

# Re-assert the CUDA torch build in case a node requirement replaced it.
RUN pip install torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0 \
        --index-url https://download.pytorch.org/whl/cu128 \
    && python -c "import torch, sys; print('torch', torch.__version__, 'cuda', torch.version.cuda); sys.exit(0 if torch.version.cuda and torch.version.cuda.startswith('12.8') else 1)"

# ---- Runtime files --------------------------------------------------------------
COPY models.txt download-models.sh start.sh nginx.conf.template /opt/ygo/
RUN chmod +x /opt/ygo/download-models.sh /opt/ygo/start.sh

ENV MODELS_DIR=/workspace/ComfyUI/models \
    COMFY_PORT=8189 \
    PROXY_PORT=8188 \
    COMFY_AUTH_USER=ygo

EXPOSE 8188
WORKDIR /opt/ComfyUI
CMD ["/opt/ygo/start.sh"]
