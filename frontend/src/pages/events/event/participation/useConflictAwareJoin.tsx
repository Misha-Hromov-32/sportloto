import { App } from 'antd';
import { useCallback } from 'react';

import { API, errorMessage } from '@/lib/api';
import type { EventDetails, TimeConflictError } from '@/types/api';

import { ConflictList } from './ConflictList';

type Run = (
  url: string,
  payload?: Record<string, unknown>,
  opts?: { silent?: boolean; success?: string },
) => Promise<unknown>;

function isTimeConflict(error: unknown): error is TimeConflictError {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'time_conflict');
}

/**
 * С9: запись с проверкой пересечений. Сначала спрашиваем «сервер», не занято ли это время;
 * если занято — человек сам решает: «Всё равно записаться» или «Отмена».
 * Возвращает карточку после записи или null, если человек передумал.
 */
export function useConflictAwareJoin(run: Run) {
  const { modal, message } = App.useApp();

  return useCallback(
    async (eventId: string, payload: Record<string, unknown> = {}): Promise<EventDetails | null> => {
      try {
        return (await run(
          API.joinEvent(eventId),
          { ...payload, checkConflicts: true },
          { silent: true },
        )) as EventDetails;
      } catch (error) {
        if (!isTimeConflict(error)) {
          message.error(errorMessage(error));
          throw error;
        }
        return new Promise<EventDetails | null>((resolve, reject) => {
          modal.confirm({
            title: 'В это время у вас другое занятие',
            icon: null,
            content: <ConflictList conflicts={error.conflicts} />,
            okText: 'Всё равно записаться',
            cancelText: 'Отмена',
            onOk: async () => {
              try {
                resolve((await run(API.joinEvent(eventId), payload)) as EventDetails);
              } catch (retryError) {
                reject(retryError);
              }
            },
            onCancel: () => resolve(null),
          });
        });
      }
    },
    [run, modal, message],
  );
}
