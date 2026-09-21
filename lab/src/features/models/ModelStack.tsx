import { forwardRef, useMemo, type ButtonHTMLAttributes } from 'react';
import { useStore } from '@/lib/store';
import { modelPreviewUrl, modelPreviewUrls, modelBaseBucket } from '@/lib/modelHash';
import { viewUrl } from '@/lib/comfy';
import { useModelMetadataStore } from '@/features/model-metadata';
import { useResourceAvailability } from '@/hooks/useResourceAvailability';
import { ModelGroup } from './primitives';
import { CheckpointModel } from './kinds/CheckpointModel';
import { CheckpointMergeBox } from './kinds/CheckpointMergeBox';
import { VaeModel } from './kinds/VaeModel';
import { LoraModel } from './kinds/LoraModel';
import { ModelPicker } from './ModelPicker';
import { EditIcon } from '@/components/ui/icons';

/**
 * The Models section of the Parameters panel — composes the model kit into a
 * single checkpoint, an optional VAE override, and an ordered list of LoRAs.
 *
 * All three are backed by `workflow` (the real ComfyUI graph state), so changes
 * here flow straight into `buildGraph`. "+ Add / Change / Set" opens a
 * searchable <ModelPicker> popover sourced from the connected server's models.
 *
 * Clicking a card opens the CivitAI metadata modal — resolved via the model's
 * hash (`store.modelHashes` ← the ImageLab custom node). Card previews come
 * from the same hash → CivitAI lookup (`store.civitaiByHash`).
 */
export function ModelStack() {
  const workflow = useStore((s) => s.workflow);
  const server = useStore((s) => s.server);
  const setWorkflow = useStore((s) => s.setWorkflow);
  const addCheckpoint = useStore((s) => s.addCheckpoint);
  const removeCheckpoint = useStore((s) => s.removeCheckpoint);
  const updateCheckpoint = useStore((s) => s.updateCheckpoint);
  const addLora = useStore((s) => s.addLora);
  const updateLora = useStore((s) => s.updateLora);
  const modelHashes = useStore((s) => s.modelHashes);
  const civitaiByHash = useStore((s) => s.civitaiByHash);
  const openForFile = useModelMetadataStore((s) => s.openForFile);

  // Per-model availability for the current routing target — drives the
  // disabled-but-visible options in each picker.
  const checkpointAvail = useResourceAvailability('checkpoint');
  const vaeAvail = useResourceAvailability('vae');
  const loraAvail = useResourceAvailability('lora');

  const checkpoints = workflow.checkpoints;
  const previewUrl = (fileName: string) => modelPreviewUrl(modelHashes, civitaiByHash, fileName);
  // Resolvers passed into the pickers — kept lightweight; the popover memoises
  // the result so we don't refire these on every keystroke.
  const previewUrls = (fileName: string) => modelPreviewUrls(modelHashes, civitaiByHash, fileName);
  const baseBucket = (fileName: string) => modelBaseBucket(modelHashes, civitaiByHash, fileName);

  // Pre-compute a (fileName → [historyUrl…]) map keyed on the latest history +
  // server snapshot. Walking the entire history list once is dirt cheap, but
  // doing it inside an inline resolver for every option × every render is not.
  const history = useStore((s) => s.history);
  const servers = useStore((s) => s.servers);
  const historyByModel = useMemo(() => {
    const hosts = new Map(servers.map((sv) => [sv.id, sv.host]));
    const out = new Map<string, string[]>();
    // History is already newest-first; preserve that order in the per-model list.
    for (const e of history) {
      const host = hosts.get(e.serverId);
      if (!host || !e.filename) continue;
      const url = String(viewUrl(e, host));
      const push = (key: string) => {
        const list = out.get(key) ?? [];
        if (!list.includes(url)) list.push(url);
        out.set(key, list);
      };
      if (e.model) push(e.model);
      // LoRAs aren't on the entry directly — pull from the workflow snapshot.
      for (const l of e.workflow?.loras ?? []) if (l?.name) push(l.name);
    }
    return out;
  }, [history, servers]);
  const historyUrls = (fileName: string) => historyByModel.get(fileName) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <ModelGroup kind="checkpoint">
        <ModelGroup.Header
          count={checkpoints.length > 1 ? checkpoints.length : undefined}
          right={
            <ModelPicker
              kind="checkpoint"
              options={server.models}
              selected={checkpoints.map((c) => c.name)}
              onSelect={(name) => addCheckpoint(name)}
              triggerLabel="Add"
              availability={checkpointAvail}
              previewUrls={previewUrls}
              historyUrls={historyUrls}
              getBaseBucket={baseBucket}
            />
          }
        />
        {checkpoints.map((ckpt, i) => (
          <CheckpointModel
            key={ckpt.id}
            fileName={ckpt.name}
            isBase={i === 0}
            onRemove={() => removeCheckpoint(ckpt.id)}
            onOpen={() => openForFile(ckpt.id, ckpt.name)}
            previewUrl={previewUrl(ckpt.name)}
            editSlot={
              <ModelPicker
                kind="checkpoint"
                options={server.models}
                selected={checkpoints.map((c) => c.name)}
                onSelect={(name) => updateCheckpoint(ckpt.id, { name })}
                triggerLabel="Change"
                availability={checkpointAvail}
                previewUrls={previewUrls}
                historyUrls={historyUrls}
                getBaseBucket={baseBucket}
                side="right"
                align="start"
                renderTrigger={() => <EditTrigger label={`Change ${ckpt.name}`} />}
              />
            }
          />
        ))}
        {checkpoints.length === 0 && <ModelGroup.Empty>No checkpoint selected.</ModelGroup.Empty>}
        <CheckpointMergeBox />
      </ModelGroup>

      <ModelGroup kind="vae">
        <ModelGroup.Header
          right={
            <ModelPicker
              kind="vae"
              options={server.vaes}
              selected={workflow.vae ? [workflow.vae] : []}
              onSelect={(name) => setWorkflow({ vae: name })}
              triggerLabel="Set"
              availability={vaeAvail}
              previewUrls={previewUrls}
              historyUrls={historyUrls}
              getBaseBucket={baseBucket}
            />
          }
        />
        {workflow.vae ? (
          <VaeModel
            fileName={workflow.vae}
            onRemove={() => setWorkflow({ vae: '' })}
            onOpen={() => openForFile('vae', workflow.vae)}
            editSlot={
              <ModelPicker
                kind="vae"
                options={server.vaes}
                selected={[workflow.vae]}
                onSelect={(name) => setWorkflow({ vae: name })}
                triggerLabel="Change"
                availability={vaeAvail}
                previewUrls={previewUrls}
                historyUrls={historyUrls}
                getBaseBucket={baseBucket}
                side="right"
                align="start"
                renderTrigger={() => <EditTrigger label={`Change ${workflow.vae}`} />}
              />
            }
          />
        ) : (
          <ModelGroup.Empty>Using the checkpoint&apos;s built-in VAE.</ModelGroup.Empty>
        )}
      </ModelGroup>

      <ModelGroup kind="lora">
        <ModelGroup.Header
          count={workflow.loras.length}
          right={
            <ModelPicker
              kind="lora"
              options={server.loras}
              selected={workflow.loras.map((l) => l.name)}
              onSelect={(name) => addLora(name)}
              triggerLabel="Add"
              availability={loraAvail}
              previewUrls={previewUrls}
              historyUrls={historyUrls}
              getBaseBucket={baseBucket}
            />
          }
        />
        {workflow.loras.map((lora) => (
          <LoraModel
            key={lora.id}
            lora={lora}
            onOpen={() => openForFile(lora.id, lora.name)}
            previewUrl={previewUrl(lora.name)}
            editSlot={
              <ModelPicker
                kind="lora"
                options={server.loras}
                selected={workflow.loras.map((l) => l.name)}
                onSelect={(name) => updateLora(lora.id, { name })}
                triggerLabel="Change"
                availability={loraAvail}
                previewUrls={previewUrls}
                historyUrls={historyUrls}
                getBaseBucket={baseBucket}
                side="right"
                align="start"
                renderTrigger={() => <EditTrigger label={`Change ${lora.name}`} />}
              />
            }
          />
        ))}
        {workflow.loras.length === 0 && <ModelGroup.Empty>No LoRAs added.</ModelGroup.Empty>}
      </ModelGroup>
    </div>
  );
}

/**
 * Inline edit trigger rendered as the <ModelPicker> popover's `asChild`. Must
 * forward ref + spread props so Radix's Slot can merge its `onClick`/`ref`
 * onto the underlying <button> — without that the popover never opens.
 */
type EditTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string };

const EditTrigger = forwardRef<HTMLButtonElement, EditTriggerProps>(function EditTrigger(
  { label, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title="Change model"
      {...rest}
      className="flex h-6 w-6 items-center justify-center rounded text-fg-dim transition-colors hover:bg-bg-elev hover:text-fg-secondary"
    >
      <EditIcon size={12} />
    </button>
  );
});
