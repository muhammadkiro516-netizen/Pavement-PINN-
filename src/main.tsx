import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

const root = createRoot(document.getElementById('root')!);
const path = window.location.pathname.slice(import.meta.env.BASE_URL.length - 1) || "/";

// A v5 deployment opens the v5 app at the site root; the v4 pages stay on their own paths.
if (import.meta.env.VITE_V5_HOME === '1' && path === '/') {
  window.history.replaceState(null, '', `${import.meta.env.BASE_URL}v5/`);
}
const livePath = window.location.pathname.slice(import.meta.env.BASE_URL.length - 1);

// Each app loads only its own code, so v5 citizen pages stay light on a low-end phone.
if (/^\/(v5|tour|why|verify|v)(\/|$)/.test(livePath)) {
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
