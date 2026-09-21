# ygo-comfy — the pod, the image, and everything that runs on it

You are probably here because there is a RunPod pod to bring up, something to change on one that
is already running, or one to shut down. Read the rules first; they are the parts that cost money
or lose work.

## The three repos

| | |
|---|---|
| `~/Github/ygo-comfy` | **this one.** The Docker image: ComfyUI, every custom node pinned to a commit, the model manifest, the pod's own little web app, and a build copy of ImageLab. Pushing to `main` builds `ghcr.io/angelmankel/ygo-comfy:latest` through GitHub Actions, about ten minutes. |
| `~/Github/ygo-art-studio` | The web app and job server. **Holds `.env`** — `RUNPOD_API_KEY`, `CIVITAI_API_KEY`, `COMFY_LOCAL_USER`, `COMFY_LOCAL_TOKEN`. Every script here reads it. |
| `~/Github/ygo-art-pipeline` | Workflow definitions: `workflows/<id>/{graph.json,manifest.json}`. |
| `~/Github/ImageLabCore` | The ComfyUI custom node that answers `/imagelab/*`. Public on GitHub, pinned in this Dockerfile. |

`lab/` in this repo is the ImageLab front end; `lab/dist` is built with `npm run build` and copied
to `app/lab` before pushing. `app/` is the pod's stdlib-only web app (model installer + a file API
it can be updated through).

## Rules that are not negotiable

1. **Before terminating a pod, pull its images.** `scratchpad/pull-images.sh <ip:port>` writes to
   `/mnt/games/images/runpod/MM-DD-YYYY/`. A pod's disk is not backed up anywhere and a terminate
   is final. Do it before the terminate, every time. Do it before a *resume* too — the app saves
   through `PreviewImage`, which lands in ComfyUI's `temp/`, and ComfyUI wipes `temp/` on start.
2. **Before terminating a pod, push every repo.** `git status` in all four, commit, push. A
   terminate is a good moment to lose an afternoon of uncommitted work.
3. **Ask before spending GPU.** The pod bills whether or not it renders. Say the hourly rate when
   you start one, and stop it when it goes idle.
4. **Every retry is a NEW project. Never overwrite a render.** The failures are the data.
5. **Commit straight to `main`, all repos. No branches.**

## Starting a pod

The GPU changes depending on the job. What does not change: **secure cloud, US**. Community is
cheaper and not worth it — a community 5090 was still pulling the 8.3 GB image fifteen minutes in
at about 10 MB/s, while a secure one served in eighty seconds. Thirty cents an hour buys a
datacentre's uplink, and first boot downloads 62 GB of models.

Pick a GPU by price and speed:

```sh
cd ~/Github/ygo-art-studio && set -a && . ./.env && set +a
curl -s https://api.runpod.io/graphql -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ gpuTypes { id displayName memoryInGb lowestPrice(input:{gpuCount:1}) { uninterruptablePrice } } }"}' \
  | jq -r '.data.gpuTypes | map(select(.lowestPrice.uninterruptablePrice > 0))
           | sort_by(.lowestPrice.uninterruptablePrice) | .[]
           | "\(.lowestPrice.uninterruptablePrice)/h  \(.memoryInGb)GB  \(.displayName)"'
```

**Do not trust the per-datacentre availability query.** It only sees secure cloud and returns
nothing for GPUs that certainly exist — an A40 with High stock globally came back empty for every
US datacentre. The only real test is deploying. A failed deploy costs nothing.

Deploy (substitute `gpuTypeId` from the list above):

```sh
cd ~/Github/ygo-art-studio && set -a && . ./.env && set +a
curl -s https://api.runpod.io/graphql -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H 'Content-Type: application/json' -d "{\"query\":\"mutation { podFindAndDeployOnDemand(input: {
    cloudType: SECURE, gpuCount: 1, countryCode: \\\"US\\\",
    containerDiskInGb: 30, volumeInGb: 100, volumeMountPath: \\\"/workspace\\\",
    minVcpuCount: 4, minMemoryInGb: 16,
    gpuTypeId: \\\"NVIDIA GeForce RTX 5090\\\",
    name: \\\"ygo-comfy\\\", imageName: \\\"ghcr.io/angelmankel/ygo-comfy:latest\\\",
    ports: \\\"8188/tcp\\\",
    env: [{ key: \\\"CIVITAI_API_KEY\\\", value: \\\"$CIVITAI_API_KEY\\\" },
          { key: \\\"COMFY_AUTH_TOKEN\\\", value: \\\"$COMFY_LOCAL_TOKEN\\\" }]
  }) { id costPerHr machine { gpuDisplayName location } } }\"}" | jq -c .
```

- `volumeInGb: 100` is a **pod-local** volume: created with the pod, deleted with it, no standing
  storage bill, and it survives a *stop*. Do not use a network volume unless you want to pay for
  storage between sessions.
- **Never pass `volumeInGb` for a B200 or B300.** Blackwell datacentre nodes have no local disk to
  give and every attempt returns "no instances available" until it is dropped. An RTX 5090 is also
  Blackwell but takes a volume fine.
- `COMFY_AUTH_TOKEN` must be `COMFY_LOCAL_TOKEN` so the password already in `.env` keeps working.

Then wait for it, and read the address:

```sh
curl -s https://api.runpod.io/graphql -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pod(input:{podId:\"POD_ID\"}) { runtime { uptimeInSeconds ports { ip publicPort type } } } }"}' \
  | jq -r '.data.pod.runtime.ports[]? | select(.type=="tcp") | "\(.ip):\(.publicPort)"'
```

`runtime: null` means it is still pulling the image. **Read the port again once the pod actually
serves** — a read immediately after a resume can still return the previous port, which has already
cost one wrong Traefik repoint.

Tell Donny the `ip:port`. He fronts it with his own Traefik at
`https://comfyui-ygo.blueoceanswim.com/`, and **the port changes on every resume**, so he has to
repoint by hand each time. A 502 on the domain while the direct `ip:port` answers 200 means
exactly that and nothing else.

## What a pod serves

| | |
|---|---|
| `/` | ComfyUI |
| `/ygo/app/lab/` | **ImageLab** — use this one |
| `/lab/` | ImageLab via nginx; same app |
| `/ygo/app/` | model installer + the file API |
| `/imagelab/*` | ImageLabCore: `hashes`, `downloads`, `favorites`, `version` |
| `/ygo/logs/download.log` | model download progress |
| `/ygo/logs/models-complete` | 200 once every model has landed |

All of it is behind nginx basic auth: user `ygo`, password `COMFY_LOCAL_TOKEN`.

First boot downloads **62.2 GB across 88 files** from `models.txt`. Ten to thirty minutes depending
on the host. Civitai answers 403 to some aria2 requests — that is normal and the curl fallback
picks them up; do not panic at 403s in the log. Watch `models-complete`.

## Pushing code to a running pod

Neither of these needs an image rebuild.

```sh
scratchpad/push.sh      <ip:port>   # ImageLab + the pod's app  (~instant)
scratchpad/push-node.sh <ip:port>   # ImageLabCore + restart ComfyUI  (~15s)
```

Both work because the code lives on the volume, not in the image, and is symlinked into place by
`start.sh`. `push-node.sh` also POSTs `/manager/reboot`, which ends in `os.execv` — ComfyUI
re-execs in place, so the PID survives, the container does not restart and the port does not
change. Because it is a real restart, **adding a route is no different from changing one**.

For ImageLab, rebuild the front end first:

```sh
cd lab && npm run build && cd .. && rm -rf app/lab && cp -r lab/dist app/lab
scratchpad/push.sh <ip:port>
```

**After resuming onto a new image, push both anyway.** The volume copy is seeded from the image
only when it is absent, so an older copy on the volume keeps running and the image's version never
appears. This is deliberate — it stops a rebuild wiping live edits — but it surprises everyone once.

An image rebuild is only needed for: `start.sh`, `nginx.conf.template`, the Dockerfile, a new
custom node, or a new Python dependency.

## Stopping, resuming, terminating

```sh
# stop — keeps the volume and the models, no GPU billing
-d '{"query":"mutation { podStop(input:{podId:\"POD_ID\"}) { desiredStatus } }"}'
# resume — re-pulls :latest, models already there, NEW PORT
-d '{"query":"mutation { podResume(input:{podId:\"POD_ID\", gpuCount:1}) { desiredStatus } }"}'
# terminate — the volume and everything on it is gone, for good
-d '{"query":"mutation { podTerminate(input:{podId:\"POD_ID\"}) }"}'
```

Stop/resume is how you pick up a new image. Terminate is how you stop paying entirely. **Pull the
images and push the repos before either.**

## Things that cost time to learn — do not relearn them

1. ComfyUI runs `steps × denoise`. "10 steps" typed literally runs two and does nothing.
2. A latent upscale destroys linework. Enlarge in PIXELS through an anime upscaler, then add
   detail. The Passes panel has a Latent/Image switch for exactly this.
3. Setting a `negative` REPLACES a graph's baked-in negative. The realism ban lives in vocab
   `always`, weighted `(photorealistic, …:0.65)` — at 1.0 it flattens everything.
4. Left alone the prompt model picks low/hero camera angles 70% of the time. Deal cameras out by
   quota.
5. `background: scene` cannot invent a place. The subject line must NAME it.
6. Seeds are fixed at 98 unless set. Anatomy must lead the prompt. Never say "official yugioh card
   artwork".
7. Civitai answers 403 to HEAD and to anonymous requests; a GET with `?token=` works. Sizes come
   from `Content-Range`, never from the API's `sizeKB`.
8. A graph's `last_link_id` can be stale. Number new links from the real maximum or you silently
   rewire a live input.
9. **Asking for `volumeInGb` blocks B200/B300 deploys.** Use a network volume there, or no volume.
10. **Verify a node's inputs against `/object_info` before trusting a graph.** And read the whole
    options list — a truncated read once "proved" `ImageScale` rejects `lanczos`, which it does not.
11. A pod cannot have a custom node installed into it live. ComfyUI-Manager refuses arbitrary git
    URLs, aiohttp freezes its router at startup, and `custom_nodes` is in the image layer. The
    volume symlink plus `push-node.sh` is the way around all three.
12. When Donny reports a mouse or input problem, ask whether it happens outside the app too. He
    works over Moonlight, whose absolute mouse mode strands the cursor at a screen edge;
    `Ctrl+Alt+Shift+M` fixes it and it is not a UI bug.

## Verifying anything

Donny tests; you do not drive his mouse. Check work with the offscreen harness:

```sh
node scratchpad/lab-check.mjs <url> [shot.png]   # loads the page, reports console + render
```

It resolves puppeteer from `ygo-art-studio/node_modules`. For anything graph-shaped, validate
against `/object_info` rather than spending a render.
