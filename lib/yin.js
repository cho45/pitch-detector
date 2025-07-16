/**
 * YIN Pitch Detection Algorithm Implementation
 * Based on the paper "YIN, a fundamental frequency estimator for speech and music" 
 * by Alain de Cheveigné and Hideki Kawahara
 */



/**
 * YIN Algorithm Core Functions
 */
export class YINCore {
    /**
     * Calculate the difference function (Step 1 of YIN algorithm)
     * This is the basic O(N²) implementation. Writes result to a buffer.
     * @param {Float32Array} audioBuffer - Input audio buffer
     * @param {Float32Array} differenceBuffer - Output buffer for the difference function
     */
    static calculateDifferenceFunction(audioBuffer, differenceBuffer) {
        const N = audioBuffer.length;
        
        // df[0] is always 0 by definition
        differenceBuffer[0] = 0;
        
        for (let tau = 1; tau < N; tau++) {
            let sum = 0;
            for (let j = 0; j < N - tau; j++) {
                const diff = audioBuffer[j] - audioBuffer[j + tau];
                sum += diff * diff;
            }
            differenceBuffer[tau] = sum;
        }
    }
    
    
    /**
     * Calculate the Cumulative Mean Normalized Difference Function (Step 2 of YIN)
     * @param {Float32Array} df - Difference function
     * @param {Float32Array} cmndf - Output buffer for the CMNDF
     */
    static calculateCMNDF(df, cmndf) {
        const N = df.length;
        
        // CMNDF[0] is set to 1 by convention
        cmndf[0] = 1;
        
        let runningSum = df[0];
        for (let tau = 1; tau < N; tau++) {
            runningSum += df[tau];
            
            if (runningSum === 0) {
                cmndf[tau] = 1;
            } else {
                cmndf[tau] = df[tau] / (runningSum / tau);
            }
        }
    }
    
    /**
     * Find the first local minimum below threshold (Step 3 of YIN)
     * @param {Float32Array} cmndf - CMNDF values
     * @param {number} threshold - Threshold value
     * @returns {number} Index of the first valid minimum, or -1 if none found
     */
    static findFirstMinimum(cmndf, threshold) {
        // Look for the first tau where CMNDF drops below threshold
        for (let tau = 1; tau < cmndf.length; tau++) {
            if (cmndf[tau] < threshold) {
                // From this point, find the next local minimum
                // Start search from at least index 2 to ensure proper local minimum
                for (let t = Math.max(2, tau); t < cmndf.length - 1; t++) {
                    // Check if this is a true local minimum with neighbors on both sides
                    if (cmndf[t] <= cmndf[t - 1] && cmndf[t] <= cmndf[t + 1]) {
                        return t;
                    }
                }
                // No proper local minimum found after threshold crossing
                return -1;
            }
        }
        return -1;
    }
    
    /**
     * Parabolic interpolation to improve precision (Step 4 of YIN)
     * @param {Float32Array} array - Array containing the minimum
     * @param {number} peakIndex - Index of the minimum
     * @returns {number} Interpolated index with sub-sample precision
     */
    static parabolicInterpolation(array, peakIndex) {
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
}

/**
 * Complete YIN Detector Class with Pitchy-compatible API
 */
export class YINDetector {
    /**
     * Create a YIN detector instance
     * @param {number} sampleRate - Sample rate in Hz
     * @param {number} bufferSize - Buffer size for analysis
     * @param {number} threshold - YIN threshold (default 0.1)
     */
    constructor(sampleRate, bufferSize = 1024, threshold = 0.1) {
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
        
        // Pre-allocate buffers for efficiency
        this.differenceBuffer = new Float32Array(bufferSize);
        this.cmndfBuffer = new Float32Array(bufferSize);
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
            // Return zero frequency for invalid input
            return [0, 0];
        }
        
        // Step 1: Calculate difference function into the pre-allocated buffer
        YINCore.calculateDifferenceFunction(audioBuffer, this.differenceBuffer);
        
        // Step 2: Calculate CMNDF into the pre-allocated buffer
        YINCore.calculateCMNDF(this.differenceBuffer, this.cmndfBuffer);
        
        // Step 3: Find absolute minimum below threshold
        const tauIndex = YINCore.findFirstMinimum(this.cmndfBuffer, this.threshold);
        
        if (tauIndex === -1) {
            return [0, 0]; // No pitch found
        }
        
        // Step 4: Parabolic interpolation for precision
        const preciseTau = YINCore.parabolicInterpolation(this.cmndfBuffer, tauIndex);
        
        const frequency = sampleRate / preciseTau;
        const clarity = Math.max(0, 1 - this.cmndfBuffer[tauIndex]);
        
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
 * Factory function to create YIN detector (Pitchy-style API)
 * @param {number} bufferSize - Buffer size for analysis
 * @param {number} threshold - YIN threshold
 * @returns {Object} Detector with forFloat32Array method
 */
export function createYINDetector(bufferSize = 1024, threshold = 0.1) {
    return {
        forFloat32Array: function(sampleRate) {
            const detector = new YINDetector(sampleRate, bufferSize, threshold);
            return {
                findPitch: (audioBuffer, sr) => detector.findPitch(audioBuffer, sr)
            };
        }
    };
}
