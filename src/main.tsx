import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

const root = createRoot(document.getElementById('root')!);
const path = window.location.pathname.slice(import.meta.env.BASE_URL.length - 1);

// Each app loads only its own code, so v5 citizen pages stay light on a low-end phone.
if (/^\/v5(\/|$)/.test(path)) {
  import('./v5/V5App').then(({default: V5App}) => {
    root.render(
      <StrictMode>
        <V5App />
      </StrictMode>,
    );
  });
} else {
  Promise.all([import('./app/App.tsx'), import('leaflet/dist/leaflet.css'), import('./styles/index.css')]).then(([{default: App}]) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
