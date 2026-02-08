import { test, expect } from '@playwright/test';

test.describe('Internationalization', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
	});

	test('should detect browser language and switch languages', async ({ page }) => {
		const settingsBtn = page.locator('.setting-toggle');
		const langSelect = page.locator('#options-language');
		const startBtn = page.locator('button.start-btn');

		// Open settings
		await settingsBtn.click();

		// Default should be English in Playwright's default locale
		await expect(langSelect).toHaveValue('en');
		await expect(startBtn).toHaveText('Start Recording');

		// Switch to Japanese
		await langSelect.selectOption('ja');
		await expect(startBtn).toHaveText('録音開始');
		await expect(page.locator('label[for="options-scope"]')).toHaveText('オシロスコープ');

		// Check if persistent after reload
		await page.reload();
		await settingsBtn.click();
		await expect(langSelect).toHaveValue('ja');
		await expect(startBtn).toHaveText('録音開始');

		// Switch back to English
		await langSelect.selectOption('en');
		await expect(startBtn).toHaveText('Start Recording');
	});
});
