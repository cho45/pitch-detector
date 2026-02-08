/**
 * Stateful Resampler using Windowed Sinc Interpolation.
 * Acts as an ideal low-pass filter to prevent aliasing when downsampling.
 */
export class Resampler {
	/**
	 * @param {number} inRate - Input sample rate (e.g., 44100, 48000)
	 * @param {number} outRate - Target sample rate (fixed at 10000)
	 */
	constructor(inRate, outRate = 10000) {
		this.inRate = inRate;
		this.outRate = outRate;
		this.ratio = outRate / inRate;

		// Kernel radius in input samples. 
		// A radius of 32 means a 65-tap filter at the input rate.
		this.kernelRadius = 32;

		// Buffer to keep track of enough past samples for the sinc kernel
		this.history = new Float32Array(this.kernelRadius * 2);

		// Position in the continuous input stream (in samples)
		this.inputPos = 0;
	}

	/**
	 * Sinc function: sin(pi * x) / (pi * x)
	 */
	_sinc(x) {
		if (Math.abs(x) < 1e-10) return 1.0;
		const pix = Math.PI * x;
		return Math.sin(pix) / pix;
	}

	/**
	 * Blackman Window
	 * Provides better stop-band attenuation than Hamming.
	 */
	_window(x, radius) {
		const norm = x / radius;
		if (Math.abs(norm) >= 1.0) return 0;
		const alpha = Math.PI * norm;
		return 0.42 + 0.5 * Math.cos(alpha) + 0.08 * Math.cos(2 * alpha);
	}

	/**
	 * Process a chunk of audio data.
	 * @param {Float32Array} input - Input audio chunk
	 * @returns {Float32Array} Resampled audio chunk (10kHz)
	 */
	process(input) {
		if (input.length === 0) return new Float32Array(0);

		// Combine history and new input for kernel look-back
		const fullInput = new Float32Array(this.history.length + input.length);
		fullInput.set(this.history);
		fullInput.set(input, this.history.length);

		const outLength = Math.floor((this.inputPos + input.length) * this.ratio) - Math.floor(this.inputPos * this.ratio);
		const output = new Float32Array(Math.max(0, outLength));

		let outIdx = 0;
		const fCutoff = this.ratio / 2; // Normalized cutoff frequency (target's Nyquist)

		// Iterate through output sample positions mapped back to input timeline
		// The first output sample should start after the history buffer is "skipped"
		let currentOutTime = Math.ceil(this.inputPos * this.ratio) / this.ratio;
		const endTime = this.inputPos + input.length;

		while (currentOutTime < endTime) {
			const centerInIdx = currentOutTime - this.inputPos + this.history.length;

			let sum = 0;
			// Apply windowed sinc kernel
			// We look at input samples around 'centerInIdx'
			const startK = Math.floor(centerInIdx - this.kernelRadius);
			const endK = Math.ceil(centerInIdx + this.kernelRadius);

			for (let k = startK; k <= endK; k++) {
				if (k >= 0 && k < fullInput.length) {
					const x = k - centerInIdx;
					// Sinc is scaled by fCutoff to define the low-pass frequency
					const weight = this._sinc(2 * fCutoff * x) * this._window(x, this.kernelRadius);
					sum += fullInput[k] * weight;
				}
			}

			// Normalization: Multiply by 2 * fCutoff (which is this.ratio) to maintain unity gain in passband
			output[outIdx++] = sum * (2 * fCutoff);
			currentOutTime += 1 / this.ratio;
		}

		// Update state
		this.inputPos += input.length;
		// Keep the end of the input as history for the next call
		this.history.set(fullInput.subarray(fullInput.length - this.history.length));

		return output.subarray(0, outIdx);
	}
}
