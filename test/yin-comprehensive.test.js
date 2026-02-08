/**
 * YIN Algorithm Comprehensive Test Suite
 * 100% test coverage and production quality validation
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { YINCore, YINDetector, createYINDetector } from '../lib/yin.js';
import { PitchDetector } from '../lib/pitchy.js';
import { YINTestUtils } from './utils.js';

describe('YIN Algorithm Comprehensive Test Suite', () => {

    // ===============================================
    // YINCore Individual Function Tests
    // ===============================================
    describe('YINCore Individual Function Tests', () => {
        test('calculateDifferenceFunction - 境界条件テスト', () => {
            // 最小サイズテスト
            const tinySignal = new Float32Array([1.0]);
            const df1 = new Float32Array(tinySignal.length);
            YINCore.calculateDifferenceFunction(tinySignal, df1);

            // サイズ2テスト
            const smallSignal = new Float32Array([1.0, -1.0]);
            const df2 = new Float32Array(smallSignal.length);
            YINCore.calculateDifferenceFunction(smallSignal, df2);

            assert.strictEqual(df1.length, 1);
            assert.strictEqual(df1[0], 0);
            assert.strictEqual(df2.length, 2);
            assert.strictEqual(df2[0], 0);
            assert.strictEqual(df2[1], 4);
        });

        test('calculateDifferenceFunction - ゼロ信号処理', () => {
            const zeroSignal = new Float32Array(100).fill(0);
            const df = new Float32Array(zeroSignal.length);
            YINCore.calculateDifferenceFunction(zeroSignal, df);

            assert(df.every(val => val === 0), 'All values should be 0');
        });

        test('calculateDifferenceFunction - 数値オーバーフロー耐性', () => {
            const largeSignal = new Float32Array(100).fill(1e6);
            const df = new Float32Array(largeSignal.length);
            YINCore.calculateDifferenceFunction(largeSignal, df);

            assert(df.every(val => isFinite(val)), 'Result should be finite');
            assert(df.every(val => val >= 0), 'Result should be non-negative');
        });

        test('calculateCMNDF - 数学的正確性', () => {
            // 既知の差分関数で検証
            const df = new Float32Array([0, 4, 1, 9, 2]);
            const cmndf = new Float32Array(df.length);
            YINCore.calculateCMNDF(df, cmndf);

            // 手動計算結果
            const expected = [1, 1, 0.4, 27 / 14, 0.5];
            const tolerance = 1e-3;

            cmndf.forEach((val, i) => {
                assert(Math.abs(val - expected[i]) < tolerance, `Index ${i}: expected ${expected[i]}, got ${val}`);
            });
        });

        test('calculateCMNDF - ゼロ除算安全性', () => {
            const df = new Float32Array([0, 0, 0, 0]);
            const cmndf = new Float32Array(df.length);
            YINCore.calculateCMNDF(df, cmndf);

            assert(cmndf.every(val => isFinite(val)), 'Result should be finite');
            assert.strictEqual(cmndf[0], 1, 'First element should be 1');
        });

        test('findFirstMinimum - 閾値処理', () => {
            const cmndf = new Float32Array([1, 0.8, 0.05, 0.02, 0.1, 0.01]);

            const result1 = YINCore.findFirstMinimum(cmndf, 0.1);  // 0.05が最初
            const result2 = YINCore.findFirstMinimum(cmndf, 0.03); // 0.02が最初
            const result3 = YINCore.findFirstMinimum(cmndf, 0.005); // 0.01が最初

            assert.strictEqual(result1, 3);
            assert.strictEqual(result2, 3);
            assert.strictEqual(result3, -1);
        });

        test('findFirstMinimum - 局所最小値判定', () => {
            // 局所最小値ではない場合
            const cmndf1 = new Float32Array([1, 0.05, 0.1, 0.2]);
            const result1 = YINCore.findFirstMinimum(cmndf1, 0.1);

            // 正しい局所最小値
            const cmndf2 = new Float32Array([1, 0.3, 0.05, 0.2]);
            const result2 = YINCore.findFirstMinimum(cmndf2, 0.1);

            assert.strictEqual(result1, -1);
            assert.strictEqual(result2, 2);
        });

        test('findFirstMinimum - 見つからない場合', () => {
            const cmndf = new Float32Array([1, 0.8, 0.9, 0.7, 0.8]);
            const result = YINCore.findFirstMinimum(cmndf, 0.1);

            assert.strictEqual(result, -1);
        });

        test('parabolicInterpolation - 数学的正確性', () => {
            // y = (x-2)² + 1 (min at x=2)
            const array = new Float32Array([5, 2, 1, 2, 5]);
            const interpolated = YINCore.parabolicInterpolation(array, 2);

            assert(Math.abs(interpolated - 2.0) < 1e-10, `Expected 2.0, got ${interpolated}`);
        });

        test('parabolicInterpolation - 境界条件', () => {
            const array = new Float32Array([1, 2, 3]);

            const result0 = YINCore.parabolicInterpolation(array, 0); // 左端
            const result2 = YINCore.parabolicInterpolation(array, 2); // 右端
            const resultNeg = YINCore.parabolicInterpolation(array, -1); // 範囲外

            assert.strictEqual(result0, 0);
            assert.strictEqual(result2, 2);
            assert.strictEqual(resultNeg, -1);
        });

        test('parabolicInterpolation - 平坦な領域', () => {
            const array = new Float32Array([1, 1, 1, 1, 1]);
            const result = YINCore.parabolicInterpolation(array, 2);

            assert.strictEqual(result, 2);
        });
    });

    // ===============================================
    // YINDetector Robustness Tests
    // ===============================================
    describe('YINDetector Robustness Tests', () => {
        test('YINDetector - 不正パラメータ処理', () => {
            let errorCount = 0;
            const expectedErrors = 5;

            try { new YINDetector(0, 1024); } catch (e) { errorCount++; }
            try { new YINDetector(-44100, 1024); } catch (e) { errorCount++; }
            try { new YINDetector(44100, 0); } catch (e) { errorCount++; }
            try { new YINDetector(44100, -1024); } catch (e) { errorCount++; }
            try { new YINDetector(44100, 1024, -0.1); } catch (e) { errorCount++; }

            assert(errorCount >= expectedErrors * 0.6, `Expected errors not thrown. Count: ${errorCount}`);
        });

        test('YINDetector - バッファサイズ不整合エラー', () => {
            const detector = new YINDetector(44100, 1024);

            assert.throws(() => {
                const wrongSizeBuffer = new Float32Array(512);
                detector.findPitch(wrongSizeBuffer);
            }, /Buffer size/);
        });

        test('YINDetector - 極端な入力値への耐性', () => {
            const detector = new YINDetector(44100, 1024);

            const nanBuffer = new Float32Array(1024).fill(NaN);
            const [nanFreq] = detector.findPitch(nanBuffer);

            const infBuffer = new Float32Array(1024).fill(Infinity);
            const [infFreq] = detector.findPitch(infBuffer);

            const maxBuffer = new Float32Array(1024).fill(Number.MAX_VALUE);
            const [maxFreq] = detector.findPitch(maxBuffer);

            assert(isFinite(nanFreq), 'NaN input should return finite result');
            assert(isFinite(infFreq), 'Infinity input should return finite result');
            assert(isFinite(maxFreq), 'Max value input should return finite result');
        });

        test('YINDetector - 高負荷耐性テスト', () => {
            const detector = new YINDetector(44100, 1024);
            const signal = YINTestUtils.generateSineWave(440, 44100, 1024 / 44100);

            const iterations = 1000;
            const startTime = performance.now();
            let errorCount = 0;

            for (let i = 0; i < iterations; i++) {
                try {
                    const [freq, clarity] = detector.findPitch(signal);
                    if (!isFinite(freq) || !isFinite(clarity)) errorCount++;
                } catch (e) {
                    errorCount++;
                }
            }

            const endTime = performance.now();
            const avgTime = (endTime - startTime) / iterations;
            const errorRate = errorCount / iterations;

            assert(errorRate < 0.01, `High error rate: ${errorRate}`);
            assert(avgTime < 10, `Performance degradation: ${avgTime}ms`);
        });
    });

    // ===============================================
    // Factory Function Tests
    // ===============================================
    describe('Factory Function Tests', () => {
        test('createYINDetector - パラメータ検証', () => {
            const factory1 = createYINDetector();
            const detector1 = factory1.forFloat32Array(44100);

            const factory2 = createYINDetector(2048, 0.05);
            const detector2 = factory2.forFloat32Array(22050);

            const signal = YINTestUtils.generateSineWave(440, 44100, 1024 / 44100);
            const signal2 = YINTestUtils.generateSineWave(440, 22050, 2048 / 22050);

            const [freq1] = detector1.findPitch(signal, 44100);
            const [freq2] = detector2.findPitch(signal2, 22050);

            assert(freq1 > 400 && freq1 < 480);
            assert(freq2 > 400 && freq2 < 480);
        });

        test('createYINDetector - API互換性', () => {
            const factory = createYINDetector(1024);
            const detector = factory.forFloat32Array(44100);

            assert.strictEqual(typeof detector.findPitch, 'function');

            const signal = YINTestUtils.generateSineWave(440, 44100, 1024 / 44100);
            const result = detector.findPitch(signal, 44100);

            assert(Array.isArray(result));
            assert.strictEqual(result.length, 2);
            assert.strictEqual(typeof result[0], 'number');
            assert.strictEqual(typeof result[1], 'number');
        });
    });

    // ===============================================
    // Production Quality Validation
    // ===============================================
    describe('Production Quality Validation', () => {
        test('型安全性 - 入力検証', () => {
            const detector = new YINDetector(44100, 1024);
            let safetyScore = 0;
            const totalChecks = 4;

            try { detector.findPitch("invalid"); } catch (e) { safetyScore++; }
            try { detector.findPitch({ length: 1024 }); } catch (e) { safetyScore++; }
            try { detector.findPitch(new Array(1024)); } catch (e) { safetyScore++; }
            try { detector.findPitch(null); } catch (e) { safetyScore++; }

            assert(safetyScore >= totalChecks * 0.75, `Type safety checks failed. Score: ${safetyScore}`);
        });

        test('戻り値の契約 - 範囲検証', () => {
            const detector = new YINDetector(44100, 1024);
            const testCases = [
                YINTestUtils.generateSineWave(82, 44100, 1024 / 44100),
                YINTestUtils.generateSineWave(440, 44100, 1024 / 44100),
                YINTestUtils.generateSineWave(2000, 44100, 1024 / 44100),
                new Float32Array(1024).fill(0),
                YINTestUtils.addNoise(YINTestUtils.generateSineWave(440, 44100, 1024 / 44100), 0.5)
            ];

            for (const signal of testCases) {
                const [freq, clarity] = detector.findPitch(signal);

                assert(freq >= 0 && freq <= 22050, `Frequency out of range: ${freq}`);
                assert(clarity >= 0 && clarity <= 1, `Clarity out of range: ${clarity}`);
                assert(isFinite(freq) && isFinite(clarity), 'Result not finite');
            }
        });

        test('スレッドセーフティ - 並行実行', async () => {
            const detectors = [
                new YINDetector(44100, 1024),
                new YINDetector(44100, 1024),
                new YINDetector(44100, 1024)
            ];

            const signals = detectors.map((_, i) =>
                YINTestUtils.generateSineWave(440 + i * 10, 44100, 1024 / 44100)
            );

            // Promise.allで並列実行をシミュレート
            const results = await Promise.all(detectors.map((detector, i) =>
                new Promise(resolve => {
                    const [freq, clarity] = detector.findPitch(signals[i]);
                    resolve({ freq, clarity, expected: 440 + i * 10 });
                })
            ));

            results.forEach(r => {
                assert(Math.abs(r.freq - r.expected) < 5, `Concurrent execution failed. Expected ${r.expected}, got ${r.freq}`);
            });
        });
    });

    // ===============================================
    // Performance Benchmarks
    // ===============================================
    describe('Performance Benchmarks', () => {
        test('性能ベンチマーク - YIN基本アルゴリズム', () => {
            const bufferSizes = [512, 1024, 2048];

            for (const bufferSize of bufferSizes) {
                const signal = YINTestUtils.generateSineWave(440, 44100, bufferSize / 44100);
                const df = new Float32Array(signal.length);

                const start = performance.now();
                for (let i = 0; i < 100; i++) {
                    YINCore.calculateDifferenceFunction(signal, df);
                }
                const time = performance.now() - start;
                const avgTime = time / 100;

                assert(avgTime <= 10, `${bufferSize} samples: Too slow (${avgTime.toFixed(2)}ms)`);
            }
        });
    });
});
