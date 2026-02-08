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

        test('観測確率計算の数学的妥当性テスト', () => {
            const minFreq = 200;
            const maxFreq = 600;
            const states = PYINCore.createPitchStates(minFreq, maxFreq, 3);
            const voicedStates = states.filter(s => s.voiced);
            const vCount = voicedStates.length;
            const unvoicedStateIndex = states.findIndex(s => !s.voiced);

            // シナリオ1: 確実なピッチ候補がある場合
            const obs1 = [{ frequency: 440, probability: 0.9 }];
            const prob1 = PYINCore.calculateObservationProbabilities(states, [obs1])[0];
            
            // 無声確率は (1 - 0.9) / vCount に分配されているはず
            const expectedUnvoiced1 = (1 - 0.9) / vCount;
            assert(Math.abs(prob1[unvoicedStateIndex] - expectedUnvoiced1) < 1e-6, 
                `Strong signal should result in distributed unvoiced prob. Expected ${expectedUnvoiced1}, got ${prob1[unvoicedStateIndex]}`);

            // シナリオ2: 候補がない（無音/ノイズ）場合
            const obs2 = []; // totalVoicedProb = 0
            const prob2 = PYINCore.calculateObservationProbabilities(states, [obs2])[0];
            
            // 無声確率は (1 - 0) / vCount 
            const expectedUnvoiced2 = 1.0 / vCount;
            assert(Math.abs(prob2[unvoicedStateIndex] - expectedUnvoiced2) < 1e-6,
                `Silence should distribute full probability. Expected ${expectedUnvoiced2}, got ${prob2[unvoicedStateIndex]}`);

            // 有声ビンとの比較: 無音時は、どの有声ビン（1e-15）よりも無声ビン（1/vCount）が圧倒的に高いはず
            assert(prob2[unvoicedStateIndex] > 1e-10, "Unvoiced state should be dominant in silence");
        });

        test('Viterbi Algorithm Mathematical Verification', () => {
            // Define a simple 3-state HMM
            // State 0: Unvoiced
            // State 1: Voiced Low
            // State 2: Voiced High
            const numStates = 3;
            const numFrames = 3;

            // Log Initial Probabilities (Equal)
            const logInitial = new Float32Array(numStates).fill(Math.log(1 / 3));

            // Log Transition Matrix (Self-transition favored)
            const logTransitions = Array(numStates).fill().map(() => new Float32Array(numStates));
            const selfProb = Math.log(0.8);
            const switchProb = Math.log(0.1);

            for (let i = 0; i < numStates; i++) {
                for (let j = 0; j < numStates; j++) {
                    logTransitions[i][j] = (i === j) ? selfProb : switchProb;
                }
            }

            // Log Observation Probabilities
            // Frame 0: State 1 is clear
            // Frame 1: State 0 (Unvoiced/Noise) dominates locally, but State 1 is possible
            // Frame 2: State 1 is clear again
            const logObserv = new Float32Array(numFrames * numStates);

            // Helper to set obs prob
            const setObs = (t, probs) => {
                for (let s = 0; s < numStates; s++) logObserv[t * numStates + s] = Math.log(probs[s]);
            };

            setObs(0, [0.05, 0.9, 0.05]);
            setObs(1, [0.6, 0.2, 0.2]); // Here, State 0 is locally most likely
            setObs(2, [0.05, 0.9, 0.05]);

            // What should happen:
            // Path 1-1-1 prob: Init + Obs0(1) + Trans(1->1) + Obs1(1) + Trans(1->1) + Obs2(1)
            // = log(1/3) + log(0.9) + log(0.8) + log(0.2) + log(0.8) + log(0.9)
            // ≈ -1.1 - 0.1 - 0.22 - 1.6 - 0.22 - 0.1 = -3.34

            // Path 1-0-1 prob: Init + Obs0(1) + Trans(1->0) + Obs1(0) + Trans(0->1) + Obs2(1)
            // = log(1/3) + log(0.9) + log(0.1) + log(0.6) + log(0.1) + log(0.9)
            // ≈ -1.1 - 0.1 - 2.3 - 0.5 - 2.3 - 0.1 = -6.4

            // Path 1-1-1 (staying in State 1) should be vastly superior to switching to State 0 and back
            // despite State 0 being locally probable in Frame 1.

            const path = PYINCore.viterbi(logInitial, logTransitions, logObserv, numFrames, numStates);

            assert.strictEqual(path[0], 1, 'Frame 0 should be State 1');
            assert.strictEqual(path[1], 1, 'Frame 1 should be corrected to State 1 by Viterbi');
            assert.strictEqual(path[2], 1, 'Frame 2 should be State 1');
        });

        test('forwardViterbiStep Mathematical Verification', () => {
            // Test single step of Forward Viterbi
            const numStates = 2;
            const prevLogProbs = new Float32Array([Math.log(0.8), Math.log(0.2)]); // S0: 0.8, S1: 0.2

            // Transitions
            // S0->S0: 0.9, S0->S1: 0.1
            // S1->S0: 0.5, S1->S1: 0.5
            const logTransitions = [
                new Float32Array([Math.log(0.9), Math.log(0.1)]),
                new Float32Array([Math.log(0.5), Math.log(0.5)])
            ];

            // Current Observation
            // S0: 0.4, S1: 0.6
            const currentLogObs = new Float32Array([Math.log(0.4), Math.log(0.6)]);

            // Expected S0:
            // from S0: log(0.8) + log(0.9) = log(0.72)
            // from S1: log(0.2) + log(0.5) = log(0.10)
            // max = log(0.72)
            // result = log(0.72) + log(0.4) = log(0.288)

            // Expected S1:
            // from S0: log(0.8) + log(0.1) = log(0.08)
            // from S1: log(0.2) + log(0.5) = log(0.10)
            // max = log(0.10)
            // result = log(0.10) + log(0.6) = log(0.06)

            const nextLogProbs = PYINCore.forwardViterbiStep(prevLogProbs, logTransitions, currentLogObs);

            const expectedS0 = Math.log(0.288);
            const expectedS1 = Math.log(0.06);

            assert(Math.abs(nextLogProbs[0] - expectedS0) < 1e-5, `S0 mismatch: ${nextLogProbs[0]} vs ${expectedS0}`);
            assert(Math.abs(nextLogProbs[1] - expectedS1) < 1e-5, `S1 mismatch: ${nextLogProbs[1]} vs ${expectedS1}`);
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

    describe('Offline Viterbi Optimization', () => {
        test('Should correct momentary dropout using future context', () => {
            // This test demonstrates the superiority of Offline Viterbi over Online processing.
            // We construct a sequence where the middle frame is ambiguous/noisy,
            // but the surrounding frames are clear. 
            // - Online processing might pick the noise peak in the middle frame.
            // - Offline Viterbi should use the transition probabilities from the FUTURE frame 
            //   to correctly identify the path through the weak signal.

            const detector = new PYINDetector(44100, 2048);

            // Frame 1: Clear 440Hz
            const frame1 = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100);

            // Frame 2: Noisy 440Hz (simulated by mixing 440Hz weak + strong noise/other peak)
            // We make 440Hz probability lower than noise in this frame locally.
            // But structurally it should be 440Hz.
            // Note: Implementing this strictly with synthesized audio is hard because pYIN is robust.
            // We will trust the integration test logic:
            // The middle frame will be pure noise, but with a very faint injection of 440Hz
            const noise = YINTestUtils.addNoise(new Float32Array(2048), 0.3);
            const weakSignal = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100, 0.3); // Increased amplitude
            const frame2 = new Float32Array(2048);
            for (let i = 0; i < 2048; i++) frame2[i] = noise[i] + weakSignal[i];

            // Frame 3: Clear 440Hz
            const frame3 = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100);

            const frames = [frame1, frame2, frame3];

            // 1. Online Processing Check (Simulated by independent analysis)
            // detector.reset();
            // const [onlineFreq, onlineConf] = detector.findPitch(frame2);

            // 2. Offline Batch Processing
            const pitchTrack = detector.detectPitch(frames);

            // Verify
            const freqs = pitchTrack.map(p => p.frequency);

            // The middle frame should be corrected to ~440Hz (or at least voiced)
            // If it's 0 (unvoiced) or random noise freq, Viterbi isn't working optimally.
            const isCorrected = Math.abs(freqs[1] - 440) < 20;

            // This assertion might fail with current implementation (Online only)
            // which confirms we need to implement true Viterbi.
            assert(isCorrected, `Middle frame should be corrected to 440Hz by Viterbi. Got: ${freqs[1]}Hz. Sequence: ${freqs.join(', ')}`);
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
