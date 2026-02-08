/**
 * PYIN (Probabilistic YIN) Pitch Detection Algorithm Implementation
 * Based on the paper "A Probabilistic Model for Main Melody Extraction" 
 * by Matthias Mauch and Simon Dixon
 */

import { YINCore } from './yin.js';
import { generateThresholds, calculateBetaProbabilities, boltzmannPmf } from './statistics.js';

/**
 * Pitch State for HMM
 */
export class PitchState {
    /**
     * @param {number} frequency - Frequency in Hz
     * @param {boolean} voiced - Whether this is a voiced state
     */
    constructor(frequency, voiced = true) {
        this.frequency = frequency;
        this.voiced = voiced;
        // Pre-calculate log2 frequency for faster cents calculation in observations
        this.log2freq = frequency > 0 ? Math.log2(frequency) : -1;
    }
}

/**
 * PYIN Algorithm Core Functions
 */
export class PYINCore {
    /**
     * Calculate difference function (reuse from YIN)
     * @param {Float32Array} audioBuffer - Input audio buffer
     * @param {Float32Array} differenceBuffer - Output buffer
     */
    static calculateDifferenceFunction(audioBuffer, differenceBuffer) {
        YINCore.calculateDifferenceFunction(audioBuffer, differenceBuffer);
    }

    /**
     * Calculate CMNDF (reuse from YIN)
     * @param {Float32Array} df - Difference function
     * @param {Float32Array} cmndfBuffer - Output buffer
     */
    static calculateCMNDF(df, cmndfBuffer) {
        YINCore.calculateCMNDF(df, cmndfBuffer);
    }

    /**
     * Create pitch states for HMM
     * @param {number} minFreq - Minimum frequency
     * @param {number} maxFreq - Maximum frequency
     * @param {number} stepsPerSemitone - Steps per semitone
     * @returns {Array<PitchState>} Array of pitch states
     */
    static createPitchStates(minFreq = 80, maxFreq = 800, stepsPerSemitone = 5) {
        const states = [new PitchState(0, false)]; // Unvoiced state

        const minMidi = 12 * Math.log2(minFreq / 440) + 69;
        const maxMidi = 12 * Math.log2(maxFreq / 440) + 69;

        for (let midi = minMidi; midi <= maxMidi; midi += 1 / stepsPerSemitone) {
            const freq = 440 * Math.pow(2, (midi - 69) / 12);
            states.push(new PitchState(freq, true));
        }

        return states;
    }

    /**
     * Extract multiple pitch candidates with fundamental frequency bias.
     * Combines pYIN's probabilistic approach with YIN's early-stopping bias.
     * 
     * OPTIMIZATION: Uses geometric series formula for Boltzmann PMF normalization.
     * 
     * @param {Float32Array} cmndf - CMNDF values
     * @param {number} sampleRate - Sample rate
     * @param {number} nThresholds - Number of thresholds
     * @param {number} minFreq - Min freq
     * @param {number} maxFreq - Max freq
     * @returns {Array<Object>} Array of candidate objects
     */
    static extractMultipleCandidates(cmndf, sampleRate = 44100, nThresholds = 100, minFreq = 80, maxFreq = 800) {
        const minTau = Math.max(1, Math.floor(sampleRate / maxFreq));
        const maxTau = Math.min(cmndf.length - 1, Math.ceil(sampleRate / minFreq));

        // Generate beta distribution thresholds
        const thresholds = generateThresholds(nThresholds);
        const betaProbs = calculateBetaProbabilities(thresholds, 2, 18);

        // Find all local minima (troughs) within range
        const allTroughs = [];
        for (let tau = minTau; tau <= maxTau; tau++) {
            if (cmndf[tau] <= cmndf[tau - 1] && cmndf[tau] <= cmndf[tau + 1]) {
                allTroughs.push({
                    tau: tau,
                    value: cmndf[tau],
                    frequency: sampleRate / tau
                });
            }
        }

        if (allTroughs.length === 0) return [];

        // Sort by tau for fundamental frequency bias (favoring lower frequencies/higher lags)
        allTroughs.sort((a, b) => {
            const tauDiff = a.tau - b.tau;
            if (Math.abs(tauDiff) > 50) return tauDiff;
            return a.value - b.value;
        });

        const troughProbabilities = new Map();
        const rBoltzmann = Math.exp(-2); // Constant factor for Boltzmann distribution parameter a=2

        // Process thresholds to accumulate probability for each trough
        for (let i = 1; i < thresholds.length; i++) {
            const threshold = thresholds[i];
            const betaProb = betaProbs[i - 1];

            // Optimization: Count qualifying troughs
            let count = 0;
            for (let j = 0; j < allTroughs.length; j++) {
                if (allTroughs[j].value < threshold) count++;
            }

            if (count > 0) {
                // Math Analysis: Boltzmann normalization sum is a geometric series.
                // sum_{i=0}^{count-1} r^i = (1 - r^count) / (1 - r)
                const sumBoltzmann = (1 - Math.pow(rBoltzmann, count)) / (1 - rBoltzmann);
                let troughIndex = 0;
                for (let j = 0; j < allTroughs.length; j++) {
                    const trough = allTroughs[j];
                    if (trough.value < threshold) {
                        const boltProb = Math.pow(rBoltzmann, troughIndex) / sumBoltzmann;
                        // Fundamental frequency bias: slightly favor longer periods
                        const fundamentalBias = 1 - Math.exp(-trough.tau / 200.0);
                        const weight = betaProb * boltProb * fundamentalBias;

                        troughProbabilities.set(trough.tau, (troughProbabilities.get(trough.tau) || 0) + weight);
                        troughIndex++;
                    }
                }
            }
        }

        // Convert tau lags back to frequencies with parabolic interpolation
        const candidates = [];
        for (const [tau, prob] of troughProbabilities.entries()) {
            let preciseTau = tau;
            if (tau > 0 && tau < cmndf.length - 1) {
                const y1 = cmndf[tau - 1], y2 = cmndf[tau], y3 = cmndf[tau + 1];
                const a = y3 + y1 - 2 * y2, b = (y3 - y1) / 2;
                if (Math.abs(b) < Math.abs(a) && a !== 0) {
                    const x0 = -b / a;
                    if (Math.abs(x0) < 1) preciseTau = tau + x0;
                }
            }
            candidates.push({
                frequency: sampleRate / preciseTau,
                tau: preciseTau,
                probability: prob
            });
        }

        // Normalize total probability
        let totalProb = 0;
        for (const c of candidates) totalProb += c.probability;
        if (totalProb > 0) {
            for (const c of candidates) c.probability /= totalProb;
        }

        return candidates.sort((a, b) => b.probability - a.probability);
    }

    /**
     * Calculate observation probabilities (librosa pYIN style).
     * @param {Array<PitchState>} states - Array of pitch states
     * @param {Array<Array<Object>>} observations - Array of observations (pitch candidates)
     * @returns {Array<Array<number>>} Observation probability matrix
     */
    static calculateObservationProbabilities(states, observations) {
        const numStates = states.length;
        const numObs = observations.length;
        const result = Array(numObs).fill().map(() => new Float32Array(numStates));

        const sigma = 50;
        const sigmaScale = -1 / (2 * sigma * sigma);
        const centsScale = 1200;

        for (let t = 0; t < numObs; t++) {
            const obs = observations[t];
            let totalVoicedProb = 0;
            for (const c of obs) totalVoicedProb += c.probability;
            const unvoicedLogProb = Math.log(Math.max(1e-15, 1 - Math.min(1, totalVoicedProb)));

            for (let s = 0; s < numStates; s++) {
                const state = states[s];
                if (!state.voiced) {
                    result[t][s] = unvoicedLogProb;
                } else {
                    let bestWeight = 1e-15;
                    for (const c of obs) {
                        const diffCents = centsScale * (Math.log2(c.frequency) - state.log2freq);
                        const weight = c.probability * Math.exp(diffCents * diffCents * sigmaScale);
                        if (weight > bestWeight) bestWeight = weight;
                    }
                    result[t][s] = Math.log(bestWeight);
                }
            }
        }
        return result.map(frame => Array.from(frame).map(Math.exp));
    }
    /**
     * Generic Viterbi Algorithm (Forward-Backward optimal path finding).
     * Used for offline batch processing.
     * 
     * @param {Float32Array} logInitial - Log probabilities of initial states
     * @param {Object} logTransitions - Transition data (either matrix or PYINTransitions)
     * @param {Float32Array} logObserv - Log observation probabilities [numFrames * numStates] flat
     * @param {number} numFrames - Number of time steps
     * @param {number} numStates - Number of states
     * @returns {Int32Array} Optimal path (indices of states)
     */
    static viterbi(logInitial, logTransitions, logObserv, numFrames, numStates) {
        const viterbiLogProb = new Float32Array(numFrames * numStates);
        const backpointer = new Int32Array(numFrames * numStates);

        // Initialization (Frame 0)
        for (let s = 0; s < numStates; s++) {
            viterbiLogProb[s] = logInitial[s] + logObserv[s];
            backpointer[s] = -1;
        }

        const nextProbs = new Float32Array(numStates);
        const stepBackpointer = new Int32Array(numStates);

        // Recursion (Forward pass)
        for (let t = 1; t < numFrames; t++) {
            const prevOffset = (t - 1) * numStates;
            const currentOffset = t * numStates;
            const prevProbs = viterbiLogProb.subarray(prevOffset, prevOffset + numStates);
            const currentObs = logObserv.subarray(currentOffset, currentOffset + numStates);

            // Use optimized step
            PYINCore.forwardViterbiStep(prevProbs, logTransitions, currentObs, nextProbs, stepBackpointer);

            for (let s = 0; s < numStates; s++) {
                viterbiLogProb[currentOffset + s] = nextProbs[s];
                backpointer[currentOffset + s] = stepBackpointer[s];
            }
        }

        // Termination
        let lastBestState = 0;
        let maxLast = -Infinity;
        const finalOffset = (numFrames - 1) * numStates;
        for (let s = 0; s < numStates; s++) {
            if (viterbiLogProb[finalOffset + s] > maxLast) {
                maxLast = viterbiLogProb[finalOffset + s];
                lastBestState = s;
            }
        }

        // Traceback (Backward pass)
        const path = new Int32Array(numFrames);
        let curr = lastBestState;
        path[numFrames - 1] = curr;
        for (let t = numFrames - 1; t > 0; t--) {
            curr = backpointer[t * numStates + curr];
            path[t - 1] = curr;
        }
        return path;
    }

    /**
     * Optimized Forward Viterbi Step.
     * 
     * WHY Analysis: O(N) optimization for pYIN structure.
     * The transition matrix for pYIN is highly sparse/structured. 
     * Any state switches to a "voiced" or "unvoiced" target group with shared probabilities.
     * Instead of iterating N*N, we only need to compare:
     * 1. Self-transition (unique to each state)
     * 2. Max from same-voicing group (shared constant)
     * 3. Max from different-voicing group (shared constant)
     * 
     * @param {Float32Array} prevLogProbs - Probabilities from previous frame
     * @param {Object} transitions - Matrix or PYINTransitions optimization object
     * @param {Float32Array} currentLogObs - Observation log probabilities for current frame
     * @param {Float32Array} newLogProbs - Output buffer for new probabilities
     * @param {Int32Array} backpointer - Optional output for best previous state indices
     * @returns {Float32Array} Updated probabilities
     */
    static forwardViterbiStep(prevLogProbs, transitions, currentLogObs, newLogProbs = null, backpointer = null) {
        const numStates = prevLogProbs.length;
        if (!newLogProbs) newLogProbs = new Float32Array(numStates);

        // Optimization: Handle structured pYIN transitions in O(N)
        if (transitions instanceof PYINTransitions) {
            let maxVoiced = { val: -Infinity, idx: 0 };
            let maxUnvoiced = { val: -Infinity, idx: 0 };

            // O(N): Find max probability in each voicing group
            for (let i = 0; i < numStates; i++) {
                if (transitions.isVoiced[i]) {
                    if (prevLogProbs[i] > maxVoiced.val) { maxVoiced.val = prevLogProbs[i]; maxVoiced.idx = i; }
                } else {
                    if (prevLogProbs[i] > maxUnvoiced.val) { maxUnvoiced.val = prevLogProbs[i]; maxUnvoiced.idx = i; }
                }
            }

            const { logSelf, logSameOther, logSwitchOther } = transitions;

            for (let s = 0; s < numStates; s++) {
                const isVoicedS = transitions.isVoiced[s];
                const selfVal = prevLogProbs[s] + logSelf;
                const sameOtherMax = (isVoicedS ? maxVoiced : maxUnvoiced);
                const switchOtherMax = (isVoicedS ? maxUnvoiced : maxVoiced);

                let maxVal = selfVal;
                let bestPrev = s;

                // Compare self-transition vs jumping from another state in the same voicing group
                if (sameOtherMax.val + logSameOther > maxVal) {
                    maxVal = sameOtherMax.val + logSameOther;
                    bestPrev = sameOtherMax.idx;
                }
                // Compare with switching from the other voicing group
                if (switchOtherMax.val + logSwitchOther > maxVal) {
                    maxVal = switchOtherMax.val + logSwitchOther;
                    bestPrev = switchOtherMax.idx;
                }

                newLogProbs[s] = maxVal + currentLogObs[s];
                if (backpointer) backpointer[s] = bestPrev;
            }
            return newLogProbs;
        }

        // Generic O(N^2) path for general HMMs (preserved for compatibility/tests)
        for (let s = 0; s < numStates; s++) {
            let maxVal = -Infinity, bestPrev = 0;
            for (let prev = 0; prev < numStates; prev++) {
                const row = transitions[prev];
                const trans = (row !== undefined && typeof row !== 'number') ? row[s] : transitions[prev * numStates + s];
                if (trans === -Infinity) continue;
                const prob = prevLogProbs[prev] + trans;
                if (prob > maxVal) { maxVal = prob; bestPrev = prev; }
            }
            newLogProbs[s] = maxVal + currentLogObs[s];
            if (backpointer) backpointer[s] = bestPrev;
        }
        return newLogProbs;
    }

    /**
     * Calculate dense transition probabilities.
     * Preserved for backward compatibility markers and tests.
     */
    static calculateTransitionProbabilities(states, switchProb = 0.01) {
        const numStates = states.length;
        const selfTransition = 0.99;
        const transitions = Array(numStates).fill().map(() => new Float32Array(numStates));
        for (let i = 0; i < numStates; i++) {
            const stateI = states[i];
            let vSwitch = 0, uSwitch = 0, sameCount = 0;
            for (let k = 0; k < numStates; k++) {
                if (k === i) continue;
                if (states[k].voiced !== stateI.voiced) {
                    if (states[k].voiced) vSwitch++; else uSwitch++;
                } else sameCount++;
            }
            const switchTargetCount = stateI.voiced ? uSwitch : vSwitch;
            const remainingProb = 1 - selfTransition;
            const switchPerTarget = switchTargetCount > 0 ? switchProb / switchTargetCount : 0;
            const samePerTarget = sameCount > 0 ? (remainingProb - switchProb) / sameCount : 0;
            for (let j = 0; j < numStates; j++) {
                if (i === j) transitions[i][j] = selfTransition;
                else if (states[i].voiced !== states[j].voiced) transitions[i][j] = switchPerTarget;
                else transitions[i][j] = samePerTarget;
            }
        }
        return transitions;
    }
}

/**
 * Metadata for O(N) optimized transitions in pYIN
 */
class PYINTransitions {
    constructor(states, switchProb = 0.01) {
        const numStates = states.length;
        this.isVoiced = new Uint8Array(numStates);
        let voicedCount = 0, unvoicedCount = 0;
        for (let i = 0; i < numStates; i++) {
            if (states[i].voiced) { this.isVoiced[i] = 1; voicedCount++; }
            else { this.isVoiced[i] = 0; unvoicedCount++; }
        }
        const selfTransition = 0.99, remainingProb = 1 - selfTransition;
        this.logSelf = Math.log(selfTransition);
        const sameOther = (remainingProb - switchProb) / Math.max(1, voicedCount - 1);
        const switchOther = switchProb / Math.max(1, unvoicedCount);
        this.logSameOther = sameOther > 0 ? Math.log(sameOther) : -100;
        this.logSwitchOther = switchOther > 0 ? Math.log(switchOther) : -100;
    }
}

/**
 * Complete PYIN Detector Implementation
 */
export class PYINDetector {
    /**
     * @param {number} sampleRate - Sample rate in Hz
     * @param {number} frameSize - FFT window size
     * @param {number} minFreq - Lower detection limit
     * @param {number} maxFreq - Upper detection limit
     */
    constructor(sampleRate, frameSize = 2048, minFreq = 80, maxFreq = 800) {
        this.sampleRate = sampleRate;
        this.frameSize = frameSize;
        this.minFreq = minFreq;
        this.maxFreq = maxFreq;
        this.states = PYINCore.createPitchStates(minFreq, maxFreq);
        this.transitions = new PYINTransitions(this.states);

        // Pre-allocate analysis buffers to minimize GC pressure
        this.diffBuf = new Float32Array(frameSize);
        this.cmndfBuf = new Float32Array(frameSize);
        this.obsBuf = new Float32Array(this.states.length);

        this.reset();
    }

    /**
     * Clear HMM memory for a new stream
     */
    reset() {
        this.viterbiLogProb = null;
        this.isInitialized = false;
    }

    /**
     * Online real-time pitch detection.
     * Uses O(N) Viterbi forward step for low latency.
     * 
     * @param {Float32Array} buf - Input audio chunk
     * @returns {Array} [frequency, confidence]
     */
    findPitch(buf) {
        const numStates = this.states.length;

        // 1. CMNDF and Candidate extraction
        PYINCore.calculateDifferenceFunction(buf, this.diffBuf);
        PYINCore.calculateCMNDF(this.diffBuf, this.cmndfBuf);
        // Using lower threshold count for real-time (50) vs batch (100)
        const cands = PYINCore.extractMultipleCandidates(this.cmndfBuf, this.sampleRate, 50, this.minFreq, this.maxFreq);

        // 2. Observation log-probabilities (Inlined for performance)
        const sigmaScale = -1 / (2 * 50 * 50);
        let totalVoiced = 0;
        for (const c of cands) totalVoiced += c.probability;
        const unvoicedLog = Math.log(Math.max(1e-15, 1 - Math.min(1, totalVoiced)));

        for (let s = 0; s < numStates; s++) {
            const state = this.states[s];
            if (!state.voiced) {
                this.obsBuf[s] = unvoicedLog;
            } else {
                let best = 1e-15;
                for (const c of cands) {
                    const d = 1200 * (Math.log2(c.frequency) - state.log2freq);
                    const w = c.probability * Math.exp(d * d * sigmaScale);
                    if (w > best) best = w;
                }
                this.obsBuf[s] = Math.log(best);
            }
        }

        // 3. Forward Viterbi update
        if (!this.isInitialized) {
            this.viterbiLogProb = new Float32Array(numStates);
            const vCount = this.states.filter(s => s.voiced).length;
            const logV = Math.log(0.9 / vCount), logU = Math.log(0.1);
            for (let i = 0; i < numStates; i++) this.viterbiLogProb[i] = (this.states[i].voiced ? logV : logU) + this.obsBuf[i];
            this.isInitialized = true;
        } else {
            const next = new Float32Array(numStates);
            PYINCore.forwardViterbiStep(this.viterbiLogProb, this.transitions, this.obsBuf, next);
            this.viterbiLogProb = next;
        }

        // 4. Find MAP (Maximum A Posteriori) state
        let maxL = -Infinity, best = 0;
        for (let i = 0; i < numStates; i++) if (this.viterbiLogProb[i] > maxL) { maxL = this.viterbiLogProb[i]; best = i; }

        const state = this.states[best];
        if (!state.voiced) return [0, 0];

        // Probability mass aggregation for confidence score
        let sum = 0;
        for (let i = 0; i < numStates; i++) {
            const d = this.viterbiLogProb[i] - maxL;
            if (d > -20) sum += Math.exp(d);
        }
        return [state.frequency, 1 / sum];
    }

    /**
     * Offline batch detection across multiple frames.
     * Runs full forward-backward Viterbi for global optimization.
     * 
     * @param {Array<Float32Array>} frames - Audio frame sequence
     * @returns {Array<Object>} Optimized pitch track
     */
    detectPitch(frames) {
        const nFrames = frames.length, nStates = this.states.length;
        const obsLogs = new Float32Array(nFrames * nStates);

        // Step 1: Analyze all frames
        for (let t = 0; t < nFrames; t++) {
            PYINCore.calculateDifferenceFunction(frames[t], this.diffBuf);
            PYINCore.calculateCMNDF(this.diffBuf, this.cmndfBuf);
            const cands = PYINCore.extractMultipleCandidates(this.cmndfBuf, this.sampleRate, 100, this.minFreq, this.maxFreq);

            let totalVoiced = 0;
            for (const c of cands) totalVoiced += c.probability;
            const unvoicedLog = Math.log(Math.max(1e-15, 1 - Math.min(1, totalVoiced)));

            for (let s = 0; s < nStates; s++) {
                const state = this.states[s];
                if (!state.voiced) {
                    obsLogs[t * nStates + s] = unvoicedLog;
                } else {
                    let best = 1e-15;
                    for (const c of cands) {
                        const d = 1200 * (Math.log2(c.frequency) - state.log2freq);
                        const weight = c.probability * Math.exp(d * d * (-1 / (2 * 50 * 50)));
                        if (weight > best) best = weight;
                    }
                    obsLogs[t * nStates + s] = Math.log(best);
                }
            }
        }

        // Step 2: Global Viterbi path find
        const vCount = this.states.filter(s => s.voiced).length;
        const logV = Math.log(0.9 / vCount), logU = Math.log(0.1);
        const initial = new Float32Array(nStates);
        for (let s = 0; s < nStates; s++) initial[s] = (this.states[s].voiced ? logV : logU);

        const path = PYINCore.viterbi(initial, this.transitions, obsLogs, nFrames, nStates);
        return Array.from(path).map(idx => ({ frequency: this.states[idx].frequency, voiced: this.states[idx].voiced }));
    }
}

/**
 * Factory function for Pitchy-compatible API
 */
export function createPYINDetector(frameSize = 2048, minFreq = 80, maxFreq = 800) {
    return {
        forFloat32Array: (sr) => {
            const d = new PYINDetector(sr, frameSize, minFreq, maxFreq);
            return { findPitch: (buf) => d.findPitch(buf) };
        }
    };
}
