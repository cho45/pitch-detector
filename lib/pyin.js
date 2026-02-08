/**
 * PYIN (Probabilistic YIN) Pitch Detection Algorithm Implementation
 * Based on the paper "A Probabilistic Model for Main Melody Extraction" 
 * by Matthias Mauch and Simon Dixon
 */

import { YINCore } from './yin.js';

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
        // Pre-calculate log2 frequency for faster cents calculation
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
     * Create pitch states for HMM aligned to MIDI-cent grid.
     * @param {number} minFreq - Minimum frequency
     * @param {number} maxFreq - Maximum frequency
     * @param {number} stepsPerSemitone - Steps per semitone
     * @returns {Array<PitchState>} Array of pitch states
     */
    static createPitchStates(minFreq = 80, maxFreq = 800, stepsPerSemitone = 5) {
        const states = [new PitchState(0, false)];
        const minMidi = 12 * Math.log2(minFreq / 440) + 69;
        const maxMidi = 12 * Math.log2(maxFreq / 440) + 69;
        const startMidi = Math.ceil(minMidi * stepsPerSemitone) / stepsPerSemitone;
        const eps = 1e-9;
        for (let midi = startMidi; midi <= maxMidi + eps; midi += 1 / stepsPerSemitone) {
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
     * ZERO-ALLOCATION implementation: Uses pre-allocated buffers and avoids objects/Maps.
     * 
     * @param {Float32Array} cmndf - CMNDF values
     * @param {number} sampleRate - Sample rate
     * @param {Object} context - Pre-allocated buffers and parameters
     * @returns {number} Number of candidates found
     */
    static extractMultipleCandidates(cmndf, sampleRate, context) {
        const { nThresholds, thresholds, betaProbs, minTau, maxTau, troughProbBuf, candidates, troughTau, troughVal } = context;
        let nTroughs = 0;
        troughProbBuf.fill(0);

        for (let tau = minTau; tau < maxTau && nTroughs < troughTau.length; tau++) {
            if (cmndf[tau] <= cmndf[tau - 1] && cmndf[tau] <= cmndf[tau + 1]) {
                troughTau[nTroughs] = tau;
                troughVal[nTroughs] = cmndf[tau];
                nTroughs++;
            }
        }
        if (nTroughs === 0) return 0;

        // Manual bubble sort to avoid allocation
        for (let i = 0; i < nTroughs - 1; i++) {
            for (let j = 0; j < nTroughs - 1 - i; j++) {
                if (troughTau[j] > troughTau[j + 1]) {
                    const t = troughTau[j]; troughTau[j] = troughTau[j + 1]; troughTau[j + 1] = t;
                    const v = troughVal[j]; troughVal[j] = troughVal[j + 1]; troughVal[j + 1] = v;
                }
            }
        }

        const rBoltzmann = Math.exp(-2); 
        for (let i = 1; i <= nThresholds; i++) {
            const threshold = thresholds[i], betaProb = betaProbs[i - 1];
            let count = 0;
            for (let j = 0; j < nTroughs; j++) if (troughVal[j] < threshold) count++;
            if (count > 0) {
                // Math Analysis: Boltzmann normalization sum is a geometric series.
                // sum_{i=0}^{count-1} r^i = (1 - r^count) / (1 - r)
                const sumBoltzmann = (1 - Math.pow(rBoltzmann, count)) / (1 - rBoltzmann);
                let tIdx = 0;
                for (let j = 0; j < nTroughs; j++) {
                    if (troughVal[j] < threshold) {
                        troughProbBuf[j] += betaProb * (Math.pow(rBoltzmann, tIdx) / sumBoltzmann);
                        tIdx++;
                    }
                }
            }
        }

        let nCands = 0;
        for (let j = 0; j < nTroughs && nCands < candidates.length; j++) {
            if (troughProbBuf[j] <= 0) continue;
            const tau = troughTau[j];
            let preciseTau = tau;
            if (tau > 0 && tau < cmndf.length - 1) {
                const y1 = cmndf[tau - 1], y2 = cmndf[tau], y3 = cmndf[tau + 1];
                const a = y3 + y1 - 2 * y2, b = (y3 - y1) / 2;
                if (Math.abs(b) < Math.abs(a) && a !== 0) {
                    const x0 = -b / a;
                    if (Math.abs(x0) < 1) preciseTau = tau + x0;
                }
            }
            candidates[nCands].frequency = sampleRate / preciseTau;
            candidates[nCands].probability = troughProbBuf[j];
            nCands++;
        }
        return nCands;
    }

    /**
     * Calculate observation log-probabilities (librosa pYIN style).
     * Operates entirely in the log-domain for numerical stability and performance.
     * 
     * ZERO-ALLOCATION.
     * 
     * @param {Array<PitchState>} states - Array of pitch states
     * @param {Array<Object>} candidates - Fixed-size candidate array
     * @param {number} nCands - Number of valid candidates in the array
     * @param {Float32Array} outputLogProbs - Buffer to fill with log-likelihoods
     * @param {number} stepsPerSemitone - Resolution used for density scaling
     * @param {Float32Array} candLogProbs - Pre-allocated buffer for log weights
     * @param {Float32Array} candLogFreqs - Pre-allocated buffer for log frequencies
     */
    static fillObservationLogProbabilities(states, candidates, nCands, outputLogProbs, stepsPerSemitone, candLogProbs, candLogFreqs) {
        const numStates = states.length, sigmaScale = -1 / (2 * 50 * 50), centsScale = 1200;
        let totalVoicedProb = 0;
        for (let i = 0; i < nCands; i++) {
            totalVoicedProb += candidates[i].probability;
            candLogProbs[i] = Math.log(Math.max(1e-15, candidates[i].probability));
            candLogFreqs[i] = Math.log2(candidates[i].frequency);
        }

        // WHY Analysis: Resolution-Invariant Density Normalization
        // In a discrete HMM, voiced states act as frequency bins. The unvoiced state is 
        // a single discrete point. To keep the ratio between them balanced as resolution
        // changes, we use the raw voicing probabilities without resolution-dependent scaling.
        const rawUnvoicedProb = Math.max(1e-15, 1 - Math.min(1, totalVoicedProb));
        const unvoicedLogProb = Math.log(rawUnvoicedProb);

        for (let s = 0; s < numStates; s++) {
            const state = states[s];
            if (!state.voiced) {
                outputLogProbs[s] = unvoicedLogProb;
            } else {
                let bestLog = -100;
                const sL2 = state.log2freq;
                for (let i = 0; i < nCands; i++) {
                    const d = centsScale * (candLogFreqs[i] - sL2);
                    const w = candLogProbs[i] + (d * d * sigmaScale);
                    if (w > bestLog) bestLog = w;
                }
                outputLogProbs[s] = bestLog;
            }
        }
    }

    /**
     * Generic Viterbi Algorithm (Forward-Backward optimal path finding).
     * Used for offline batch processing.
     * 
     * @param {Float32Array} logInitial - Log probabilities of initial states
     * @param {Object} transitions - Transition data containing logMatrix
     * @param {Float32Array} logObserv - Log observation probabilities [numFrames * numStates] flat
     * @param {number} numFrames - Number of time steps
     * @param {number} numStates - Number of states
     * @returns {Int32Array} Optimal path (indices of states)
     */
    static viterbi(logInitial, transitions, logObserv, numFrames, numStates) {
        const viterbiLogProb = new Float32Array(numFrames * numStates);
        const backpointer = new Int32Array(numFrames * numStates);
        const logMatrix = transitions.logMatrix;

        for (let s = 0; s < numStates; s++) {
            viterbiLogProb[s] = logInitial[s] + logObserv[s];
            backpointer[s] = -1;
        }

        const nextProbs = new Float32Array(numStates), stepBack = new Int32Array(numStates);
        for (let t = 1; t < numFrames; t++) {
            const prevOff = (t - 1) * numStates, currOff = t * numStates;
            const prevP = viterbiLogProb.subarray(prevOff, prevOff + numStates);
            const currO = logObserv.subarray(currOff, currOff + numStates);

            // Inlined forward step
            for (let s = 0; s < numStates; s++) {
                let maxV = -Infinity, bestP = 0;
                for (let prev = 0; prev < numStates; prev++) {
                    const prob = prevP[prev] + logMatrix[prev * numStates + s];
                    if (prob > maxV) { maxV = prob; bestP = prev; }
                }
                nextProbs[s] = maxV + currO[s];
                stepBack[s] = bestP;
            }

            for (let s = 0; s < numStates; s++) {
                viterbiLogProb[currOff + s] = nextProbs[s];
                backpointer[currOff + s] = stepBack[s];
            }
        }

        let maxL = -Infinity, lastS = 0;
        const finalOff = (numFrames - 1) * numStates;
        for (let s = 0; s < numStates; s++) {
            if (viterbiLogProb[finalOff + s] > maxL) { maxL = viterbiLogProb[finalOff + s]; lastS = s; }
        }

        const path = new Int32Array(numFrames);
        let curr = lastS;
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
     * WHY Analysis: O(N^2) implementation chosen for Gaussian distance accuracy.
     * The inner loop iterates over 'prev' states for a fixed 's'.
     * Accessing logMatrix[prev * numStates + s] results in a stride of numStates.
     * 
     * @param {Float32Array} prevLogProbs - Probabilities from previous frame
     * @param {Object} transitions - Object containing the log-transition matrix
     * @param {Float32Array} currentLogObs - Observation log probabilities for current frame
     * @param {Float32Array} newLogProbs - Output buffer for new probabilities
     * @param {Int32Array} backpointer - Optional output for best previous state indices
     * @returns {Float32Array} Updated probabilities
     */
    static forwardViterbiStep(prevLogProbs, transitions, currentLogObs, newLogProbs = null, backpointer = null) {
        const numStates = prevLogProbs.length;
        if (!newLogProbs) newLogProbs = new Float32Array(numStates);
        const logMatrix = transitions.logMatrix;
        for (let s = 0; s < numStates; s++) {
            let maxV = -Infinity, bestP = 0;
            for (let prev = 0; prev < numStates; prev++) {
                const prob = prevLogProbs[prev] + logMatrix[prev * numStates + s];
                if (prob > maxV) { maxV = prob; bestP = prev; }
            }
            newLogProbs[s] = maxV + currentLogObs[s];
            if (backpointer) backpointer[s] = bestP;
        }
        return newLogProbs;
    }
}

/**
 * Transition probabilities for pYIN
 * Based on Mauch & Dixon (2014) Section 3.2.2
 */
export class PYINTransitions {
    constructor(states, switchProb = 0.01) {
        const numStates = states.length;
        this.logMatrix = new Float32Array(numStates * numStates).fill(-Infinity);
        const sigmaTrans = 25; // cents
        const voicedIdx = [], unvoicedIdx = [];
        for (let i = 0; i < numStates; i++) {
            if (states[i].voiced) voicedIdx.push(i); else unvoicedIdx.push(i);
        }

        for (let i = 0; i < numStates; i++) {
            const sI = states[i], rowProbs = new Float32Array(numStates);
            let sameGroupSum = 0;
            for (let j = 0; j < numStates; j++) {
                const sJ = states[j];
                if (sI.voiced === sJ.voiced) {
                    if (sI.voiced) {
                        const d = 1200 * (sJ.log2freq - sI.log2freq);
                        rowProbs[j] = Math.exp(-0.5 * Math.pow(d / sigmaTrans, 2));
                    } else {
                        rowProbs[j] = 1.0 / Math.max(1, unvoicedIdx.length);
                    }
                    sameGroupSum += rowProbs[j];
                }
            }
            // 2. Normalize and distribute probabilities
            // P(stay in same group) = 1 - switchProb
            // P(switch to other group) = switchProb
            
            // MATH ANALYSIS: Resolution-Independent Transition Normalization.
            // To maintain balance across resolutions, the probability of switching from 
            // unvoiced to ANY voiced state must be treated as a density integral.
            const targetGroup = sI.voiced ? unvoicedIdx : voicedIdx;
            const switchProbPerState = switchProb / Math.max(1, targetGroup.length);
            for (let j = 0; j < numStates; j++) {
                let finalP = 0;
                if (sI.voiced === states[j].voiced) {
                    // Staying in same voicing group
                    finalP = (1 - switchProb) * (rowProbs[j] / sameGroupSum);
                } else {
                    // Switching voicing group
                    finalP = switchProbPerState;
                }
                this.logMatrix[i * numStates + j] = Math.log(Math.max(1e-30, finalP));
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
     * @param {number} stepsPerSemitone - Resolution of the pitch grid
     */
    constructor(sampleRate, frameSize = 2048, minFreq = 80, maxFreq = 800, stepsPerSemitone = 5) {
        this.sampleRate = sampleRate; this.frameSize = frameSize; this.stepsPerSemitone = stepsPerSemitone;
        this.minFreq = minFreq; this.maxFreq = maxFreq;
        this.states = PYINCore.createPitchStates(minFreq, maxFreq, stepsPerSemitone);
        this.transitions = new PYINTransitions(this.states);

        const nT = 50; // Threshold count for real-time performance
        this.context = {
            nThresholds: nT, thresholds: new Float32Array(nT + 1), betaProbs: new Float32Array(nT),
            minTau: Math.max(1, Math.floor(sampleRate / maxFreq)),
            maxTau: Math.min(frameSize - 1, Math.ceil(sampleRate / minFreq)),
            troughTau: new Int32Array(200), // Lag buffer
            troughVal: new Float32Array(200), // CMNDF value buffer
            troughProbBuf: new Float32Array(200), // Accumulated probability buffer
            candidates: Array(100).fill(0).map(() => ({ frequency: 0, probability: 0 })),
            candLogProbs: new Float32Array(100), // Scratch buffer for candidate log-probabilities
            candLogFreqs: new Float32Array(100)  // Scratch buffer for candidate log-frequencies
        };
        for (let i = 0; i <= nT; i++) this.context.thresholds[i] = i / nT;
        const betaCdf = (x) => 1 - Math.pow(1 - x, 18) * (1 + 18 * x);
        for (let i = 0; i < nT; i++) this.context.betaProbs[i] = betaCdf(this.context.thresholds[i + 1]) - betaCdf(this.context.thresholds[i]);

        this.diffBuf = new Float32Array(frameSize); this.cmndfBuf = new Float32Array(frameSize);
        this.obsBuf = new Float32Array(this.states.length); this.nextVitBuf = new Float32Array(this.states.length);
        this.result = new Float32Array(2); // Pre-allocated return buffer [frequency, confidence]
        this.reset();
    }

    reset() { this.viterbiLogProb = null; this.isInitialized = false; }

    findPitch(buf) {
        const nS = this.states.length;
        PYINCore.calculateDifferenceFunction(buf, this.diffBuf);
        PYINCore.calculateCMNDF(this.diffBuf, this.cmndfBuf);
        const nC = PYINCore.extractMultipleCandidates(this.cmndfBuf, this.sampleRate, this.context);
        PYINCore.fillObservationLogProbabilities(this.states, this.context.candidates, nC, this.obsBuf, this.stepsPerSemitone, this.context.candLogProbs, this.context.candLogFreqs);

        if (!this.isInitialized) {
            this.viterbiLogProb = new Float32Array(nS);
            const vC = this.states.filter(s => s.voiced).length;
            const lV = Math.log(0.5 / vC), lU = Math.log(0.5);
            for (let i = 0; i < nS; i++) this.viterbiLogProb[i] = (this.states[i].voiced ? lV : lU) + this.obsBuf[i];
            this.isInitialized = true;
        } else {
            PYINCore.forwardViterbiStep(this.viterbiLogProb, this.transitions, this.obsBuf, this.nextVitBuf);
            const tmp = this.viterbiLogProb; this.viterbiLogProb = this.nextVitBuf; this.nextVitBuf = tmp;
        }

        let maxL = -Infinity, best = 0;
        for (let i = 0; i < nS; i++) if (this.viterbiLogProb[i] > maxL) { maxL = this.viterbiLogProb[i]; best = i; }
        for (let i = 0; i < nS; i++) this.viterbiLogProb[i] -= maxL;

        const state = this.states[best];
        if (!state.voiced) return [0, 0];

        let sumV = 0, sumT = 0;
        for (let i = 0; i < nS; i++) {
            const p = Math.exp(this.viterbiLogProb[i]);
            sumT += p; if (this.states[i].voiced) sumV += p;
        }
        this.result[0] = state.frequency;
        this.result[1] = sumV / sumT;
        return this.result;
    }

    detectPitch(frames) {
        const nF = frames.length, nS = this.states.length;
        const obsL = new Float32Array(nF * nS);
        const origN = this.context.nThresholds; this.context.nThresholds = 100;
        for (let t = 0; t < nF; t++) {
            PYINCore.calculateDifferenceFunction(frames[t], this.diffBuf);
            PYINCore.calculateCMNDF(this.diffBuf, this.cmndfBuf);
            const nC = PYINCore.extractMultipleCandidates(this.cmndfBuf, this.sampleRate, this.context);
            PYINCore.fillObservationLogProbabilities(this.states, this.context.candidates, nC, obsL.subarray(t * nS, (t + 1) * nS), this.stepsPerSemitone, this.context.candLogProbs, this.context.candLogFreqs);
        }
        this.context.nThresholds = origN;
        const vC = this.states.filter(s => s.voiced).length;
        const lV = Math.log(0.5 / vC), lU = Math.log(0.5);
        const init = new Float32Array(nS);
        for (let s = 0; s < nS; s++) init[s] = (this.states[s].voiced ? lV : lU);
        const path = PYINCore.viterbi(init, this.transitions, obsL, nF, nS);
        return Array.from(path).map(idx => ({ frequency: this.states[idx].frequency, voiced: this.states[idx].voiced }));
    }
}

export function createPYINDetector(frameSize = 2048, minFreq = 80, maxFreq = 800, stepsPerSemitone = 5) {
    return {
        forFloat32Array: (sr) => {
            const d = new PYINDetector(sr, frameSize, minFreq, maxFreq, stepsPerSemitone);
            return { findPitch: (buf) => d.findPitch(buf) };
        }
    };
}
