
import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { ViewController } from '../lib/view-controller.js';

describe('ViewController', () => {
	it('should initialize with default values', () => {
		const vc = new ViewController({ initialNote: 60, displayRange: 36, speed: 5.0 });
		assert.strictEqual(vc.currentCenterNote, 60);
		assert.strictEqual(vc.targetCenterNote, 60);
		assert.strictEqual(vc.displayRange, 36);
	});

	it('should update target when pitch is detected', () => {
		const vc = new ViewController({ initialNote: 60 });
		vc.setDetectedPitch(72);
		assert.strictEqual(vc.targetCenterNote, 72);
		// currentCenterNote should not change immediately
		assert.strictEqual(vc.currentCenterNote, 60);
	});

	it('should smooth transition to target using exponential decay', () => {
		const initial = 60;
		const target = 72;
		const speed = 5.0;
		const vc = new ViewController({ initialNote: initial, speed: speed });
		vc.setDetectedPitch(target);

		// t = 0
		assert.strictEqual(vc.currentCenterNote, initial);

		// t = 0.2s
		// Expected: target + (initial - target) * exp(-speed * dt)
		// 72 + (60 - 72) * exp(-5 * 0.2) = 72 - 12 * exp(-1) = 72 - 12 * 0.367879... = 72 - 4.4145... = 67.585...
		const dt1 = 0.2;
		vc.update(dt1);
		const expected1 = target + (initial - target) * Math.exp(-speed * dt1);
		assert.ok(Math.abs(vc.currentCenterNote - expected1) < 0.001, `t=0.2s: expected ${expected1}, got ${vc.currentCenterNote}`);

		// t = 1.0s (accumulated)
		// Since we already updated 0.2s, we update 0.8s more
		const dt2 = 0.8;
		vc.update(dt2);
		const totalTime = dt1 + dt2; // 1.0s
		const expected2 = target + (initial - target) * Math.exp(-speed * totalTime);
		assert.ok(Math.abs(vc.currentCenterNote - expected2) < 0.001, `t=1.0s: expected ${expected2}, got ${vc.currentCenterNote}`);

		// t -> infinity (simulated by large efficient update or just checking logic convergence)
		// Let's run for a long time
		vc.update(10.0);
		assert.ok(Math.abs(vc.currentCenterNote - target) < 0.001, `t=large: expected ${target}, got ${vc.currentCenterNote}`);
	});

	it('should maintain position when silence (no pitch detected)', () => {
		const vc = new ViewController({ initialNote: 60 });

		// Move to somewhere else first
		vc.setDetectedPitch(70);
		vc.update(1.0); // Allow it to move towards 70

		// Pitch lost
		vc.setSilence();

		// Reset to known state for test clarity
		const vc2 = new ViewController({ initialNote: 60 });
		vc2.setDetectedPitch(72);
		vc2.update(0.1);
		// It has started moving.
		const movingPos = vc2.currentCenterNote;
		assert.notStrictEqual(movingPos, 60);
		assert.notStrictEqual(movingPos, 72);

		// Silence detected!
		vc2.setSilence();

		// Update time. It should NOT move towards 72 anymore?
		// Plan says: "ビューは「最後に検出された位置」に留まります"
		// This confirms that it should NOT reset to default.
		// It implies that `targetCenterNote` should remain what it was.

		vc2.update(1.0);

		// Since target was 72 before silence, it should continue towards 72.
		assert.strictEqual(vc2.targetCenterNote, 72);
		assert.ok(Math.abs(vc2.currentCenterNote - 72) < 0.1);
	});

	it('should calculate render state correctly', () => {
		const displayRange = 36;
		const vc = new ViewController({ initialNote: 60, displayRange: displayRange });

		// Center 60, Range 36 (-18 to +18)
		// Start: 60 - 18 = 42
		// End: 60 + 18 = 78
		const state = vc.getRenderState();
		assert.strictEqual(state.startNote, 42);
		assert.strictEqual(state.endNote, 78);
		assert.strictEqual(state.centerNote, 60);

		// Change center
		vc.setDetectedPitch(70);
		// Force update to target
		vc.update(100);

		const state2 = vc.getRenderState();
		assert.ok(Math.abs(state2.centerNote - 70) < 0.001);
		assert.ok(Math.abs(state2.startNote - (70 - 18)) < 0.001);
		assert.ok(Math.abs(state2.endNote - (70 + 18)) < 0.001);
	});
});
