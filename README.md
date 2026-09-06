# ygo-comfy

Self-hosted ComfyUI for the Yu-Gi-Oh card-art pipeline (`ygo-art-pipeline` / `ygo-art-studio`).
One Docker image with ComfyUI, the four custom node packs the two workflows use, and a model
manifest that is fetched onto a persistent volume on first boot. Built by GitHub Actions and
published as `ghcr.io/angelmankel/ygo-comfy:latest`; meant to run on a RunPod RTX 5090 pod.

## What is inside

| Component | Pin |
|---|---|
| Base | `nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04`, Python 3.11, torch 2.8.0 + cu128 (Blackwell needs CUDA 12.8 / torch >= 2.7) |
| ComfyUI | `v0.34.5` (`7fd919f0caff66a52289ea5b19cb6eaca0da04ef`) - same major as Comfy Cloud (v0.34.4) |
| ComfyMath (`CM_FloatBinaryOperation`) | evanspearman/ComfyMath `c011772` |
| ComfyUI-RMBG (`BiRefNetRMBG`) | 1038lab/ComfyUI-RMBG `58f1947` |
| ComfyUI_LayerStyle (`LayerUtility: ColorImage`) | chflame163/ComfyUI_LayerStyle `5ba9390` |
| comfyui_controlnet_aux (`AnimeLineArtPreprocessor`) | Fannovel16/comfyui_controlnet_aux `59b1fc4` |

`ComfySwitchNode` and every other class the workflows use are ComfyUI core (`comfy_extras.nodes_logic` etc.).

Models (see `models.txt` for URLs, target folders and sizes):

- checkpoints: `illustriousXLPersonalMerge_v30Noob10based.safetensors`, `anima_turboV11.safetensors`
- loras: `Yu-Gi-Oh_Kagami_Takahiro_Style`, `Yugioh_GX_Illustrious_X1_SD8`, `illustrious-detailer`, `Anima_Base_ygiohdsod_ydms`
- diffusion_models: `anima-base-v1.0.safetensors`; text_encoders: `qwen_3_06b_base.safetensors`; vae: `qwen_image_vae.safetensors`
- controlnet: `TencentARC__t2i-adapter-lineart-sdxl-10__diffusion_pytorch_model.fp16.safetensors`
- upscale_models: `RealESRGAN_x4plus_anime_6B.pth`
- `RMBG/BiRefNet/BiRefNet_toonout.*` pre-fetched in the exact layout ComfyUI-RMBG expects
- `controlnet_aux_ckpts/lllyasviel/Annotators/netG.pth` (AnimeLineArt weights; the node's `ckpts` dir is symlinked there)

About 19 GB in total. Civitai files need `CIVITAI_API_KEY`.

## How it runs

`start.sh` (the entrypoint):

1. Symlinks `/opt/ComfyUI/models`, `input`, `output` to `/workspace/ComfyUI/...` so a RunPod network/volume disk keeps them across restarts.
2. Starts nginx on `0.0.0.0:8188` with HTTP basic auth (user `ygo`, password `COMFY_AUTH_TOKEN`), proxying to ComfyUI and passing WebSocket upgrades (`/ws`).
3. Runs `download-models.sh` - every missing file from `models.txt` in parallel with `aria2c -x8 -s8 --continue`; files that already exist with the right size are skipped.
4. Starts ComfyUI on `127.0.0.1:8189` with `--preview-method auto`.

Everything logs to stdout.

## Environment variables

| Var | Purpose |
|---|---|
| `COMFY_AUTH_TOKEN` | basic-auth password for user `ygo` (generated and printed if unset) |
| `CIVITAI_API_KEY` | needed for the Civitai downloads |
| `MODELS_DIR` | default `/workspace/ComfyUI/models` |
| `COMFY_ARGS` | extra ComfyUI CLI flags |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_PARALLEL` | concurrent aria2 downloads (default 6) |

## Run locally

```sh
docker run --gpus all -p 8188:8188 \
  -v $PWD/workspace:/workspace \
  -e CIVITAI_API_KEY=... -e COMFY_AUTH_TOKEN=... \
  ghcr.io/angelmankel/ygo-comfy:latest
# then http://localhost:8188  (user ygo / COMFY_AUTH_TOKEN)
```

## RunPod

The pod is created with `podFindAndDeployOnDemand` (RTX 5090, community cloud, 30 GB container disk,
80 GB volume on `/workspace`, port `8188/http`). ComfyUI is reachable at
`https://<podId>-8188.proxy.runpod.net` behind the basic auth above. See `POD.md` for the live pod id
and the exact GraphQL calls to stop / resume / terminate it.

Costs (Sept 2026): RTX 5090 community $0.69/h, secure $0.99/h; volume storage ~$0.10/GB/month while the
pod exists (stopped pods still pay for the volume). Stop the pod when not in use; resume takes about a
minute because the models are already on the volume.

## Build

Pushing to `main` builds and pushes `ghcr.io/angelmankel/ygo-comfy:latest` (and `:<sha>`) via
`.github/workflows/build.yml`. The package must be public for RunPod to pull it without credentials.
