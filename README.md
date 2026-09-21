# ygo-comfy
Self-hosted ComfyUI for the Yu-Gi-Oh card-art pipeline (`ygo-art-pipeline` / `ygo-art-studio`).
One Docker image with ComfyUI, the custom node packs the workflows use, and a model manifest
(`models.txt`, ~62 GB) that is fetched onto a persistent volume on first boot. Built by GitHub
Actions and published as `ghcr.io/angelmankel/ygo-comfy:latest`; meant to run on a RunPod pod.

**The working card-art workflow is `cardart-hires-illustrious`** and this image carries everything
it needs — see *The card-art stack* below. Its graph uses core ComfyUI nodes only
(`CheckpointLoaderSimple`, `ModelMergeSimple`, `LoraLoaderModelOnly`, `PrimitiveStringMultiline`,
`StringConcatenate`, `KSampler`, `LatentUpscaleBy`), all present in the pinned ComfyUI, so no node
pack is required for it.

## What is inside

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

### Models (see `models.txt` for URLs, target folders and byte sizes; ~62 GB total on the volume)

| Folder | Files |
|---|---|
| checkpoints | `wai-illustrious-sdxl`, `illustriousXLPersonalMerge_v30Noob10based`, `hexus_etnix`, `spicySouls_12`, `anima_turboV11` |
| loras | `Yu-Gi-Oh_Kagami_Takahiro_Style`, `Yugioh_GX_Illustrious_X1_SD8`, `retro_scifi_artstyle_illustriousXL-000021`, `illustrious-detailer`, `Anima_Base_ygiohdsod_ydms` |
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

### The card-art stack (`cardart-hires-illustrious`)

Two passes. Composition is decided by a model with no style opinion; style is applied only afterwards.

```
WAI (plain, no lora/merge) -> pass 1 denoise 1.0 -> latent -> upscale 1.25x
  personal merge + Hexus + Spicy Souls (equal thirds)
    -> gx lora 1.0 -> kagami lora 1.0 -> retro lora 0.25   -> pass 2 denoise 0.6
```

| Slot | File the graph asks for | Civitai |
|---|---|---|
| pass 1 checkpoint + the one CLIP both passes use | `wai-illustrious-sdxl.safetensors` | `827184@2167369` (uploaded as `waiIllustriousSDXL_v150`) |
| style merge a | `illustriousXLPersonalMerge_v30Noob10based.safetensors` | `835655@1023901` |
| style merge b | `hexus_etnix.safetensors` | `2149545@2938105` |
| style merge c | `spicySouls_12.safetensors` | `2934475@3321542` |
| lora, GX look | `Yugioh_GX_Illustrious_X1_SD8.safetensors` | `960264@1480107` |
| lora, Kagami Takahiro line | `Yu-Gi-Oh_Kagami_Takahiro_Style.safetensors` | `1481618@1675894` |
| lora, retro 90s anime (0.25) | `retro_scifi_artstyle_illustriousXL-000021.safetensors` | `912942@1021743` |

The filenames are Comfy Cloud's, so the same project renders on either backend without edits;
`download-models.sh` renames each file on the way in. No LoRA touches the text encoder.

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
`start.sh` (the entrypoint):

1. Symlinks `/opt/ComfyUI/models`, `input`, `output` to `/workspace/ComfyUI/...` so a RunPod network/volume disk keeps them across restarts.
2. Starts nginx on `0.0.0.0:8188` with HTTP basic auth (user `ygo`, password `COMFY_AUTH_TOKEN`), proxying to ComfyUI and passing WebSocket upgrades (`/ws`).
3. Runs `download-models.sh` - every missing file from `models.txt` in parallel with `aria2c -x8 -s8 --continue`; files that already exist with the right size are skipped.
4. Starts ComfyUI on `127.0.0.1:8189` with `--preview-method taesd` (live previews for SD1.5/SDXL/SD3/Flux and, via `lighttaew2_1`, Anima/Qwen-Image/Wan latents).
Everything logs to stdout.

## Environment variables

| Var | Purpose |
|---|---|
| `COMFY_AUTH_TOKEN` | basic-auth password for user `ygo` (generated and printed if unset) |
| `CIVITAI_API_KEY` | needed for the Civitai downloads |
| `MODELS_DIR` | default `/workspace/ComfyUI/models` |
| `COMFY_ARGS` | extra ComfyUI CLI flags |
| `DOWNLOAD_PARALLEL` | concurrent aria2 downloads (default 6) |
| `SKIP_MODEL_DOWNLOAD=1` | skip the manifest step |
| `DOWNLOAD_ATTEMPTS` | retries of the whole manifest (default 20, 30 s apart) |

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
volume on `/workspace`, port `8188/tcp`). **Use a 100 GB volume**: the manifest is ~62 GB and an 80 GB
volume leaves no room for outputs or a second checkpoint. ComfyUI is reachable at
`https://<podId>-8188.proxy.runpod.net` behind the basic auth above. See `POD.md` for the live pod id
and the exact GraphQL calls to stop / resume / terminate it.
Costs (Sept 2026): RTX 5090 community $0.69/h, secure $0.99/h; volume storage ~$0.10/GB/month while the
pod exists (stopped pods still pay for the volume). Stop the pod when not in use; resume takes about a
minute because the models are already on the volume.

## Build
Pushing to `main` builds and pushes `ghcr.io/angelmankel/ygo-comfy:latest` (and `:<sha>`) via
`.github/workflows/build.yml`. The package must be public for RunPod to pull it without credentials.
