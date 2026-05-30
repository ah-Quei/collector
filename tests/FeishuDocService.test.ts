import { describe, expect, it } from 'vitest';
import { selectTopLevelBlocksInOrder } from '../src/services/FeishuDocService.js';

describe('FeishuDocService markdown conversion', () => {
    it('preserves top-level block order from first_level_block_ids', () => {
        const blocks = [
            { block_id: 'block-2', children: [] },
            { block_id: 'block-4', children: [] },
            { block_id: 'block-1', children: [] },
            { block_id: 'block-3', children: [] },
        ];

        const ordered = selectTopLevelBlocksInOrder(blocks, ['block-1', 'block-2', 'block-3', 'block-4']);

        expect(ordered.map((block) => block.block_id)).toEqual(['block-1', 'block-2', 'block-3', 'block-4']);
    });
});
