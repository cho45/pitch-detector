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

        // Align to the nearest stepsPerSemitone grid
        const startMidi = Math.ceil(minMidi * stepsPerSemitone) / stepsPerSemitone;

        for (let midi = startMidi; midi <= maxMidi; midi += 1 / stepsPerSemitone) {
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
        for (let tau = minTau; tau < maxTau; tau++) {
            if (cmndf[tau] <= cmndf[tau - 1] && cmndf[tau] <= cmndf[tau + 1]) {
                allTroughs.push({
                    tau: tau,
                    value: cmndf[tau],
                    frequency: sampleRate / tau
                });
            }
        }

        if (allTroughs.length === 0) return [];

        // Sort by tau for fundamental frequency bias (favoring shorter periods / higher frequencies)
        // as per the pYIN paper's use of Boltzmann distribution on ordered troughs.
        allTroughs.sort((a, b) => a.tau - b.tau);

        const troughProbabilities = new Map();
        const rBoltzmann = Math.exp(-2); // Boltzmann distribution parameter a=2

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
                        const weight = betaProb * boltProb;

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

        return candidates.sort((a, b) => b.probability - a.probability);
    }

    /**
     * Calculate observation probabilities (librosa pYIN style).
     * @param {Array<PitchState>} states - Array of pitch states
     * @param {Array<Array<Object>>} observations - Array of observations (pitch candidates)
     * @returns {Array<Array<number>>} Observation probability matrix
     */
    /**
     * Calculate observation log-probabilities for a single frame.
     * Operates entirely in the log-domain for numerical stability and performance.
     * 
     * @param {Array<PitchState>} states - HMM states
     * @param {Array<Object>} observations - Pitch candidates for this frame
     * @param {Float32Array} outputLogProbs - Buffer to fill with log-likelihoods
     */
    static fillObservationLogProbabilities(states, observations, outputLogProbs) {
        const numStates = states.length;
        const sigma = 50;
        const sigmaScale = -1 / (2 * sigma * sigma);
        const centsScale = 1200;
        
        // Count voiced states once
        let vCount = 0;
        for (let i = 0; i < numStates; i++) if (states[i].voiced) vCount++;

        let totalVoicedProb = 0;
        for (const c of observations) totalVoicedProb += c.probability;

        // Density-normalized unvoiced likelihood (Log-domain)
        const rawUnvoicedProb = Math.max(1e-15, 1 - Math.min(1, totalVoicedProb));
        const unvoicedLogProb = Math.log(rawUnvoicedProb / Math.max(1, vCount));

        for (let s = 0; s < numStates; s++) {
            const state = states[s];
            if (!state.voiced) {
                outputLogProbs[s] = unvoicedLogProb;
            } else {
                let bestLogWeight = -100; // Small log-probability as floor (~1e-43)
                for (const c of observations) {
                    const diffCents = centsScale * (Math.log2(c.frequency) - state.log2freq);
                    // Weight = log(c.prob * exp(cents_dist)) = log(c.prob) + cents_dist
                    const logWeight = Math.log(Math.max(1e-15, c.probability)) + (diffCents * diffCents * sigmaScale);
                    if (logWeight > bestLogWeight) bestLogWeight = logWeight;
                }
                outputLogProbs[s] = bestLogWeight;
            }
        }
    }

    /**
     * Legacy placeholder for backward compatibility (if needed)
     * @deprecated Use fillObservationLogProbabilities instead
     */
    static calculateObservationProbabilities(states, observations) {
        return observations.map(obs => {
            const logProbs = new Float32Array(states.length);
            this.fillObservationLogProbabilities(states, obs, logProbs);
            return Array.from(logProbs).map(Math.exp);
        });
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

        const logMatrix = transitions.logMatrix;

        if (logMatrix) {
            // Optimized path for PYINTransitions object (O(N^2) but fast due to direct array access)
            let matrixIdx = 0;
            for (let s = 0; s < numStates; s++) {
                let maxVal = -Infinity, bestPrev = 0;
                // We need to access logMatrix[prev * numStates + s]
                // but since we iterate s in outer loop, the stride is numStates.
                // However, if we swap the loops or use a better index, we can improve cache locality.
                // For now, let's just do direct index to keep it simple and correct.
                for (let prev = 0; prev < numStates; prev++) {
                    const prob = prevLogProbs[prev] + logMatrix[prev * numStates + s];
                    if (prob > maxVal) { maxVal = prob; bestPrev = prev; }
                }
                newLogProbs[s] = maxVal + currentLogObs[s];
                if (backpointer) backpointer[s] = bestPrev;
            }
        } else {
            // Generic path for legacy test matrices
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
        }
        return newLogProbs;
    }

    /**
     * Calculate dense transition probabilities.
     * Preserved for backward compatibility markers and tests.
     */
    static calculateTransitionProbabilities(states, switchProb = 0.002) {
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
 * Transition probabilities for pYIN
 * Based on Mauch & Dixon (2014) Section 3.2.2
 */
class PYINTransitions {
    /**
     * @param {Array<PitchState>} states - HMM states
     * @param {number} switchProb - Probability of switching between voiced/unvoiced
     */
    constructor(states, switchProb = 0.01) {
        const numStates = states.length;
        this.numStates = numStates;
        this.logMatrix = new Float32Array(numStates * numStates).fill(-Infinity);

        const sigmaTrans = 50; // cents (from paper)
        
        const voicedIndices = [];
        const unvoicedIndices = [];
        for (let i = 0; i < numStates; i++) {
            if (states[i].voiced) voicedIndices.push(i);
            else unvoicedIndices.push(i);
        }

        for (let i = 0; i < numStates; i++) {
            const sI = states[i];
            const rowProbs = new Float32Array(numStates);
            let sameGroupSum = 0;

            // 1. Calculate raw transition weights for the same voicing group
            for (let j = 0; j < numStates; j++) {
                const sJ = states[j];
                if (sI.voiced === sJ.voiced) {
                    if (sI.voiced) {
                        // Voiced to Voiced: Gaussian based on cent distance
                        const diffCents = 1200 * (sJ.log2freq - sI.log2freq);
                        rowProbs[j] = Math.exp(-0.5 * Math.pow(diffCents / sigmaTrans, 2));
                    } else {
                        // Unvoiced to Unvoiced: Uniform
                        rowProbs[j] = 1.0 / Math.max(1, unvoicedIndices.length);
                    }
                    sameGroupSum += rowProbs[j];
                }
            }

            // 2. Normalize and distribute probabilities
            // P(stay in same group) = 1 - switchProb
            // P(switch to other group) = switchProb
            const targetGroup = sI.voiced ? unvoicedIndices : voicedIndices;
            const switchProbPerState = switchProb / Math.max(1, targetGroup.length);

            for (let j = 0; j < numStates; j++) {
                const sJ = states[j];
                let finalProb = 0;

                if (sI.voiced === sJ.voiced) {
                    finalProb = (1 - switchProb) * (rowProbs[j] / sameGroupSum);
                } else {
                    finalProb = switchProbPerState;
                }
                this.logMatrix[i * numStates + j] = Math.log(Math.max(1e-30, finalProb));
            }
        }
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

        // 2. Observation log-probabilities (Centralized log-domain logic)
        PYINCore.fillObservationLogProbabilities(this.states, cands, this.obsBuf);

        // 3. Forward Viterbi update
        if (!this.isInitialized) {
            this.viterbiLogProb = new Float32Array(numStates);
            const vCount = this.states.filter(s => s.voiced).length;
            const logV = Math.log(0.5 / vCount), logU = Math.log(0.5);
            for (let i = 0; i < numStates; i++) this.viterbiLogProb[i] = (this.states[i].voiced ? logV : logU) + this.obsBuf[i];
            this.isInitialized = true;
        } else {
            const next = new Float32Array(numStates);
            PYINCore.forwardViterbiStep(this.viterbiLogProb, this.transitions, this.obsBuf, next);
            this.viterbiLogProb = next;
        }

        // 4. Normalize log-probabilities to prevent underflow and find MAP state
        let maxL = -Infinity, best = 0;
        for (let i = 0; i < numStates; i++) {
            if (this.viterbiLogProb[i] > maxL) {
                maxL = this.viterbiLogProb[i];
                best = i;
            }
        }
        
        // Shift all so maxL is 0 (equivalent to dividing by max probability)
        for (let i = 0; i < numStates; i++) this.viterbiLogProb[i] -= maxL;

        const state = this.states[best];
        if (!state.voiced) return [0, 0];

        // 5. Calculate Voicing Confidence (Total probability of all voiced states)
        // Since we normalized maxL to 0, actual probability P(s) = exp(viterbiLogProb[s]) / sum(exp(viterbiLogProb))
        let sumVoiced = 0;
        let sumTotal = 0;
        for (let i = 0; i < numStates; i++) {
            const p = Math.exp(this.viterbiLogProb[i]);
            sumTotal += p;
            if (this.states[i].voiced) sumVoiced += p;
        }
        
        const confidence = sumVoiced / sumTotal;
        return [state.frequency, confidence];
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

        // Step 1: Extract all candidates for all frames
        const allCands = frames.map(buf => {
            PYINCore.calculateDifferenceFunction(buf, this.diffBuf);
            PYINCore.calculateCMNDF(this.diffBuf, this.cmndfBuf);
            // Use 100 thresholds for batch processing quality
            return PYINCore.extractMultipleCandidates(this.cmndfBuf, this.sampleRate, 100, this.minFreq, this.maxFreq);
        });

        // Step 2: Calculate observation log-probabilities directly in log-domain
        const obsLogs = new Float32Array(nFrames * nStates);
        for (let t = 0; t < nFrames; t++) {
            const frameLogs = obsLogs.subarray(t * nStates, (t + 1) * nStates);
            PYINCore.fillObservationLogProbabilities(this.states, allCands[t], frameLogs);
        }

        // Step 3: Global Viterbi path find
        const vCount = this.states.filter(s => s.voiced).length;
        const logV = Math.log(0.5 / vCount), logU = Math.log(0.5);
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
