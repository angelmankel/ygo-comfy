# Where this came from

A full copy of `imagelab-gpu` (gitea.dev.blueoceanswim.com/donny/imagelab-gpu), taken on 2026-09-20 at commit
89359ca, to be the pod's own UI. It is a COPY, not a submodule and not a remote: changes here do not go back,
and changes there do not come here. The two are free to diverge, which is the point — this one only ever has to
work in one place, behind the pod's nginx, next to the GPU it drives.

Two changes from upstream, both about being served from a subpath on the pod instead of a host of its own:
- `vite.config.ts`: `base: '/lab/'`, and the build writes to `lab/dist` instead of the repo root.
- No `serve.py` and no docker-compose: nginx serves `dist` straight off the volume at /lab/, so the app shares
  an origin with ComfyUI and inherits the basic auth you already logged in with.
