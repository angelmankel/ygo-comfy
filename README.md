| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |# ygo-comfy
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |Self-hosted ComfyUI for the Yu-Gi-Oh card-art pipeline (`ygo-art-pipeline` / `ygo-art-studio`).
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |One Docker image with ComfyUI, the four custom node packs the two workflows use, and a model
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |manifest that is fetched onto a persistent volume on first boot. Built by GitHub Actions and
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |published as `ghcr.io/angelmankel/ygo-comfy:latest`; meant to run on a RunPod RTX 5090 pod.
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |## What is inside
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) || Component | Pin |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) ||---|---|
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) || Base | `nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04`, Python 3.11, torch 2.8.0 + cu128 (Blackwell needs CUDA 12.8 / torch >= 2.7) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) || ComfyUI | `v0.34.5` (`7fd919f0caff66a52289ea5b19cb6eaca0da04ef`) - same major as Comfy Cloud (v0.34.4) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) || ComfyMath (`CM_FloatBinaryOperation`) | evanspearman/ComfyMath `c011772` |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) || ComfyUI-RMBG (`BiRefNetRMBG`) | 1038lab/ComfyUI-RMBG `58f1947` |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) || ComfyUI_LayerStyle (`LayerUtility: ColorImage`) | chflame163/ComfyUI_LayerStyle `5ba9390` |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) || comfyui_controlnet_aux (`AnimeLineArtPreprocessor`) | Fannovel16/comfyui_controlnet_aux `59b1fc4` |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |`ComfySwitchNode` and every other class the workflows use are ComfyUI core (`comfy_extras.nodes_logic` etc.).
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |Models (see `models.txt` for URLs, target folders and sizes):
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |- checkpoints: `illustriousXLPersonalMerge_v30Noob10based.safetensors`, `anima_turboV11.safetensors`
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |- loras: `Yu-Gi-Oh_Kagami_Takahiro_Style`, `Yugioh_GX_Illustrious_X1_SD8`, `illustrious-detailer`, `Anima_Base_ygiohdsod_ydms`
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |- diffusion_models: `anima-base-v1.0.safetensors`; text_encoders: `qwen_3_06b_base.safetensors`; vae: `qwen_image_vae.safetensors`
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |- controlnet: `TencentARC__t2i-adapter-lineart-sdxl-10__diffusion_pytorch_model.fp16.safetensors`
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |- upscale_models: `RealESRGAN_x4plus_anime_6B.pth`
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |- `RMBG/BiRefNet/BiRefNet_toonout.*` pre-fetched in the exact layout ComfyUI-RMBG expects
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |- `controlnet_aux_ckpts/lllyasviel/Annotators/netG.pth` (AnimeLineArt weights; the node's `ckpts` dir is symlinked there)
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |About 19 GB in total. Civitai files need `CIVITAI_API_KEY`.
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |## How it runs
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |`start.sh` (the entrypoint):
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |1. Symlinks `/opt/ComfyUI/models`, `input`, `output` to `/workspace/ComfyUI/...` so a RunPod network/volume disk keeps them across restarts.
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |2. Starts nginx on `0.0.0.0:8188` with HTTP basic auth (user `ygo`, password `COMFY_AUTH_TOKEN`), proxying to ComfyUI and passing WebSocket upgrades (`/ws`).
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |3. Runs `download-models.sh` - every missing file from `models.txt` in parallel with `aria2c -x8 -s8 --continue`; files that already exist with the right size are skipped.
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |4. Starts ComfyUI on `127.0.0.1:8189` with `--preview-method auto`.
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |Everything logs to stdout.
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |## Environment variables
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) || Var | Purpose |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) ||---|---|
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) || `COMFY_AUTH_TOKEN` | basic-auth password for user `ygo` (generated and printed if unset) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) || `CIVITAI_API_KEY` | needed for the Civitai downloads |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) || `MODELS_DIR` | default `/workspace/ComfyUI/models` |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) || `COMFY_ARGS` | extra ComfyUI CLI flags |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) || `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) || `DOWNLOAD_PARALLEL` | concurrent aria2 downloads (default 6) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |## Run locally
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |```sh
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |docker run --gpus all -p 8188:8188 \
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |  -v $PWD/workspace:/workspace \
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |  -e CIVITAI_API_KEY=... -e COMFY_AUTH_TOKEN=... \
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |  ghcr.io/angelmankel/ygo-comfy:latest
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |# then http://localhost:8188  (user ygo / COMFY_AUTH_TOKEN)
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |```
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |## RunPod
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |The pod is created with `podFindAndDeployOnDemand` (RTX 5090, community cloud, 30 GB container disk,
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |80 GB volume on `/workspace`, port `8188/http`). ComfyUI is reachable at
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |`https://<podId>-8188.proxy.runpod.net` behind the basic auth above. See `POD.md` for the live pod id
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |and the exact GraphQL calls to stop / resume / terminate it.
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |Costs (Sept 2026): RTX 5090 community $0.69/h, secure $0.99/h; volume storage ~$0.10/GB/month while the
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |pod exists (stopped pods still pay for the volume). Stop the pod when not in use; resume takes about a
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |minute because the models are already on the volume.
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |## Build
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |Pushing to `main` builds and pushes `ghcr.io/angelmankel/ygo-comfy:latest` (and `:<sha>`) via
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |`.github/workflows/build.yml`. The package must be public for RunPod to pull it without credentials.
