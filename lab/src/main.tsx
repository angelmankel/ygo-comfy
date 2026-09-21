import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';

// Dev-only side-effect: attaches window.__exerciseCanvasStorage (gated inside the module).
import './lib/idbCanvasStorage';
// Dev-only side-effect: attaches window.__exerciseCanvasLayers (gated inside the module).
import './lib/canvasLayersExercise';

// THROW-AWAY: ticket #19 spike route. Delete this block + the import + web/src/spike/ to revert.
import PixiSpike from './spike/PixiSpike';
const isPixiSpike = new URLSearchParams(window.location.search).get('spike') === 'pixi';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPixiSpike ? <PixiSpike /> : <App />}
  </StrictMode>,
);
