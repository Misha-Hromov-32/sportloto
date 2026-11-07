import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/onest/700.css';
import '@/theme/tokens.css';
import '@/theme/global.css';
import '@/theme/motion.css';
import '@/theme/midnight.css';
import '@/lib/dates';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app/App';

// После выкладки старая вкладка просит удалённые файлы разделов: перезагружаем её один раз.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('sportitochka.reloaded') === location.pathname) return;
    sessionStorage.setItem('sportitochka.reloaded', location.pathname);
  } catch {
    /* Без хранилища просто перезагружаем. */
  }
  event.preventDefault();
  location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
