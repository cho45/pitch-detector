/**
 * AGC (Automatic Gain Control) AudioWorklet Processor
 * Runs in audio thread for low-latency real-time processing
 */
class AGCProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        
        // AGC parameters
        this.targetLevel = options?.processorOptions?.targetLevel || 0.3;
        this.attackTime = options?.processorOptions?.attackTime || 0.003;
        this.releaseTime = options?.processorOptions?.releaseTime || 0.1;
        this.maxGain = options?.processorOptions?.maxGain || 10.0;
        this.minGain = options?.processorOptions?.minGain || 0.1;
        
        // Internal state
        this.currentGain = 1.0;
        this.envelope = 0.0;
        this.targetGain = 1.0;
        this.sampleRate = sampleRate; // Global sampleRate from AudioWorkletGlobalScope
        this.previousEnabled = true; // Track previous enabled state
        this.gainReduction = 0.0; // Track gain reduction in dB for metering
        
        
        // Validate sample rate
        if (!isFinite(this.sampleRate) || this.sampleRate < 8000 || this.sampleRate > 192000) {
            this.sampleRate = 44100; // Fallback to standard rate
        }
        
        // Convert time constants to per-sample coefficients
        const attackExpArg = Math.max(-50, Math.min(-0.001, -2.2 / (this.attackTime * this.sampleRate)));
        const releaseExpArg = Math.max(-50, Math.min(-0.001, -2.2 / (this.releaseTime * this.sampleRate)));
        this.attackCoeff = Math.max(0.001, Math.min(0.999, 1.0 - Math.exp(attackExpArg)));
        this.releaseCoeff = Math.max(0.001, Math.min(0.999, 1.0 - Math.exp(releaseExpArg)));
        
        // Gain smoothing coefficient
        this.gainSmoothingTime = 0.005; // 5ms
        const gainSmoothingExpArg = Math.max(-50, Math.min(-0.001, -2.2 / (this.gainSmoothingTime * this.sampleRate)));
        this.gainSmoothingCoeff = Math.max(0.001, Math.min(0.999, 1.0 - Math.exp(gainSmoothingExpArg)));
        
        // Performance monitoring
        this.frameCount = 0;
        this.lastLogTime = 0;
        
        // Pre-allocate stats object to avoid repeated allocations
        this.statsObject = {
            type: 'agcStats',
            stats: {
                rms: '0.0000',
                envelope: '0.0000',
                gain: '1.00',
                targetGain: '1.00',
                gainReduction: '0.00'
            }
        };
        
        // Listen for parameter updates from main thread
        this.port.onmessage = (event) => {
            this.updateParameters(event.data);
        };
        
        console.log('🎚️ AGC AudioWorklet processor initialized');
    }
    
    /**
     * Update AGC parameters from main thread
     * @param {Object} params - Parameter updates
     */
    updateParameters(params) {
        if (params.targetLevel !== undefined) {
            this.targetLevel = Math.max(0.01, Math.min(1.0, params.targetLevel));
        }
        if (params.attackTime !== undefined) {
            this.attackTime = Math.max(0.0005, Math.min(1.0, params.attackTime));
            const expArg = Math.max(-50, Math.min(-0.001, -2.2 / (this.attackTime * this.sampleRate)));
            this.attackCoeff = Math.max(0.001, Math.min(0.999, 1.0 - Math.exp(expArg)));
        }
        if (params.releaseTime !== undefined) {
            this.releaseTime = Math.max(0.001, Math.min(10.0, params.releaseTime));
            const expArg = Math.max(-50, Math.min(-0.001, -2.2 / (this.releaseTime * this.sampleRate)));
            this.releaseCoeff = Math.max(0.001, Math.min(0.999, 1.0 - Math.exp(expArg)));
        }
        if (params.maxGain !== undefined) {
            this.maxGain = Math.max(1.0, Math.min(20.0, params.maxGain));
        }
        if (params.minGain !== undefined) {
            this.minGain = Math.max(0.01, Math.min(1.0, params.minGain));
        }
        
        // Send acknowledgment back to main thread
        this.port.postMessage({
            type: 'parametersUpdated',
            parameters: {
                targetLevel: this.targetLevel,
                attackTime: this.attackTime,
                releaseTime: this.releaseTime,
                maxGain: this.maxGain,
                minGain: this.minGain
            }
        });
    }
    
    /**
     * Calculate RMS (Root Mean Square) of audio buffer with DC removal
     * Optimized for cache efficiency and reduced floating-point operations
     * @param {Float32Array} buffer - Audio buffer
     * @returns {number} RMS value
     */
    calculateRMS(buffer) {
        const length = buffer.length;
        if (length === 0) return 0;
        
        // Single pass calculation for better cache efficiency
        let sum = 0;
        let squareSum = 0;
        let validSamples = 0;
        
        // First pass: calculate both sum and square sum
        for (let i = 0; i < length; i++) {
            const sample = buffer[i];
            if (isFinite(sample)) {
                sum += sample;
                squareSum += sample * sample;
                validSamples++;
            }
        }
        
        if (validSamples === 0) return 0;
        
        // Calculate DC offset
        const dc = sum / validSamples;
        
        // Calculate variance: E[X²] - E[X]²
        const meanSquare = squareSum / validSamples;
        const variance = meanSquare - (dc * dc);
        
        // RMS is sqrt of variance (AC component)
        const rms = Math.sqrt(Math.max(0, variance));
        return isFinite(rms) ? rms : 0;
    }
    
    /**
     * Main audio processing function
     * @param {Array<Array<Float32Array>>} inputs - Input audio buffers
     * @param {Array<Array<Float32Array>>} outputs - Output audio buffers
     * @param {Object} parameters - Audio parameters
     * @returns {boolean} Continue processing
     */
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        const enabled = parameters.enabled[0];
        
        // Reset state when transitioning from disabled to enabled
        if (enabled >= 0.5 && this.previousEnabled < 0.5) {
            this.currentGain = 1.0;
            this.envelope = 0.0;
            this.targetGain = 1.0;
            this.gainReduction = 0.0;
        }
        this.previousEnabled = enabled;
        
        // Handle case where there's no input
        if (!input || input.length === 0 || !input[0]) {
            // Clear all output channels
            for (let channel = 0; channel < output.length; channel++) {
                if (output[channel]) {
                    output[channel].fill(0);
                }
            }
            return true;
        }
        
        // Process all available channels (usually just mono)
        const numChannels = Math.min(input.length, output.length);
        
        // Clear any unused output channels
        for (let channel = numChannels; channel < output.length; channel++) {
            if (output[channel]) {
                output[channel].fill(0);
            }
        }
        
        for (let channel = 0; channel < numChannels; channel++) {
            const inputChannel = input[channel];
            const outputChannel = output[channel];
            
            if (!inputChannel || !outputChannel) {
                continue;
            }
            
            const bufferLength = inputChannel.length;
            if (bufferLength === 0) {
                continue;
            }
        
            // If disabled, just pass through
            if (enabled < 0.5) {
                for (let i = 0; i < bufferLength; i++) {
                    outputChannel[i] = inputChannel[i];
                }
                continue;
            }
            
            // Calculate RMS for the entire buffer (use first channel for analysis)
            if (channel === 0) {
                const rms = this.calculateRMS(inputChannel);
                
                // Update envelope follower with noise floor protection
                const noiseFloor = 1e-10;
                const clampedRMS = Math.max(rms, noiseFloor);
                
                const alpha = clampedRMS > this.envelope ? this.attackCoeff : this.releaseCoeff;
                this.envelope = this.envelope * (1 - alpha) + clampedRMS * alpha;
                
                // Clamp envelope to safe range
                if (!isFinite(this.envelope) || this.envelope < noiseFloor) {
                    this.envelope = noiseFloor;
                }
                if (this.envelope > 10.0) {
                    this.envelope = 10.0;
                }
                
                // Calculate target gain
                let targetGain = 1.0;
                if (this.envelope > 1e-8) {
                    targetGain = this.targetLevel / this.envelope;
                    if (!isFinite(targetGain) || targetGain < 0) {
                        targetGain = 1.0;
                    }
                }
                
                // Clamp gain to limits
                targetGain = Math.max(this.minGain, Math.min(this.maxGain, targetGain));
                this.targetGain = targetGain;
                
                // Calculate gain reduction for metering
                this.gainReduction = targetGain < 1.0 ? 20 * Math.log10(targetGain) : 0.0;
            }
            
            // Process each sample with smoothed gain
            for (let i = 0; i < bufferLength; i++) {
                // Update gain smoothing (only for first channel)
                if (channel === 0) {
                    this.currentGain = this.currentGain * (1 - this.gainSmoothingCoeff) + 
                                     this.targetGain * this.gainSmoothingCoeff;
                    
                    // Clamp gain to safe range
                    if (!isFinite(this.currentGain) || this.currentGain < this.minGain) {
                        this.currentGain = this.minGain;
                    } else if (this.currentGain > this.maxGain) {
                        this.currentGain = this.maxGain;
                    }
                }
                
                // Apply gain with bounds checking
                const sample = inputChannel[i];
                if (isFinite(sample) && Math.abs(sample) < 10.0) {
                    const output = sample * this.currentGain;
                    outputChannel[i] = output < -1.0 ? -1.0 : output > 1.0 ? 1.0 : output;
                } else {
                    outputChannel[i] = 0;
                }
            }
        }
        
        // Performance monitoring and logging (less frequent for better performance)
        this.frameCount++;
        if (this.frameCount % 2000 === 0) { // Check every 2000 frames instead of 1000
            const now = currentTime * 1000; // Convert to milliseconds
            if (now - this.lastLogTime > 10000) { // Log every 10 seconds instead of 5
                // Only send stats if first channel was processed
                if (numChannels > 0) {
                    // Reuse pre-allocated object to avoid memory allocation
                    this.statsObject.stats.rms = this.calculateRMS(input[0]).toFixed(4);
                    this.statsObject.stats.envelope = this.envelope.toFixed(4);
                    this.statsObject.stats.gain = this.currentGain.toFixed(2);
                    this.statsObject.stats.targetGain = this.targetGain.toFixed(2);
                    this.statsObject.stats.gainReduction = this.gainReduction.toFixed(2);
                    this.port.postMessage(this.statsObject);
                }
                this.lastLogTime = now;
            }
        }
        
        return true; // Continue processing
    }
    
    /**
     * Called when the processor should be destroyed
     */
    static get parameterDescriptors() {
        return [
            {
                name: 'enabled',
                defaultValue: 1,
                minValue: 0,
                maxValue: 1,
                automationRate: 'k-rate'
            }
        ];
    }
}

// Register the processor
registerProcessor('agc-processor', AGCProcessor);