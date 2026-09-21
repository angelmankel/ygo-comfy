import { useEffect, useState } from 'react';
import { useShortcut, ShortcutPriority } from './useShortcut';

export type MobilePanels = {
  leftOpen: boolean;
  rightOpen: boolean;
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
};

/**
 * Owns the left/right panel open state plus the mobile gestures that drive it:
 * edge-swipe to open / inward-swipe to close, ESC to close, and browser-back
 * treated as "close panel". Panels start open on desktop-width viewports.
 */
export function useMobilePanels(isDesktop: boolean): MobilePanels {
  const [leftOpen, setLeftOpen] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
  );
  const [rightOpen, setRightOpen] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
  );

  // ESC closes any open mobile panel. Drawer priority so it loses to
  // top-level overlays (Fullscreen viewer, Confirm dialog, Modal).
  useShortcut('Escape', () => {
    if (isDesktop) return;
    if (leftOpen) setLeftOpen(false);
    if (rightOpen) setRightOpen(false);
  }, { priority: ShortcutPriority.Drawer, when: () => !isDesktop && (leftOpen || rightOpen) });

  // Edge-swipe: drag from a screen edge to open, drag inward to close.
  useEffect(() => {
    if (isDesktop) return;
    let active: {
      startX: number; startY: number;
      mode: 'open-left' | 'open-right' | 'close-left' | 'close-right';
      committed: boolean;
    } | null = null;
    const EDGE = 28, THRESHOLD = 60, VERT_BAIL = 12;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const w = window.innerWidth;
      if (leftOpen) active = { startX: t.clientX, startY: t.clientY, mode: 'close-left', committed: false };
      else if (rightOpen) active = { startX: t.clientX, startY: t.clientY, mode: 'close-right', committed: false };
      else if (t.clientX < EDGE) active = { startX: t.clientX, startY: t.clientY, mode: 'open-left', committed: false };
      else if (t.clientX > w - EDGE) active = { startX: t.clientX, startY: t.clientY, mode: 'open-right', committed: false };
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const t = e.touches[0];
      const dx = t.clientX - active.startX;
      const dy = t.clientY - active.startY;
      if (!active.committed) {
        if (Math.abs(dy) > VERT_BAIL && Math.abs(dy) > Math.abs(dx)) { active = null; return; }
        if (Math.abs(dx) > 8) active.committed = true;
      }
      if (active.committed) e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      if (!active) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - active.startX;
      if (active.mode === 'open-left'   && dx >  THRESHOLD) setLeftOpen(true);
      else if (active.mode === 'open-right'  && dx < -THRESHOLD) setRightOpen(true);
      else if (active.mode === 'close-left'  && dx < -THRESHOLD) setLeftOpen(false);
      else if (active.mode === 'close-right' && dx >  THRESHOLD) setRightOpen(false);
      active = null;
    };
    const onCancel = () => { active = null; };

    document.addEventListener('touchstart',  onStart, { passive: true });
    document.addEventListener('touchmove',   onMove,  { passive: false });
    document.addEventListener('touchend',    onEnd);
    document.addEventListener('touchcancel', onCancel);
    return () => {
      document.removeEventListener('touchstart',  onStart);
      document.removeEventListener('touchmove',   onMove);
      document.removeEventListener('touchend',    onEnd);
      document.removeEventListener('touchcancel', onCancel);
    };
  }, [leftOpen, rightOpen, isDesktop]);

  // History guard: while a panel is open, treat browser back as "close panel".
  useEffect(() => {
    if (!leftOpen && !rightOpen) return;
    history.pushState({ panelOpen: true }, '');
    const onPop = () => { setLeftOpen(false); setRightOpen(false); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [leftOpen, rightOpen]);

  return { leftOpen, rightOpen, setLeftOpen, setRightOpen };
}
