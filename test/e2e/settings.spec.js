import { test, expect } from '@playwright/test';

test.describe('Settings UI', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
	});

	test('should open and close settings menu', async ({ page }) => {
		const settingsBtn = page.locator('.setting-toggle');
		const optionsDiv = page.locator('#options');

		// Initially closed
		await expect(page.locator('label[for="options-scope"]')).not.toBeVisible();

		// Open
		await settingsBtn.click();
		await expect(optionsDiv).toHaveClass(/open/);
		await expect(page.locator('label[for="options-scope"]')).toBeVisible();

		// Close
		await settingsBtn.click();
		await expect(optionsDiv).not.toHaveClass(/open/);
		await expect(page.locator('label[for="options-scope"]')).not.toBeVisible();
	});

	test('should toggle scope and reflect in UI', async ({ page }) => {
		await page.locator('.setting-toggle').click();
		const scopeCheckbox = page.locator('#options-scope');
		const scopeContainer = page.locator('div[style*="background: #fff"], div[style*="background: rgb(255, 255, 255)"]');

		// Initially hidden
		await expect(scopeContainer).not.toBeVisible();

		// Toggle on
		await scopeCheckbox.check();
		await expect(scopeContainer).toBeVisible();
	});

	test('should change algorithm', async ({ page }) => {
		await page.locator('.setting-toggle').click();
		const algoSelect = page.locator('#options-algorithm');

		// Change to MPM
		await algoSelect.selectOption('mpm');
		await expect(algoSelect).toHaveValue('mpm');

		// Start recording and check if it still works (using console log check)
		const consoleMessages = [];
		page.on('console', msg => consoleMessages.push(msg.text()));

		await page.evaluate(() => {
			window.__PITCH_DETECTOR_INJECT_SOURCE__ = async (audioContext) => {
				const osc = audioContext.createOscillator();
				osc.start();
				return osc;
			};
		});

		await page.click('button.start-btn');
		await page.waitForTimeout(1000); // Wait for some processing

		const mpmLog = consoleMessages.find(m => m.includes('Using MPM pitch detection algorithm'));
		expect(mpmLog).toBeDefined();
	});

	test('should toggle AGC and show/hide its settings', async ({ page }) => {
		await page.locator('.setting-toggle').click();
		const agcCheckbox = page.locator('#options-agc-enabled');
		const agcSettings = page.locator('label[for="options-agc-target"]');

		// Initially ON
		await expect(agcCheckbox).toBeChecked();
		await expect(agcSettings).toBeVisible();

		// Toggle OFF
		await agcCheckbox.uncheck();
		await expect(agcSettings).not.toBeVisible();
	});
});
