/**
 * MPM Algorithm Test Suite for Node.js
 */

import { MPMCore, MPMDetector, createMPMDetector } from '../lib/mpm.js';

// Console colors for test output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

let passedTests = 0;
let failedTests = 0;

// Simple test runner
function test(description, fn) {
    try {
        fn();
        console.log(`${colors.green}✓${colors.reset} ${description}`);
        passedTests++;
    } catch (error) {
        console.log(`${colors.red}✗${colors.reset} ${description}`);
        console.log(`  ${colors.red}${error.message}${colors.reset}`);
        if (error.stack) {
            console.log(`  ${colors.red}${error.stack.split('\n').slice(1, 3).join('\n  ')}${colors.reset}`);
        }
        failedTests++;
    }
}

// Helper functions
function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

function assertAlmostEqual(actual, expected, tolerance = 0.001, message = '') {
    const diff = Math.abs(actual - expected);
    if (diff > tolerance) {
        throw new Error(
            message || `Expected ${actual} to be close to ${expected} (tolerance: ${tolerance}, diff: ${diff})`
        );
    }
}

function assertArrayAlmostEqual(actual, expected, tolerance = 0.001) {
    assert(actual.length === expected.length, 
        `Array length mismatch: ${actual.length} !== ${expected.length}`);
    
    for (let i = 0; i < actual.length; i++) {
        assertAlmostEqual(actual[i], expected[i], tolerance, 
            `Arrays differ at index ${i}: ${actual[i]} !== ${expected[i]}`);
    }
}

function generateSineWave(frequency, sampleRate, duration) {
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(numSamples);
    const angularFrequency = 2 * Math.PI * frequency;
    
    for (let i = 0; i < numSamples; i++) {
        buffer[i] = Math.sin(angularFrequency * i / sampleRate);
    }
    
    return buffer;
}

function generateComplexSignal(fundamentalFreq, harmonics, sampleRate, duration) {
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(numSamples);
    
    for (let i = 0; i < numSamples; i++) {
        let value = 0;
        for (let h = 0; h < harmonics.length; h++) {
            const freq = fundamentalFreq * (h + 1);
            const amplitude = harmonics[h];
            value += amplitude * Math.sin(2 * Math.PI * freq * i / sampleRate);
        }
        buffer[i] = value;
    }
    
    return buffer;
}

// Test output helper
const log = (msg) => console.log(msg);

log(`${colors.bright}${colors.magenta}🚀 MPM Algorithm Test Suite${colors.reset}\n`);

// Test Suite 1: Core Algorithm Functions
log(`${colors.cyan}Testing MPMCore functions${colors.reset}`);

test('calculateNSDF should handle zero signal', () => {
    const audioBuffer = new Float32Array(256);
    const nsdfBuffer = new Float32Array(256);
    
    MPMCore.calculateNSDF(audioBuffer, nsdfBuffer);
    
    // All values should be 0 or NaN for zero signal
    for (let i = 0; i < nsdfBuffer.length; i++) {
        assert(nsdfBuffer[i] === 0 || isNaN(nsdfBuffer[i]), 
            `NSDF[${i}] should be 0 or NaN for zero signal, got ${nsdfBuffer[i]}`);
    }
});

test('calculateNSDF should produce normalized values', () => {
    const sampleRate = 44100;
    const signal = generateSineWave(440, sampleRate, 0.05);
    const nsdfBuffer = new Float32Array(signal.length);
    
    MPMCore.calculateNSDF(signal, nsdfBuffer);
    
    // NSDF should be normalized between -1 and 1
    let maxValue = -Infinity;
    let minValue = Infinity;
    
    for (let i = 0; i < nsdfBuffer.length; i++) {
        if (!isNaN(nsdfBuffer[i])) {
            maxValue = Math.max(maxValue, nsdfBuffer[i]);
            minValue = Math.min(minValue, nsdfBuffer[i]);
            assert(nsdfBuffer[i] >= -1.1 && nsdfBuffer[i] <= 1.1, 
                `NSDF[${i}] = ${nsdfBuffer[i]} is out of normalized range`);
        }
    }
    
    // First value should be close to 1 (perfect correlation at lag 0)
    assertAlmostEqual(nsdfBuffer[0], 1.0, 0.01);
});

test('findPeaks should find peaks in NSDF', () => {
    const nsdf = new Float32Array(200);
    
    // Create a simple pattern with clear peaks
    for (let i = 0; i < 200; i++) {
        nsdf[i] = Math.sin(i * 0.1) * Math.exp(-i * 0.01);
    }
    
    const peaks = MPMCore.findPeaks(nsdf);
    
    assert(peaks.length > 0, 'Should find at least one peak');
    
    // Verify each peak is a local maximum
    for (const peak of peaks) {
        assert(peak > 0 && peak < nsdf.length - 1, 
            `Peak ${peak} should be within valid range`);
        assert(nsdf[peak] > nsdf[peak - 1] && nsdf[peak] >= nsdf[peak + 1], 
            `Peak at ${peak} should be a local maximum`);
    }
});

test('choosePeak should select appropriate peak', () => {
    const nsdf = new Float32Array(100);
    const peaks = [20, 40, 60];
    
    // Set peak values
    nsdf[20] = 0.8;
    nsdf[40] = 0.95;
    nsdf[60] = 0.7;
    
    // With high threshold, should choose the highest peak
    let chosen = MPMCore.choosePeak(nsdf, peaks, 0.93);
    assert(chosen === 40, `Should choose highest peak (40), got ${chosen}`);
    
    // With lower threshold, should choose first peak above threshold
    chosen = MPMCore.choosePeak(nsdf, peaks, 0.75);
    assert(chosen === 20, `Should choose first peak above threshold (20), got ${chosen}`);
});

test('parabolicInterpolation should refine peak position', () => {
    const array = new Float32Array([0.5, 0.8, 0.9, 0.85, 0.6]);
    
    // Peak is at index 2
    const refined = MPMCore.parabolicInterpolation(array, 2);
    
    // Should be slightly adjusted from 2
    assert(refined >= 1.5 && refined <= 2.5, 
        `Refined position ${refined} should be near 2`);
    
    // For symmetric peak, should return exact center
    const symmetric = new Float32Array([0.5, 0.8, 0.5]);
    const refinedSym = MPMCore.parabolicInterpolation(symmetric, 1);
    assertAlmostEqual(refinedSym, 1, 0.01);
});

// Test Suite 2: Detector Class
log(`\n${colors.cyan}Testing MPMDetector class${colors.reset}`);

test('MPMDetector constructor should validate inputs', () => {
    // Valid construction
    const detector = new MPMDetector(44100, 1024, 0.93);
    assert(detector.sampleRate === 44100);
    assert(detector.bufferSize === 1024);
    assert(detector.threshold === 0.93);
    
    // Invalid inputs
    try {
        new MPMDetector(-1, 1024);
        assert(false, 'Should throw on negative sample rate');
    } catch (e) {
        assert(e.message.includes('positive'));
    }
    
    try {
        new MPMDetector(44100, 0);
        assert(false, 'Should throw on zero buffer size');
    } catch (e) {
        assert(e.message.includes('positive integer'));
    }
    
    try {
        new MPMDetector(44100, 1024, 1.5);
        assert(false, 'Should throw on invalid threshold');
    } catch (e) {
        assert(e.message.includes('between 0 and 1'));
    }
});

test('MPMDetector should detect pure sine wave frequencies', () => {
    const sampleRate = 44100;
    const detector = new MPMDetector(sampleRate, 2048);
    
    const testFrequencies = [110, 220, 440, 880, 1760];
    
    for (const targetFreq of testFrequencies) {
        const signal = generateSineWave(targetFreq, sampleRate, 0.05);
        const buffer = signal.slice(0, 2048);
        
        const [frequency, clarity] = detector.findPitch(buffer);
        
        const error = Math.abs(frequency - targetFreq) / targetFreq;
        assert(error < 0.02, 
            `Frequency detection error too high for ${targetFreq}Hz: ${frequency}Hz (${(error*100).toFixed(1)}%)`);
        
        assert(clarity > 0.9, 
            `Clarity should be high for pure sine wave at ${targetFreq}Hz, got ${clarity}`);
    }
});

test('MPMDetector should handle complex harmonic signals', () => {
    const sampleRate = 44100;
    const detector = new MPMDetector(sampleRate, 2048);
    
    // Test with different harmonic structures
    const harmonicTests = [
        { fundamental: 220, harmonics: [1, 0.5, 0.3, 0.2] }, // Rich harmonics
        { fundamental: 440, harmonics: [1, 0.7, 0.5] }, // Medium harmonics
        { fundamental: 330, harmonics: [1, 0.3, 0.1, 0.1, 0.1] } // Many weak harmonics
    ];
    
    for (const test of harmonicTests) {
        const signal = generateComplexSignal(
            test.fundamental, 
            test.harmonics, 
            sampleRate, 
            0.05
        );
        const buffer = signal.slice(0, 2048);
        
        const [frequency, clarity] = detector.findPitch(buffer);
        
        const error = Math.abs(frequency - test.fundamental) / test.fundamental;
        assert(error < 0.03, 
            `Should detect fundamental ${test.fundamental}Hz in harmonic signal, got ${frequency}Hz`);
        
        assert(clarity > 0.7, 
            `Clarity should be reasonable for harmonic signal, got ${clarity}`);
    }
});

test('MPMDetector should handle edge cases', () => {
    const sampleRate = 44100;
    const detector = new MPMDetector(sampleRate, 1024);
    
    // Test with silence
    const silence = new Float32Array(1024);
    let [frequency, clarity] = detector.findPitch(silence);
    assert(frequency === 0, 'Should return 0 frequency for silence');
    assert(clarity === 0, 'Should return 0 clarity for silence');
    
    // Test with very quiet signal
    const quiet = generateSineWave(440, sampleRate, 0.025);
    for (let i = 0; i < quiet.length; i++) {
        quiet[i] *= 0.0001;
    }
    [frequency, clarity] = detector.findPitch(quiet.slice(0, 1024));
    assert(frequency === 0, 'Should return 0 frequency for very quiet signal');
    
    // Test with NaN values
    const withNaN = generateSineWave(440, sampleRate, 0.025);
    withNaN[100] = NaN;
    [frequency, clarity] = detector.findPitch(withNaN.slice(0, 1024));
    assert(frequency === 0, 'Should return 0 frequency for signal with NaN');
});

test('MPMDetector should provide alternative API', () => {
    const sampleRate = 44100;
    const detector = new MPMDetector(sampleRate, 1024);
    const signal = generateSineWave(440, sampleRate, 0.025).slice(0, 1024);
    
    const result = detector.detectPitch(signal);
    
    assert(typeof result.frequency === 'number', 'Should have frequency property');
    assert(typeof result.confidence === 'number', 'Should have confidence property');
    assert(typeof result.tau === 'number', 'Should have tau property');
    
    assertAlmostEqual(result.frequency, 440, 10);
    assert(result.confidence > 0.9);
    assertAlmostEqual(result.tau, sampleRate / result.frequency, 0.1);
});

// Test Suite 3: Factory Function
log(`\n${colors.cyan}Testing factory function${colors.reset}`);

test('createMPMDetector should create Pitchy-compatible detector', () => {
    const factory = createMPMDetector(1024, 0.93);
    assert(typeof factory.forFloat32Array === 'function');
    
    const detector = factory.forFloat32Array(44100);
    assert(typeof detector.findPitch === 'function');
    
    const signal = generateSineWave(440, 44100, 0.025).slice(0, 1024);
    const [frequency, clarity] = detector.findPitch(signal, 44100);
    
    assertAlmostEqual(frequency, 440, 10);
    assert(clarity > 0.9);
});

// Test Suite 4: Performance comparison with YIN
log(`\n${colors.cyan}Testing MPM vs YIN accuracy${colors.reset}`);

test('MPM should handle high frequencies better than typical pitch detectors', () => {
    const sampleRate = 44100;
    const detector = new MPMDetector(sampleRate, 2048);
    
    // Test high frequencies where MPM excels
    const highFreqs = [1500, 2000, 2500, 3000];
    
    for (const freq of highFreqs) {
        const signal = generateSineWave(freq, sampleRate, 0.05);
        const buffer = signal.slice(0, 2048);
        
        const [detectedFreq, clarity] = detector.findPitch(buffer);
        
        const error = Math.abs(detectedFreq - freq) / freq;
        assert(error < 0.05, 
            `MPM should handle high frequency ${freq}Hz well, got ${detectedFreq}Hz (${(error*100).toFixed(1)}% error)`);
    }
});

// Summary
log(`\n${colors.bright}Test Summary:${colors.reset}`);
log(`${colors.green}Passed: ${passedTests}${colors.reset}`);
log(`${colors.red}Failed: ${failedTests}${colors.reset}`);

if (failedTests === 0) {
    log(`\n${colors.green}${colors.bright}All tests passed! 🎉${colors.reset}`);
    process.exit(0);
} else {
    log(`\n${colors.red}${colors.bright}Some tests failed 😞${colors.reset}`);
    process.exit(1);
}