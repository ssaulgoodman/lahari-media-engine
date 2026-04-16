import { CallbackListener, PlayerRef } from '@remotion/player';
import { useCallback, useSyncExternalStore } from 'react';

export const useCurrentPlayerFrame = (ref: React.RefObject<PlayerRef> | null) => {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const current = ref?.current;
      if (!current) return () => undefined;
      const updater: CallbackListener<'frameupdate'> = () => onStoreChange();
      current.addEventListener('frameupdate', updater);
      return () => current.removeEventListener('frameupdate', updater);
    },
    [ref],
  );
  return useSyncExternalStore<number>(
    subscribe,
    () => ref?.current?.getCurrentFrame() ?? 0,
    () => 0,
  );
};
