/**
 * PYIN Algorithm Test Suite for Node.js
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { PYINDetector, PYINCore } from '../lib/pyin.js';
import { YINTestUtils } from './utils.js';

describe('PYIN Algorithm Test Suite', () => {

    describe('Core Function Tests', () => {
        test('ピッチ状態生成テスト', () => {
            const states = PYINCore.createPitchStates(80, 800, 5);

            const hasUnvoiced = states.some(s => !s.voiced);
            const hasVoiced = states.some(s => s.voiced);
            const freqRange = states.filter(s => s.voiced);
            const minFreq = Math.min(...freqRange.map(s => s.frequency));
            const maxFreq = Math.max(...freqRange.map(s => s.frequency));

            assert(hasUnvoiced, 'Should include unvoiced state');
            assert(hasVoiced, 'Should include voiced state');
            assert(minFreq >= 70 && maxFreq <= 850, `Frequency range mismatch: ${minFreq}-${maxFreq}`);
        });

        test('複数閾値候補抽出テスト', () => {
            const signal = YINTestUtils.generateSineWave(220, 44100, 0.1);
            const df = new Float32Array(signal.length);
            const cmndf = new Float32Array(signal.length);
            PYINCore.calculateDifferenceFunction(signal, df);
            PYINCore.calculateCMNDF(df, cmndf);
            const candidates = PYINCore.extractMultipleCandidates(cmndf, 44100);

            const expectedFreq = 220;
            const hasExpectedCandidate = candidates.some(c => Math.abs(c.frequency - expectedFreq) <= 5);

            assert(candidates.length > 0, 'No candidates found');
            assert(hasExpectedCandidate, 'Expected frequency not found among candidates');
        });

        test('遷移確率行列生成テスト', () => {
            const states = PYINCore.createPitchStates(80, 400, 3);
            const transitions = PYINCore.calculateTransitionProbabilities(states);

            const rowSums = transitions.map(row => row.reduce((sum, p) => sum + p, 0));
            assert(rowSums.every(sum => Math.abs(sum - 1.0) < 0.01), 'Row sums should be ~1');

            const selfTransitions = transitions.map((row, i) => row[i]);
            const avgSelfTransition = selfTransitions.reduce((sum, p) => sum + p, 0) / selfTransitions.length;

            assert(avgSelfTransition > 0.98, `Self transition probability too low: ${avgSelfTransition}`);
        });

        test('観測確率計算テスト', () => {
            const states = PYINCore.createPitchStates(200, 600, 3);
            const observations = [
                [{ frequency: 440, probability: 0.8 }, { frequency: 880, probability: 0.2 }],
                [{ frequency: 441, probability: 0.9 }],
                []  // 無音フレーム
            ];

            const obsProb = PYINCore.calculateObservationProbabilities(states, observations);

            assert.strictEqual(obsProb.length, 3);
            assert.strictEqual(obsProb[0].length, states.length);

            const unvoicedStateIndex = states.findIndex(s => !s.voiced);
            const unvoicedProbForSilence = obsProb[2][unvoicedStateIndex];

            assert(unvoicedProbForSilence > 0.8, `Silence should favor unvoiced state. Got ${unvoicedProbForSilence}`);
        });

        test('ビタビアルゴリズムテスト', () => {
            const states = PYINCore.createPitchStates(200, 600, 2);
            const transitions = PYINCore.calculateTransitionProbabilities(states);
            const observations = [
                [{ frequency: 440, probability: 1.0 }],
                [{ frequency: 440, probability: 1.0 }],
                [{ frequency: 441, probability: 1.0 }]
            ];

            const obsProb = PYINCore.calculateObservationProbabilities(states, observations);
            const { viterbi, path } = PYINCore.viterbiAlgorithm(states, transitions, observations, obsProb);
            const pitchTrack = PYINCore.tracebackPath(viterbi, path, states);

            assert.strictEqual(pitchTrack.length, observations.length);
            const averageFreq = pitchTrack.filter(p => p.voiced).reduce((sum, p) => sum + p.frequency, 0) /
                pitchTrack.filter(p => p.voiced).length;

            assert(Math.abs(averageFreq - 440) < 10, `Average freq mismatch: ${averageFreq}`);
        });
    });

    describe('Integration Tests', () => {
        test('PYIN単一フレーム検出テスト（正弦波）', () => {
            const detector = new PYINDetector(44100, 2048);
            const signal = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100);

            const [frequency, confidence] = detector.findPitch(signal);
            const error = Math.abs(frequency - 440);

            assert(error < 5, `Error too high: ${error}Hz`);
        });

        test('PYIN無声（ノイズ）入力テスト', () => {
            const detector = new PYINDetector(44100, 2048);
            const noisySignal = YINTestUtils.addNoise(new Float32Array(2048), 1.0);

            const [frequency, confidence] = detector.findPitch(noisySignal);

            assert.strictEqual(frequency, 0);
            assert.strictEqual(confidence, 0);
        });

        test('PYINオクターブエラーテスト（矩形波）', () => {
            const detector = new PYINDetector(44100, 2048, 80, 1000);
            const signal = YINTestUtils.generateSquareWave(220, 44100, 2048 / 44100);

            const [frequency, confidence] = detector.findPitch(signal);
            const error = Math.abs(frequency - 220);
            const isOctaveError = Math.abs(frequency - 440) < 10 || Math.abs(frequency - 660) < 15;

            assert(error < 10, `Frequency error: ${error}Hz`);
            assert(!isOctaveError, 'Octave error detected');
        });

        test('PYIN複数フレーム検出テスト（HMM使用）', () => {
            const detector = new PYINDetector(44100, 2048);
            const frames = [
                YINTestUtils.generateSineWave(440, 44100, 2048 / 44100),
                YINTestUtils.generateSineWave(440, 44100, 2048 / 44100),
                YINTestUtils.generateSineWave(440, 44100, 2048 / 44100)
            ];

            const pitchTrack = detector.detectPitch(frames);
            const frequencies = pitchTrack.map(p => p.frequency);

            const allVoiced = pitchTrack.every(p => p.voiced);
            const errors = frequencies.map(freq =>
                freq > 0 ? Math.abs(freq - 440) / 440 * 100 : 100
            );
            const avgError = errors.reduce((sum, err) => sum + err, 0) / errors.length;

            assert(avgError < 5, `Average error too high: ${avgError}%`);
            assert(allVoiced, 'Should be all voiced');
        });

        test('PYINノイズ耐性テスト', () => {
            const detector = new PYINDetector(44100, 2048);
            const cleanSignal = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100);
            const noisySignal = YINTestUtils.addNoise(cleanSignal, 0.2);

            const [frequency, confidence] = detector.findPitch(noisySignal);
            const error = Math.abs(frequency - 440);

            assert(error < 10, `Noise resistance failed. Error: ${error}Hz`);
        });
    });

    describe('Stream Processing Tests (Stateful HMM)', () => {
        test('HMM状態引き継ぎテスト', () => {
            const detector = new PYINDetector(44100, 2048);
            const frame = YINTestUtils.generateSineWave(330, 44100, 2048 / 44100);
            const results = [];
            for (let i = 0; i < 5; i++) {
                results.push(detector.findPitch(frame));
            }
            const frequencies = results.map(r => r[0]);

            assert(frequencies.every(f => Math.abs(f - 330) < 10),
                `Inconsistent frequencies: ${frequencies.join(', ')}`);
        });

        test('HMM平滑化効果テスト（ノイズ挿入）', () => {
            const detector = new PYINDetector(44100, 2048, 80, 1000);
            const goodFrame = YINTestUtils.generateSineWave(261.6, 44100, 2048 / 44100); // C4
            const noiseFrame = YINTestUtils.addNoise(new Float32Array(2048), 0.8);
            const frames = [goodFrame, goodFrame, noiseFrame, goodFrame, goodFrame];

            const frequencies = frames.map(frame => detector.findPitch(frame)[0]);

            // 3フレーム目（ノイズ）が、直前の周波数に近いか、無声(0)になっていることを期待
            const smoothed = Math.abs(frequencies[2] - 261.6) < 20 || frequencies[2] === 0;

            assert(smoothed, `Smoothing failed. Freqs: ${frequencies.join(', ')}`);
        });

        test('reset()機能テスト', () => {
            const detector = new PYINDetector(44100, 2048);
            const frame = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100);

            const result1_run1 = detector.findPitch(frame);
            // const result2_run1 = detector.findPitch(frame); // unused

            detector.reset();

            const result1_run2 = detector.findPitch(frame);

            // reset()後は、最初の呼び出し結果が再現されるはず
            const isResetCorrectly = Math.abs(result1_run1[0] - result1_run2[0]) < 0.1 &&
                Math.abs(result1_run1[1] - result1_run2[1]) < 0.1;

            assert(isResetCorrectly, `Reset failed. Run1: ${result1_run1}, Run2: ${result1_run2}`);
        });
    });

    describe('Performance Tests', () => {
        test('PYIN性能ベンチマーク', () => {
            const detector = new PYINDetector(44100, 1024);
            const frames = Array(10).fill().map(() =>
                YINTestUtils.generateSineWave(440, 44100, 1024 / 44100)
            );

            const start = performance.now();
            for (let i = 0; i < 10; i++) {
                detector.detectPitch(frames);
            }
            const end = performance.now();

            const avgTime = (end - start) / 10;

            assert(avgTime < 100, `Too slow: ${avgTime.toFixed(2)}ms for 10 frames`);
        });
    });
});
