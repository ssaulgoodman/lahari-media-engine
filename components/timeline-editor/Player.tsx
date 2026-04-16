import React, { useEffect, useRef } from 'react';
import { Player as RemotionPlayer, PlayerRef } from '@remotion/player';
import Composition from './Composition';
import useStore from './store';

const Player: React.FC = () => {
  const playerRef = useRef<PlayerRef>(null);
  const { setPlayerRef, duration, fps, size } = useStore();

  useEffect(() => {
    setPlayerRef(playerRef);
    return () => setPlayerRef(null);
  }, [setPlayerRef]);

  return (
    <RemotionPlayer
      ref={playerRef}
      component={Composition}
      durationInFrames={Math.max(1, Math.round((duration / 1000) * fps))}
      compositionWidth={size.width}
      compositionHeight={size.height}
      style={{ width: '100%', height: '100%' }}
      inputProps={{}}
      fps={fps}
      controls
      acknowledgeRemotionLicense
    />
  );
};

export default Player;
