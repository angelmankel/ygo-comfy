#!/usr/bin/env bash
# Container entrypoint: persist models on /workspace, download what is missing, run ComfyUI behind nginx basic auth.
set -euo pipefail
MODELS_DIR=${MODELS_DIR:-/workspace/ComfyUI/models}
COMFY_PORT=${COMFY_PORT:-8189}
PROXY_PORT=${PROXY_PORT:-8188}
COMFY_AUTH_USER=${COMFY_AUTH_USER:-ygo}
COMFY_ARGS=${COMFY_ARGS:-}

if [ -z "${COMFY_AUTH_TOKEN:-}" ]; then
  COMFY_AUTH_TOKEN=$(openssl rand -hex 16)
  echo "[start] COMFY_AUTH_TOKEN not set; generated one: $COMFY_AUTH_TOKEN"
fi

# ---- models live on the (persistent) workspace volume ------------------------------
mkdir -p "$MODELS_DIR"
if [ ! -L /opt/ComfyUI/models ]; then
  # seed the standard folder layout (and configs like extra_model_paths) then swap in a symlink
  cp -rn /opt/ComfyUI/models/. "$MODELS_DIR"/ 2>/dev/null || true
  rm -rf /opt/ComfyUI/models
  ln -s "$MODELS_DIR" /opt/ComfyUI/models
fi
mkdir -p "$MODELS_DIR/controlnet_aux_ckpts"
aux=/opt/ComfyUI/custom_nodes/comfyui_controlnet_aux
if [ -d "$aux" ] && [ ! -L "$aux/ckpts" ]; then
  rm -rf "$aux/ckpts"; ln -s "$MODELS_DIR/controlnet_aux_ckpts" "$aux/ckpts"
fi
mkdir -p /workspace/ComfyUI/output /workspace/ComfyUI/input
for d in output input; do
  if [ ! -L /opt/ComfyUI/$d ]; then
    cp -rn /opt/ComfyUI/$d/. /workspace/ComfyUI/$d/ 2>/dev/null || true
    rm -rf /opt/ComfyUI/$d; ln -s /workspace/ComfyUI/$d /opt/ComfyUI/$d
  fi
done

# ---- reverse proxy with basic auth --------------------------------------------------
mkdir -p /tmp/nginx-body /tmp/nginx-proxy /tmp/nginx-fastcgi /tmp/nginx-uwsgi /tmp/nginx-scgi
printf '%s:%s\n' "$COMFY_AUTH_USER" "$(openssl passwd -apr1 "$COMFY_AUTH_TOKEN")" > /tmp/htpasswd
sed -e "s/\${PROXY_PORT}/$PROXY_PORT/g" -e "s/\${COMFY_PORT}/$COMFY_PORT/g" /opt/ygo/nginx.conf.template > /tmp/nginx.conf
nginx -c /tmp/nginx.conf &
echo "[start] nginx listening on 0.0.0.0:$PROXY_PORT (basic auth user '$COMFY_AUTH_USER') -> 127.0.0.1:$COMFY_PORT"

# ---- models -----------------------------------------------------------------------------
if [ "${SKIP_MODEL_DOWNLOAD:-0}" != 1 ]; then
  /opt/ygo/download-models.sh || echo "[start] WARNING: model download incomplete; ComfyUI will start anyway (rerun /opt/ygo/download-models.sh)"
fi

# ---- ComfyUI ----------------------------------------------------------------------------------
cd /opt/ComfyUI
echo "[start] ComfyUI $(cat .pinned-commit 2>/dev/null) on 127.0.0.1:$COMFY_PORT"
exec python main.py --listen 127.0.0.1 --port "$COMFY_PORT" --preview-method auto $COMFY_ARGS
