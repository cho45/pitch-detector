import { test, expect } from '@playwright/test';

test.describe('Settings UI', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => localStorage.clear());
		await page.reload();
	});
	test('should open and close settings menu', async ({ page }) => {
		const settingsBtn = page.locator('.settings-btn');
		const dialog = page.locator('#settings-dialog');
		const closeBtn = page.locator('button:has-text("✕ 閉じる"), button:has-text("✕ Close")');

		// Initially closed
		await expect(dialog).not.toBeVisible();

		// Open
		await settingsBtn.click();
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAttribute('open', '');
		await expect(page.locator('label[for="options-scope"]')).toBeVisible();

		// Close via close button
		await closeBtn.click();
		await expect(dialog).not.toBeVisible();
		await expect(dialog).not.toHaveAttribute('open', '');
	});

	test('should toggle scope and reflect in UI', async ({ page }) => {
		await page.locator('.settings-btn').click();
		const scopeCheckbox = page.locator('#options-scope');
		const scopeContainer = page.locator('div[style*="background: #fff"], div[style*="background: rgb(255, 255, 255)"]');

		// Initially hidden
		await expect(scopeContainer).not.toBeVisible();

		// Toggle on
		await scopeCheckbox.check();
		await expect(scopeContainer).toBeVisible();
	});

	test('should change algorithm', async ({ page }) => {
		await page.locator('.settings-btn').click();

		// Advanced settings should be hidden by default
		await expect(page.locator('.algorithm-settings')).not.toBeVisible();

		// Toggle advanced settings
		await page.locator('#options-advanced').check();
		await expect(page.locator('.algorithm-settings')).toBeVisible();

		// Change to MPM
		const mpmRadio = page.locator('input[value="mpm"]');
		await mpmRadio.check({ force: true });
		await expect(mpmRadio).toBeChecked();

		// Close settings to interact with the main UI
		await page.locator('button:has-text("✕ 閉じる"), button:has-text("✕ Close")').click();

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
		await page.locator('.settings-btn').click();

		// Toggle advanced settings (AGC is in advanced)
		await page.locator('#options-advanced').check();

		const agcCheckbox = page.locator('#options-agc-enabled');
		const agcSettings = page.locator('label[for="options-agc-target"]');

		// Initially ON
		await expect(agcCheckbox).toBeChecked();
		await expect(agcSettings).toBeVisible();

		// Toggle OFF
		await agcCheckbox.uncheck();
		await expect(agcSettings).not.toBeVisible();

		// Clean up: close dialog
		await page.locator('button:has-text("✕ 閉じる"), button:has-text("✕ Close")').click();
	});
});
