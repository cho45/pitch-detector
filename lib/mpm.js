/**
 * MPM (McLeod Pitch Method) Pitch Detection Algorithm Implementation
 * Based on the paper "A Smarter Way to Find Pitch" by Philip McLeod and Geoff Wyvill
 * 
 * MPM is an improvement over YIN, using NSDF (Normalized Square Difference Function)
 * and a better peak picking strategy
 */

/**
 * MPM Algorithm Core Functions
 */
export class MPMCore {
    /**
     * Calculate the Normalized Square Difference Function (NSDF)
     * This is similar to autocorrelation but normalized differently
     * @param {Float32Array} audioBuffer - Input audio buffer
     * @param {Float32Array} nsdfBuffer - Output buffer for the NSDF
     */
    static calculateNSDF(audioBuffer, nsdfBuffer) {
        const N = audioBuffer.length;
        
        // Calculate autocorrelation (r_t(τ))
        for (let tau = 0; tau < N; tau++) {
            let sum = 0;
            for (let j = 0; j < N - tau; j++) {
                sum += audioBuffer[j] * audioBuffer[j + tau];
            }
            nsdfBuffer[tau] = sum;
        }
        
        // Calculate m_t(τ) - the normalization factor
        // m_t(τ) = Σ_{j=0}^{N-1-τ} (x[j]² + x[j+τ]²)
        const m = new Float32Array(N);
        
        // Pre-calculate cumulative sum of squares for efficiency
        const cumSum = new Float32Array(N + 1);
        cumSum[0] = 0;
        for (let i = 0; i < N; i++) {
            cumSum[i + 1] = cumSum[i] + audioBuffer[i] * audioBuffer[i];
        }
        
        for (let tau = 0; tau < N; tau++) {
            // m_t(τ) = sum of squares from 0 to N-1-tau plus sum from tau to N-1
            const sumLeft = cumSum[N - tau] - cumSum[0];
            const sumRight = cumSum[N] - cumSum[tau];
            m[tau] = sumLeft + sumRight;
        }
        
        // Normalize to get NSDF
        // nsdf_t(τ) = 2 * r_t(τ) / m_t(τ)
        for (let tau = 0; tau < N; tau++) {
            if (m[tau] !== 0) {
                nsdfBuffer[tau] = 2 * nsdfBuffer[tau] / m[tau];
            } else {
                nsdfBuffer[tau] = 0;
            }
        }
    }
    
    /**
     * Find all positive peaks in the NSDF
     * @param {Float32Array} nsdf - NSDF values
     * @returns {Array<number>} Array of peak indices
     */
    static findPeaks(nsdf) {
        const peaks = [];
        let pos = 0;
        const N = nsdf.length - 1;
        
        // Skip the first zero crossing
        while (pos < N && nsdf[pos] > 0) pos++;
        while (pos < N && nsdf[pos] <= 0) pos++;
        
        // Find all peaks
        while (pos < N) {
            // Find the highest point in this positive region
            let maxPos = pos;
            while (pos < N && nsdf[pos] > 0) {
                if (nsdf[pos] > nsdf[maxPos]) {
                    maxPos = pos;
                }
                pos++;
            }
            
            // Only add if it's a true local maximum
            if (maxPos > 0 && maxPos < N && 
                nsdf[maxPos] > nsdf[maxPos - 1] && 
                nsdf[maxPos] >= nsdf[maxPos + 1]) {
                peaks.push(maxPos);
            }
            
            // Skip negative region
            while (pos < N && nsdf[pos] <= 0) pos++;
        }
        
        return peaks;
    }
    
    /**
     * Choose the best peak using MPM's key maximum selection
     * @param {Float32Array} nsdf - NSDF values
     * @param {Array<number>} peaks - Array of peak indices
     * @param {number} threshold - Threshold for peak selection (default: 0.93)
     * @returns {number} Index of the chosen peak, or -1 if none found
     */
    static choosePeak(nsdf, peaks, threshold = 0.93) {
        if (peaks.length === 0) return -1;
        
        // Find the highest peak
        let maxPeakValue = 0;
        for (const peak of peaks) {
            if (nsdf[peak] > maxPeakValue) {
                maxPeakValue = nsdf[peak];
            }
        }
        
        // Apply relative threshold
        const actualThreshold = threshold * maxPeakValue;
        
        // Find the first peak that meets the threshold
        for (const peak of peaks) {
            if (nsdf[peak] >= actualThreshold) {
                return peak;
            }
        }
        
        // If no peak meets threshold, return the highest
        return peaks.reduce((maxIdx, peakIdx) => 
            nsdf[peakIdx] > nsdf[maxIdx] ? peakIdx : maxIdx
        );
    }
    
    /**
     * Parabolic interpolation for better precision
     * Uses a more robust formulation than YIN
     * @param {Float32Array} array - Array containing the peak
     * @param {number} peakIndex - Index of the peak
     * @returns {number} Interpolated index with sub-sample precision
     */
    static parabolicInterpolation(array, peakIndex) {
        if (peakIndex <= 0 || peakIndex >= array.length - 1) {
            return peakIndex;
        }
        
        const y1 = array[peakIndex - 1];
        const y2 = array[peakIndex];
        const y3 = array[peakIndex + 1];
        
        // Use a more stable formulation
        const a = y3 - 2 * y2 + y1;
        const b = y3 - y1;
        
        if (Math.abs(a) < 1e-10) return peakIndex;
        
        const xOffset = b / (2 * a);
        
        // Clamp the offset to prevent unrealistic jumps
        const clampedOffset = Math.max(-0.5, Math.min(0.5, xOffset));
        
        return peakIndex - clampedOffset;
    }
}

/**
 * Complete MPM Detector Class with Pitchy/YIN-compatible API
 */
export class MPMDetector {
    /**
     * Create an MPM detector instance
     * @param {number} sampleRate - Sample rate in Hz
     * @param {number} bufferSize - Buffer size for analysis
     * @param {number} threshold - MPM threshold (default 0.93)
     */
    constructor(sampleRate, bufferSize = 1024, threshold = 0.93) {
        // Input validation
        if (typeof sampleRate !== 'number' || sampleRate <= 0) {
            throw new Error('Sample rate must be a positive number');
        }
        if (typeof bufferSize !== 'number' || bufferSize <= 0 || bufferSize !== Math.floor(bufferSize)) {
            throw new Error('Buffer size must be a positive integer');
        }
        if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
            throw new Error('Threshold must be a number between 0 and 1');
        }
        
        this.sampleRate = sampleRate;
        this.bufferSize = bufferSize;
        this.threshold = threshold;
        
        // Pre-allocate buffer for efficiency
        this.nsdfBuffer = new Float32Array(bufferSize);
    }
    
    /**
     * Detect pitch in audio buffer (Pitchy-compatible API)
     * @param {Float32Array} audioBuffer - Input audio buffer
     * @param {number} sampleRate - Sample rate (will use instance rate if not provided)
     * @returns {Array} [frequency, clarity] tuple compatible with Pitchy
     */
    findPitch(audioBuffer, sampleRate = null) {
        // Input validation
        if (!audioBuffer || typeof audioBuffer !== 'object') {
            throw new Error('Audio buffer must be a typed array');
        }
        if (!(audioBuffer instanceof Float32Array)) {
            throw new Error('Audio buffer must be a Float32Array');
        }
        if (audioBuffer.length !== this.bufferSize) {
            throw new Error(`Buffer size must be ${this.bufferSize}, got ${audioBuffer.length}`);
        }
        
        if (sampleRate === null) {
            sampleRate = this.sampleRate;
        }
        
        // Check for invalid values in the audio buffer
        const hasInvalidValues = Array.from(audioBuffer).some(val => !isFinite(val));
        if (hasInvalidValues) {
            return [0, 0];
        }
        
        // Check if signal is too quiet (avoid noise)
        const rms = Math.sqrt(audioBuffer.reduce((sum, val) => sum + val * val, 0) / audioBuffer.length);
        if (rms < 0.001) {
            return [0, 0];
        }
        
        // Step 1: Calculate NSDF
        MPMCore.calculateNSDF(audioBuffer, this.nsdfBuffer);
        
        // Step 2: Find peaks
        const peaks = MPMCore.findPeaks(this.nsdfBuffer);
        
        if (peaks.length === 0) {
            return [0, 0];
        }
        
        // Step 3: Choose the best peak
        const chosenPeak = MPMCore.choosePeak(this.nsdfBuffer, peaks, this.threshold);
        
        if (chosenPeak === -1) {
            return [0, 0];
        }
        
        // Step 4: Parabolic interpolation for precision
        const preciseTau = MPMCore.parabolicInterpolation(this.nsdfBuffer, chosenPeak);
        
        const frequency = sampleRate / preciseTau;
        const clarity = Math.max(0, Math.min(1, this.nsdfBuffer[chosenPeak]));
        
        return [frequency, clarity];
    }
    
    /**
     * Alternative API method for compatibility
     * @param {Float32Array} audioBuffer - Input audio buffer  
     * @returns {Object} {frequency, confidence, tau}
     */
    detectPitch(audioBuffer) {
        const [frequency, clarity] = this.findPitch(audioBuffer);
        return {
            frequency: frequency,
            confidence: clarity,
            tau: frequency > 0 ? this.sampleRate / frequency : 0
        };
    }
}

/**
 * Factory function to create MPM detector (Pitchy-style API)
 * @param {number} bufferSize - Buffer size for analysis
 * @param {number} threshold - MPM threshold
 * @returns {Object} Detector with forFloat32Array method
 */
export function createMPMDetector(bufferSize = 1024, threshold = 0.93) {
    return {
        forFloat32Array: function(sampleRate) {
            const detector = new MPMDetector(sampleRate, bufferSize, threshold);
            return {
                findPitch: (audioBuffer, sr) => detector.findPitch(audioBuffer, sr)
            };
        }
    };
}