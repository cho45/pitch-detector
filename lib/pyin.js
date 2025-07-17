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
    constructor(frequency, voiced = true) {
        this.frequency = frequency;
        this.voiced = voiced;
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
        
        for (let midi = minMidi; midi <= maxMidi; midi += 1/stepsPerSemitone) {
            const freq = 440 * Math.pow(2, (midi - 69) / 12);
            states.push(new PitchState(freq, true));
        }
        
        return states;
    }
    
    /**
     * Extract multiple pitch candidates with fundamental frequency bias
     * Combines pYIN's probabilistic approach with YIN's early-stopping bias
     * @param {Float32Array} cmndf - CMNDF values
     * @param {number} sampleRate - Sample rate
     * @param {number} nThresholds - Number of thresholds (default: 100)
     * @returns {Array<Object>} Array of candidate objects with frequency, tau, and probability
     */
    static extractMultipleCandidates(cmndf, sampleRate = 44100, nThresholds = 100, minFreq = 80, maxFreq = 800) {
        const minTau = Math.max(1, Math.floor(sampleRate / maxFreq));
        const maxTau = Math.min(cmndf.length - 1, Math.ceil(sampleRate / minFreq));
        
        // Generate beta distribution thresholds
        const thresholds = generateThresholds(nThresholds);
        const betaProbs = calculateBetaProbabilities(thresholds, 2, 18);
        
        // Find all local minima
        const allTroughs = [];
        for (let tau = minTau; tau <= maxTau; tau++) {
            if (tau > 0 && tau < cmndf.length - 1) {
                if (cmndf[tau] <= cmndf[tau - 1] && cmndf[tau] <= cmndf[tau + 1]) {
                    allTroughs.push({
                        tau: tau,
                        value: cmndf[tau],
                        frequency: sampleRate / tau
                    });
                }
            }
        }
        
        if (allTroughs.length === 0) {
            return [];
        }
        
        // FUNDAMENTAL FREQUENCY BIAS: Sort by tau first, then by value
        allTroughs.sort((a, b) => {
            const tauDiff = a.tau - b.tau;
            if (Math.abs(tauDiff) > 50) {
                return tauDiff;
            }
            return a.value - b.value;
        });
        
        const candidateSet = new Set();
        const troughProbabilities = new Map();
        
        // Process thresholds with fundamental bias
        for (let i = 1; i < thresholds.length; i++) {
            const threshold = thresholds[i];
            const betaProb = betaProbs[i - 1];
            
            const troughsBelowThreshold = allTroughs.filter(t => t.value < threshold);
            
            if (troughsBelowThreshold.length > 0) {
                troughsBelowThreshold.forEach((trough, index) => {
                    const baseBoltzmannWeight = boltzmannPmf(index, 2, troughsBelowThreshold.length);
                    
                    // Add fundamental frequency bias: favor higher tau values (lower frequencies)
                    const fundamentalBias = 1 - Math.exp(-trough.tau / 200.0);
                    const biasedWeight = baseBoltzmannWeight * fundamentalBias;
                    
                    const combinedProb = betaProb * biasedWeight;
                    
                    candidateSet.add(trough.tau);
                    
                    if (troughProbabilities.has(trough.tau)) {
                        troughProbabilities.set(trough.tau, 
                            troughProbabilities.get(trough.tau) + combinedProb);
                    } else {
                        troughProbabilities.set(trough.tau, combinedProb);
                    }
                });
            }
        }
        
        // Enhanced no_trough_prob handling
        if (candidateSet.size === 0) {
            const reasonableCandidates = allTroughs.filter(t => t.value < 0.5);
            if (reasonableCandidates.length > 0) {
                const bestCandidate = reasonableCandidates[0];
                candidateSet.add(bestCandidate.tau);
                troughProbabilities.set(bestCandidate.tau, 0.01);
            } else {
                const globalMin = allTroughs.reduce((min, trough) => 
                    trough.value < min.value ? trough : min);
                candidateSet.add(globalMin.tau);
                troughProbabilities.set(globalMin.tau, 0.01);
            }
        }
        
        // Convert to candidate objects
        const candidates = Array.from(candidateSet).map(tau => {
            let preciseTau = tau;
            
            // Apply parabolic interpolation
            if (tau > 0 && tau < cmndf.length - 1) {
                const y1 = cmndf[tau - 1];
                const y2 = cmndf[tau];
                const y3 = cmndf[tau + 1];
                const a = y3 + y1 - 2 * y2;
                const b = (y3 - y1) / 2;
                
                if (Math.abs(b) < Math.abs(a) && a !== 0) {
                    const x0 = -b / a;
                    if (Math.abs(x0) < 1) {
                        preciseTau = tau + x0;
                    }
                }
            }
            
            return {
                frequency: sampleRate / preciseTau,
                tau: preciseTau,
                probability: troughProbabilities.get(tau) || 0
            };
        });
        
        // Sort by probability (highest first)
        candidates.sort((a, b) => b.probability - a.probability);
        
        // Normalize probabilities
        const totalProb = candidates.reduce((sum, c) => sum + c.probability, 0);
        if (totalProb > 0) {
            candidates.forEach(c => {
                c.probability /= totalProb;
            });
        }
        
        return candidates;
    }
    
    /**
     * Find pitch candidates for a given threshold
     * @param {Float32Array} cmndf - CMNDF values
     * @param {number} threshold - Threshold value
     * @returns {Array<Object>} Array of candidates with tau and value
     */
    static findPitchCandidates(cmndf, threshold = 0.1) {
        const candidates = [];
        
        // Limit search to reasonable frequency range (80-800Hz at 44.1kHz sample rate)
        // τ_min = 44100/800 ≈ 55, τ_max = 44100/80 ≈ 551
        const minTau = 55;   // ~800Hz max
        const maxTau = Math.min(551, cmndf.length - 1);  // ~80Hz min
        
        for (let tau = minTau; tau <= maxTau; tau++) {
            // Detect local minima
            if (cmndf[tau] <= cmndf[tau - 1] && cmndf[tau] <= cmndf[tau + 1]) {
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
    
    /**
     * Calculate pitch probabilities from candidates (FIXED - no artificial recalculation)
     * @param {Array<Object>} candidates - Array of candidate objects with frequency, tau, and probability
     * @param {Float32Array} cmndf - CMNDF values (unused - kept for compatibility)
     * @param {number} sampleRate - Sample rate (unused - kept for compatibility)
     * @returns {Array<Object>} Array of pitch probabilities (candidates already have proper probabilities)
     */
    static calculatePitchProbabilities(candidates, cmndf, sampleRate) {
        // Candidates already have proper beta×Boltzmann probabilities
        // No need to recalculate with artificial formulas
        return candidates;
    }
    
    /**
     * Calculate transition probabilities between states (Fixed normalization)
     * @param {Array<PitchState>} states - Array of pitch states
     * @param {number} switchProb - Probability of switching voiced/unvoiced (default: 0.01)
     * @returns {Array<Array<number>>} Transition probability matrix
     */
    static calculateTransitionProbabilities(states, switchProb = 0.01) {
        const numStates = states.length;
        const transitions = Array(numStates).fill().map(() => Array(numStates).fill(0));
        
        // Self-transition probability (PYIN paper standard)
        const selfTransition = 0.99;
        
        for (let i = 0; i < numStates; i++) {
            const stateI = states[i];
            
            // Count voiced/unvoiced neighbors for proper normalization
            let voicedSwitchCount = 0;
            let unvoicedSwitchCount = 0;
            let sameVoicingCount = 0;
            
            for (let k = 0; k < numStates; k++) {
                if (k !== i) {
                    if (states[k].voiced && !stateI.voiced) {
                        voicedSwitchCount++;
                    } else if (!states[k].voiced && stateI.voiced) {
                        unvoicedSwitchCount++;
                    } else if (states[k].voiced === stateI.voiced) {
                        sameVoicingCount++;
                    }
                }
            }
            
            const switchTargetCount = stateI.voiced ? unvoicedSwitchCount : voicedSwitchCount;
            const remainingProb = 1 - selfTransition;
            const switchProbPerTarget = switchTargetCount > 0 ? switchProb / switchTargetCount : 0;
            const sameVoicingProb = remainingProb - switchProb;
            const sameVoicingProbPerTarget = sameVoicingCount > 0 ? sameVoicingProb / sameVoicingCount : 0;
            
            for (let j = 0; j < numStates; j++) {
                const stateJ = states[j];
                
                if (i === j) {
                    // Self-transition
                    transitions[i][j] = selfTransition;
                } else if (stateI.voiced !== stateJ.voiced) {
                    // Voiced <-> Unvoiced transition
                    transitions[i][j] = switchProbPerTarget;
                } else {
                    // Same voicing state, different frequency
                    transitions[i][j] = sameVoicingProbPerTarget;
                }
            }
        }
        
        return transitions;
    }
    
    /**
     * Calculate observation probabilities (librosa pYIN style)
     * @param {Array<PitchState>} states - Array of pitch states
     * @param {Array<Array<Object>>} observations - Array of observations (pitch candidates)
     * @returns {Array<Array<number>>} Observation probability matrix
     */
    static calculateObservationProbabilities(states, observations) {
        const numStates = states.length;
        const numObs = observations.length;
        const obsProb = Array(numObs).fill().map(() => Array(numStates).fill(0));
        
        for (let t = 0; t < numObs; t++) {
            const obs = observations[t]; // Pitch candidates and their probabilities
            
            // Calculate total voiced probability from candidates
            const totalVoicedProb = obs.reduce((sum, candidate) => sum + candidate.probability, 0);
            const clippedVoicedProb = Math.min(Math.max(totalVoicedProb, 0), 1);
            const unvoicedProb = 1 - clippedVoicedProb;
            
            for (let s = 0; s < numStates; s++) {
                const state = states[s];
                
                if (!state.voiced) {
                    // Unvoiced state: gets the unvoiced probability
                    obsProb[t][s] = unvoicedProb;
                } else {
                    // Voiced state: based on candidate proximity
                    let bestProb = 1e-10; // Very small baseline
                    
                    obs.forEach(candidate => {
                        const freqRatio = candidate.frequency / state.frequency;
                        const cents = 1200 * Math.log2(freqRatio);
                        
                        // Gaussian observation model: exp(-cents²/(2σ²))
                        const sigma = 50; // 50 cents standard deviation (librosa standard)
                        const gaussianProb = Math.exp(-(cents * cents) / (2 * sigma * sigma));
                        const observationProb = candidate.probability * gaussianProb;
                        
                        bestProb = Math.max(bestProb, observationProb);
                    });
                    
                    obsProb[t][s] = bestProb;
                }
            }
        }
        
        return obsProb;
    }
    
    /**
     * Viterbi algorithm for finding optimal state sequence
     * @param {Array<PitchState>} states - Array of pitch states
     * @param {Array<Array<number>>} transitions - Transition probabilities
     * @param {Array<Array<Object>>} observations - Observations
     * @param {Array<Array<number>>} obsProb - Observation probabilities
     * @returns {Object} Viterbi table and path
     */
    static viterbiAlgorithm(states, transitions, observations, obsProb) {
        const numStates = states.length;
        const numObs = observations.length;
        
        // Viterbi probability table
        const viterbi = Array(numObs).fill().map(() => Array(numStates).fill(0));
        const path = Array(numObs).fill().map(() => Array(numStates).fill(0));
        
        // Initialization with uniform distribution for voiced states
        for (let s = 0; s < numStates; s++) {
            const state = states[s];
            // Equal initial probability for all voiced states
            let initialProb;
            if (!state.voiced) {
                initialProb = 0.1; // 10% for unvoiced
            } else {
                const voicedStates = states.filter(st => st.voiced).length;
                initialProb = 0.9 / voicedStates; // 90% distributed among voiced states
            }
            viterbi[0][s] = initialProb * obsProb[0][s];
        }
        
        // Forward computation
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
    
    /**
     * Traceback the optimal path
     * @param {Array<Array<number>>} viterbi - Viterbi probability table
     * @param {Array<Array<number>>} path - Path table
     * @param {Array<PitchState>} states - Array of pitch states
     * @returns {Array<Object>} Optimal pitch track
     */
    static tracebackPath(viterbi, path, states) {
        const numObs = viterbi.length;
        const numStates = viterbi[0].length;
        const bestPath = new Array(numObs);
        
        // Find optimal state at last time step
        let maxProb = 0;
        let bestState = 0;
        for (let s = 0; s < numStates; s++) {
            if (viterbi[numObs-1][s] > maxProb) {
                maxProb = viterbi[numObs-1][s];
                bestState = s;
            }
        }
        
        // Backward traceback
        bestPath[numObs-1] = bestState;
        for (let t = numObs-2; t >= 0; t--) {
            bestPath[t] = path[t+1][bestPath[t+1]];
        }
        
        // Convert state indices to frequencies
        return bestPath.map(stateIndex => ({
            frequency: states[stateIndex].frequency,
            voiced: states[stateIndex].voiced
        }));
    }
}

/**
 * Complete PYIN Detector Class
 * Supports stateful stream processing for real-time analysis and 
 * batch processing for analyzing multiple frames at once.
 */
export class PYINDetector {
    /**
     * Create a PYIN detector instance.
     * @param {number} sampleRate - Sample rate in Hz.
     * @param {number} frameSize - Frame size for analysis.
     * @param {number} minFreq - Minimum frequency to detect.
     * @param {number} maxFreq - Maximum frequency to detect.
     */
    constructor(sampleRate, frameSize = 2048, minFreq = 80, maxFreq = 800) {
        this.sampleRate = sampleRate;
        this.frameSize = frameSize;
        this.minFreq = minFreq;
        this.maxFreq = maxFreq;
        this.states = PYINCore.createPitchStates(minFreq, maxFreq);
        
        // Pre-calculate transition probabilities in log space for numerical stability
        const transitions = PYINCore.calculateTransitionProbabilities(this.states);
        this.logTransitions = transitions.map(row => row.map(p => p > 0 ? Math.log(p) : -Infinity));

        // Pre-allocate buffers for efficiency
        this.differenceBuffer = new Float32Array(frameSize);
        this.cmndfBuffer = new Float32Array(frameSize);

        // Initialize HMM state for stream processing
        this.reset();
    }

    /**
     * Reset the HMM state for stream processing.
     * Call this when starting a new, independent audio stream.
     */
    reset() {
        this.viterbiLogProb = null;
        this.isInitialized = false;
    }
    
    /**
     * Detect pitch in multiple audio frames by processing them as a stream.
     * This provides consistent output with frame-by-frame processing.
     * @param {Array<Float32Array>} audioFrames - Array of audio frames.
     * @returns {Array<Object>} Pitch track with frequency and voiced status.
     */
    detectPitch(audioFrames) {
        this.reset();
        const pitchTrack = [];
        audioFrames.forEach(frame => {
            const [frequency, confidence] = this.findPitch(frame);
            pitchTrack.push({
                frequency: frequency,
                voiced: frequency > 0,
            });
        });
        return pitchTrack;
    }
    
    /**
     * Process a single audio frame in a stream, updating the internal HMM state.
     * @param {Float32Array} audioBuffer - Input audio buffer for the current frame.
     * @returns {Array} [frequency, confidence] tuple for the current frame.
     */
    findPitch(audioBuffer) {
        const numStates = this.states.length;

        // Step 1: Extract pitch candidates for the current frame
        PYINCore.calculateDifferenceFunction(audioBuffer, this.differenceBuffer);
        PYINCore.calculateCMNDF(this.differenceBuffer, this.cmndfBuffer);
        const candidates = PYINCore.extractMultipleCandidates(this.cmndfBuffer, this.sampleRate, 100, this.minFreq, this.maxFreq);

        // Step 2: Calculate observation log probabilities for the current frame
        const obsLogProb = new Float32Array(numStates).fill(-Infinity);
        const obsProbFrame = PYINCore.calculateObservationProbabilities(this.states, [candidates]);
        for (let i = 0; i < numStates; i++) {
            const p = obsProbFrame[0][i];
            if (p > 1e-10) { // Avoid log(0)
                obsLogProb[i] = Math.log(p);
            }
        }

        // Step 3: Update Viterbi path
        if (!this.isInitialized) {
            // Initialization step for the first frame
            this.viterbiLogProb = new Float32Array(numStates);
            const voicedStatesCount = this.states.filter(s => s.voiced).length;
            const initialVoicedProb = voicedStatesCount > 0 ? 0.9 / voicedStatesCount : 0;
            const initialUnvoicedProb = 0.1;

            for (let i = 0; i < numStates; i++) {
                const initialProb = this.states[i].voiced ? initialVoicedProb : initialUnvoicedProb;
                this.viterbiLogProb[i] = (initialProb > 0 ? Math.log(initialProb) : -Infinity) + obsLogProb[i];
            }
            this.isInitialized = true;
        } else {
            // Iteration step for subsequent frames
            const prevViterbiLogProb = this.viterbiLogProb.slice();
            const newViterbiLogProb = new Float32Array(numStates).fill(-Infinity);

            for (let s = 0; s < numStates; s++) {
                let maxProb = -Infinity;
                for (let prev = 0; prev < numStates; prev++) {
                    const p = prevViterbiLogProb[prev] + this.logTransitions[prev][s];
                    if (p > maxProb) {
                        maxProb = p;
                    }
                }
                newViterbiLogProb[s] = maxProb + obsLogProb[s];
            }
            this.viterbiLogProb = newViterbiLogProb;
        }

        // Step 4: Find the most likely state and return its frequency
        let maxLogProb = -Infinity;
        let bestStateIndex = 0;
        for (let i = 0; i < numStates; i++) {
            if (this.viterbiLogProb[i] > maxLogProb) {
                maxLogProb = this.viterbiLogProb[i];
                bestStateIndex = i;
            }
        }

        const bestState = this.states[bestStateIndex];
        
        // Confidence calculation (heuristic based on probability distribution)
        // A simplified softmax-like normalization to get a confidence value
        const maxProb = this.viterbiLogProb[bestStateIndex];
        const probSum = this.viterbiLogProb.reduce((sum, p) => sum + Math.exp(p - maxProb), 0);
        const confidence = 1 / probSum;

        if (bestState.voiced) {
            return [bestState.frequency, Math.min(1.0, confidence)];
        } else {
            return [0, 0];
        }
    }
}

/**
 * Factory function to create PYIN detector (Pitchy-style API)
 * @param {number} frameSize - Frame size for analysis
 * @param {number} minFreq - Minimum frequency
 * @param {number} maxFreq - Maximum frequency
 * @returns {Object} Detector with forFloat32Array method
 */
export function createPYINDetector(frameSize = 2048, minFreq = 80, maxFreq = 800) {
    return {
        forFloat32Array: function(sampleRate) {
            const detector = new PYINDetector(sampleRate, frameSize, minFreq, maxFreq);
            return {
                findPitch: (audioBuffer, sr) => detector.findPitch(audioBuffer, sr || sampleRate)
            };
        }
    };
}
