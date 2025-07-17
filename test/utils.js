/**
 * Test utilities for YIN algorithm development
 */

export class YINTestUtils {
    /**
     * Generate a pure sine wave for testing
     * @param {number} frequency - Frequency in Hz
     * @param {number} sampleRate - Sample rate in Hz
     * @param {number} duration - Duration in seconds
     * @param {number} amplitude - Amplitude (0-1)
     * @returns {Float32Array} Generated sine wave
     */
    static generateSineWave(frequency, sampleRate, duration, amplitude = 1.0) {
        const length = Math.floor(sampleRate * duration);
        const buffer = new Float32Array(length);
        const omega = 2 * Math.PI * frequency / sampleRate;
        
        for (let i = 0; i < length; i++) {
            buffer[i] = amplitude * Math.sin(omega * i);
        }
        
        return buffer;
    }
    
    /**
     * Generate a sine wave with harmonics for testing
     * @param {number} fundamental - Fundamental frequency in Hz
     * @param {number} sampleRate - Sample rate in Hz
     * @param {number} duration - Duration in seconds
     * @param {Array<number>} harmonicAmplitudes - Amplitudes for each harmonic
     * @returns {Float32Array} Generated complex wave
     */
    static generateHarmonicWave(fundamental, sampleRate, duration, harmonicAmplitudes = [1.0, 0.5, 0.25]) {
        const length = Math.floor(sampleRate * duration);
        const buffer = new Float32Array(length);
        
        for (let h = 0; h < harmonicAmplitudes.length; h++) {
            const frequency = fundamental * (h + 1);
            const amplitude = harmonicAmplitudes[h];
            const omega = 2 * Math.PI * frequency / sampleRate;
            
            for (let i = 0; i < length; i++) {
                buffer[i] += amplitude * Math.sin(omega * i);
            }
        }
        
        // Normalize
        const maxValue = Math.max(...buffer.map(Math.abs));
        if (maxValue > 0) {
            for (let i = 0; i < buffer.length; i++) {
                buffer[i] /= maxValue;
            }
        }
        
        return buffer;
    }
    
    /**
     * Add white noise to a signal
     * @param {Float32Array} signal - Input signal
     * @param {number} noiseLevel - Noise level (0-1)
     * @returns {Float32Array} Signal with noise added
     */
    static addNoise(signal, noiseLevel = 0.1) {
        const noisySignal = new Float32Array(signal.length);
        
        for (let i = 0; i < signal.length; i++) {
            const noise = (Math.random() - 0.5) * 2 * noiseLevel;
            noisySignal[i] = signal[i] + noise;
        }
        
        return noisySignal;
    }

    /**
     * Generate a square wave for testing octave errors
     * @param {number} frequency - Frequency in Hz
     * @param {number} sampleRate - Sample rate in Hz
     * @param {number} duration - Duration in seconds
     * @param {number} amplitude - Amplitude (0-1)
     * @returns {Float32Array} Generated square wave
     */
    static generateSquareWave(frequency, sampleRate, duration, amplitude = 0.5) {
        const length = Math.floor(sampleRate * duration);
        const buffer = new Float32Array(length);
        const period = sampleRate / frequency;

        for (let i = 0; i < length; i++) {
            buffer[i] = (i % period) < (period / 2) ? amplitude : -amplitude;
        }

        return buffer;
    }
}