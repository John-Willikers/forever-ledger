import { describe, expect, it } from 'vitest';
import { withWowheadLinks, wowheadUrl } from '../src/knowledge/links.js';

describe('Wowhead links', () => {
  it('builds Forever page URLs from ids, and none for ids without a page', () => {
    expect(wowheadUrl('item', 7973)).toBe('https://www.wowhead.com/forever/item=7973');
    expect(wowheadUrl('npc', 4275)).toBe('https://www.wowhead.com/forever/npc=4275');
    expect(wowheadUrl('object', 0)).toBeNull(); // fishing is "object 0" in our data
    expect(wowheadUrl('zone', 1446)).toBeNull();
    expect(wowheadUrl('item', '7973')).toBeNull();
  });

  it('adds links beside ids everywhere in an answer, never changing what was there', () => {
    const answer = {
      entity: { type: 'item', id: 7973, name: 'Big-mouth Clam' },
      firstParty: {
        drops: [{ npcId: 4275, npcName: 'Archmage Arugal', dropped: 1 }],
        questRewards: [{ questId: 91001, title: 'Clear the Bayou' }],
        containers: [{ containerId: 5523, name: 'Small Barnacled Clam' }],
        nodes: [{ objectId: 0, name: 'Fishing' }],
      },
      facts: [
        {
          entity: { type: 'item', id: 7971, name: 'Black Pearl' },
          value: { id: 2505, type: 'npc', name: 'Saltwater Snapjaw' },
          source: { site: 'wowhead.com', url: 'https://www.wowhead.com/classic/item=7971' },
        },
      ],
      zone: { type: 'zone', id: 1446, name: 'Tanaris' },
      at: new Date(0),
    };
    const linked = withWowheadLinks(answer);
    expect(linked.entity).toMatchObject({ url: 'https://www.wowhead.com/forever/item=7973' });
    expect(linked.firstParty.drops[0]).toMatchObject({
      npcName: 'Archmage Arugal',
      npcUrl: 'https://www.wowhead.com/forever/npc=4275',
    });
    expect(linked.firstParty.questRewards[0]).toMatchObject({
      questUrl: 'https://www.wowhead.com/forever/quest=91001',
    });
    expect(linked.firstParty.containers[0]).toMatchObject({
      containerUrl: 'https://www.wowhead.com/forever/item=5523',
    });
    expect(linked.firstParty.nodes[0]).not.toHaveProperty('objectUrl');
    expect(linked.facts[0]!.value).toMatchObject({
      url: 'https://www.wowhead.com/forever/npc=2505',
    });
    // The source keeps its own URL (the page the claim came from).
    expect(linked.facts[0]!.source.url).toBe('https://www.wowhead.com/classic/item=7971');
    expect(linked.zone).not.toHaveProperty('url');
    expect(linked.at).toBeInstanceOf(Date);
    expect(answer.entity).not.toHaveProperty('url'); // a copy
  });
});
