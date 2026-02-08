import { test } from 'node:test';
import assert from 'node:assert';
import { Resampler } from '../lib/downsample.js';

test('Resampler: basic properties', async (t) => {
	await t.test('output sample rate should be 10000', () => {
		const resampler = new Resampler(44100, 10000);
		assert.strictEqual(resampler.outRate, 10000);
	});

	await t.test('should handle different input rates', () => {
		const r441 = new Resampler(44100, 10000);
		const r48 = new Resampler(48000, 10000);
		assert.strictEqual(r441.ratio, 10000 / 44100);
		assert.strictEqual(r48.ratio, 10000 / 48000);
	});
});

test('Resampler: sine wave accuracy', async (t) => {
	const inRate = 48000;
	const outRate = 10000;
	const freq = 440; // A4
	const resampler = new Resampler(inRate, outRate);

	// Generate 500ms of 440Hz sine wave
	const duration = 0.5;
	const inSamples = new Float32Array(Math.floor(inRate * duration));
	for (let i = 0; i < inSamples.length; i++) {
		inSamples[i] = Math.sin(2 * Math.PI * freq * i / inRate);
	}

	const outSamples = resampler.process(inSamples);

	// Verify output length (roughly)
	const expectedOutLength = Math.floor(inSamples.length * (outRate / inRate));
	assert.ok(Math.abs(outSamples.length - expectedOutLength) <= 2);

	// Verify sine wave frequency in output
	// Looking for zero crossings to estimate frequency
	let crossings = 0;
	for (let i = 1; i < outSamples.length; i++) {
		if (outSamples[i - 1] <= 0 && outSamples[i] > 0) {
			crossings++;
		}
	}

	const actualDuration = outSamples.length / outRate;
	const detectedFreq = crossings / actualDuration;

	// Allowed error: 1%
	const error = Math.abs(detectedFreq - freq) / freq;
	assert.ok(error < 0.01, `Detected frequency ${detectedFreq} is too far from ${freq}`);

	// Verify amplitude is maintained (within reasonable bounds for linear interpolation)
	let maxAmp = 0;
	for (let i = 0; i < outSamples.length; i++) {
		maxAmp = Math.max(maxAmp, Math.abs(outSamples[i]));
	}
	assert.ok(maxAmp > 0.9 && maxAmp <= 1.0, `Amplitude ${maxAmp} should be near 1.0`);
});

test('Resampler: aliasing suppression', async (t) => {
	const inRate = 48000;
	const outRate = 10000;
	const resampler = new Resampler(inRate, outRate);

	// Input 8kHz sine wave 
	// (Should be suppressed significantly if Nyquist/cutoff is 5kHz)
	const freq = 8000;
	const inSamples = new Float32Array(2000);
	for (let i = 0; i < inSamples.length; i++) {
		inSamples[i] = Math.sin(2 * Math.PI * freq * i / inRate);
	}

	const outSamples = resampler.process(inSamples);

	let maxAmp = 0;
	for (let i = 0; i < outSamples.length; i++) {
		maxAmp = Math.max(maxAmp, Math.abs(outSamples[i]));
	}

	// 8kHz is well above 5kHz. A decent sinc filter should reduce it significantly.
	assert.ok(maxAmp < 0.25, `Aliasing suppression for 8kHz is insufficient: amplitude ${maxAmp}`);
});

test('Resampler: stateful continuity', async (t) => {
	const inRate = 44100;
	const outRate = 10000;
	const resampler = new Resampler(inRate, outRate);

	const chunk1 = new Float32Array(100).fill(1.0);
	const chunk2 = new Float32Array(100).fill(1.0);

	const out1 = resampler.process(chunk1);
	const out2 = resampler.process(chunk2);

	const totalOutLength = out1.length + out2.length;
	const expectedTotal = Math.floor(200 * (outRate / inRate));

	assert.ok(Math.abs(totalOutLength - expectedTotal) <= 2, "State should be maintained across chunks");
});
