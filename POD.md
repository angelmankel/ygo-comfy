# Live pod

| | |
|---|---|
| Pod id | `2wkq26rkp2mgbe` (`characteristic_emerald_alligator`, rented 2026-09-21) |
| GPU | NVIDIA **B200** 180 GB, RunPod secure cloud, US-CA-2, **$6.79/h** |
| Endpoint | `http://38.80.152.146:30246` — point Traefik at this for `https://comfyui-ygo.blueoceanswim.com/` |
| Volume | **network** volume on `/workspace`; the manifest's 58 files verified 2026-09-21 |
| Auth | user `ygo`, password = `COMFY_LOCAL_TOKEN` (reused from the previous pod) |
| App | `~/Github/ygo-comfy/app` pushed 2026-09-21 |
| ImageLab | **`/ygo/app/lab/`** — verified rendering and Connected. `/lab/` is a white screen here: this pod pulled its image four minutes before 23cc450 landed, so its nginx still has no `mime.types` and serves modules as `text/plain`. A resume onto `:latest` fixes that path. |

Do not ask a Blackwell pod for `volumeInGb` — it has no local disk and the deploy is refused. A
network volume is the only way, and it is also why a resume is cheap: the 58 models stay put.

## Benchmark, 2026-09-21 (`scratchpad/bench.ts 38.80.152.146:30246 twopass`)

The same two-pass graph the A100 ran (`cardart-hires-illustrious` at commit `2e74f30`: base 40 →
latent 1.25x → hires 45, one decode, seed 98).

| | A100 80 GB | B200 180 GB |
|---|---|---|
| Whole prompt, cold | — | **139.5 s** |
| Sampling alone | — | ~7 s per pass (22 steps at 3.2 it/s), so ~14 s for both |
| Comparable A100 figure | 14.5 s | |

The GPU is not the 139.5 s. Sampling is ~14 s, which is the A100's whole number; the other ~125 s
is the four checkpoints and three LoRAs arriving cold off the network volume. The log shows the
second pass asking to load SDXL at 05:41:48 and finishing a 7-second sample at 05:42:43 — 48
seconds of that minute was loading.

Two things make that load slow, and both are worth chasing before trusting any B200 number:

1. **`comfy-aimdo` is staging instead of resident-loading.** Every checkpoint logs "prepared for
   dynamic VRAM loading … 4896MB Staged", and the run threw 89 `hostbuf_grow` errors trying to
   grow a fixed ~10.28 GB host buffer. On a card with 191 GB of free VRAM there is nothing to
   offload; the staging is pure overhead.
2. **A network volume is not a local disk.** It is why Blackwell deploys work at all, and it is
   also why a cold checkpoint read is slow.

A warm re-run would separate the two, and was not spent: the brief was one render.

## The live pod's own commands

These carry the live id. A recipe that asks you to substitute a pod id by hand is a recipe for
stopping the wrong pod, so the id is written in, and the general forms live further down with the
pod they were written for.

Read the address again — **it changes on every resume**:

```sh
curl -s https://api.runpod.io/graphql -H "Authorization: Bearer $RUNPOD_API_KEY" -H 'Content-Type: application/json' \
  -d '{"query":"{ pod(input:{podId:\"2wkq26rkp2mgbe\"}) { desiredStatus runtime { uptimeInSeconds ports { ip isIpPublic privatePort publicPort type } } } }"}' \
  | jq '.data.pod.runtime.ports[] | select(.type=="tcp")'
```

Then repoint Traefik, push the app again (`scratchpad/push.sh <ip:port>`), and follow the .env
rule below: comment the domain line, add the ip:port under it, never delete the domain line.

Stop it (keeps the network volume and the 58 models; no GPU billing):

```sh
curl -s https://api.runpod.io/graphql -H "Authorization: Bearer $RUNPOD_API_KEY" -H 'Content-Type: application/json' \
  -d '{"query":"mutation { podStop(input:{podId:\"2wkq26rkp2mgbe\"}) { id desiredStatus } }"}'
```

Resume it (models are already on the volume, so this is fast and cheap):

```sh
curl -s https://api.runpod.io/graphql -H "Authorization: Bearer $RUNPOD_API_KEY" -H 'Content-Type: application/json' \
  -d '{"query":"mutation { podResume(input:{podId:\"2wkq26rkp2mgbe\", gpuCount:1}) { id desiredStatus costPerHr } }"}'
```

At $6.79/h this pod costs about **11 cents a minute whether or not it renders**. Stop it when idle.

Every earlier pod below is terminated; their sections are kept for the facts they cost.

## Older: RTX 5090 pod (terminated)

| | |
|---|---|
| Pod id | `rq6z6e1djo9sbn` |
| GPU | NVIDIA GeForce RTX 5090 (32 GB), RunPod **community** cloud, location SK |
| Price | $0.69/h while running; volume storage is billed while the pod exists (also when stopped) |
| Image | `ghcr.io/angelmankel/ygo-comfy:latest` |
| Disks | 30 GB container, 80 GB volume on `/workspace` (models + input/output live there). The manifest is now ~62 GB — a fresh pod should take **100 GB**. |
| ComfyUI endpoint (TCP, the real one) | `http://87.197.126.165:40379` - plain HTTP, basic auth user `ygo`, password = `COMFY_LOCAL_TOKEN` in ygo-art-studio/.env |
| RunPod HTTP proxy | `https://rq6z6e1djo9sbn-8188.proxy.runpod.net` - **currently answers 404**: with `8188/http,8188/tcp` both requested, RunPod mapped the http side to a bogus private port. It goes through Cloudflare anyway, which drops long WebSocket connections, so do not rely on it. |
| Download log | `http://87.197.126.165:40379/ygo/logs/download.log` (same auth); `/ygo/logs/models-complete` exists once every model verified |

The user will front the TCP endpoint with their own Traefik at `comfyui-ygo.blueoceanswim.com`
(forward to `http://87.197.126.165:40379`, keep the basic auth or terminate it in Traefik and inject the header).

**The public IP:port changes on every resume/recreate** (:40364 -> :40318 -> :40379 over the first two
stop/resume cycles). Read it again with:

```sh
curl -s https://api.runpod.io/graphql -H "Authorization: Bearer $RUNPOD_API_KEY" -H 'Content-Type: application/json' \
  -d '{"query":"{ pod(input:{podId:\"rq6z6e1djo9sbn\"}) { desiredStatus runtime { uptimeInSeconds ports { ip isIpPublic privatePort publicPort type } } } }"}' \
  | jq '.data.pod.runtime.ports[] | select(.type=="tcp")'
```

then update `COMFY_LOCAL_URL` in `ygo-art-studio/.env` (and the Traefik backend).

## Stop (keeps the volume; no GPU billing)

```sh
curl -s https://api.runpod.io/graphql -H "Authorization: Bearer $RUNPOD_API_KEY" -H 'Content-Type: application/json' \
  -d '{"query":"mutation { podStop(input:{podId:\"rq6z6e1djo9sbn\"}) { id desiredStatus } }"}'
```

## Resume (re-pulls `:latest`, models already on the volume, ComfyUI up in ~1 min; new TCP port)

```sh
curl -s https://api.runpod.io/graphql -H "Authorization: Bearer $RUNPOD_API_KEY" -H 'Content-Type: application/json' \
  -d '{"query":"mutation { podResume(input:{podId:\"rq6z6e1djo9sbn\", gpuCount:1}) { id desiredStatus costPerHr } }"}'
```

If the host's GPU was rented out meanwhile, resume fails; terminate and recreate instead.

## Terminate (deletes the volume too)

```sh
curl -s https://api.runpod.io/graphql -H "Authorization: Bearer $RUNPOD_API_KEY" -H 'Content-Type: application/json' \
  -d '{"query":"mutation { podTerminate(input:{podId:\"rq6z6e1djo9sbn\"}) }"}'
```

## Recreate from scratch

```sh
TOKEN=$(openssl rand -hex 16)
curl -s https://api.runpod.io/graphql -H "Authorization: Bearer $RUNPOD_API_KEY" -H 'Content-Type: application/json' \
  -d "{\"query\":\"mutation { podFindAndDeployOnDemand(input: { cloudType: COMMUNITY, gpuCount: 1, volumeInGb: 100, containerDiskInGb: 30, minVcpuCount: 4, minMemoryInGb: 16, gpuTypeId: \\\"NVIDIA GeForce RTX 5090\\\", name: \\\"ygo-comfy\\\", imageName: \\\"ghcr.io/angelmankel/ygo-comfy:latest\\\", dockerArgs: \\\"\\\", ports: \\\"8188/tcp\\\", volumeMountPath: \\\"/workspace\\\", env: [{ key: \\\"CIVITAI_API_KEY\\\", value: \\\"$CIVITAI_API_KEY\\\" }, { key: \\\"COMFY_AUTH_TOKEN\\\", value: \\\"$TOKEN\\\" }] }) { id costPerHr machine { gpuDisplayName } } }\"}"
```

Use `cloudType: SECURE` ($0.99/h) if community has no 5090. Then read the TCP port as above and update `.env`.

The manifest is ~62 GB on a fresh volume (it was ~19 GB when the first pod was built, ~46 GB after the
anime-workstation pass). Budget 5-10 minutes for the first boot; a resume re-downloads nothing.

## Cost log

- 2026-09-06: first pod `8g18kc9zrqtbku` (old image, terminated) ~15 min + this pod from 22:12 UTC.
  Balance $18.30 -> $17.91 by 22:35 UTC (~$0.39).
- 2026-09-06 23:45 UTC: stop/resume onto the anime-workstation image (15 more packs, +26 GB models, ~3.5 min
  download); volume now ~46 GB of 80. Balance $16.98 at 23:58 UTC (~$1.32 total so far, pod still running at $0.69/h).


## 2026-09-07: A100 pod (GPU swap for the Anima test)

- The RTX 5090 pod `rq6z6e1djo9sbn` is STOPPED (volume kept; resume with `podResume` above, then re-read its port).
- New pod `4fgj4rhklpi255`: **NVIDIA A100 80GB PCIe, SECURE cloud, $1.59/h** (community had none at the time), same image,
  80 GB volume, `8188/tcp` → `http://185.216.21.214:27971` (basic auth unchanged). Donny's Traefik (comfyui-ygo.blueoceanswim.com)
  was repointed at it; `.env` uses the domain.
- Stop / resume / terminate: same mutations as above with `podId:"4fgj4rhklpi255"`. Two pods stopped still bill their volumes.
- .env rule: when the address changes, COMMENT the domain line and add the ip:port below it — never delete the domain line.

## 2026-09-20: the card-art stack is in the manifest

`cardart-hires-illustrious` is the workflow the app actually renders with, and three of its four
checkpoints plus its retro LoRA were only ever on Comfy Cloud — a pod could not run it. They are in
`models.txt` now, pulled from the same Civitai versions the cloud assets were imported from:

| File | Civitai version | Bytes |
|---|---|---|
| `wai-illustrious-sdxl.safetensors` | 2167369 | 6938040682 |
| `hexus_etnix.safetensors` | 2938105 | 6938041520 |
| `spicySouls_12.safetensors` | 3321542 | 6938042794 |
| `retro_scifi_artstyle_illustriousXL-000021.safetensors` | 1021743 | 228460796 |

Sizes were read from the download's own `Content-Range`, so `download-models.sh` will not re-fetch them
on every boot. Civitai answers **403 to HEAD** on these files and 200 to a normal GET with
`?token=` — do not "fix" a HEAD check that looks broken.

Manifest total: ~62 GB, 58 files. Both pods were stopped or gone when this was written, so it is
verified against the pinned ComfyUI commit and the Civitai endpoints, not against a live pod.
