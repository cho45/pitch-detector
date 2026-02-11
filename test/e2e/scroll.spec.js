import { test, expect } from '@playwright/test';

test.describe('Auto-Scrolling View Logic', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => localStorage.clear());
		await page.reload();
		// Wait for app to be ready
		await page.waitForFunction(() => window.app && window.app.viewController);
	});

	test('should smoothly scroll towards the detected pitch (A5, note 81)', async ({ page }) => {
		// Initial state: Center is A4 (69)
		const initialCenter = await page.evaluate(() => window.app.viewController.currentCenterNote);
		expect(initialCenter).toBeCloseTo(69, 0);

		// Inject 880Hz (A5 = Note 81)
		await page.evaluate(() => {
			window.__PITCH_DETECTOR_INJECT_SOURCE__ = async (audioContext) => {
				const osc = audioContext.createOscillator();
				osc.type = 'sine';
				osc.frequency.value = 880; // A5
				osc.start();
				return osc;
			};
		});

		await page.click('button.start-btn');

		// Wait for detection to stabilize (clarity > 0.9)
		await expect(async () => {
			const clarity = await page.evaluate(() => window.app.clarity);
			expect(clarity).toBeGreaterThan(0.9);
		}).toPass({ timeout: 2000 });

		// Check target center note is updated to 81
		const targetCenter = await page.evaluate(() => window.app.viewController.targetCenterNote);
		expect(targetCenter).toBeCloseTo(81, 0.1);

		// Check immediate movement (should be > 69 but < 81)
		// Wait a bit for update loop to run
		await page.waitForTimeout(100);
		const movingCenter = await page.evaluate(() => window.app.viewController.currentCenterNote);
		expect(movingCenter).toBeGreaterThan(69);
		expect(movingCenter).toBeLessThan(82);

		// Wait for convergence (e.g. 1.0 second)
		// Speed is 5.0, so exp(-5 * 1) = 0.006. 99.4% converged.
		await page.waitForTimeout(1000);
		const convergedCenter = await page.evaluate(() => window.app.viewController.currentCenterNote);
		expect(convergedCenter).toBeCloseTo(81, 0.5);
	});

	test('should stay at last detected position when signal stops', async ({ page }) => {
		// Inject 880Hz (A5)
		await page.evaluate(() => {
			window.__PITCH_DETECTOR_INJECT_SOURCE__ = async (audioContext) => {
				const osc = audioContext.createOscillator();
				osc.type = 'sine';
				osc.frequency.value = 880;
				osc.start();
				// Stop after 2 seconds (simulating silence)
				setTimeout(() => osc.stop(), 2000);
				return osc;
			};
		});

		await page.click('button.start-btn');

		// Wait for scroll to reach near A5
		await page.waitForTimeout(1500);
		const centerAtSignal = await page.evaluate(() => window.app.viewController.currentCenterNote);
		expect(centerAtSignal).toBeGreaterThan(75);

		// Wait for silence (oscillator stopped)
		await page.waitForTimeout(1000);

		// Check clarity is low
		const clarity = await page.evaluate(() => window.app.clarity);
		expect(clarity).toBeLessThan(0.1);

		// Center note should NOT return to initial (69), should stay near 81
		const centerAtSilence = await page.evaluate(() => window.app.viewController.currentCenterNote);
		expect(centerAtSilence).toBeCloseTo(81, 0.5);
	});
});
