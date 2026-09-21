#!/usr/bin/env python3
"""The pod's own little web app: a model installer, and a file API so this app can rewrite itself.

It is deliberately stdlib-only. Anything pip-installed would live in the image, and the whole point of this
directory is that it changes without one. nginx already puts basic auth in front of every route, so there is no
auth here; keep it that way by never exposing this port publicly.
"""
import json, os, re, subprocess, threading, time, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP = Path(__file__).resolve().parent
MODELS = Path(os.environ.get("MODELS_DIR", "/workspace/ComfyUI/models"))
EXTRA = Path(os.environ.get("YGO_EXTRA_MANIFEST", "/workspace/models-extra.txt"))  # on the volume: survives a restart
COMFY = f"http://127.0.0.1:{os.environ.get('COMFY_PORT', '8189')}"
PORT = int(os.environ.get("YGO_APP_PORT", "8190"))
CIVITAI = os.environ.get("CIVITAI_API_KEY", "")

JOBS: dict[str, dict] = {}          # install id -> {state, log[], pct}
FOLDERS = ["checkpoints", "loras", "vae", "controlnet", "upscale_models", "embeddings", "clip_vision", "ipadapter"]


def civitai_version(vid: str) -> dict:
    # Civitai answers 403 to an anonymous or user-agent-less request, and 403 to HEAD on the file itself.
    # Both are normal; neither means the key is wrong.
    headers = {"User-Agent": "ygo-comfy"}
    if CIVITAI:
        headers["Authorization"] = f"Bearer {CIVITAI}"
    req = urllib.request.Request(f"https://civitai.com/api/v1/model-versions/{vid}", headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        v = json.load(r)
    f = next((x for x in v.get("files", []) if x.get("primary")), (v.get("files") or [None])[0]) or {}
    return {"version_id": vid, "model": v.get("model", {}).get("name", ""), "version": v.get("name", ""),
            "filename": f.get("name", ""), "size": int(float(f.get("sizeKB", 0)) * 1024),
            "base": v.get("baseModel", ""), "download": f.get("downloadUrl", "")}


def resolve(src: str) -> dict:
    """A civitai link, a bare version id, or any direct URL — all end up as one manifest row."""
    src = src.strip()
    m = re.search(r"modelVersionId=(\d+)", src) or re.search(r"model-versions/(\d+)", src)
    if m or src.isdigit():
        return civitai_version(m.group(1) if m else src)
    name = urllib.parse.unquote(src.rsplit("/", 1)[-1].split("?")[0])
    return {"version_id": "", "model": name, "version": "", "filename": name, "size": 0, "download": src}


def _aria(job: str, url: str, dest: Path, filename: str) -> bool:
    """aria2 when it is there: eight connections beats one every time."""
    j = JOBS[job]
    cmd = ["aria2c", url, "--dir", str(dest), "--out", filename, "--continue=true", "--allow-overwrite=true",
           "--auto-file-renaming=false", "--max-connection-per-server=8", "--split=8", "--min-split-size=8M",
           "--file-allocation=none", "--summary-interval=2", "--console-log-level=warn", "--show-console-readout=true",
           "--user-agent=Mozilla/5.0 (ygo-comfy)"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    for line in p.stdout:                                   # type: ignore[union-attr]
        line = line.strip()
        if not line:
            continue
        j["log"] = (j["log"] + [line])[-40:]
        m = re.search(r"\((\d+)%\)", line)
        if m:
            j["pct"] = int(m.group(1))
    return p.wait() == 0


def _stream(job: str, url: str, dest: Path, filename: str) -> bool:
    """No aria2 (a laptop, a stripped image): one plain connection, so a missing tool is slow, never fatal."""
    j = JOBS[job]
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (ygo-comfy)"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest / filename, "wb") as out:
        total = int(r.headers.get("Content-Length") or 0)
        got = 0
        while chunk := r.read(1 << 20):
            out.write(chunk)
            got += len(chunk)
            if total:
                j["pct"] = int(got * 100 / total)
    j["log"] = (j["log"] + [f"streamed {got} bytes"])[-40:]
    return True


def run_install(job: str, url: str, folder: str, filename: str, size: int, note: str) -> None:
    j = JOBS[job]
    try:
        dest = MODELS / folder
        dest.mkdir(parents=True, exist_ok=True)
        if url.startswith("https://civitai.com") and CIVITAI and "token=" not in url:
            url = f"{url}{'&' if '?' in url else '?'}token={CIVITAI}"
        j["state"] = "downloading"
        try:
            ok = _aria(job, url, dest, filename)
        except FileNotFoundError:
            j["log"] = j["log"] + ["aria2c not installed; falling back to a single connection"]
            ok = _stream(job, url, dest, filename)
        path = dest / filename
        if not (ok and path.exists() and path.stat().st_size > 0):
            j.update(state="error", log=j["log"] + ["download did not produce a file"])
            return
        real = path.stat().st_size
        row = f"{('civitai:' + j['version_id']) if j.get('version_id') else url.split('?')[0]}\t{folder}\t{filename}\t{real}"
        # The model is on disk and usable from here on. Recording it is bookkeeping, so a failure to write the
        # manifest is a warning on a finished job, never a failed install.
        try:
            prev = EXTRA.read_text() if EXTRA.exists() else "# added from /ygo/app - mirror these into ygo-comfy/models.txt\n"
            if row not in prev:
                EXTRA.parent.mkdir(parents=True, exist_ok=True)
                EXTRA.write_text(prev + row + "\n")
        except OSError as e:
            j["log"] = j["log"] + [f"installed, but could not write {EXTRA}: {e}"]
        j.update(state="done", pct=100, manifest=row, bytes=real)
        try:
            urllib.request.urlopen(f"{COMFY}/object_info", timeout=30)   # nudge comfy to re-read its folders
        except Exception:
            pass
    except Exception as e:
        # A thread that dies quietly leaves the page spinning at 0% for ever, which is the worst way to fail.
        j.update(state="error", log=(j.get("log") or []) + [f"{type(e).__name__}: {e}"])


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json")

    def log_message(self, *a) -> None:      # nginx already logs; this would only double it
        pass

    # ---- GET ---------------------------------------------------------------
    def do_GET(self) -> None:
        u = urllib.parse.urlparse(self.path)
        p = u.path[len("/ygo/app"):] if u.path.startswith("/ygo/app") else u.path
        q = urllib.parse.parse_qs(u.query)
        if p in ("", "/"):
            return self._send(200, (APP / "index.html").read_bytes(), "text/html; charset=utf-8")
        if p == "/api/state":
            return self._json(200, {"folders": FOLDERS, "models": self.inventory(), "jobs": JOBS,
                                    "extra": EXTRA.read_text().splitlines() if EXTRA.exists() else []})
        if p == "/api/resolve":
            try:
                return self._json(200, resolve(q.get("src", [""])[0]))
            except Exception as e:
                hint = " (no CIVITAI_API_KEY in the pod env?)" if "403" in str(e) and not CIVITAI else ""
                return self._json(400, {"error": f"{e}{hint}"})
        if p == "/api/files":                      # the file API: this app can be edited through itself
            rel = q.get("path", [""])[0]
            if rel:
                f = (APP / rel).resolve()
                if not str(f).startswith(str(APP)) or not f.is_file():
                    return self._json(404, {"error": "no such file"})
                return self._send(200, f.read_bytes(), "text/plain; charset=utf-8")
            return self._json(200, {"files": sorted(str(f.relative_to(APP)) for f in APP.rglob("*")
                                                    if f.is_file() and "__pycache__" not in str(f))})
        return self._json(404, {"error": "not found"})

    # ---- POST / PUT --------------------------------------------------------
    def do_POST(self) -> None:
        u = urllib.parse.urlparse(self.path)
        p = u.path[len("/ygo/app"):] if u.path.startswith("/ygo/app") else u.path
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        data = json.loads(body or b"{}")
        if p == "/api/install":
            info = resolve(data.get("src", ""))
            folder = data.get("folder") or "checkpoints"
            filename = data.get("filename") or info["filename"]
            if not filename:
                return self._json(400, {"error": "could not work out a filename"})
            job = str(int(time.time() * 1000))
            JOBS[job] = {"id": job, "state": "starting", "pct": 0, "log": [], "folder": folder,
                         "filename": filename, "version_id": info.get("version_id", ""), "name": info.get("model", "")}
            threading.Thread(target=run_install, daemon=True,
                             args=(job, info["download"] or data.get("src", ""), folder, filename,
                                   info.get("size", 0), data.get("note", ""))).start()
            return self._json(200, {"job": job})
        return self._json(404, {"error": "not found"})

    def do_PUT(self) -> None:
        u = urllib.parse.urlparse(self.path)
        p = u.path[len("/ygo/app"):] if u.path.startswith("/ygo/app") else u.path
        q = urllib.parse.parse_qs(u.query)
        if p == "/api/files":
            rel = q.get("path", [""])[0]
            if not rel:
                return self._json(400, {"error": "path required"})
            f = (APP / rel).resolve()
            if not str(f).startswith(str(APP)):
                return self._json(400, {"error": "outside the app directory"})
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)))
            return self._json(200, {"wrote": rel, "bytes": f.stat().st_size})
        return self._json(404, {"error": "not found"})

    def inventory(self) -> dict:
        out: dict[str, list] = {}
        for folder in FOLDERS:
            d = MODELS / folder
            if not d.is_dir():
                continue
            out[folder] = sorted(({"name": f.name, "bytes": f.stat().st_size}
                                  for f in d.iterdir() if f.is_file() and not f.name.endswith(".aria2")),
                                 key=lambda x: x["name"])
        return out


if __name__ == "__main__":
    print(f"[app] listening on 127.0.0.1:{PORT}, models at {MODELS}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
