import { useCustomMutation } from '@refinedev/core';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useAiFeature } from '@/lib/aiFeatures';
import { API } from '@/lib/api';
import { fromAssistant, writeFilters } from '@/pages/events/feed/filters';
import type { ParsedSearch } from '@/types/api';

/**
 * Поиск фразой вне ленты (лендинг, 404): помощник разбирает фразу на фильтры,
 * и человек попадает в ленту с уже выставленными фильтрами. Если помощник не ответил,
 * в ленту уходит сама фраза, а фильтры человек выберет там.
 */
export function usePhraseSearch() {
  const navigate = useNavigate();
  const searchOn = useAiFeature('search');
  const { mutateAsync, mutation } = useCustomMutation<ParsedSearch>();
  const [value, setValue] = useState('');

  const submit = async (text: string) => {
    const phrase = text.trim();
    if (!phrase) return;
    let params = new URLSearchParams();
    if (searchOn) {
      try {
        const res = await mutateAsync({
          url: API.assistantSearch,
          method: 'post',
          values: { text: phrase },
          successNotification: false,
          errorNotification: false,
        });
        params = writeFilters(params, fromAssistant(res.data.filters).filters);
      } catch {
        /* помощник недоступен: лента получит только фразу */
      }
    }
    params.set('phrase', phrase);
    navigate(`/events?${params.toString()}`);
  };

  return { value, setValue, submit, loading: mutation.isPending, smart: searchOn };
}
