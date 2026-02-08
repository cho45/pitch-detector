
import { PitchDetector } from "./lib/pitchy.js";
import { YINDetector } from "./lib/yin.js";
import { PYINDetector } from "./lib/pyin.js";
import { MPMDetector } from "./lib/mpm.js";
import { YINTestUtils } from "./test/utils.js";

const SAMPLE_RATE = 44100;
const BUFFER_SIZES = [1024, 2048, 4096];
const ITERATIONS = 100;
const WARMUP = 10;

function benchmark() {
	console.log("🚀 Starting Pitch Detection Benchmarks...");
	console.log(`Iterations: ${ITERATIONS} | Sample Rate: ${SAMPLE_RATE}Hz\n`);

	const results = [];

	for (const bufferSize of BUFFER_SIZES) {
		console.log(`--- Buffer Size: ${bufferSize} ---`);
		const signal = YINTestUtils.generateSineWave(440, SAMPLE_RATE, bufferSize / SAMPLE_RATE);

		const algorithms = [
			{ name: "Pitchy", factory: () => PitchDetector.forFloat32Array(bufferSize) },
			{ name: "YIN", factory: () => new YINDetector(SAMPLE_RATE, bufferSize) },
			{ name: "MPM", factory: () => new MPMDetector(SAMPLE_RATE, bufferSize) },
			{ name: "PYIN", factory: () => new PYINDetector(SAMPLE_RATE, bufferSize) }
		];

		for (const algo of algorithms) {
			const detector = algo.factory();

			// Warmup
			for (let i = 0; i < WARMUP; i++) {
				detector.findPitch(signal, SAMPLE_RATE);
			}

			const start = performance.now();
			for (let i = 0; i < ITERATIONS; i++) {
				detector.findPitch(signal, SAMPLE_RATE);
			}
			const end = performance.now();

			const totalTime = end - start;
			const avgTime = totalTime / ITERATIONS;
			const throughput = (ITERATIONS / totalTime) * 1000; // frames per second

			results.push({
				Algorithm: algo.name,
				"Buffer Size": bufferSize,
				"Avg Time (ms)": avgTime.toFixed(4),
				"FPS": throughput.toFixed(2)
			});

			console.log(`${algo.name.padEnd(8)}: ${avgTime.toFixed(4)} ms`);
		}
		console.log("");
	}

	console.table(results);
}

benchmark();
