/**
 * MPM Algorithm Test Suite for Node.js
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { MPMCore, MPMDetector, createMPMDetector } from '../lib/mpm.js';

// Helper functions (copied from original test or using utils if appropriate, 
// strictly keeping original logic for now)

function generateSineWave(frequency, sampleRate, duration) {
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(numSamples);
    const angularFrequency = 2 * Math.PI * frequency;

    for (let i = 0; i < numSamples; i++) {
        buffer[i] = Math.sin(angularFrequency * i / sampleRate);
    }

    return buffer;
}

function generateComplexSignal(fundamentalFreq, harmonics, sampleRate, duration) {
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
        let value = 0;
        for (let h = 0; h < harmonics.length; h++) {
            const freq = fundamentalFreq * (h + 1);
            const amplitude = harmonics[h];
            value += amplitude * Math.sin(2 * Math.PI * freq * i / sampleRate);
        }
        buffer[i] = value;
    }

    return buffer;
}

function assertAlmostEqual(actual, expected, tolerance = 0.001, message = '') {
    const diff = Math.abs(actual - expected);
    assert(diff <= tolerance,
        message || `Expected ${actual} to be close to ${expected} (tolerance: ${tolerance}, diff: ${diff})`);
}

describe('MPM Algorithm Test Suite', () => {

    describe('MPMCore functions', () => {
        test('calculateNSDF should handle zero signal', () => {
            const audioBuffer = new Float32Array(256);
            const nsdfBuffer = new Float32Array(256);

            MPMCore.calculateNSDF(audioBuffer, nsdfBuffer);

            for (let i = 0; i < nsdfBuffer.length; i++) {
                assert(nsdfBuffer[i] === 0 || isNaN(nsdfBuffer[i]),
                    `NSDF[${i}] should be 0 or NaN for zero signal, got ${nsdfBuffer[i]}`);
            }
        });

        test('calculateNSDF should produce normalized values', () => {
            const sampleRate = 44100;
            const signal = generateSineWave(440, sampleRate, 0.05);
            const nsdfBuffer = new Float32Array(signal.length);

            MPMCore.calculateNSDF(signal, nsdfBuffer);

            for (let i = 0; i < nsdfBuffer.length; i++) {
                if (!isNaN(nsdfBuffer[i])) {
                    assert(nsdfBuffer[i] >= -1.1 && nsdfBuffer[i] <= 1.1,
                        `NSDF[${i}] = ${nsdfBuffer[i]} is out of normalized range`);
                }
            }

            assertAlmostEqual(nsdfBuffer[0], 1.0, 0.01);
        });

        test('findPeaks should find peaks in NSDF', () => {
            const nsdf = new Float32Array(200);

            for (let i = 0; i < 200; i++) {
                nsdf[i] = Math.sin(i * 0.1) * Math.exp(-i * 0.01);
            }

            const peaks = MPMCore.findPeaks(nsdf);

            assert(peaks.length > 0, 'Should find at least one peak');

            for (const peak of peaks) {
                assert(peak > 0 && peak < nsdf.length - 1,
                    `Peak ${peak} should be within valid range`);
                assert(nsdf[peak] > nsdf[peak - 1] && nsdf[peak] >= nsdf[peak + 1],
                    `Peak at ${peak} should be a local maximum`);
            }
        });

        test('choosePeak should select appropriate peak', () => {
            const nsdf = new Float32Array(100);
            const peaks = [20, 40, 60];

            nsdf[20] = 0.8;
            nsdf[40] = 0.95;
            nsdf[60] = 0.7;

            let chosen = MPMCore.choosePeak(nsdf, peaks, 0.93);
            assert.strictEqual(chosen, 40, `Should choose highest peak (40), got ${chosen}`);

            chosen = MPMCore.choosePeak(nsdf, peaks, 0.75);
            assert.strictEqual(chosen, 20, `Should choose first peak above threshold (20), got ${chosen}`);
        });

        test('parabolicInterpolation should refine peak position', () => {
            const array = new Float32Array([0.5, 0.8, 0.9, 0.85, 0.6]);

            const refined = MPMCore.parabolicInterpolation(array, 2);

            assert(refined >= 1.5 && refined <= 2.5,
                `Refined position ${refined} should be near 2`);

            const symmetric = new Float32Array([0.5, 0.8, 0.5]);
            const refinedSym = MPMCore.parabolicInterpolation(symmetric, 1);
            assertAlmostEqual(refinedSym, 1, 0.01);
        });
    });

    describe('MPMDetector class', () => {
        test('MPMDetector constructor should validate inputs', () => {
            const detector = new MPMDetector(44100, 1024, 0.93);
            assert.strictEqual(detector.sampleRate, 44100);
            assert.strictEqual(detector.bufferSize, 1024);
            assert.strictEqual(detector.threshold, 0.93);

            assert.throws(() => new MPMDetector(-1, 1024), /positive/);
            assert.throws(() => new MPMDetector(44100, 0), /positive integer/);
            assert.throws(() => new MPMDetector(44100, 1024, 1.5), /between 0 and 1/);
        });

        test('MPMDetector should detect pure sine wave frequencies', () => {
            const sampleRate = 44100;
            const detector = new MPMDetector(sampleRate, 2048);

            const testFrequencies = [110, 220, 440, 880, 1760];

            for (const targetFreq of testFrequencies) {
                const signal = generateSineWave(targetFreq, sampleRate, 0.05);
                const buffer = signal.slice(0, 2048);

                const [frequency, clarity] = detector.findPitch(buffer);

                const error = Math.abs(frequency - targetFreq) / targetFreq;
                assert(error < 0.02,
                    `Frequency error too high for ${targetFreq}Hz: ${frequency}Hz (${(error * 100).toFixed(1)}%)`);

                assert(clarity > 0.9,
                    `Clarity should be high for pure sine wave at ${targetFreq}Hz, got ${clarity}`);
            }
        });

        test('MPMDetector should handle complex harmonic signals', () => {
            const sampleRate = 44100;
            const detector = new MPMDetector(sampleRate, 2048);

            const harmonicTests = [
                { fundamental: 220, harmonics: [1, 0.5, 0.3, 0.2] },
                { fundamental: 440, harmonics: [1, 0.7, 0.5] },
                { fundamental: 330, harmonics: [1, 0.3, 0.1, 0.1, 0.1] }
            ];

            for (const t of harmonicTests) {
                const signal = generateComplexSignal(
                    t.fundamental,
                    t.harmonics,
                    sampleRate,
                    0.05
                );
                const buffer = signal.slice(0, 2048);

                const [frequency, clarity] = detector.findPitch(buffer);

                const error = Math.abs(frequency - t.fundamental) / t.fundamental;
                assert(error < 0.03,
                    `Should detect fundamental ${t.fundamental}Hz, got ${frequency}Hz`);

                assert(clarity > 0.7,
                    `Clarity should be reasonable for harmonic signal, got ${clarity}`);
            }
        });

        test('MPMDetector should handle edge cases', () => {
            const sampleRate = 44100;
            const detector = new MPMDetector(sampleRate, 1024);

            const silence = new Float32Array(1024);
            let [frequency, clarity] = detector.findPitch(silence);
            assert.strictEqual(frequency, 0, 'Should return 0 frequency for silence');
            assert.strictEqual(clarity, 0, 'Should return 0 clarity for silence');

            const quiet = generateSineWave(440, sampleRate, 0.025);
            for (let i = 0; i < quiet.length; i++) {
                quiet[i] *= 0.0001;
            }
            [frequency, clarity] = detector.findPitch(quiet.slice(0, 1024));
            assert.strictEqual(frequency, 0, 'Should return 0 frequency for very quiet signal');

            const withNaN = generateSineWave(440, sampleRate, 0.025);
            withNaN[100] = NaN;
            [frequency, clarity] = detector.findPitch(withNaN.slice(0, 1024));
            assert.strictEqual(frequency, 0, 'Should return 0 frequency for signal with NaN');
        });

        test('MPMDetector should provide alternative API', () => {
            const sampleRate = 44100;
            const detector = new MPMDetector(sampleRate, 1024);
            const signal = generateSineWave(440, sampleRate, 0.025).slice(0, 1024);

            const result = detector.detectPitch(signal);

            assert.strictEqual(typeof result.frequency, 'number');
            assert.strictEqual(typeof result.confidence, 'number');
            assert.strictEqual(typeof result.tau, 'number');

            assertAlmostEqual(result.frequency, 440, 10);
            assert(result.confidence > 0.9);
            assertAlmostEqual(result.tau, sampleRate / result.frequency, 0.1);
        });
    });

    describe('Factory Function Tests', () => {
        test('createMPMDetector should create Pitchy-compatible detector', () => {
            const factory = createMPMDetector(1024, 0.93);
            assert.strictEqual(typeof factory.forFloat32Array, 'function');

            const detector = factory.forFloat32Array(44100);
            assert.strictEqual(typeof detector.findPitch, 'function');

            const signal = generateSineWave(440, 44100, 0.025).slice(0, 1024);
            const [frequency, clarity] = detector.findPitch(signal, 44100);

            assertAlmostEqual(frequency, 440, 10);
            assert(clarity > 0.9);
        });
    });

    describe('MPM vs YIN accuracy', () => {
        test('MPM should handle high frequencies better than typical pitch detectors', () => {
            const sampleRate = 44100;
            const detector = new MPMDetector(sampleRate, 2048);

            const highFreqs = [1500, 2000, 2500, 3000];

            for (const freq of highFreqs) {
                const signal = generateSineWave(freq, sampleRate, 0.05);
                const buffer = signal.slice(0, 2048);

                const [detectedFreq, clarity] = detector.findPitch(buffer);

                const error = Math.abs(detectedFreq - freq) / freq;
                assert(error < 0.05,
                    `High frequency error too high for ${freq}Hz: ${detectedFreq}Hz`);
            }
        });
    });
});
