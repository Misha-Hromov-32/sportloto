import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { Drawer } from 'antd';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { AssistantThinking } from '@/components';
import { AssistantGlyph } from '@/components/Assistant/AssistantGlyph';
import { ASSISTANT_NAME } from '@/pages/chat/name';
import styles from './ChatLauncher.module.css';

import { ChatBoundary } from '@/pages/chat/ChatBoundary';

const ChatPage = lazy(() => import('@/pages/chat/ChatPage'));

/** Вне раскладок: чат доступен также в админке, входе и служебных экранах. */
export function ChatLauncher() {
  const { pathname, search, hash, state } = useLocation();
  const navigate = useNavigate();
  const resumeWidget = state?.assistantWidget === true;
  useEffect(() => {
    if (!resumeWidget || /^\/assistant\/?$/.test(pathname)) return;
    const nextState = { ...state };
    delete nextState.assistantWidget;
    navigate(`${pathname}${search}${hash}`, { replace: true, state: nextState });
  }, [resumeWidget, pathname, search, hash, state, navigate]);
  const aboveActions = /^\/events\/[^/]+(?:\/(?:edit|manage))?$|^\/companions\/new$|^\/org\/new$/.test(
    pathname,
  );
  // На странице чата кнопка не нужна: чат уже открыт
  if (/^\/assistant\/?$/.test(pathname)) return null;
  if (pathname.startsWith('/pay/fake/')) return null; // тестовая страница банка: без кнопок сайта поверх оплаты
  return (
    <Launcher
      key={pathname}
      aboveActions={aboveActions}
      initialOpen={resumeWidget}
      returnTo={`${pathname}${search}${hash}`}
    />
  );
}

function Launcher({
  aboveActions,
  initialOpen,
  returnTo,
}: {
  aboveActions: boolean;
  initialOpen: boolean;
  returnTo: string;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      {!open && (
        <button
          className={styles.launcher}
          data-above-actions={aboveActions ? '' : undefined}
          aria-label={`Открыть чат: ${ASSISTANT_NAME}`}
          aria-expanded={false}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <AssistantGlyph size={30} className={styles.launcherMark} />
          <span className={styles.launcherLabel} aria-hidden="true">
            {ASSISTANT_NAME}
          </span>
        </button>
      )}
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={
          <div className={styles.drawerHeading}>
            <span>
              <AssistantGlyph size={34} />
            </span>
            <strong>{ASSISTANT_NAME}</strong>
          </div>
        }
        placement="right"
        width={460}
        rootClassName={styles.drawer}
        destroyOnHidden
        extra={
          <Link
            to="/assistant"
            state={{ assistantReturnTo: returnTo }}
            aria-label="Открыть чат на всю страницу"
            title="На всю страницу"
          >
            <ArrowSquareOutIcon size={21} />
          </Link>
        }
      >
        <Suspense fallback={<AssistantThinking text="Открываем чат…" />}>
          <ChatBoundary>
            <ChatPage compact />
          </ChatBoundary>
        </Suspense>
      </Drawer>
    </>
  );
}
