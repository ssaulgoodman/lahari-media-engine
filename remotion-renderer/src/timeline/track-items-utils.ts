// 1:1 port of reference: src/features/editor/utils/track-items.ts
import { ITrackItem, ITransition } from '@designcombo/types';

type ITrackItemsMap = Record<string, ITrackItem>;
type GroupElement = ITrackItem | ITransition;

export const groupTrackItems = (data: {
  trackItemIds: string[];
  transitionsMap: Record<string, ITransition>;
  trackItemsMap: ITrackItemsMap;
}): GroupElement[][] => {
  const { trackItemIds, transitionsMap, trackItemsMap } = data;

  // Map items → their transitions
  const itemTransitionMap = new Map<string, ITransition[]>();

  Object.values(transitionsMap).forEach((transition) => {
    const { fromId, toId, kind } = transition;
    if (kind === 'none') return;
    if (!itemTransitionMap.has(fromId)) itemTransitionMap.set(fromId, []);
    if (!itemTransitionMap.has(toId)) itemTransitionMap.set(toId, []);
    itemTransitionMap.get(fromId)?.push(transition);
    itemTransitionMap.get(toId)?.push(transition);
  });

  const groups: GroupElement[][] = [];
  const processed = new Set<string>();

  const buildGroup = (startItemId: string): GroupElement[] => {
    const group: GroupElement[] = [];
    let currentId = startItemId;

    while (currentId) {
      if (processed.has(currentId)) break;
      processed.add(currentId);
      const currentItem = trackItemsMap[currentId];
      if (!currentItem) break;
      group.push(currentItem);

      const transition = Object.values(transitionsMap).find(
        (t) => t.fromId === currentId && t.kind !== 'none',
      );
      if (!transition) break;

      group.push(transition);
      currentId = transition.toId;
    }

    return group;
  };

  for (const itemId of trackItemIds) {
    if (processed.has(itemId)) continue;

    if (
      !itemTransitionMap.has(itemId) ||
      !Object.values(transitionsMap).some((t) => t.toId === itemId)
    ) {
      const group = buildGroup(itemId);
      if (group.length > 0) {
        groups.push(group);
      }
    }
  }

  // Sort items within each group by display.from
  groups.forEach((group) => {
    group.sort((a, b) => {
      if ('display' in a && 'display' in b) {
        return a.display.from - b.display.from;
      }
      return 0;
    });
  });

  return groups;
};
