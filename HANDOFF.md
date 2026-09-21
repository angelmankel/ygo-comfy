# Where things stand — 2026-09-21

**Start with `CLAUDE.md` in this repo.** It is the standing documentation: the rules, how to start
and stop a pod, how to push code to a running one, and the facts that cost time to learn. This
file is only what is true right now and what is still owed.

## The live pod

`aur3i91oqwwb2w` — **RTX 5090, 32 GB, secure US, $0.99/h**, at `74.2.96.53:12322`.

Fronted by Donny's Traefik at `https://comfyui-ygo.blueoceanswim.com/`. **The port changes on
every resume and he repoints it by hand** — a 502 on the domain while the direct `ip:port` answers
200 means only that.

All 62.2 GB of models are on a 100 GB pod-local volume: 5 checkpoints, 5 LoRAs, VAEs, upscalers.
A *stop* keeps them; a *terminate* does not.

Working end to end: ComfyUI, ImageLab at `/ygo/app/lab/`, and ImageLabCore answering
`/imagelab/hashes` (30 models indexed), `downloads`, `favorites` and `version`.

## What was built this session

- **ImageLabCore** — the custom node ImageLab has been calling since the first pod, which was
  never in the image. Every `/imagelab/*` route 404'd until now. Public at
  `github.com/angelmankel/ImageLabCore`, pinned in the Dockerfile, `CIVITAI_TOKEN` renamed to
  `CIVITAI_API_KEY` to match what everything else already uses.
- **Push to a running pod.** `scratchpad/push.sh` (app) and `scratchpad/push-node.sh` (node, ~15s
  including an in-place ComfyUI re-exec). Neither needs an image rebuild.
- **`scratchpad/pull-images.sh`** — pulls a pod's generations into
  `/mnt/games/images/runpod/MM-DD-YYYY/`. Run it before any terminate or resume.
- **Studio**, a second UI: loads any workflow saved in ComfyUI, exposes every parameter
  automatically, pins a few into a simple mode. Mobile-first, swipe panes, gamepad support.
- **One shared ComfyUI websocket**, live progress bars and live preview frames, image inputs.
- **ComfyUI caching** — it serves its bundle with `Cache-Control: no-store`, 14.7 MB re-downloaded
  every load. nginx overrides that for the hashed `/assets/` bundle, and the iframe is kept alive
  across view switches instead of rebuilt.
- **Parameter panel rework** — stacked rows with full-width sliders, typeable values, steppers,
  reset; collapsible sections that show their values in the header; a search over every control.
- A **latent vs image upscale** switch per pass, and a **plain resize** post-process module.

## Still owed

1. **`ygo-art-studio` and `ygo-art-pipeline` have an unpushed commit each** (their `CLAUDE.md`).
   They push to Gitea over SSH and this session had no key. One `git push origin HEAD` in each.
2. **Prompt layer QOL.** The parameter rework never reached the prompt layer cards — Donny asked
   for it and it is the obvious next piece.
3. **Rotate the GitHub token.** It sits in plaintext in `ygo-comfy/.git/config` as part of the
   remote URL, so any `git remote -v` prints it. `ImageLabCore`'s remote is already clean.
4. **Moonlight absolute mouse mode.** `Ctrl+Alt+Shift+M` fixes it per session; Donny wants it
   turned off permanently in Moonlight's settings for that host.
