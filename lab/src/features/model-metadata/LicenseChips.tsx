import { cn } from '@/lib/cn';
import type { CivitaiModel } from './civitai';
import { Section } from './Section';
import { CheckIcon, CloseIcon } from '@/components/ui/icons';

/** Civitai license flags rendered as allowed/denied chips. */
export function LicenseChips({ model }: { model: CivitaiModel }) {
  const commercialUse = model.allowCommercialUse ?? [];
  const perms: { label: string; allowed: boolean }[] = [
    {
      label: 'Commercial use',
      allowed: commercialUse.length > 0 && !commercialUse.includes('None'),
    },
    { label: 'No credit required', allowed: model.allowNoCredit },
    { label: 'Derivatives OK', allowed: model.allowDerivatives },
    { label: 'Different license OK', allowed: model.allowDifferentLicense },
  ];
  return (
    <Section label="License">
      <div className="flex flex-wrap gap-1.5">
        {perms.map((p) => (
          <span
            key={p.label}
            className={cn(
              'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
              p.allowed ? 'bg-vae-soft text-vae-fg' : 'bg-coral-bg text-coral-fg',
            )}
          >
            {p.allowed ? <CheckIcon size={12} /> : <CloseIcon size={12} />} {p.label}
          </span>
        ))}
      </div>
    </Section>
  );
}
