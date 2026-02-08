
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { betaCdf } from '../lib/statistics.js';

describe('Mathematical Verifications', () => {
    test('Beta(2, 18) CDF Verification', () => {
        // We know CDF(x) = 1 - (1-x)^18 * (1 + 18x)
        // Let's check at x = 0.1
        const x = 0.1;
        const expected = 1 - Math.pow(0.9, 18) * (1 + 18 * 0.1);
        const actual = betaCdf(x, 2, 18);
        
        console.log(`x=0.1: Expected=${expected}, Actual=${actual}`);
        
        // Let's check x=0.05
        const x2 = 0.05;
        const expected2 = 1 - Math.pow(0.95, 18) * (1 + 18 * 0.05);
        const actual2 = betaCdf(x2, 2, 18);
        console.log(`x=0.05: Expected=${expected2}, Actual=${actual2}`);

        assert(Math.abs(actual - expected) < 1e-10, `Beta CDF at 0.1 mismatch: ${actual} vs ${expected}`);
    });
});
