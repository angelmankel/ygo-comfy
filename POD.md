# Live pod

| | |
|---|---|
| Pod id | `rq6z6e1djo9sbn` |
| GPU | NVIDIA GeForce RTX 5090 (32 GB), RunPod **community** cloud, location SK |
| Price | $0.69/h while running; volume storage is billed while the pod exists (also when stopped) |
| Image | `ghcr.io/angelmankel/ygo-comfy:latest` |
| Disks | 30 GB container, 80 GB volume on `/workspace` (models + input/output live there) |
| ComfyUI endpoint (TCP, the real one) | `http://87.197.126.165:40318` - plain HTTP, basic auth user `ygo`, password = `COMFY_LOCAL_TOKEN` in ygo-art-studio/.env |
| RunPod HTTP proxy | `https://rq6z6e1djo9sbn-8188.proxy.runpod.net` - **currently answers 404**: with `8188/http,8188/tcp` both requested, RunPod mapped the http side to a bogus private port. It goes through Cloudflare anyway, which drops long WebSocket connections, so do not rely on it. |
| Download log | `http://87.197.126.165:40318/ygo/logs/download.log` (same auth); `/ygo/logs/models-complete` exists once every model verified |

The user will front the TCP endpoint with their own Traefik at `comfyui-ygo.blueoceanswim.com`
(forward to `http://87.197.126.165:40318`, keep the basic auth or terminate it in Traefik and inject the header).

**The public IP:port changes on every resume/recreate** (it changed from :40364 to :40318 on the first
stop/resume). Read it again with:

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
  -d "{\"query\":\"mutation { podFindAndDeployOnDemand(input: { cloudType: COMMUNITY, gpuCount: 1, volumeInGb: 80, containerDiskInGb: 30, minVcpuCount: 4, minMemoryInGb: 16, gpuTypeId: \\\"NVIDIA GeForce RTX 5090\\\", name: \\\"ygo-comfy\\\", imageName: \\\"ghcr.io/angelmankel/ygo-comfy:latest\\\", dockerArgs: \\\"\\\", ports: \\\"8188/tcp\\\", volumeMountPath: \\\"/workspace\\\", env: [{ key: \\\"CIVITAI_API_KEY\\\", value: \\\"$CIVITAI_API_KEY\\\" }, { key: \\\"COMFY_AUTH_TOKEN\\\", value: \\\"$TOKEN\\\" }] }) { id costPerHr machine { gpuDisplayName } } }\"}"
```

Use `cloudType: SECURE` ($0.99/h) if community has no 5090. Model download on a fresh volume took about
2 minutes on this host (~19 GB). Then read the TCP port as above and update `.env`.

## Cost log

- 2026-09-06: first pod `8g18kc9zrqtbku` (old image, terminated) ~15 min + this pod from 22:12 UTC.
  Balance went $18.30 -> $17.91 by 22:35 UTC (~$0.39) with the pod still running.
