#!/usr/bin/env node

/**
 * YIN Algorithm Test Suite for Node.js
 * Run with: npm test
 */

import { YINCore, YINDetector, createYINDetector } from '../lib/yin.js';
import { PitchDetector } from '../lib/pitchy.mjs';
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
log(`${colors.bright}${colors.magenta}🚀 YIN Algorithm Test Suite${colors.reset}\n`);

// 基本機能テスト
log(`${colors.bright}${colors.blue}🧪 Core Function Tests${colors.reset}`);
log(''.padEnd(50, '='), colors.blue);

runTest('差分関数計算 - 440Hz正弦波', () => {
    const signal = YINTestUtils.generateSineWave(440, 44100, 0.1);
    const df = YINCore.calculateDifferenceFunction(signal);
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
    return {
        passed: error <= 2,
        details: `期待周期: ${expectedPeriod}, 検出: ${minIndex}, 誤差: ${error}`
    };
});

runTest('CMNDF計算', () => {
    const signal = YINTestUtils.generateSineWave(440, 44100, 0.1);
    const df = YINCore.calculateDifferenceFunction(signal);
    const cmndf = YINCore.calculateCMNDF(df);
    
    const isValid = cmndf[0] === 1 && 
                   cmndf.length === df.length && 
                   cmndf.every(val => !isNaN(val) && isFinite(val));
    
    return {
        passed: isValid,
        details: `CMNDF[0] = ${cmndf[0]}, 長さ: ${cmndf.length}, 全て有限値: ${isValid}`
    };
});

runTest('YINDetector統合テスト', () => {
    const detector = new YINDetector(44100, 1024);
    const signal = YINTestUtils.generateSineWave(440, 44100, 1024 / 44100);
    const [freq, clarity] = detector.findPitch(signal);
    
    const error = Math.abs(freq - 440) / 440 * 100;
    return {
        passed: error < 1.0 && clarity > 0.9,
        details: `検出: ${freq.toFixed(1)}Hz, 誤差: ${error.toFixed(2)}%, 信頼度: ${clarity.toFixed(3)}`
    };
});

// 精度テスト
log(`\n${colors.bright}${colors.blue}🎯 Accuracy Tests${colors.reset}`);
log(''.padEnd(50, '='), colors.blue);

const testFrequencies = [82.41, 110, 220, 440, 880, 1760];
testFrequencies.forEach(freq => {
    runTest(`精度テスト - ${freq}Hz`, () => {
        const detector = new YINDetector(44100, 2048);
        const signal = YINTestUtils.generateSineWave(freq, 44100, 2048 / 44100);
        const [detectedFreq, clarity] = detector.findPitch(signal);
        
        const error = Math.abs(detectedFreq - freq) / freq * 100;
        return {
            passed: error < 1.0,
            details: `期待: ${freq}Hz, 検出: ${detectedFreq.toFixed(1)}Hz, 誤差: ${error.toFixed(2)}%`
        };
    });
});

// Pitchy互換性テスト
log(`\n${colors.bright}${colors.blue}🔄 Pitchy Compatibility Tests${colors.reset}`);
log(''.padEnd(50, '='), colors.blue);

runTest('PitchyライブラリとのAPI互換性', () => {
    const yinDetector = new YINDetector(44100, 1024);
    const pitchyDetector = PitchDetector.forFloat32Array(1024);
    const signal = YINTestUtils.generateSineWave(440, 44100, 1024 / 44100);
    
    const [yinFreq, yinClarity] = yinDetector.findPitch(signal);
    const [pitchyFreq, pitchyClarity] = pitchyDetector.findPitch(signal, 44100);
    
    const freqDiff = Math.abs(yinFreq - pitchyFreq);
    const bothDetected = yinFreq > 0 && pitchyFreq > 0;
    
    return {
        passed: bothDetected && freqDiff < 5, // 5Hz以内の差は許容
        details: `YIN: ${yinFreq.toFixed(1)}Hz, Pitchy: ${pitchyFreq.toFixed(1)}Hz, 差: ${freqDiff.toFixed(1)}Hz`
    };
});

runTest('Factory API互換性', () => {
    const factory = createYINDetector(1024);
    const detector = factory.forFloat32Array(44100);
    const signal = YINTestUtils.generateSineWave(440, 44100, 1024 / 44100);
    
    const [freq, clarity] = detector.findPitch(signal, 44100);
    const error = Math.abs(freq - 440) / 440 * 100;
    
    return {
        passed: error < 1.0,
        details: `Factory API検出: ${freq.toFixed(1)}Hz, 誤差: ${error.toFixed(2)}%`
    };
});

// 複雑な信号テスト
log(`\n${colors.bright}${colors.blue}🎵 Complex Signal Tests${colors.reset}`);
log(''.padEnd(50, '='), colors.blue);

runTest('ハーモニクス信号テスト', () => {
    const detector = new YINDetector(44100, 2048);
    const fundamental = 220;
    const signal = YINTestUtils.generateHarmonicWave(
        fundamental, 44100, 2048 / 44100, [1.0, 0.5, 0.25]
    );
    
    const [freq, clarity] = detector.findPitch(signal);
    const error = Math.abs(freq - fundamental) / fundamental * 100;
    
    return {
        passed: error < 2.0,
        details: `基音: ${fundamental}Hz, 検出: ${freq.toFixed(1)}Hz, 誤差: ${error.toFixed(2)}%`
    };
});

runTest('ノイズ混入信号テスト', () => {
    const detector = new YINDetector(44100, 2048);
    const cleanSignal = YINTestUtils.generateSineWave(440, 44100, 2048 / 44100);
    const noisySignal = YINTestUtils.addNoise(cleanSignal, 0.1);
    
    const [freq, clarity] = detector.findPitch(noisySignal);
    const error = Math.abs(freq - 440) / 440 * 100;
    
    return {
        passed: error < 3.0 && clarity > 0.5,
        details: `期待: 440Hz, 検出: ${freq.toFixed(1)}Hz, 誤差: ${error.toFixed(2)}%, 信頼度: ${clarity.toFixed(3)}`
    };
});

// 性能テスト
log(`\n${colors.bright}${colors.blue}⚡ Performance Tests${colors.reset}`);
log(''.padEnd(50, '='), colors.blue);

const bufferSizes = [512, 1024, 2048, 4096];
log('バッファサイズ | 処理時間(ms) | 1秒あたり処理回数');
log(''.padEnd(50, '-'));

bufferSizes.forEach(bufferSize => {
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
    const callsPerSecond = Math.round(1000 / avgTime);
    
    log(`${bufferSize.toString().padStart(10)} | ${avgTime.toFixed(2).padStart(11)} | ${callsPerSecond.toString().padStart(15)}`);
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