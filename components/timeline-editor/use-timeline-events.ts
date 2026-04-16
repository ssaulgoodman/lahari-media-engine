import { useEffect } from 'react';
import { filter, subject } from '@designcombo/events';
import {
  LAYER_PREFIX,
  LAYER_SELECTION,
  PLAYER_PREFIX,
  PLAYER_PAUSE,
  PLAYER_PLAY,
  PLAYER_SEEK,
  PLAYER_SEEK_BY,
  PLAYER_TOGGLE_PLAY,
} from './events';
import useStore from './store';

const useTimelineEvents = () => {
  const { playerRef, fps, setState } = useStore();

  useEffect(() => {
    const sub = subject.pipe(filter(({ key }) => key.startsWith(PLAYER_PREFIX))).subscribe((obj) => {
      const p = playerRef?.current;
      if (!p) return;
      if (obj.key === PLAYER_SEEK) {
        p.seekTo(((obj.value?.payload.time ?? 0) / 1000) * fps);
      } else if (obj.key === PLAYER_PLAY) {
        p.play();
      } else if (obj.key === PLAYER_PAUSE) {
        p.pause();
      } else if (obj.key === PLAYER_TOGGLE_PLAY) {
        p.isPlaying() ? p.pause() : p.play();
      } else if (obj.key === PLAYER_SEEK_BY) {
        p.seekTo(Math.round(p.getCurrentFrame()) + (obj.value?.payload.frames ?? 0));
      }
    });
    return () => sub.unsubscribe();
  }, [playerRef, fps]);

  useEffect(() => {
    const sub = subject.pipe(filter(({ key }) => key.startsWith(LAYER_PREFIX))).subscribe((obj) => {
      if (obj.key === LAYER_SELECTION) {
        setState({ activeIds: obj.value?.payload.activeIds });
      }
    });
    return () => sub.unsubscribe();
  }, [setState]);
};

export default useTimelineEvents;
