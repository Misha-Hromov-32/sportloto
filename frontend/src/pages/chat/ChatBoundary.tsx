import { Component, type ReactNode } from 'react';

import { Button, ErrorState } from '@/components';

/** Сбой внутри чата не должен оставлять белый экран: показываем, что сделать, и даём начать заново. */
export class ChatBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ErrorState title="Чат не открылся">
        <p>Обычно помогает обновить страницу. Если не помогло, очистите историю чата в этом браузере.</p>
        <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Обновить страницу
          </Button>
          <Button variant="secondary" onClick={clearChatsAndReload}>
            Очистить историю чата
          </Button>
        </p>
      </ErrorState>
    );
  }
}

function clearChatsAndReload() {
  try {
    for (const store of [localStorage, sessionStorage])
      Object.keys(store)
        .filter((key) => key.startsWith('sportitochka.chat.'))
        .forEach((key) => store.removeItem(key));
  } catch {
    /* Хранилище может быть недоступно в приватном режиме. */
  }
  window.location.reload();
}
