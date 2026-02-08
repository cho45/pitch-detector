/**
 * YIN Algorithm Test Suite for Node.js
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { YINCore, YINDetector, createYINDetector } from '../lib/yin.js';
import { PitchDetector } from '../lib/pitchy.js';
import { YINTestUtils } from './utils.js';

describe('YIN Algorithm Test Suite', () => {

    describe('Core Function Tests', () => {
        test('差分関数計算 - 440Hz正弦波', () => {
            const signal = YINTestUtils.generateSineWave(440, 44100, 0.1);
            const df = new Float32Array(signal.length);
            YINCore.calculateDifferenceFunction(signal, df);
            const expectedPeriod = Math.round(44100 / 440);

            // 期待周期付近での最小値を検索
            let minValue = Infinity;
            let minIndex = expectedPeriod;
            for (let i = expectedPeriod - 5; i <= expectedPeriod + 5; i++) {
                if (i > 0 && i < df.length && df[i] < minValue) {
                    minValue = df[i];
                    minIndex = i;
                }
            }

            const error = Math.abs(minIndex - expectedPeriod);
            assert(error <= 2, `期待周期: ${expectedPeriod}, 検出: ${minIndex}, 誤差: ${error}`);
        });

        test('CMNDF計算', () => {
            const signal = YINTestUtils.generateSineWave(440, 44100, 0.1);
            const df = new Float32Array(signal.length);
            YINCore.calculateDifferenceFunction(signal, df);
            const cmndf = new Float32Array(df.length);
            YINCore.calculateCMNDF(df, cmndf);

            assert.strictEqual(cmndf[0], 1, 'CMNDF[0] should be 1');
            assert.strictEqual(cmndf.length, df.length, 'CMNDF length mismatch');
            assert(cmndf.every(val => !isNaN(val) && isFinite(val)), 'CMNDF contains invalid values');
        });

        test('YINDetector統合テスト', () => {
            const detector = new YINDetector(44100, 1024);
            const signal = YINTestUtils.generateSineWave(440, 44100, 1024 / 44100);
            const [freq, clarity] = detector.findPitch(signal);

            const error = Math.abs(freq - 440) / 440 * 100;
            assert(error < 1.0, `Error too high: ${error.toFixed(2)}%`);
            assert(clarity > 0.9, `Clarity too low: ${clarity.toFixed(3)}`);
        });
    });

    describe('Accuracy Tests', () => {
        const testFrequencies = [82.41, 110, 220, 440, 880, 1760];
        testFrequencies.forEach(freq => {
            test(`精度テスト - ${freq}Hz`, () => {
                const detector = new YINDetector(44100, 2048);
                const signal = YINTestUtils.generateSineWave(freq, 44100, 2048 / 44100);
                const [detectedFreq, clarity] = detector.findPitch(signal);

                const error = Math.abs(detectedFreq - freq) / freq * 100;
                assert(error < 1.0, `期待: ${freq}Hz, 検出: ${detectedFreq.toFixed(1)}Hz, 誤差: ${error.toFixed(2)}%`);
            });
        });
    });

    describe('Pitchy Compatibility Tests', () => {
        test('PitchyライブラリとのAPI互換性', () => {
            const yinDetector = new YINDetector(44100, 1024);
            const pitchyDetector = PitchDetector.forFloat32Array(1024);
            const signal = YINTestUtils.generateSineWave(440, 44100, 1024 / 44100);

            const [yinFreq, yinClarity] = yinDetector.findPitch(signal);
            const [pitchyFreq, pitchyClarity] = pitchyDetector.findPitch(signal, 44100);

            const freqDiff = Math.abs(yinFreq - pitchyFreq);
            const bothDetected = yinFreq > 0 && pitchyFreq > 0;

            assert(bothDetected, 'Both detectors should find pitch');
            assert(freqDiff < 5, `YIN: ${yinFreq.toFixed(1)}Hz, Pitchy: ${pitchyFreq.toFixed(1)}Hz, 差: ${freqDiff.toFixed(1)}Hz`);
        });

        test('Factory API互換性', () => {
            const factory = createYINDetector(1024);
            const detector = factory.forFloat32Array(44100);
            const signal = YINTestUtils.generateSineWave(440, 44100, 1024 / 44100);

            const [freq, clarity] = detector.findPitch(signal, 44100);
            const error = Math.abs(freq - 440) / 440 * 100;

            assert(error < 1.0, `Factory API検出: ${freq.toFixed(1)}Hz, 誤差: ${error.toFixed(2)}%`);
        });
    });

    describe('Complex Signal Tests', () => {
        test('ハーモニクス信号テスト', () => {
            const detector = new YINDetector(44100, 2048);
            const fundamental = 220;
            const signal = YINTestUtils.generateHarmonicWave(
                fundamental, 44100, 2048 / 44100, [1.0, 0.5, 0.25]
            );

            const [freq, clarity] = detector.findPitch(signal);
            const error = Math.abs(freq - fundamental) / fundamental * 100;

            assert(error < 2.0, `基音: ${fundamental}Hz, 検出: ${freq.toFixed(1)}Hz, 誤差: ${error.toFixed(2)}%`);
        });

        test('ノイズ混入信号テスト', () => {
            const detector = new YINDetector(44100, 2048);
            const cleanSignal = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100);
            const noisySignal = YINTestUtils.addNoise(cleanSignal, 0.1);

            const [freq, clarity] = detector.findPitch(noisySignal);
            const error = Math.abs(freq - 440) / 440 * 100;

            assert(error < 3.0, `Not robust enough to noise. Error: ${error.toFixed(2)}%`);
            assert(clarity > 0.5, `Clarity too low under noise: ${clarity.toFixed(3)}`);
        });
    });

    describe('Performance Tests', () => {
        const bufferSizes = [512, 1024, 2048, 4096];

        bufferSizes.forEach(bufferSize => {
            test(`Performance for buffer size ${bufferSize}`, () => {
                const detector = new YINDetector(44100, bufferSize);
                const signal = YINTestUtils.generateSineWave(440, 44100, bufferSize / 44100);

                // ウォームアップ
                for (let i = 0; i < 10; i++) {
                    detector.findPitch(signal);
                }

                // 実際の測定
                const iterations = 100;
                const start = performance.now();
                for (let i = 0; i < iterations; i++) {
                    detector.findPitch(signal);
                }
                const end = performance.now();

                const avgTime = (end - start) / iterations;
                assert(avgTime < 50, `Too slow: ${avgTime.toFixed(2)}ms per call`);
            });
        });
    });
});
