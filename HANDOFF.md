# ygo-art — continue: the B200 pod

## Repos
- `~/Github/ygo-art-studio` — web app + job server (web :5173, server :4100, TrailBase :4000).
- `~/Github/ygo-art-pipeline` — workflows (`workflows/<id>/{graph.json,manifest.json}`), `src/{t2i,vocab,workflow}.ts`.
- `~/Github/ygo-comfy` — the pod's Docker image (ComfyUI + models manifest + the live app + ImageLab). Pushing to
  `main` builds `ghcr.io/angelmankel/ygo-comfy:latest` via GitHub Actions (~10 min).
- Decks: `/home/donny/Downloads/GX Decks/*.ydk`. Card API: `https://cards.blueoceanswim.com/api/cards/<id>`
  (YGOPro bitfields: type&0x1 = monster; race/attribute are bitmasks).

## The live pod
- `2wkq26rkp2mgbe` — **B200, 180 GB, US-CA-2, $6.79/h**, on a **network volume** at `/workspace`.
- Auth: user `ygo`, password = `COMFY_LOCAL_TOKEN` in `ygo-art-studio/.env`. Traefik fronts it at
  `https://comfyui-ygo.blueoceanswim.com/` — the ip:port changes on every resume, so re-read it and repoint.
- URLs: `/` ComfyUI · `/lab/` ImageLab (nginx) · `/ygo/app/lab/` ImageLab (python, right MIME types) ·
  `/ygo/app/` Civitai browser + installer · `/ygo/logs/download.log` · `/ygo/logs/models-complete` marker.
- RunPod template `ygo-comfy` (id `efow3nf6e7`) deploys it from the UI. Storage must be added in the UI:
  network volume, mount `/workspace`.

## The recipe that works (`cardart-hires-illustrious`)
```
WAI plain (no lora/merge) base 40 steps → latent 1.25x → hires 45 steps @ denoise 0.6
  on personal merge + Hexus + Spicy Souls (equal thirds) + gx 0.6 + kagami 0.6 + retro 0
  → decode → 4x-AnimeSharp → resize 1600 → re-encode → detail 40 steps @ 0.25 (= ten real steps)
```
Vocabulary axes: `subject-form`, `background` (abstract | scene | none), `framing`, `camera`, `lighting`,
`palette`. 231 rendered images are at `~/Pictures/ygo-pod-2026-09-20/`.

## Facts that cost time to learn — do not relearn them
1. Comfy runs `steps × denoise`. "10 steps" typed literally runs two and does nothing.
2. A latent upscale destroys linework; enlarge in PIXELS through an anime upscaler, then add detail.
3. Setting a `negative` REPLACES a graph's baked-in negative. The realism ban lives in vocab `always`, weighted
   `(photorealistic, …:0.65)` — at 1.0 it flattened everything.
4. `camera: eye level` used to tag "straight-on" and produced mugshots; `three-quarter` / `hero angle` exist now.
   Left to itself the prompt model picks low/hero 70% of the time — deal cameras out by quota.
5. `background: scene` cannot invent a place. The subject line must NAME the place or you get the old gradient.
6. Seeds are fixed at 98 unless set. Anatomy must lead the prompt. Never say "official yugioh card artwork".
7. Civitai answers 403 to HEAD and to anonymous requests; a GET with `?token=` works. Sizes come from
   `Content-Range`, never from the API's sizeKB.
8. A graph's `last_link_id` can be stale — this one said 23 while links ran to 37. Number new links from the real
   maximum or you silently rewire a live input.
9. **Asking for a pod `volumeInGb` blocks Blackwell deploys.** Every B200/B300 attempt returned "no instances
   available" until the volume was dropped; the nodes have no local disk to give. Use a network/global volume.
10. nginx serves files as text/plain unless `mime.types` is included. Fixed in the image as of 23cc450.

## Rules
- Every retry is a NEW project. Never overwrite a render.
- Ask before spending GPU. The pod bills whether or not it is rendering — say so, and stop it when idle.
- Commit straight to main, all repos. No branches.

## Where it was left

The B200 `2wkq26rkp2mgbe` is **up and ready to render**. Address `38.80.152.146:30246` — that is
the Traefik target. All 58 models are on the network volume (`/ygo/logs/models-complete` is 200);
aria2 failed on this host and the curl fallback fetched every file. `app/` is pushed, and `/`,
`/lab/`, `/ygo/app/` and `/ygo/app/lab/` all answer 200 with the right MIME types.

`scratchpad/push.sh <ip:port>` and `scratchpad/bench.ts <ip:port> [twopass|threepass]` were lost
with the old session's temp directory and are rewritten here, in the repo this time.

The benchmark ran once (`twopass`, the graph the A100 did in 14.5 s) and the answer needs reading
carefully — see POD.md. Whole prompt 139.5 s, but sampling inside it was ~7 s per pass. The GPU is
doing A100-speed work and ~125 s went on loading four checkpoints and three LoRAs cold off the
network volume, with `comfy-aimdo` staging them for "dynamic VRAM loading" on a card that has
191 GB free and threw 89 `hostbuf_grow` errors doing it.

Still to do:
- A **warm** re-run of `bench.ts twopass`, which is the number that actually compares to 14.5 s.
  Not spent: the brief was one render.
- Work out whether `comfy-aimdo` can be turned off on a card this size. If the staging is the
  cost, a B200 at $6.79/h is being paid for an A100's throughput.
- Optional and worth it: make `models.txt` fetch the ~21 GB the card workflow needs FIRST and the
  other 40 GB after. On a slow host that is 20 minutes to first render instead of four hours.
- aria2 failed outright on this host. The curl fallback saved it, but find out why.
