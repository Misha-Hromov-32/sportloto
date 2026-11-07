import { useCustom } from '@refinedev/core';

import { ASSISTANT_API, type AiFeature, type AssistantMode } from '@/pages/chat/remote';

const ALL_OFF: Record<AiFeature, boolean> = {
  chat: false,
  forms: false,
  search: false,
  premoderation: false,
  covers: false,
  profile: false,
  digest: false,
  bots: false,
  mcp: false,
};

/**
 * Что администратор включил в разделе «ИИ на сайте». Пока ответа нет и при сбое всё считается
 * выключенным: сайт работает обычными формами и поиском. `loaded` — ответ получен или запрос не удался.
 */
export function useAiFeatures() {
  const { result, query } = useCustom<AssistantMode>({
    url: ASSISTANT_API.config,
    method: 'get',
    queryOptions: { retry: false, staleTime: 30_000 },
  });
  const config = result.data as AssistantMode | undefined;
  return {
    features: config?.features ?? ALL_OFF,
    loaded: Boolean(config?.features) || query.isError,
  };
}

export function useAiFeature(feature: AiFeature): boolean {
  return useAiFeatures().features[feature];
}
