import { useSyncExternalStore } from 'react';

import { cityStateKey, getSelectedCity, subscribeCity } from './cities';

/** Выбранный в шапке город; экран перерисуется и при смене города, и при обновлении списка городов. */
export function useSelectedCity() {
  useSyncExternalStore(subscribeCity, cityStateKey, () => 'krasnoyarsk|0');
  return getSelectedCity();
}

/** Список городов для выбора: перерисовывается, когда он пришёл с сервера. */
export function useCitiesRevision() {
  return useSyncExternalStore(subscribeCity, cityStateKey, () => 'krasnoyarsk|0');
}
