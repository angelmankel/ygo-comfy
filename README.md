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

| Component | Pin |
|---|---|
| Base | `nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04`, Python 3.11, torch 2.8.0 + cu128 (Blackwell needs CUDA 12.8 / torch >= 2.7), onnxruntime-gpu |
| ComfyUI | `v0.34.5` (`7fd919f0caff66a52289ea5b19cb6eaca0da04ef`) - same major as Comfy Cloud (v0.34.4) |

### Custom node packs (all pinned to a commit in the Dockerfile)

| Pack | Used for |
|---|---|
| ComfyUI-RMBG (1038lab) | `BiRefNetRMBG` background removal (toonout model) - the pipeline's cutout step |
| ComfyUI_LayerStyle (chflame163) | `LayerUtility: ColorImage` and other layer/compositing helpers |
| ComfyMath (evanspearman) | `CM_FloatBinaryOperation` etc. - arithmetic in graphs |
| comfyui_controlnet_aux (Fannovel16) | preprocessors: AnimeLineArt, LineArt, HED, PiDiNet, DepthAnythingV2, DWPose, Canny |
| ComfyUI-Manager (Comfy-Org) | install/update packs from the UI, missing-node detection |
| ComfyUI-Impact-Pack + Impact-Subpack (ltdrdata) | `FaceDetailer`, `UltralyticsDetectorProvider`, SEGS, SAM-based inpaint/detail passes |
| ComfyUI-Inspire-Pack (ltdrdata) | regional prompting, LoRA block weight, prompt utilities, KSampler variants |
| ComfyUI_essentials (cubiq) | image/mask utilities, `ImageResize+`, `SimpleMath+`, `MaskFromColor+` |
| ComfyUI-KJNodes (kijai) | mask/image batch helpers, `GetImageSizeAndCount`, colour-match, scheduling utilities |
| rgthree-comfy | `Fast Groups Bypasser`, `Context`, `Power Lora Loader`, `Any Switch`, reroutes |
| ComfyUI-Custom-Scripts (pythongosssss) | UI quality of life: autocomplete, `ShowText`, `MathExpression`, workflow images |
| ComfyUI-WD14-Tagger (pythongosssss) | `WD14Tagger|pysssss` - danbooru tag inference for img2img / captioning |
| ComfyUI_UltimateSDUpscale (ssitu) | `UltimateSDUpscale` tiled SD upscaling |
| ComfyUI_IPAdapter_plus (cubiq) | `IPAdapterUnifiedLoader`, `IPAdapter`, `IPAdapterAdvanced` style/character reference |
| comfyui_segment_anything (storyicon) | `SAMModelLoader (segment anything)`, GroundingDINO text-prompted segmentation |
| ComfyUI_Comfyroll_CustomNodes | `CR` aspect ratio, text, image list/grid and pipe nodes |
| was-node-suite-comfyui | large grab-bag: image filters, blending, text ops, `Image Blend by Mask` |
| ComfyUI-Easy-Use (yolain) | `easy` loaders/samplers, prompt styler, `easy imageRemBg`, LLM-free prompt helpers |

### Models (see `models.txt` for URLs, target folders and byte sizes; ~46 GB total on the volume)

| Folder | Files |
|---|---|
| checkpoints | `illustriousXLPersonalMerge_v30Noob10based`, `anima_turboV11` |
| loras | `Yu-Gi-Oh_Kagami_Takahiro_Style`, `Yugioh_GX_Illustrious_X1_SD8`, `illustrious-detailer`, `Anima_Base_ygiohdsod_ydms` |
| diffusion_models / text_encoders / vae | `anima-base-v1.0`, `qwen_3_06b_base`, `qwen_image_vae` (Anima pipeline) |
| vae_approx | `taesd_decoder`, `taesdxl_decoder`, `taesd3_decoder`, `taef1_decoder`, `lighttaew2_1` (Wan21 latent = Anima / Qwen-Image) - live previews with `--preview-method taesd` |
| controlnet | NoobAI XL (Eugeoter, fp16): `noob-sdxl-controlnet-{canny,depth,lineart_anime,manga_line,scribble_pidinet}`; `xinsir-controlnet-union-sdxl-promax` (incl. openpose - there is no NoobAI openpose); `CN-anytest_v4-marged`; T2I adapters `TencentARC__t2i-adapter-{lineart,sketch,canny,depth-midas,openpose}-sdxl-10__...` |
| controlnet_aux_ckpts | Annotators `netG` (anime lineart), `sk_model`/`sk_model2` (lineart), `ControlNetHED`, `table5_pidinet`; `depth_anything_v2_vitl`; DWPose `yolox_l.onnx`, `dw-ll_ucoco_384.onnx`, `dw-ll_ucoco_384_bs5.torchscript.pt` |
| ultralytics/bbox, ultralytics/segm, sams | `face_yolov8m`, `hand_yolov8n`, `person_yolov8m-seg`, `sam_vit_b_01ec64` |
| ipadapter, clip_vision | `ip-adapter-plus_sdxl_vit-h`, `ip-adapter_sdxl_vit-h`, `CLIP-ViT-H-14-laion2B-s32B-b79K` |
| wd14_tagger | `wd-v1-4-moat-tagger-v2`, `wd-eva02-large-tagger-v3` (onnx + csv) |
| upscale_models | `RealESRGAN_x4plus_anime_6B`, `4x-AnimeSharp`, `4x-UltraSharp` |
| RMBG/BiRefNet | `BiRefNet_toonout` pre-fetched in the layout ComfyUI-RMBG expects |

Civitai files need `CIVITAI_API_KEY`. Not included: `2x-AnimeJaNai` (no stable HF source).

### What Comfy Cloud does NOT have (tag workflows by backend)

Comfy Cloud (v0.34.4) runs the five node packs of the original image (RMBG, LayerStyle, ComfyMath,
controlnet_aux) plus core. Everything below exists **only on this self-hosted image**, so a workflow that
uses any of it must be tagged `backend: local`:

- packs: ComfyUI-Manager, Impact-Pack/Subpack (`FaceDetailer`, `UltralyticsDetectorProvider`), Inspire-Pack,
  ComfyUI_essentials, KJNodes, rgthree, Custom-Scripts, WD14-Tagger, UltimateSDUpscale, IPAdapter_plus,
  segment_anything, Comfyroll, WAS suite, Easy-Use
- models: every NoobAI / xinsir / anytest controlnet, the extra T2I adapters, IPAdapter + CLIP-ViT-H,
  WD14 tagger weights, ultralytics detectors, SAM, `4x-AnimeSharp`, `4x-UltraSharp`, the TAESD previews
- Comfy Cloud previews are its own; `lighttaew2_1` / `--preview-method taesd` only matter here

## How it runs
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
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |4. Starts ComfyUI on `127.0.0.1:8189` with `--preview-method taesd` (live previews for SD1.5/SDXL/SD3/Flux and, via `lighttaew2_1`, Anima/Qwen-Image/Wan latents).
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
