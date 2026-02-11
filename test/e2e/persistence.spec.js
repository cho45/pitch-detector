import { test, expect } from '@playwright/test';

test.describe('Settings Persistence', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// Clear localStorage before each test
		await page.evaluate(() => localStorage.clear());
		await page.reload();
	});

	test('should save and restore settings after reload', async ({ page }) => {
		await page.locator('.settings-btn').click();

		// Toggle advanced settings
		await page.check('#options-advanced');
		// Change algorithm to MPM (now visible)
		await page.check('input[value="mpm"]', { force: true });
		// Toggle scope on
		await page.check('#options-scope');
		// Change Freq of A4
		await page.fill('#options-tune', '442');

		// Verify settings are in localStorage
		const savedSettings = await page.evaluate(() => localStorage.getItem('pitch-detector-settings'));
		const settings = JSON.parse(savedSettings);
		expect(settings.pitchAlgorithm).toBe('mpm');
		expect(settings.showAdvanced).toBe(true);
		expect(settings.showScope).toBe(true);
		expect(settings.freqOfA4).toBe(442);

		// Reload page
		await page.reload();

		// Verify settings are restored
		await page.locator('.settings-btn').click();
		await expect(page.locator('#options-advanced')).toBeChecked();
		await expect(page.locator('input[value="mpm"]')).toBeChecked();
		await expect(page.locator('#options-scope')).toBeChecked();
		await expect(page.locator('#options-tune')).toHaveValue('442');
	});

	test('should clear settings', async ({ page }) => {
		await page.locator('.settings-btn').click();

		// Change something to non-default
		await page.check('#options-advanced');
		await page.check('input[value="mpm"]', { force: true });

		// Mock window.confirm to return true
		page.on('dialog', dialog => dialog.accept());

		// Click clear settings button
		await page.click('button:has-text("設定をクリア"), button:has-text("Clear Settings")');

		// Wait for reload
		await page.waitForLoadState('load');

		// Verify settings are cleared from localStorage
		const savedSettings = await page.evaluate(() => localStorage.getItem('pitch-detector-settings'));
		expect(savedSettings).toBeNull();

		// Verify setting is back to default (pyin is default)
		await page.locator('.settings-btn').click();
		// Advanced settings should be hidden by default
		await expect(page.locator('#options-advanced')).not.toBeChecked();
		await expect(page.locator('.algorithm-settings')).not.toBeVisible();

		// Open it to check the radio
		await page.check('#options-advanced');
		await expect(page.locator('input[value="pyin"]')).toBeChecked();
	});
});
