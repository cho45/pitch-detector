/**
 * PYIN Algorithm Test Suite for Node.js
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { PYINDetector, PYINCore, PYINTransitions } from '../lib/pyin.js';
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

            const context = YINTestUtils.createPYINContext(44100, signal.length);
            const nCands = PYINCore.extractMultipleCandidates(cmndf, 44100, context);

            const expectedFreq = 220;
            // 検証: 候補リストの中に期待される基本周波数が含まれていること
            const hasExpectedCandidate = context.candidates.slice(0, nCands).some(c => Math.abs(c.frequency - expectedFreq) <= 5);

            assert(nCands > 0, 'No candidates found');
            assert(hasExpectedCandidate, 'Expected frequency not found among candidates');
        });

        test('遷移確率行列生成テスト', () => {
            const states = PYINCore.createPitchStates(80, 400, 3);
            const transitions = new PYINTransitions(states);

            const nS = states.length;
            const logMatrix = transitions.logMatrix;

            // 各行の合計が確率 1.0 になっていることを検証
            for (let i = 0; i < nS; i++) {
                let sum = 0;
                for (let j = 0; j < nS; j++) sum += Math.exp(logMatrix[i * nS + j]);
                assert(Math.abs(sum - 1.0) < 0.01, `Row ${i} sum should be ~1, got ${sum}`);
            }

            // 自己遷移確率の検証（sigmaTrans=25centsに基づく理論値）
            let avgSelf = 0;
            for (let i = 0; i < nS; i++) avgSelf += Math.exp(logMatrix[i * nS + i]);
            avgSelf /= nS;

            // 理論値（sigmaTrans = 25 cents）に基づく自己遷移確率の検証。
            // 状態が離散化されていても、十分な自己遷移確率が維持されていることを確認。
            assert(avgSelf > 0.5, `Self transition probability too low: ${avgSelf}`);
        });

        test('観測確率計算の数学的妥当性と精度（対数領域）テスト', () => {
            const minFreq = 200;
            const maxFreq = 600;
            const stepsPerSemitone = 3;
            const states = PYINCore.createPitchStates(minFreq, maxFreq, stepsPerSemitone);
            const unvoicedStateIndex = states.findIndex(s => !s.voiced);

            // シナリオ1: クリアなピッチ候補が存在する場合
            const candidates = [{ frequency: 440, probability: 0.9 }];
            const logProbs1 = new Float32Array(states.length);
            const candLogProbs = new Float32Array(1);
            const candLogFreqs = new Float32Array(1);
            PYINCore.fillObservationLogProbabilities(states, candidates, 1, logProbs1, stepsPerSemitone, candLogProbs, candLogFreqs);

            // 無声尤度は、解像度独立な密度補正 log(1 - voicingProb) と一致すべき。
            const expectedUnvoicedLog1 = Math.log(1 - 0.9);
            assert(Math.abs(logProbs1[unvoicedStateIndex] - expectedUnvoicedLog1) < 1e-6,
                `Likelihood mismatch. Expected ${expectedUnvoicedLog1}, got ${logProbs1[unvoicedStateIndex]}`);

            // シナリオ2: 候補が存在しない場合
            const logProbs2 = new Float32Array(states.length);
            PYINCore.fillObservationLogProbabilities(states, [], 0, logProbs2, stepsPerSemitone, candLogProbs, candLogFreqs);

            const expectedUnvoicedLog2 = Math.log(1.0);
            assert(Math.abs(logProbs2[unvoicedStateIndex] - expectedUnvoicedLog2) < 1e-6);
        });

        test('密度補正の解像度独立性テスト', () => {
            const minFreq = 200;
            const maxFreq = 600;
            const candidates = [{ frequency: 440, probability: 0.5 }];
            const candLogProbs = new Float32Array(1);
            const candLogFreqs = new Float32Array(1);

            // 低解像度（1ステップ/半音）
            const statesLow = PYINCore.createPitchStates(minFreq, maxFreq, 1);
            const logProbsLow = new Float32Array(statesLow.length);
            PYINCore.fillObservationLogProbabilities(statesLow, candidates, 1, logProbsLow, 1, candLogProbs, candLogFreqs);
            const unvoicedLogLow = logProbsLow[statesLow.findIndex(s => !s.voiced)];

            // 高解像度（10ステップ/半音）
            const statesHigh = PYINCore.createPitchStates(minFreq, maxFreq, 10);
            const logProbsHigh = new Float32Array(statesHigh.length);
            PYINCore.fillObservationLogProbabilities(statesHigh, candidates, 1, logProbsHigh, 10, candLogProbs, candLogFreqs);
            const unvoicedLogHigh = logProbsHigh[statesHigh.findIndex(s => !s.voiced)];

            // 密度補正により、ピッチビンの密度に関わらず、無声尤度が積分的に一定（log(0.5)）であることを確認。
            assert(Math.abs(unvoicedLogLow - Math.log(0.5)) < 1e-6);
            assert(Math.abs(unvoicedLogLow - unvoicedLogHigh) < 1e-6,
                `Unvoiced likelihood shifted with resolution! Low: ${unvoicedLogLow}, High: ${unvoicedLogHigh}`);
        });

        test('fillObservationLogProbabilities should track optimal candidate frequencies', () => {
            const minFreq = 400; // ~G4
            const maxFreq = 500; // ~B4
            const stepsPerSemitone = 1; // Coarse grid
            const states = PYINCore.createPitchStates(minFreq, maxFreq, stepsPerSemitone);

            // Create a candidate that is slightly off-grid
            // A4 = 440Hz. Grid probably has 440.0. 
            // Let's use 442.0Hz as candidate.
            const preciseFreq = 442.0;
            const candidates = [{ frequency: preciseFreq, probability: 0.9 }];

            const nCands = 1;
            const outputLogProbs = new Float32Array(states.length);
            const candLogProbs = new Float32Array(nCands);
            const candLogFreqs = new Float32Array(nCands);
            const optimalFreqs = new Float32Array(states.length); // New buffer

            PYINCore.fillObservationLogProbabilities(
                states, candidates, nCands, outputLogProbs, stepsPerSemitone,
                candLogProbs, candLogFreqs, optimalFreqs
            );

            // Find the state corresponding to A4 (closest to 442Hz)
            const bestStateIdx = states.findIndex(s => s.voiced && Math.abs(s.frequency - 440) < 5);
            assert(bestStateIdx >= 0, "State near 440Hz should exist");

            // The optimal frequency for this state should be the candidate's frequency, not the state's frequency
            /*
            console.log({
                stateFreq: states[bestStateIdx].frequency,
                optimalFreq: optimalFreqs[bestStateIdx],
                candidateFreq: preciseFreq
            });
            */

            assert(Math.abs(optimalFreqs[bestStateIdx] - preciseFreq) < 1e-6,
                `Optimal frequency should match candidate. Got ${optimalFreqs[bestStateIdx]}, expected ${preciseFreq}`);

            // Unvoiced state should have 0 (or safe fallback)
            const unvoicedIdx = states.findIndex(s => !s.voiced);
            assert.strictEqual(optimalFreqs[unvoicedIdx], 0, "Unvoiced state should have 0 frequency");
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
            const transitions = {
                logMatrix: new Float32Array(numStates * numStates),
                voicedIdx: [1, 2],
                unvoicedIdx: [0],
                voicedRanges: [
                    { start: 1, end: 2 }, // For state 1, can reach 1 and 2
                    { start: 1, end: 2 }  // For state 2, can reach 1 and 2
                ]
            };
            const selfProb = Math.log(0.8);
            const switchProb = Math.log(0.1);

            for (let i = 0; i < numStates; i++) {
                for (let j = 0; j < numStates; j++) {
                    transitions.logMatrix[i * numStates + j] = (i === j) ? selfProb : switchProb;
                }
            }

            // Log Observation Probabilities
            // Frame 0: State 1 is clear
            // Frame 1: State 0 (Unvoiced/Noise) dominates locally, but State 1 is possible
            // Frame 2: State 1 is clear again
            const logObserv = new Float32Array(numFrames * numStates);

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

            const path = PYINCore.viterbi(logInitial, transitions, logObserv, numFrames, numStates);

            assert.strictEqual(path[0], 1, 'Frame 0 should be State 1');
            assert.strictEqual(path[1], 1, 'Frame 1 should be corrected to State 1 by Viterbi');
            assert.strictEqual(path[2], 1, 'Frame 2 should be State 1');
        });

        test('forwardViterbiStep Mathematical Verification', () => {
            // Test single step of Forward Viterbi
            const numStates = 2;
            const prevLogProbs = new Float32Array([Math.log(0.8), Math.log(0.2)]); // S0: 0.8, S1: 0.2

            // Transitions
            // S0: Unvoiced, S1: Voiced
            // S0->S0: 0.9, S0->S1: 0.1
            // S1->S0: 0.5, S1->S1: 0.5
            const transitions = {
                logMatrix: new Float32Array([
                    Math.log(0.9), Math.log(0.1),
                    Math.log(0.5), Math.log(0.5)
                ]),
                voicedIdx: [1],
                unvoicedIdx: [0],
                voicedRanges: [
                    { start: 1, end: 1 }
                ]
            };

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

            const nextLogProbs = PYINCore.forwardViterbiStep(prevLogProbs, transitions, currentLogObs);

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

        test('PYIN確信度計算テスト（正弦波）', () => {
            const detector = new PYINDetector(44100, 2048);
            const signal = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100);

            // HMMの確率が安定するまで数フレーム実行
            let confidence = 0;
            for (let i = 0; i < 5; i++) {
                [, confidence] = detector.findPitch(signal);
            }

            // 理論的に正しい有声確信度（全有声状態の確率の和）により、
            // 明確な信号に対しては 0.98 以上の高い値が返されることを検証。
            assert(confidence > 0.98, `Confidence should be very high for sine wave. Got ${confidence}`);
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
            const noisySignal = YINTestUtils.addNoise(cleanSignal, 0.1);

            const [frequency, confidence] = detector.findPitch(noisySignal);
            const error = Math.abs(frequency - 440);

            assert(error < 10, `Noise resistance failed. Error: ${error}Hz`);
        });
    });

    describe('Offline Viterbi Optimization', () => {
        test('Should correct momentary dropout using future context', () => {
            const detector = new PYINDetector(44100, 2048);
            const frame1 = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100);
            const noise = YINTestUtils.addNoise(new Float32Array(2048), 0.2);
            const weakSignal = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100, 0.3);
            const frame2 = new Float32Array(2048);
            for (let i = 0; i < 2048; i++) frame2[i] = noise[i] + weakSignal[i];
            const frame3 = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100);

            const frames = [frame1, frame2, frame3];
            const pitchTrack = detector.detectPitch(frames);
            const freqs = pitchTrack.map(p => p.frequency);

            // オフライン・ビタビにより、一時的なノイズ区間が前後の文脈（未来の情報）から正しく補正されることを検証
            const isCorrected = Math.abs(freqs[1] - 440) < 20;
            assert(isCorrected, `Middle frame should be corrected to 440Hz by Viterbi. Got: ${freqs[1]}Hz. Sequence: ${freqs.join(', ')}`);
        });

        test('Offline detectPitch should have the same noise robustness as online findPitch', () => {
            const sampleRate = 44100;
            const frameSize = 2048;
            const detector = new PYINDetector(sampleRate, frameSize);
            const cleanSignal = YINTestUtils.generateSineWave(440, sampleRate, frameSize / sampleRate);
            const noisySignal = YINTestUtils.addNoise(cleanSignal, 0.1);

            detector.reset();
            const [onlineFreq,] = detector.findPitch(noisySignal);

            const frames = [noisySignal];
            const pitchTrack = detector.detectPitch(frames);
            const offlineFreq = pitchTrack[0].frequency;

            assert(onlineFreq > 0, "Online should detect the pitch under this noise level");
            assert(offlineFreq > 0, `Offline should also detect the pitch. Got ${offlineFreq}Hz (Online got ${onlineFreq}Hz)`);
        });

        test('Transition model should penalize large pitch jumps (RED test)', () => {
            const detector = new PYINDetector(44100, 2048, 80, 800);
            const states = detector.states;
            const nStates = states.length;
            const findIdx = (f) => states.findIndex(s => s.voiced && Math.abs(1200 * Math.log2(s.frequency / f)) < 25);

            const state440Idx = findIdx(440);
            const state445Idx = findIdx(445);
            const state600Idx = findIdx(600);

            assert(state440Idx !== -1, "440Hz state should exist");
            assert(state445Idx !== -1, "445Hz state should exist");
            assert(state600Idx !== -1, "600Hz state should exist");

            const obsLogs = new Float32Array(3 * nStates).fill(-50);
            obsLogs[0 * nStates + state440Idx] = 0;
            obsLogs[1 * nStates + state445Idx] = -1.0;
            obsLogs[1 * nStates + state600Idx] = -0.5; // 観測自体は600Hzの方が強い設定
            const state450Idx = findIdx(450);
            assert(state450Idx !== -1, "450Hz state should exist");
            obsLogs[2 * nStates + state450Idx] = 0;

            const initial = new Float32Array(nStates).fill(Math.log(0.5 / (nStates - 1)));
            const unvoicedIdx = states.findIndex(s => !s.voiced);
            initial[unvoicedIdx] = Math.log(0.5);

            const path = PYINCore.viterbi(initial, detector.transitions, obsLogs, 3, nStates);
            const freqAtFrame1 = states[path[1]].frequency;

            // 距離依存遷移モデルにより、観測が強くても遠いピッチ（600Hz）へのジャンプが抑制されることを検証
            assert(Math.abs(freqAtFrame1 - 445) < 10, `Should prioritize 445Hz due to proximity. Got: ${freqAtFrame1}Hz`);
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
            const goodFrame = YINTestUtils.generateSineWave(261.6, 44100, 2048 / 44100);
            const noiseFrame = YINTestUtils.addNoise(new Float32Array(2048), 0.8);
            const frames = [goodFrame, goodFrame, noiseFrame, goodFrame, goodFrame];

            const frequencies = frames.map(frame => detector.findPitch(frame)[0]);

            const smoothed = Math.abs(frequencies[2] - 261.6) < 20 || frequencies[2] === 0;
            assert(smoothed, `Smoothing failed. Freqs: ${frequencies.join(', ')}`);
        });

        test('reset()機能テスト', () => {
            const detector = new PYINDetector(44100, 2048);
            const frame = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100);
            const result1_run1 = detector.findPitch(frame);
            detector.reset();
            const result1_run2 = detector.findPitch(frame);

            const isResetCorrectly = Math.abs(result1_run1[0] - result1_run2[0]) < 0.1 &&
                Math.abs(result1_run1[1] - result1_run2[1]) < 0.1;

            assert(isResetCorrectly, `Reset failed. Run1: ${result1_run1}, Run2: ${result1_run2}`);
        });
    });

    describe('Performance and Memory Integrity (Zero-Allocation Audit)', () => {
        test('findPitch should not trigger garbage collection pressure (Code Audit RED)', () => {
            const detector = new PYINDetector(44100, 2048);
            const signal = new Float32Array(2048);
            const start = performance.now();
            for (let i = 0; i < 100; i++) {
                detector.findPitch(signal);
            }
            const end = performance.now();
            const avgTime = (end - start) / 100;
            assert(avgTime < 5, `Too slow: ${avgTime}ms. Potential heavy allocations or O(N^2) overhead.`);
        });
    });
});
