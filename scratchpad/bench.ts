/**
 * Time one render of a card-art graph on a pod, so a new GPU can be compared to an old one.
 *
 *   node --experimental-strip-types scratchpad/bench.ts <ip:port> [twopass|threepass]
 *
 * `twopass` is the pre-5bfe440 cardart-hires-illustrious graph (base 40 -> latent 1.25x -> hires 45, one decode):
 * the shape the A100 ran in 14.5 s. `threepass` is the graph on main today (that, plus the pixel upscale and the
 * detail pass). Both run seed 98 and the graph's own baked widget values, so nothing but the hardware differs.
 *
 * It submits with plain fetch and polls /history: the benchmark should not depend on the app or the client
 * library, only on ComfyUI.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkflow, type Workflow } from "../../ygo-art-pipeline/src/workflow.ts";

const PIPELINE = join(import.meta.dirname, "..", "..", "ygo-art-pipeline");
const TWO_PASS_COMMIT = "2e74f30";                       // the last commit before the pixel upscale landed
const WF = "cardart-hires-illustrious";

const [hostport, which = "twopass"] = process.argv.slice(2);
if (!hostport) { console.error("usage: bench.ts <ip:port> [twopass|threepass]"); process.exit(1); }

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [join(PIPELINE, ".env"), join(import.meta.dirname, "..", "..", "ygo-art-studio", ".env")]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*(COMFY_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}
const E = env();
const AUTH = "Basic " + Buffer.from(`${E.COMFY_LOCAL_USER}:${E.COMFY_LOCAL_TOKEN}`).toString("base64");
const BASE = `http://${hostport}`;
const get = async (p: string) => {
  const r = await fetch(BASE + p, { headers: { Authorization: AUTH } });
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`);
  return r.json() as Promise<any>;
};

/** A throwaway workflow dir holding the chosen graph, so buildWorkflow can load it the normal way. */
function workflowDir(): Workflow {
  const manifest = JSON.parse(readFileSync(join(PIPELINE, "workflows", WF, "manifest.json"), "utf8"));
  const dir = mkdtempSync(join(tmpdir(), "bench-"));
  const graph = which === "twopass"
    ? execFileSync("git", ["show", `${TWO_PASS_COMMIT}:workflows/${WF}/graph.json`], { cwd: PIPELINE, maxBuffer: 1 << 28 }).toString()
    : readFileSync(join(PIPELINE, "workflows", WF, "graph.json"), "utf8");
  writeFileSync(join(dir, "graph.json"), graph);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return { ...manifest, dir } as Workflow;
}

const info = await get("/object_info");
const { graph } = buildWorkflow(workflowDir(), info, {}, {});
const samplers = Object.values(graph).filter((n: any) => n.class_type === "KSampler").length;

const started = Date.now();
const r = await fetch(`${BASE}/prompt`, {
  method: "POST",
  headers: { Authorization: AUTH, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: graph, client_id: "bench" }),
});
const body = await r.json();
if (!r.ok || !body.prompt_id) throw new Error(`submit failed: ${JSON.stringify(body).slice(0, 2000)}`);
console.log(`${which}: ${samplers} sampler pass(es), prompt ${body.prompt_id}`);

let queued = 0;
for (;;) {
  const h = await get(`/history/${body.prompt_id}`);
  const rec = h[body.prompt_id];
  if (rec?.status?.completed) {
    const wall = (Date.now() - started) / 1000;
    const msgs: any[] = rec.status.messages ?? [];
    const at = (k: string) => msgs.find((m) => m[0] === k)?.[1]?.timestamp;
    const exec = at("execution_start") && at("execution_success") ? (at("execution_success") - at("execution_start")) / 1000 : null;
    console.log(`wall ${wall.toFixed(1)}s` + (exec !== null ? `  execution ${exec.toFixed(1)}s  (queue ${(wall - exec).toFixed(1)}s)` : ""));
    for (const out of Object.values(rec.outputs ?? {}) as any[])
      for (const im of out.images ?? []) console.log(`  image ${im.filename}`);
    break;
  }
  if (rec?.status?.status_str === "error") throw new Error(JSON.stringify(rec.status.messages).slice(0, 3000));
  if (++queued % 10 === 0) process.stdout.write(".");
  await new Promise((s) => setTimeout(s, 1000));
}
