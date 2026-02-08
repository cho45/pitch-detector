import { test, expect } from '@playwright/test';

test.describe('Pitch Detection Signal Injection', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => localStorage.clear());
		await page.reload();
	});

	test('should detect 440Hz as A4', async ({ page }) => {
		// Inject oscillator as audio source
		await page.evaluate(() => {
			window.__PITCH_DETECTOR_INJECT_SOURCE__ = async (audioContext) => {
				const osc = audioContext.createOscillator();
				osc.type = 'sine';
				osc.frequency.value = 440;
				osc.start();
				return osc;
			};
		});

		// Start recording
		await page.click('button.start-btn');

		// Wait for the tuner to settle and show data
		const tuner = page.locator('#tuner');
		await expect(tuner).toBeVisible({ timeout: 10000 });

		// Check note name
		const noteName = page.locator('.note-name');
		await expect(noteName).toHaveText('A4');

		// Check frequency display (rounding to 1 decimal place as in UI)
		// pYIN may have slight errors, so we check if it's close to 440
		const freqDisplay = page.locator('.freq').first();
		await expect(async () => {
			const text = await freqDisplay.innerText();
			const freq = parseFloat(text);
			expect(freq).toBeGreaterThan(435);
			expect(freq).toBeLessThan(445);
		}).toPass();

		// Stop recording
		await page.click('button.stop-btn');
		await expect(tuner).not.toBeVisible();
	});

	test('should detect 261.63Hz as C4', async ({ page }) => {
		await page.goto('/');

		await page.evaluate(() => {
			window.__PITCH_DETECTOR_INJECT_SOURCE__ = async (audioContext) => {
				const osc = audioContext.createOscillator();
				osc.type = 'sine';
				osc.frequency.value = 261.63;
				osc.start();
				return osc;
			};
		});

		await page.click('button.start-btn');

		const tuner = page.locator('#tuner');
		await expect(tuner).toBeVisible({ timeout: 10000 });

		const noteName = page.locator('.note-name');
		await expect(noteName).toHaveText('C4');

		const freqDisplay = page.locator('.freq').first();
		await expect(async () => {
			const text = await freqDisplay.innerText();
			const freq = parseFloat(text);
			expect(freq).toBeGreaterThan(255);
			expect(freq).toBeLessThan(265);
		}).toPass();
	});
});
