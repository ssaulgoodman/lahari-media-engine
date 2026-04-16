// Local event keys for the embedded timeline page. Mirrors the legacy
// @designcombo/events constants from the reference project; newer versions
// only export the dispatcher itself, not the key strings.
export const PLAYER_PREFIX = 'player';
export const PLAYER_PLAY = 'player:play';
export const PLAYER_PAUSE = 'player:pause';
export const PLAYER_TOGGLE_PLAY = 'player:togglePlay';
export const PLAYER_SEEK = 'player:seek';
export const PLAYER_SEEK_BY = 'player:seekBy';

export const LAYER_PREFIX = 'layer';
export const LAYER_SELECTION = 'layer:selection';

export const TIMELINE_PREFIX = 'timeline';
export const TIMELINE_BOUNDING_CHANGED = 'timeline:boundingChanged';
