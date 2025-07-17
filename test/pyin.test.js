#!/usr/bin/env node

/**
 * PYIN Algorithm Test Suite for Node.js
 * Run with: npm test
 */

import { PYINDetector, PYINCore } from '../lib/pyin.js';
import { YINTestUtils } from './utils.js';

// ANSI色コード
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

function testResult(name, passed, details = '') {
    const icon = passed ? '✅' : '❌';
    const color = passed ? colors.green : colors.red;
    log(`${icon} ${name}`, color);
    if (details) log(`   ${details}`, colors.cyan);
    return passed;
}

let passedTests = 0;
let totalTests = 0;

function runTest(name, testFn) {
    totalTests++;
    try {
        const result = testFn();
        if (result.passed) passedTests++;
        testResult(name, result.passed, result.details);
    } catch (error) {
        testResult(name, false, `Error: ${error.message}`);
    }
}

// メインテスト
log(`${colors.bright}${colors.magenta}🚀 PYIN Algorithm Test Suite${colors.reset}\n`);

// 基本機能テスト
log(`${colors.bright}${colors.blue}🧪 Core Function Tests${colors.reset}`);
log(''.padEnd(50, '='), colors.blue);

runTest('ピッチ状態生成テスト', () => {
    const states = PYINCore.createPitchStates(80, 800, 5);
    
    // 無声状態 + 有声状態があることを確認
    const hasUnvoiced = states.some(s => !s.voiced);
    const hasVoiced = states.some(s => s.voiced);
    const freqRange = states.filter(s => s.voiced);
    const minFreq = Math.min(...freqRange.map(s => s.frequency));
    const maxFreq = Math.max(...freqRange.map(s => s.frequency));
    
    return {
        passed: hasUnvoiced && hasVoiced && minFreq >= 70 && maxFreq <= 850,
        details: `状態数: ${states.length}, 周波数範囲: ${minFreq.toFixed(1)}-${maxFreq.toFixed(1)}Hz`
    };
});

runTest('複数閾値候補抽出テスト', () => {
    const signal = YINTestUtils.generateSineWave(220, 44100, 0.1);
    const df = new Float32Array(signal.length);
    const cmndf = new Float32Array(signal.length);
    PYINCore.calculateDifferenceFunction(signal, df);
    PYINCore.calculateCMNDF(df, cmndf);
    const candidates = PYINCore.extractMultipleCandidates(cmndf, 44100);
    
    const expectedFreq = 220;
    const hasExpectedCandidate = candidates.some(c => Math.abs(c.frequency - expectedFreq) <= 5);
    
    return {
        passed: candidates.length > 0 && hasExpectedCandidate,
        details: `候補数: ${candidates.length}, 期待周波数: ${expectedFreq}Hz, 候補にあり: ${hasExpectedCandidate}`
    };
});

runTest('ピッチ確率分布計算テスト', () => {
    const signal = YINTestUtils.generateSineWave(440, 44100, 0.1);
    const df = new Float32Array(signal.length);
    const cmndf = new Float32Array(signal.length);
    PYINCore.calculateDifferenceFunction(signal, df);
    PYINCore.calculateCMNDF(df, cmndf);
    const candidates = PYINCore.extractMultipleCandidates(cmndf, 44100);
    const probabilities = PYINCore.calculatePitchProbabilities(candidates, cmndf, 44100);
    
    const totalProb = probabilities.reduce((sum, p) => sum + p.probability, 0);
    const has440Hz = probabilities.some(p => Math.abs(p.frequency - 440) < 5);
    
    return {
        passed: Math.abs(totalProb - 1.0) < 0.01 && has440Hz,
        details: `確率合計: ${totalProb.toFixed(3)}, 440Hz付近: ${has440Hz}`
    };
});

runTest('遷移確率行列生成テスト', () => {
    const states = PYINCore.createPitchStates(80, 400, 3);
    const transitions = PYINCore.calculateTransitionProbabilities(states);
    
    // 各行の確率合計が1に近いことを確認
    const rowSums = transitions.map(row => row.reduce((sum, p) => sum + p, 0));
    const allSumsValid = rowSums.every(sum => Math.abs(sum - 1.0) < 0.01);
    
    // 自己遷移確率が高いことを確認
    const selfTransitions = transitions.map((row, i) => row[i]);
    const avgSelfTransition = selfTransitions.reduce((sum, p) => sum + p, 0) / selfTransitions.length;
    
    return {
        passed: allSumsValid && avgSelfTransition > 0.98, // PYIN paper standard
        details: `行列サイズ: ${transitions.length}x${transitions[0].length}, 平均自己遷移: ${avgSelfTransition.toFixed(3)}`
    };
});

runTest('観測確率計算テスト', () => {
    const states = PYINCore.createPitchStates(200, 600, 3);
    const observations = [
        [{ frequency: 440, probability: 0.8 }, { frequency: 880, probability: 0.2 }],
        [{ frequency: 441, probability: 0.9 }],
        []  // 無音フレーム
    ];
    
    const obsProb = PYINCore.calculateObservationProbabilities(states, observations);
    
    const hasCorrectDimensions = obsProb.length === 3 && obsProb[0].length === states.length;
    const unvoicedStateIndex = states.findIndex(s => !s.voiced);
    const unvoicedProbForSilence = obsProb[2][unvoicedStateIndex];
    
    return {
        passed: hasCorrectDimensions && unvoicedProbForSilence > 0.8,
        details: `観測確率行列: ${obsProb.length}x${obsProb[0].length}, 無音での無声確率: ${unvoicedProbForSilence.toFixed(3)}`
    };
});

runTest('ビタビアルゴリズムテスト', () => {
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
    
    const hasCorrectLength = pitchTrack.length === observations.length;
    const averageFreq = pitchTrack.filter(p => p.voiced).reduce((sum, p) => sum + p.frequency, 0) / 
                      pitchTrack.filter(p => p.voiced).length;
    
    return {
        passed: hasCorrectLength && Math.abs(averageFreq - 440) < 10,
        details: `トラック長: ${pitchTrack.length}, 平均周波数: ${averageFreq.toFixed(1)}Hz`
    };
});

// 統合テスト
log(`\n${colors.bright}${colors.blue}🎯 Integration Tests${colors.reset}`);
log(''.padEnd(50, '='), colors.blue);

runTest('PYIN単一フレーム検出テスト（正弦波）', () => {
    const detector = new PYINDetector(44100, 2048);
    const signal = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100);
    
    const [frequency, confidence] = detector.findPitch(signal);
    const error = Math.abs(frequency - 440);
    
    return {
        passed: error < 5, // 5Hz未満の誤差
        details: `期待: 440Hz, 検出: ${frequency.toFixed(1)}Hz, 誤差: ${error.toFixed(2)}Hz`
    };
});

runTest('PYIN無声（ノイズ）入力テスト', () => {
    const detector = new PYINDetector(44100, 2048);
    const noisySignal = YINTestUtils.addNoise(new Float32Array(2048), 1.0);
    
    const [frequency, confidence] = detector.findPitch(noisySignal);
    
    return {
        passed: frequency === 0 && confidence === 0,
        details: `検出周波数: ${frequency}, 信頼度: ${confidence}`
    };
});

runTest('PYINオクターブエラーテスト（矩形波）', () => {
    const detector = new PYINDetector(44100, 2048, 80, 1000);
    const signal = YINTestUtils.generateSquareWave(220, 44100, 2048 / 44100);
    
    const [frequency, confidence] = detector.findPitch(signal);
    const error = Math.abs(frequency - 220);
    const isOctaveError = Math.abs(frequency - 440) < 10 || Math.abs(frequency - 660) < 15;

    return {
        passed: error < 10 && !isOctaveError,
        details: `期待: 220Hz, 検出: ${frequency.toFixed(1)}Hz. オクターブエラー発生: ${isOctaveError}`
    };
});

runTest('PYIN複数フレーム検出テスト（HMM使用）', () => {
    const detector = new PYINDetector(44100, 2048);
    // Test with identical frames to verify consistency
    const frames = [
        YINTestUtils.generateSineWave(440, 44100, 2048 / 44100),
        YINTestUtils.generateSineWave(440, 44100, 2048 / 44100),
        YINTestUtils.generateSineWave(440, 44100, 2048 / 44100)
    ];
    
    const pitchTrack = detector.detectPitch(frames);
    const frequencies = pitchTrack.map(p => p.frequency);
    
    const errors = frequencies.map(freq => 
        freq > 0 ? Math.abs(freq - 440) / 440 * 100 : 100
    );
    const avgError = errors.reduce((sum, err) => sum + err, 0) / errors.length;
    const allVoiced = pitchTrack.every(p => p.voiced);
    
    return {
        passed: avgError < 5 && allVoiced, // Should detect 440Hz accurately
        details: `検出: [${frequencies.map(f => f.toFixed(1)).join(', ')}]Hz, 平均誤差: ${avgError.toFixed(2)}%, 全て有声: ${allVoiced}`
    };
});

runTest('PYINノイズ耐性テスト', () => {
    const detector = new PYINDetector(44100, 2048);
    const cleanSignal = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100);
    const noisySignal = YINTestUtils.addNoise(cleanSignal, 0.2);
    
    const [frequency, confidence] = detector.findPitch(noisySignal);
    const error = Math.abs(frequency - 440);
    
    return {
        passed: error < 10, // 10Hz未満の誤差
        details: `ノイズ入り検出: ${frequency.toFixed(1)}Hz, 誤差: ${error.toFixed(2)}Hz`
    };
});

log(`
${colors.bright}${colors.blue}🧪 Stream Processing Tests (Stateful HMM)${colors.reset}`);
log(''.padEnd(50, '='), colors.blue);

runTest('HMM状態引き継ぎテスト', () => {
    const detector = new PYINDetector(44100, 2048);
    const frame = YINTestUtils.generateSineWave(330, 44100, 2048 / 44100);
    const results = [];
    for (let i = 0; i < 5; i++) {
        results.push(detector.findPitch(frame));
    }
    const frequencies = results.map(r => r[0]);
    const allConsistent = frequencies.every(f => Math.abs(f - 330) < 10);

    return {
        passed: allConsistent,
        details: `検出された周波数: [${frequencies.map(f => f.toFixed(1)).join(', ')}]`
    };
});

runTest('HMM平滑化効果テスト（ノイズ挿入）', () => {
    const detector = new PYINDetector(44100, 2048, 80, 1000);
    const goodFrame = YINTestUtils.generateSineWave(261.6, 44100, 2048/44100); // C4
    const noiseFrame = YINTestUtils.addNoise(new Float32Array(2048), 0.8);
    const frames = [goodFrame, goodFrame, noiseFrame, goodFrame, goodFrame];
    
    const frequencies = frames.map(frame => detector.findPitch(frame)[0]);
    
    // 3フレーム目（ノイズ）が、直前の周波数に近いか、無声(0)になっていることを期待
    const smoothed = Math.abs(frequencies[2] - 261.6) < 20 || frequencies[2] === 0;

    return {
        passed: smoothed,
        details: `周波数系列: [${frequencies.map(f => f.toFixed(1)).join(', ')}]`
    };
});

runTest('reset()機能テスト', () => {
    const detector = new PYINDetector(44100, 2048);
    const frame = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100);
    
    const result1_run1 = detector.findPitch(frame);
    const result2_run1 = detector.findPitch(frame);

    detector.reset();

    const result1_run2 = detector.findPitch(frame);

    // reset()後は、最初の呼び出し結果が再現されるはず
    const isResetCorrectly = Math.abs(result1_run1[0] - result1_run2[0]) < 0.1 && Math.abs(result1_run1[1] - result1_run2[1]) < 0.1;

    return {
        passed: isResetCorrectly,
        details: `Run1-1: ${result1_run1[0].toFixed(1)}Hz, Run2-1: ${result1_run2[0].toFixed(1)}Hz`
    };
});

// 性能テスト
log(`\n${colors.bright}${colors.blue}⚡ Performance Tests${colors.reset}`);
log(''.padEnd(50, '='), colors.blue);

runTest('PYIN性能ベンチマーク', () => {
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
    const framesPerSec = (frames.length * 1000) / avgTime;
    
    return {
        passed: avgTime < 100, // 100ms以内
        details: `10フレーム処理時間: ${avgTime.toFixed(2)}ms, 処理能力: ${framesPerSec.toFixed(1)}フレーム/秒`
    };
});

// 結果サマリー
log('\n' + ''.padEnd(50, '='), colors.bright);
log(`📊 テスト結果: ${passedTests}/${totalTests} passed`, colors.bright);

if (passedTests === totalTests) {
    log('🎉 すべてのテストが成功しました！', colors.green);
    process.exit(0);
} else {
    log(`❌ ${totalTests - passedTests} 個のテストが失敗しました`, colors.red);
    process.exit(1);
}