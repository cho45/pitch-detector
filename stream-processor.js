import { Resampler } from './lib/downsample.js';

/**
 * StreamProcessor: Resamples input audio to a fixed 10kHz 
 * and sends chunks to the main thread for contiguous pitch detection.
 */
class StreamProcessor extends AudioWorkletProcessor {
	constructor(options) {
		super();

		const targetSampleRate = options.processorOptions.targetSampleRate || 10000;
		this.targetSampleRate = targetSampleRate;

		// Initialize resampler to convert from system rate to target rate
		this.resampler = new Resampler(sampleRate, targetSampleRate);

		// BUFFER_SIZE: Number of samples to accumulate before sending
		// 256 samples @ 24kHz = ~10.6ms (approx 93fps)
		this.BUFFER_SIZE = 256;
		this.buffer = new Float32Array(this.BUFFER_SIZE);
		this.bufferPtr = 0;
	}

	process(inputs, outputs, parameters) {
		const input = inputs[0];
		if (!input || !input[0]) return true;

		// Note: We only process the first channel (mono)
		const inputChannel = input[0];

		// 1. Resample current input block (usually 128 samples) to 10kHz
		const resampled = this.resampler.process(inputChannel);

		// 2. Accumulate in our buffer
		for (let i = 0; i < resampled.length; i++) {
			this.buffer[this.bufferPtr++] = resampled[i];

			// 3. If buffer is full, send to main thread
			if (this.bufferPtr >= this.BUFFER_SIZE) {
				// Send a copy to avoid neutered buffers or shared state issues
				this.port.postMessage({
					type: 'audioChunk',
					buffer: this.buffer.slice(), // Slice creates a copy
					sampleRate: this.targetSampleRate
				});
				this.bufferPtr = 0;
			}
		}

		// Just pass through to output (if needed for monitoring, though currently ignored)
		const output = outputs[0];
		if (output && output[0]) {
			for (let channel = 0; channel < output.length; channel++) {
				output[channel].set(inputChannel);
			}
		}

		return true;
	}
}

registerProcessor('stream-processor', StreamProcessor);
