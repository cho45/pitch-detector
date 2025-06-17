/**
 * Tests for statistics.js - Mathematical functions for pYIN implementation
 * Using Node.js built-in test framework
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { betaCdf, boltzmannPmf, generateThresholds, calculateBetaProbabilities } from '../lib/statistics.js';

/**
 * Helper function to check if two numbers are approximately equal
 * @param {number} actual - Actual value
 * @param {number} expected - Expected value
 * @param {number} tolerance - Tolerance for comparison (default: 1e-10)
 * @returns {boolean} True if values are within tolerance
 */
function assertApproxEqual(actual, expected, tolerance = 1e-8) {
    const diff = Math.abs(actual - expected);
    assert(diff <= tolerance, 
        `Expected ${actual} to be approximately ${expected}, difference: ${diff}, tolerance: ${tolerance}`);
}

describe('Gamma function (internal)', () => {
    // Note: gamma function is not exported, so we test it indirectly through betaCdf
    
    test('Gamma function properties via betaCdf', () => {
        // Test that betaCdf(0.5, 1, 1) = 0.5 (uniform distribution)
        const result = betaCdf(0.5, 1, 1);
        assertApproxEqual(result, 0.5, 1e-10);
    });
});

describe('Beta distribution CDF', () => {
    test('boundary conditions', () => {
        // CDF should be 0 at x=0
        assert.strictEqual(betaCdf(0, 2, 18), 0);
        assert.strictEqual(betaCdf(-0.1, 2, 18), 0);
        
        // CDF should be 1 at x=1
        assert.strictEqual(betaCdf(1, 2, 18), 1);
        assert.strictEqual(betaCdf(1.1, 2, 18), 1);
    });
    
    test('monotonicity property', () => {
        // CDF should be non-decreasing
        const values = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
        let prev = betaCdf(values[0], 2, 18);
        
        for (let i = 1; i < values.length; i++) {
            const current = betaCdf(values[i], 2, 18);
            assert(current >= prev, `CDF should be non-decreasing: ${current} >= ${prev}`);
            prev = current;
        }
    });
    
    test('Beta(2,18) closed form accuracy', () => {
        // Test the optimized closed form for Beta(2,18)
        // CDF(x) = 1 - (1-x)^18 * (1 + 17*x)
        const testPoints = [0.1, 0.2, 0.3, 0.5, 0.8];
        
        testPoints.forEach(x => {
            const actual = betaCdf(x, 2, 18);
            const oneMinusX = 1 - x;
            const expected = 1 - Math.pow(oneMinusX, 18) * (1 + 17 * x);
            assertApproxEqual(actual, expected, 1e-14);
        });
    });
    
    test('general Beta distribution properties', () => {
        // Test with different parameters using general incomplete beta function
        
        // Beta(1,1) is uniform distribution
        assertApproxEqual(betaCdf(0.5, 1, 1), 0.5, 1e-10);
        assertApproxEqual(betaCdf(0.25, 1, 1), 0.25, 1e-10);
        
        // Beta(2,1) has CDF(x) = x^2
        assertApproxEqual(betaCdf(0.5, 2, 1), 0.25, 1e-10);
        assertApproxEqual(betaCdf(0.8, 2, 1), 0.64, 1e-10);
        
        // Beta(1,2) has CDF(x) = 2x - x^2
        assertApproxEqual(betaCdf(0.5, 1, 2), 0.75, 1e-10);
    });
    
    test('numerical stability for extreme values', () => {
        // Test with very small and large parameter values
        const result1 = betaCdf(0.999, 2, 18);
        assert(result1 > 0.99 && result1 <= 1, 'Should handle values close to 1');
        
        const result2 = betaCdf(0.001, 2, 18);
        assert(result2 >= 0 && result2 < 0.01, 'Should handle values close to 0');
    });
});

describe('Boltzmann distribution PMF', () => {
    test('boundary conditions', () => {
        // PMF should be 0 for invalid indices
        assert.strictEqual(boltzmannPmf(-1, 2, 5), 0);
        assert.strictEqual(boltzmannPmf(5, 2, 5), 0);
        assert.strictEqual(boltzmannPmf(10, 2, 5), 0);
    });
    
    test('normalization property', () => {
        // Sum of PMF over all states should equal 1
        const a = 2;
        const n = 10;
        let sum = 0;
        
        for (let k = 0; k < n; k++) {
            sum += boltzmannPmf(k, a, n);
        }
        
        assertApproxEqual(sum, 1.0, 1e-14);
    });
    
    test('monotonicity property', () => {
        // PMF should be decreasing with increasing k (for a > 0)
        const a = 1.5;
        const n = 8;
        
        for (let k = 0; k < n - 1; k++) {
            const current = boltzmannPmf(k, a, n);
            const next = boltzmannPmf(k + 1, a, n);
            assert(current >= next, `PMF should be decreasing: P(${k}) = ${current} >= P(${k+1}) = ${next}`);
        }
    });
    
    test('known values for specific parameters', () => {
        // For a=0, distribution should be uniform
        const n = 5;
        const uniformProb = 1 / n;
        
        for (let k = 0; k < n; k++) {
            assertApproxEqual(boltzmannPmf(k, 0, n), uniformProb, 1e-14);
        }
    });
    
    test('first state probability formula', () => {
        // P(0) = 1 / sum(exp(-a*k) for k=0 to n-1)
        const a = 1.0;
        const n = 6;
        
        let denominator = 0;
        for (let k = 0; k < n; k++) {
            denominator += Math.exp(-a * k);
        }
        
        const expected = 1 / denominator;
        const actual = boltzmannPmf(0, a, n);
        
        assertApproxEqual(actual, expected, 1e-14);
    });
    
    test('parameter sensitivity', () => {
        // Higher 'a' should make distribution more concentrated on first states
        const n = 5;
        
        const prob_a1 = boltzmannPmf(0, 1, n);
        const prob_a3 = boltzmannPmf(0, 3, n);
        
        assert(prob_a3 > prob_a1, 'Higher a should increase probability of first state');
    });
});

describe('generateThresholds', () => {
    test('correct array size', () => {
        const nThresholds = 10;
        const thresholds = generateThresholds(nThresholds);
        
        assert.strictEqual(thresholds.length, nThresholds + 1);
        assert(thresholds instanceof Float32Array, 'Should return Float32Array');
    });
    
    test('correct range and values', () => {
        const nThresholds = 5;
        const thresholds = generateThresholds(nThresholds);
        
        // Should start at 0 and end at 1
        assert.strictEqual(thresholds[0], 0);
        assert.strictEqual(thresholds[nThresholds], 1);
        
        // Should be evenly spaced
        for (let i = 0; i <= nThresholds; i++) {
            assertApproxEqual(thresholds[i], i / nThresholds, 1e-6);
        }
    });
    
    test('monotonicity', () => {
        const thresholds = generateThresholds(20);
        
        for (let i = 1; i < thresholds.length; i++) {
            assert(thresholds[i] >= thresholds[i-1], 'Thresholds should be non-decreasing');
        }
    });
    
    test('edge cases', () => {
        // Single threshold
        const single = generateThresholds(1);
        assert.strictEqual(single.length, 2);
        assert.strictEqual(single[0], 0);
        assert.strictEqual(single[1], 1);
        
        // Zero thresholds
        const zero = generateThresholds(0);
        assert.strictEqual(zero.length, 1);
        assert.strictEqual(zero[0], 0);
    });
});

describe('calculateBetaProbabilities', () => {
    test('correct output size', () => {
        const thresholds = generateThresholds(10);
        const probs = calculateBetaProbabilities(thresholds, 2, 18);
        
        assert.strictEqual(probs.length, thresholds.length - 1);
        assert(probs instanceof Float32Array, 'Should return Float32Array');
    });
    
    test('probabilities sum to 1', () => {
        const thresholds = generateThresholds(100);
        const probs = calculateBetaProbabilities(thresholds, 2, 18);
        
        let sum = 0;
        for (let i = 0; i < probs.length; i++) {
            sum += probs[i];
        }
        
        assertApproxEqual(sum, 1.0, 1e-8);
    });
    
    test('all probabilities are non-negative', () => {
        const thresholds = generateThresholds(50);
        const probs = calculateBetaProbabilities(thresholds, 2, 18);
        
        for (let i = 0; i < probs.length; i++) {
            assert(probs[i] >= 0, `Probability at index ${i} should be non-negative: ${probs[i]}`);
        }
    });
    
    test('consistent with CDF differences', () => {
        const nThresholds = 20;
        const thresholds = generateThresholds(nThresholds);
        const probs = calculateBetaProbabilities(thresholds, 2, 18);
        
        // Manually calculate CDF differences
        for (let i = 0; i < probs.length; i++) {
            const cdf1 = betaCdf(thresholds[i], 2, 18);
            const cdf2 = betaCdf(thresholds[i + 1], 2, 18);
            const expectedProb = cdf2 - cdf1;
            
            assertApproxEqual(probs[i], expectedProb, 5e-8);
        }
    });
    
    test('different beta parameters', () => {
        const thresholds = generateThresholds(10);
        
        // Test with different Beta parameters
        const probs_2_18 = calculateBetaProbabilities(thresholds, 2, 18);
        const probs_1_1 = calculateBetaProbabilities(thresholds, 1, 1);
        
        // For uniform distribution (1,1), probabilities should be equal
        const uniformProb = 1 / probs_1_1.length;
        for (let i = 0; i < probs_1_1.length; i++) {
            assertApproxEqual(probs_1_1[i], uniformProb, 5e-8);
        }
        
        // Beta(2,18) should have different distribution
        assert(JSON.stringify(probs_2_18) !== JSON.stringify(probs_1_1), 
               'Different parameters should produce different distributions');
    });
});

describe('Integration tests', () => {
    test('pYIN workflow simulation', () => {
        // Simulate the typical pYIN workflow
        const nThresholds = 100;
        const thresholds = generateThresholds(nThresholds);
        const betaProbs = calculateBetaProbabilities(thresholds, 2, 18);
        
        // All components should work together
        assert.strictEqual(thresholds.length, nThresholds + 1);
        assert.strictEqual(betaProbs.length, nThresholds);
        
        // Test Boltzmann weights for typical scenario
        const nTroughs = 5;
        let boltzmannSum = 0;
        for (let i = 0; i < nTroughs; i++) {
            boltzmannSum += boltzmannPmf(i, 2, nTroughs);
        }
        assertApproxEqual(boltzmannSum, 1.0, 1e-14);
    });
    
    test('numerical stability under typical usage', () => {
        // Test with parameters typical for audio processing
        const largeN = 1000;
        const thresholds = generateThresholds(largeN);
        const probs = calculateBetaProbabilities(thresholds, 2, 18);
        
        // Should not have NaN or infinite values
        for (let i = 0; i < probs.length; i++) {
            assert(isFinite(probs[i]), `Probability at index ${i} should be finite: ${probs[i]}`);
            assert(!isNaN(probs[i]), `Probability at index ${i} should not be NaN: ${probs[i]}`);
        }
    });
});