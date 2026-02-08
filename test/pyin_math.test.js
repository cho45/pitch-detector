
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { PYINCore, PYINDetector } from '../lib/pyin.js';
import { YINTestUtils } from './utils.js';

describe('PYIN Mathematical Correctness Tests', () => {
    test('Voiced probability should be low for bad matches (no normalization bug check)', () => {
        // 周期性が低い（CMNDFの谷が浅い）場合、有声確率の合計が低くなることを検証。
        
        const cmndf = new Float32Array(1000).fill(1.0);
        // 深さ 0.6 の浅い谷を追加。Beta(2, 18)において 0.6 を下回るしきい値は極めて稀。
        cmndf[100] = 0.6;
        cmndf[99] = 0.61;
        cmndf[101] = 0.61;
        
        const sampleRate = 44100;
        const context = YINTestUtils.createPYINContext(sampleRate, 1000);
        const nCands = PYINCore.extractMultipleCandidates(cmndf, sampleRate, context);
        
        // 有声確率の合計を計算
        let totalVoicedProb = 0;
        for (let i = 0; i < nCands; i++) totalVoicedProb += context.candidates[i].probability;
        
        console.log(`Total voiced probability: ${totalVoicedProb}`);
        
        // 理論的な期待値: P(Theta > 0.6) ≒ 6.8e-8
        // したがって、正規化が行われていなければ、合計確率は極めて小さくなるはず。
        assert(totalVoicedProb < 0.1, `Voiced probability should be low for bad matches. Got ${totalVoicedProb}`);
    });

    test('Candidates should favor fundamental over harmonics via threshold distribution', () => {
        // ボルツマン分布としきい値分布の組み合わせにより、基本波が調波より優先されることを検証。
        const cmndf = new Float32Array(1000).fill(1.0);
        
        // 基本波 (200Hz, tau=220): 深い谷 (0.05)
        const tauF = 220;
        cmndf[tauF] = 0.05;
        cmndf[tauF-1] = 0.06;
        cmndf[tauF+1] = 0.06;
        
        // 第2調波 (400Hz, tau=110): 浅い谷 (0.15)
        const tauH = 110;
        cmndf[tauH] = 0.15;
        cmndf[tauH-1] = 0.16;
        cmndf[tauH+1] = 0.16;
        
        const sampleRate = 44100;
        const context = YINTestUtils.createPYINContext(sampleRate, 1000, 1000); // 高精度しきい値
        const nCands = PYINCore.extractMultipleCandidates(cmndf, sampleRate, context);
        
        const candidates = context.candidates.slice(0, nCands);
        const candF = candidates.find(c => Math.abs(sampleRate / c.frequency - tauF) < 1);
        const candH = candidates.find(c => Math.abs(sampleRate / c.frequency - tauH) < 1);
        
        assert(candF, 'Fundamental candidate should exist');
        assert(candH, 'Harmonic candidate should exist');
        
        console.log(`Fundamental prob: ${candF.probability}, Harmonic prob: ${candH.probability}`);
        
        // pYIN理論に基づき、基本波（より多くのしきい値をパスする深い谷）が優先されることを確認。
        assert(candF.probability > candH.probability, "Fundamental should be more probable than harmonic");
    });
});
