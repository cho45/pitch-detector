# YIN実装計画

## YINアルゴリズムの概要

YIN（YIN isn't McAulay-Quatieri）は、自己相関に基づく高精度なピッチ検出アルゴリズムです。従来の自己相関法の問題点（サブハーモニクスエラー）を解決し、特に楽器音に対して高い精度を持ちます。

## YINの4つの基本ステップ

### ステップ1: 差分関数（Difference Function）
音声信号の自己類似性を差分で計算します。

### ステップ2: 累積平均正規化差分関数（CMNDF）
差分関数を正規化して、相対的な最小値を強調します。

### ステップ3: 絶対閾値法（Absolute Threshold）
閾値を使って有効なピッチ候補を検出します。

### ステップ4: 放物線補間（Parabolic Interpolation）
検出されたピッチの精度を向上させます。

## 段階的実装計画

### フェーズ1: 基本的なYIN実装（1-2日）

#### 1.1 差分関数の実装
```javascript
// 単純版（理解しやすい）
function calculateDifferenceFunction(audioBuffer) {
    const N = audioBuffer.length;
    const df = new Array(N);
    
    for (let tau = 0; tau < N; tau++) {
        let sum = 0;
        for (let j = 0; j < N - tau; j++) {
            const diff = audioBuffer[j] - audioBuffer[j + tau];
            sum += diff * diff;
        }
        df[tau] = sum;
    }
    return df;
}
```

#### 1.2 CMNDFの実装
```javascript
function calculateCMNDF(df) {
    const cmndf = new Array(df.length);
    cmndf[0] = 1; // 特別な値
    
    let runningSum = df[0];
    for (let tau = 1; tau < df.length; tau++) {
        runningSum += df[tau];
        if (runningSum === 0) {
            cmndf[tau] = 1;
        } else {
            cmndf[tau] = df[tau] / (runningSum / tau);
        }
    }
    return cmndf;
}
```

#### 1.3 基本的なピッチ検出
```javascript
function detectPitch(cmndf, sampleRate, threshold = 0.1) {
    // 最初の局所最小値を探す
    for (let tau = 1; tau < cmndf.length - 1; tau++) {
        if (cmndf[tau] < threshold) {
            // 局所最小値かチェック
            if (cmndf[tau] < cmndf[tau - 1] && cmndf[tau] < cmndf[tau + 1]) {
                const frequency = sampleRate / tau;
                const confidence = 1 - cmndf[tau];
                return { frequency, confidence, tau };
            }
        }
    }
    return { frequency: 0, confidence: 0, tau: 0 }; // ピッチなし
}
```

### フェーズ2: 精度向上（1-2日）

#### 2.1 放物線補間による精度向上
```javascript
function parabolicInterpolation(array, peakIndex) {
    if (peakIndex <= 0 || peakIndex >= array.length - 1) {
        return peakIndex;
    }
    
    const y1 = array[peakIndex - 1];
    const y2 = array[peakIndex];
    const y3 = array[peakIndex + 1];
    
    const a = (y1 - 2 * y2 + y3) / 2;
    const b = (y3 - y1) / 2;
    
    if (a === 0) return peakIndex;
    
    const xOffset = -b / (2 * a);
    return peakIndex + xOffset;
}
```

#### 2.2 改良されたピッチ検出
```javascript
function detectPitchWithInterpolation(cmndf, sampleRate, threshold = 0.1) {
    for (let tau = 1; tau < cmndf.length - 1; tau++) {
        if (cmndf[tau] < threshold) {
            if (cmndf[tau] < cmndf[tau - 1] && cmndf[tau] < cmndf[tau + 1]) {
                // 放物線補間で精度向上
                const preciseTau = parabolicInterpolation(cmndf, tau);
                const frequency = sampleRate / preciseTau;
                const confidence = 1 - cmndf[tau];
                return { frequency, confidence, tau: preciseTau };
            }
        }
    }
    return { frequency: 0, confidence: 0, tau: 0 };
}
```

### フェーズ3: 性能最適化（2-3日）

#### 3.1 FFTを使った高速化
```javascript
// FFTベースの差分関数計算（より高速）
function calculateDifferenceFunctionFFT(audioBuffer) {
    const N = audioBuffer.length;
    const N2 = N * 2;
    
    // ゼロパディング
    const paddedBuffer = new Array(N2).fill(0);
    for (let i = 0; i < N; i++) {
        paddedBuffer[i] = audioBuffer[i];
    }
    
    // FFTを使用した自己相関計算
    // (実際のFFT実装が必要)
    const autocorr = performFFTAutocorrelation(paddedBuffer);
    
    // 差分関数に変換
    const df = new Array(N);
    df[0] = 0;
    
    for (let tau = 1; tau < N; tau++) {
        df[tau] = 2 * (autocorr[0] - autocorr[tau]);
    }
    
    return df;
}
```

#### 3.2 メモリ効率の改善
```javascript
class YINDetector {
    constructor(bufferSize, sampleRate) {
        this.bufferSize = bufferSize;
        this.sampleRate = sampleRate;
        
        // 再利用可能なバッファを事前割り当て
        this.differenceBuffer = new Array(bufferSize);
        this.cmndfBuffer = new Array(bufferSize);
    }
    
    detectPitch(audioBuffer, threshold = 0.1) {
        // バッファを再利用して計算
        this.calculateDifferenceFunction(audioBuffer, this.differenceBuffer);
        this.calculateCMNDF(this.differenceBuffer, this.cmndfBuffer);
        return this.detectPitchFromCMNDF(this.cmndfBuffer, threshold);
    }
}
```

### フェーズ4: 統合とテスト（1-2日）

#### 4.1 完全なYINDetectorクラス
```javascript
class YINDetector {
    constructor(sampleRate, bufferSize = 1024, threshold = 0.1) {
        this.sampleRate = sampleRate;
        this.bufferSize = bufferSize;
        this.threshold = threshold;
        this.differenceBuffer = new Array(bufferSize);
        this.cmndfBuffer = new Array(bufferSize);
    }
    
    detectPitch(audioBuffer) {
        if (audioBuffer.length !== this.bufferSize) {
            throw new Error(`Buffer size must be ${this.bufferSize}`);
        }
        
        // ステップ1: 差分関数
        this.calculateDifferenceFunction(audioBuffer);
        
        // ステップ2: CMNDF
        this.calculateCMNDF();
        
        // ステップ3 & 4: ピッチ検出と補間
        return this.detectPitchFromCMNDF();
    }
    
    calculateDifferenceFunction(audioBuffer) {
        for (let tau = 0; tau < this.bufferSize; tau++) {
            let sum = 0;
            for (let j = 0; j < this.bufferSize - tau; j++) {
                const diff = audioBuffer[j] - audioBuffer[j + tau];
                sum += diff * diff;
            }
            this.differenceBuffer[tau] = sum;
        }
    }
    
    calculateCMNDF() {
        this.cmndfBuffer[0] = 1;
        let runningSum = this.differenceBuffer[0];
        
        for (let tau = 1; tau < this.bufferSize; tau++) {
            runningSum += this.differenceBuffer[tau];
            this.cmndfBuffer[tau] = runningSum === 0 ? 1 : 
                this.differenceBuffer[tau] / (runningSum / tau);
        }
    }
    
    detectPitchFromCMNDF() {
        for (let tau = 1; tau < this.bufferSize - 1; tau++) {
            if (this.cmndfBuffer[tau] < this.threshold) {
                if (this.cmndfBuffer[tau] < this.cmndfBuffer[tau - 1] && 
                    this.cmndfBuffer[tau] < this.cmndfBuffer[tau + 1]) {
                    
                    const preciseTau = this.parabolicInterpolation(tau);
                    const frequency = this.sampleRate / preciseTau;
                    const confidence = 1 - this.cmndfBuffer[tau];
                    
                    return { frequency, confidence, tau: preciseTau };
                }
            }
        }
        return { frequency: 0, confidence: 0, tau: 0 };
    }
    
    parabolicInterpolation(peakIndex) {
        if (peakIndex <= 0 || peakIndex >= this.cmndfBuffer.length - 1) {
            return peakIndex;
        }
        
        const y1 = this.cmndfBuffer[peakIndex - 1];
        const y2 = this.cmndfBuffer[peakIndex];
        const y3 = this.cmndfBuffer[peakIndex + 1];
        
        const a = (y1 - 2 * y2 + y3) / 2;
        const b = (y3 - y1) / 2;
        
        if (a === 0) return peakIndex;
        
        const xOffset = -b / (2 * a);
        return peakIndex + xOffset;
    }
}
```

## 実装のタイムライン

**1週間での実装スケジュール:**

- **Day 1-2**: フェーズ1（基本実装）
- **Day 3-4**: フェーズ2（精度向上）
- **Day 5-6**: フェーズ3（性能最適化）
- **Day 7**: フェーズ4（統合・テスト）

## 現在のPitchyライブラリとの統合

```javascript
// 既存のコードとの統合例
const yinDetector = new YINDetector(this.audioContext.sampleRate, PART_LENGTH);

// draw関数内での使用
for (let p = 0; p < PART; p++) {
    const start = PART_LENGTH * p;
    const audioSegment = audioData.subarray(start, start + PART_LENGTH);
    
    // YINでピッチ検出
    const result = yinDetector.detectPitch(audioSegment);
    const freq = result.frequency;
    const clarity = result.confidence;
    
    // 既存のコードと同じように使用
    if (freq > 0) {
        const note = this.hzToNote(freq);
        // ... 既存の描画コード
    }
}
```

この段階的な実装により、理解しやすく、テストしやすい形でYINアルゴリズムを構築できます。