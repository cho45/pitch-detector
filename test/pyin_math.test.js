
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { PYINCore, PYINDetector } from '../lib/pyin.js';
import { YINTestUtils } from './utils.js';

describe('PYIN Mathematical Correctness Tests', () => {
    test('Voiced probability should be low for bad matches (no normalization bug check)', () => {
        // Create a signal that has troughs, but they are all "bad" (high CMNDF values)
        // For example, white noise often has CMNDF values near 1.0.
        // We will manually construct a CMNDF buffer.
        
        const cmndf = new Float32Array(1000).fill(1.0);
        // Add some local minima, but with high values (e.g., 0.6)
        cmndf[100] = 0.6;
        cmndf[99] = 0.61;
        cmndf[101] = 0.61;
        
        cmndf[200] = 0.7;
        cmndf[199] = 0.71;
        cmndf[201] = 0.71;
        
        const sampleRate = 44100;
        const candidates = PYINCore.extractMultipleCandidates(cmndf, sampleRate, 100, 40, 4000);
        
        // Calculate total voiced probability
        let totalVoicedProb = 0;
        for (const c of candidates) totalVoicedProb += c.probability;
        
        console.log(`Total voiced probability: ${totalVoicedProb}`);
        
        // With Beta(2, 18), the probability of threshold > 0.6 is very low.
        // P(Theta > 0.6) = (1-0.6)^18 * (1 + 18*0.6) = 0.4^18 * 11.8 
        // 0.4^18 is approx 6.8e-8.
        // So totalVoicedProb should be very small (e.g. < 0.01).
        
        // If it's normalized to 1, then this test will fail if we expect it to be low.
        assert(totalVoicedProb < 0.1, `Voiced probability should be low for bad matches. Got ${totalVoicedProb}`);
    });

    test('Candidates should favor fundamental over harmonics via threshold distribution', () => {
        // Fundamental at 200Hz (tau=220.5), harmonic at 400Hz (tau=110.25)
        const cmndf = new Float32Array(1000).fill(1.0);
        
        // Fundamental is deep (0.05)
        const tauF = 220;
        cmndf[tauF] = 0.05;
        cmndf[tauF-1] = 0.06;
        cmndf[tauF+1] = 0.06;
        
        // Harmonic is less deep (0.15)
        const tauH = 110;
        cmndf[tauH] = 0.15;
        cmndf[tauH-1] = 0.16;
        cmndf[tauH+1] = 0.16;
        
        const sampleRate = 44100;
        // nThresholds=1000 for better precision in this math test
        const candidates = PYINCore.extractMultipleCandidates(cmndf, sampleRate, 1000, 40, 4000);
        
        const candF = candidates.find(c => Math.abs(c.tau - tauF) < 1);
        const candH = candidates.find(c => Math.abs(c.tau - tauH) < 1);
        
        assert(candF, 'Fundamental candidate should exist');
        assert(candH, 'Harmonic candidate should exist');
        
        console.log(`Fundamental prob: ${candF.probability}, Harmonic prob: ${candH.probability}`);
        
        // In pYIN, the fundamental (deeper trough at larger tau) should eventually get 
        // more weight because it's below more thresholds in the Beta(2, 18) distribution.
        // Thresholds in [0.05, 0.15] only see the fundamental.
        // Thresholds in [0.15, 1.0] see both.
        // Beta(2, 18) has a lot of weight in [0.05, 0.15].
        
        assert(candF.probability > candH.probability, "Fundamental should be more probable than harmonic");
    });
});
