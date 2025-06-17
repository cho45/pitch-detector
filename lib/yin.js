/**
 * YIN Pitch Detection Algorithm Implementation
 * Based on the paper "YIN, a fundamental frequency estimator for speech and music" 
 * by Alain de Cheveigné and Hideki Kawahara
 */

import FFTImport from './fft.mjs';
const FFT = FFTImport.default || FFTImport;


/**
 * YIN Algorithm Core Functions
 */
export class YINCore {
    /**
     * Calculate the difference function (Step 1 of YIN algorithm)
     * This is the basic O(N²) implementation for clarity and testing
     * @param {Float32Array} audioBuffer - Input audio buffer
     * @returns {Float32Array} Difference function
     */
    static calculateDifferenceFunction(audioBuffer) {
        const N = audioBuffer.length;
        const df = new Float32Array(N);
        
        // df[0] is always 0 by definition
        df[0] = 0;
        
        for (let tau = 1; tau < N; tau++) {
            let sum = 0;
            for (let j = 0; j < N - tau; j++) {
                const diff = audioBuffer[j] - audioBuffer[j + tau];
                sum += diff * diff;
            }
            df[tau] = sum;
        }
        
        return df;
    }
    
    /**
     * Calculate the difference function using FFT for better performance
     * @param {Float32Array} audioBuffer - Input audio buffer
     * @returns {Float32Array} Difference function
     */
    static calculateDifferenceFunctionFFT(audioBuffer) {
        const N = audioBuffer.length;
        // Ensure N2 is a power of 2 and at least 2
        let N2 = N * 2;
        if (N2 <= 1 || (N2 & (N2 - 1)) !== 0) {
            // Find next power of 2
            N2 = Math.pow(2, Math.ceil(Math.log2(N2)));
        }
        
        // Create FFT instance
        const fft = new FFT(N2);
        
        // Prepare padded buffer for FFT
        const paddedBuffer = new Array(N2);
        for (let i = 0; i < N; i++) {
            paddedBuffer[i] = audioBuffer[i];
        }
        for (let i = N; i < N2; i++) {
            paddedBuffer[i] = 0;
        }
        
        // Convert to complex array format expected by FFT
        const complexBuffer = fft.toComplexArray(paddedBuffer);
        const fftResult = fft.createComplexArray();
        
        // Perform FFT
        fft.transform(fftResult, complexBuffer);
        
        // Calculate power spectrum (|X[k]|²)
        const powerSpectrum = fft.createComplexArray();
        for (let i = 0; i < fftResult.length; i += 2) {
            const real = fftResult[i];
            const imag = fftResult[i + 1];
            powerSpectrum[i] = real * real + imag * imag;
            powerSpectrum[i + 1] = 0;
        }
        
        // Inverse FFT to get autocorrelation
        const autocorrComplex = fft.createComplexArray();
        fft.inverseTransform(autocorrComplex, powerSpectrum);
        
        // Extract real part of autocorrelation
        const autocorr = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            autocorr[i] = autocorrComplex[i * 2] / N2;
        }
        
        // Convert autocorrelation to difference function
        const df = new Float32Array(N);
        df[0] = 0;
        
        // Calculate energy terms for proper difference function
        const energy = new Float32Array(N);
        for (let tau = 0; tau < N; tau++) {
            let sum = 0;
            for (let j = 0; j < N - tau; j++) {
                sum += audioBuffer[j] * audioBuffer[j] + audioBuffer[j + tau] * audioBuffer[j + tau];
            }
            energy[tau] = sum;
        }
        
        for (let tau = 1; tau < N; tau++) {
            df[tau] = energy[tau] - 2 * autocorr[tau];
        }
        
        return df;
    }
    
    /**
     * Calculate the Cumulative Mean Normalized Difference Function (Step 2 of YIN)
     * @param {Float32Array} df - Difference function
     * @returns {Float32Array} CMNDF
     */
    static calculateCMNDF(df) {
        const N = df.length;
        const cmndf = new Float32Array(N);
        
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
        
        return cmndf;
    }
    
    /**
     * Find the first local minimum below threshold (Step 3 of YIN)
     * @param {Float32Array} cmndf - CMNDF values
     * @param {number} threshold - Threshold value (default 0.1)
     * @returns {number} Index of the first valid minimum, or -1 if none found
     */
    static findFirstMinimum(cmndf, threshold = 0.1) {
        for (let tau = 1; tau < cmndf.length - 1; tau++) {
            if (cmndf[tau] < threshold) {
                // Check if it's a local minimum
                if (cmndf[tau] < cmndf[tau - 1] && cmndf[tau] < cmndf[tau + 1]) {
                    return tau;
                }
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
     * @param {boolean} useFFT - Use FFT-based difference function (default false)
     */
    constructor(sampleRate, bufferSize = 1024, threshold = 0.1, useFFT = false) {
        this.sampleRate = sampleRate;
        this.bufferSize = bufferSize;
        this.threshold = threshold;
        this.useFFT = useFFT;
        
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
        if (sampleRate === null) {
            sampleRate = this.sampleRate;
        }
        
        if (audioBuffer.length !== this.bufferSize) {
            throw new Error(`Buffer size must be ${this.bufferSize}, got ${audioBuffer.length}`);
        }
        
        // Step 1: Calculate difference function
        const df = this.useFFT ? 
            YINCore.calculateDifferenceFunctionFFT(audioBuffer) :
            YINCore.calculateDifferenceFunction(audioBuffer);
        
        // Step 2: Calculate CMNDF
        const cmndf = YINCore.calculateCMNDF(df);
        
        // Step 3: Find first minimum
        const tauIndex = YINCore.findFirstMinimum(cmndf, this.threshold);
        
        if (tauIndex === -1) {
            return [0, 0]; // No pitch found
        }
        
        // Step 4: Parabolic interpolation for precision
        const preciseTau = YINCore.parabolicInterpolation(cmndf, tauIndex);
        
        const frequency = sampleRate / preciseTau;
        const clarity = Math.max(0, 1 - cmndf[tauIndex]);
        
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
 * @param {boolean} useFFT - Use FFT optimization
 * @returns {Object} Detector with forFloat32Array method
 */
export function createYINDetector(bufferSize = 1024, threshold = 0.1, useFFT = false) {
    return {
        forFloat32Array: function(sampleRate) {
            const detector = new YINDetector(sampleRate, bufferSize, threshold, useFFT);
            return {
                findPitch: (audioBuffer, sr) => detector.findPitch(audioBuffer, sr)
            };
        }
    };
}