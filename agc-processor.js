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
        this.maxGain = options?.processorOptions?.maxGain || 50.0;
        this.minGain = options?.processorOptions?.minGain || 0.1;
        
        // Internal state
        this.currentGain = 1.0;
        this.envelope = 0.0;
        this.sampleRate = sampleRate; // Global sampleRate from AudioWorkletGlobalScope
        
        // Convert time constants to per-sample coefficients
        this.attackCoeff = 1.0 - Math.exp(-1.0 / (this.attackTime * this.sampleRate));
        this.releaseCoeff = 1.0 - Math.exp(-1.0 / (this.releaseTime * this.sampleRate));
        
        // Performance monitoring
        this.frameCount = 0;
        this.lastLogTime = 0;
        
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
            this.attackTime = Math.max(0.001, Math.min(1.0, params.attackTime));
            this.attackCoeff = 1.0 - Math.exp(-1.0 / (this.attackTime * this.sampleRate));
        }
        if (params.releaseTime !== undefined) {
            this.releaseTime = Math.max(0.001, Math.min(10.0, params.releaseTime));
            this.releaseCoeff = 1.0 - Math.exp(-1.0 / (this.releaseTime * this.sampleRate));
        }
        if (params.maxGain !== undefined) {
            this.maxGain = Math.max(1.0, Math.min(100.0, params.maxGain));
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
     * Calculate RMS (Root Mean Square) of audio buffer
     * @param {Float32Array} buffer - Audio buffer
     * @returns {number} RMS value
     */
    calculateRMS(buffer) {
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
            sum += buffer[i] * buffer[i];
        }
        return Math.sqrt(sum / buffer.length);
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
        
        // Handle case where there's no input
        if (!input || input.length === 0 || !input[0]) {
            return true;
        }
        
        const inputChannel = input[0];
        const outputChannel = output[0];
        const bufferLength = inputChannel.length;
        
        if (!outputChannel || bufferLength === 0) {
            return true;
        }
        
        // Calculate RMS for the entire buffer
        const rms = this.calculateRMS(inputChannel);
        
        // Update envelope follower
        const alpha = rms > this.envelope ? this.attackCoeff : this.releaseCoeff;
        this.envelope = this.envelope * (1 - alpha) + rms * alpha;
        
        // Calculate target gain
        let targetGain = 1.0;
        if (this.envelope > 1e-6) { // Avoid division by very small numbers
            targetGain = this.targetLevel / this.envelope;
        }
        
        // Clamp gain to reasonable limits
        targetGain = Math.max(this.minGain, Math.min(this.maxGain, targetGain));
        
        // Smooth gain changes per sample to avoid artifacts
        const gainAlpha = targetGain > this.currentGain ? this.attackCoeff : this.releaseCoeff;
        
        // Process each sample with smoothed gain
        for (let i = 0; i < bufferLength; i++) {
            // Update gain smoothly per sample
            this.currentGain = this.currentGain * (1 - gainAlpha) + targetGain * gainAlpha;
            
            // Apply gain to output
            outputChannel[i] = inputChannel[i] * this.currentGain;
        }
        
        // Performance monitoring and logging (every ~1000 frames at 128 samples)
        this.frameCount++;
        if (this.frameCount % 1000 === 0) {
            const now = currentTime * 1000; // Convert to milliseconds
            if (now - this.lastLogTime > 5000) { // Log every 5 seconds
                this.port.postMessage({
                    type: 'agcStats',
                    stats: {
                        rms: rms.toFixed(4),
                        envelope: this.envelope.toFixed(4),
                        gain: this.currentGain.toFixed(2),
                        targetGain: targetGain.toFixed(2)
                    }
                });
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