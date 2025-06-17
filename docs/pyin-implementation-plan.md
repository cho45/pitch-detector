# PYIN実装計画

## PYINアルゴリズム概要

PYIN（Probabilistic YIN）は、YINアルゴリズムの確率的拡張で、複数のピッチ候補を確率分布として扱い、隠れマルコフモデル（HMM）とビタビアルゴリズムを使用して最適なピッチトラックを決定します。

## 実装ステップ

### ステップ1: YIN基本アルゴリズムの実装

#### 1.1 差分関数（Difference Function）の計算
```javascript
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

#### 1.2 累積平均正規化差分関数（CMNDF）の計算
```javascript
function calculateCMNDF(df) {
    const cmndf = new Array(df.length);
    cmndf[0] = 1;
    
    let runningSum = df[0];
    for (let tau = 1; tau < df.length; tau++) {
        runningSum += df[tau];
        cmndf[tau] = df[tau] / (runningSum / tau);
    }
    return cmndf;
}
```

#### 1.3 閾値を使ったピッチ候補の検出
```javascript
function findPitchCandidates(cmndf, threshold = 0.1) {
    const candidates = [];
    
    for (let tau = 1; tau < cmndf.length - 1; tau++) {
        // 局所最小値を検出
        if (cmndf[tau] < cmndf[tau - 1] && cmndf[tau] < cmndf[tau + 1]) {
            if (cmndf[tau] < threshold) {
                candidates.push({
                    tau: tau,
                    value: cmndf[tau]
                });
            }
        }
    }
    return candidates;
}
```

### ステップ2: 確率的拡張の実装

#### 2.1 複数閾値による候補抽出
```javascript
function extractMultipleCandidates(cmndf) {
    const thresholds = [0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.35, 0.5];
    const allCandidates = new Set();
    
    thresholds.forEach(threshold => {
        const candidates = findPitchCandidates(cmndf, threshold);
        candidates.forEach(candidate => {
            allCandidates.add(candidate.tau);
        });
    });
    
    return Array.from(allCandidates).sort((a, b) => a - b);
}
```

#### 2.2 ピッチ確率分布の計算
```javascript
function calculatePitchProbabilities(candidates, cmndf, sampleRate) {
    const probabilities = [];
    
    candidates.forEach(tau => {
        if (tau > 0) {
            const frequency = sampleRate / tau;
            const confidence = 1 - cmndf[tau]; // CMNDFが低いほど信頼度が高い
            
            probabilities.push({
                frequency: frequency,
                tau: tau,
                probability: Math.max(0, confidence)
            });
        }
    });
    
    // 確率を正規化
    const totalProb = probabilities.reduce((sum, p) => sum + p.probability, 0);
    if (totalProb > 0) {
        probabilities.forEach(p => {
            p.probability /= totalProb;
        });
    }
    
    return probabilities;
}
```

### ステップ3: 隠れマルコフモデル（HMM）の実装

#### 3.1 状態定義
```javascript
class PitchState {
    constructor(frequency, voiced = true) {
        this.frequency = frequency;
        this.voiced = voiced; // 有声/無声の判定
    }
}

function createPitchStates(minFreq = 80, maxFreq = 800, stepsPerSemitone = 5) {
    const states = [new PitchState(0, false)]; // 無声状態
    
    const minMidi = 12 * Math.log2(minFreq / 440) + 69;
    const maxMidi = 12 * Math.log2(maxFreq / 440) + 69;
    
    for (let midi = minMidi; midi <= maxMidi; midi += 1/stepsPerSemitone) {
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        states.push(new PitchState(freq, true));
    }
    
    return states;
}
```

#### 3.2 遷移確率の計算
```javascript
function calculateTransitionProbabilities(states) {
    const numStates = states.length;
    const transitions = Array(numStates).fill().map(() => Array(numStates).fill(0));
    
    // 自己遷移確率（高い）
    const selfTransition = 0.9;
    
    for (let i = 0; i < numStates; i++) {
        transitions[i][i] = selfTransition;
        
        // 近隣状態への遷移確率
        const remainingProb = 1 - selfTransition;
        const neighborCount = Math.min(10, numStates - 1); // 近隣10状態
        
        for (let j = 0; j < numStates; j++) {
            if (i !== j) {
                const distance = Math.abs(i - j);
                if (distance <= neighborCount) {
                    transitions[i][j] = remainingProb * Math.exp(-distance / 5) / neighborCount;
                }
            }
        }
    }
    
    return transitions;
}
```

#### 3.3 観測確率の計算
```javascript
function calculateObservationProbabilities(states, observations) {
    const numStates = states.length;
    const numObs = observations.length;
    const obsProb = Array(numObs).fill().map(() => Array(numStates).fill(0));
    
    for (let t = 0; t < numObs; t++) {
        const obs = observations[t]; // ピッチ候補とその確率
        
        for (let s = 0; s < numStates; s++) {
            const state = states[s];
            
            if (!state.voiced) {
                // 無声状態：ピッチ候補が少ない場合に高確率
                obsProb[t][s] = obs.length === 0 ? 0.8 : 0.2;
            } else {
                // 有声状態：最も近いピッチ候補の確率を使用
                let maxProb = 0.01; // 最小確率
                
                obs.forEach(candidate => {
                    const freqRatio = candidate.frequency / state.frequency;
                    const cents = 1200 * Math.log2(freqRatio);
                    
                    if (Math.abs(cents) < 50) { // 50セント以内
                        const prob = candidate.probability * Math.exp(-Math.abs(cents) / 25);
                        maxProb = Math.max(maxProb, prob);
                    }
                });
                
                obsProb[t][s] = maxProb;
            }
        }
    }
    
    return obsProb;
}
```

### ステップ4: ビタビアルゴリズムの実装

#### 4.1 前向き確率の計算
```javascript
function viterbiAlgorithm(states, transitions, observations, obsProb) {
    const numStates = states.length;
    const numObs = observations.length;
    
    // ビタビ確率テーブル
    const viterbi = Array(numObs).fill().map(() => Array(numStates).fill(0));
    const path = Array(numObs).fill().map(() => Array(numStates).fill(0));
    
    // 初期化
    const initialProb = 1 / numStates; // 均等確率
    for (let s = 0; s < numStates; s++) {
        viterbi[0][s] = initialProb * obsProb[0][s];
    }
    
    // 前向き計算
    for (let t = 1; t < numObs; t++) {
        for (let s = 0; s < numStates; s++) {
            let maxProb = 0;
            let maxState = 0;
            
            for (let prev = 0; prev < numStates; prev++) {
                const prob = viterbi[t-1][prev] * transitions[prev][s] * obsProb[t][s];
                if (prob > maxProb) {
                    maxProb = prob;
                    maxState = prev;
                }
            }
            
            viterbi[t][s] = maxProb;
            path[t][s] = maxState;
        }
    }
    
    return { viterbi, path };
}
```

#### 4.2 後向きトレースバック
```javascript
function tracebackPath(viterbi, path, states) {
    const numObs = viterbi.length;
    const numStates = viterbi[0].length;
    const bestPath = new Array(numObs);
    
    // 最後の時刻での最適状態を見つける
    let maxProb = 0;
    let bestState = 0;
    for (let s = 0; s < numStates; s++) {
        if (viterbi[numObs-1][s] > maxProb) {
            maxProb = viterbi[numObs-1][s];
            bestState = s;
        }
    }
    
    // 後向きトレースバック
    bestPath[numObs-1] = bestState;
    for (let t = numObs-2; t >= 0; t--) {
        bestPath[t] = path[t+1][bestPath[t+1]];
    }
    
    // 状態インデックスを周波数に変換
    return bestPath.map(stateIndex => ({
        frequency: states[stateIndex].frequency,
        voiced: states[stateIndex].voiced
    }));
}
```

### ステップ5: メインPYIN関数の実装

```javascript
class PYINDetector {
    constructor(sampleRate, frameSize = 2048) {
        this.sampleRate = sampleRate;
        this.frameSize = frameSize;
        this.states = createPitchStates();
        this.transitions = calculateTransitionProbabilities(this.states);
    }
    
    detectPitch(audioFrames) {
        const observations = [];
        
        // 各フレームでピッチ候補を抽出
        audioFrames.forEach(frame => {
            const df = calculateDifferenceFunction(frame);
            const cmndf = calculateCMNDF(df);
            const candidates = extractMultipleCandidates(cmndf);
            const probabilities = calculatePitchProbabilities(candidates, cmndf, this.sampleRate);
            observations.push(probabilities);
        });
        
        // HMMで最適パスを計算
        const obsProb = calculateObservationProbabilities(this.states, observations);
        const { viterbi, path } = viterbiAlgorithm(this.states, this.transitions, observations, obsProb);
        const pitchTrack = tracebackPath(viterbi, path, this.states);
        
        return pitchTrack;
    }
}
```

## 実装時の注意点

1. **計算効率化**: FFTベースの差分関数計算の実装
2. **メモリ管理**: 大きな状態空間での効率的なメモリ使用
3. **パラメータ調整**: 閾値、遷移確率、状態数の最適化
4. **リアルタイム対応**: フレームバッファリングとオーバーラップ処理

この実装により、ノイズ耐性が高く、複数のピッチ候補を考慮した堅牢なピッチ検出が可能になります。