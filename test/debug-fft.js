#!/usr/bin/env node

/**
 * FFT問題のデバッグスクリプト
 */

import { YINCore } from '../lib/yin.js';
import { YINTestUtils } from './utils.js';

const signal = YINTestUtils.generateSineWave(110, 44100, 0.1);
console.log('信号長:', signal.length);

const dfBasic = YINCore.calculateDifferenceFunction(signal);
const dfFFT = YINCore.calculateDifferenceFunctionFFT(signal);

console.log('基本版 df[0-10]:', Array.from(dfBasic.slice(0, 11)).map(v => v.toFixed(2)));
console.log('FFT版 df[0-10]:', Array.from(dfFFT.slice(0, 11)).map(v => v.toFixed(2)));

const expectedPeriod = Math.round(44100 / 110);
console.log('期待周期:', expectedPeriod);

const basicMin = dfBasic.slice(expectedPeriod - 5, expectedPeriod + 5);
const fftMin = dfFFT.slice(expectedPeriod - 5, expectedPeriod + 5);

console.log('基本版 周期付近:', Array.from(basicMin).map(v => v.toFixed(2)));
console.log('FFT版 周期付近:', Array.from(fftMin).map(v => v.toFixed(2)));

// 最大差を計算
let maxDiff = 0;
let maxIndex = 0;
for (let i = 1; i < Math.min(dfBasic.length, 1000); i++) {
    const diff = Math.abs(dfFFT[i] - dfBasic[i]);
    if (diff > maxDiff) {
        maxDiff = diff;
        maxIndex = i;
    }
}

console.log('最大差:', maxDiff, 'at index', maxIndex);
console.log('基本版[' + maxIndex + ']:', dfBasic[maxIndex]);
console.log('FFT版[' + maxIndex + ']:', dfFFT[maxIndex]);