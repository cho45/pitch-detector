import { test, expect } from '@playwright/test';

test.describe('Internationalization', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => localStorage.clear());
		await page.reload();
	});

	test('should detect browser language and switch languages', async ({ page }) => {
		const settingsBtn = page.locator('.settings-btn');
		const langSelect = page.locator('#options-language');

		// Open settings
		await settingsBtn.click();

		// Default should be English in Playwright's default locale
		await expect(langSelect).toHaveValue('en');
		await expect(page.locator('#options-scope')).toBeVisible();

		// Switch to Japanese
		await langSelect.selectOption('ja');
		await expect(langSelect).toHaveValue('ja');

		// Check if some text changed to Japanese
		await expect(page.locator('label[for="options-scope"]')).toHaveText(/オシロスコープ/);

		// Switch back to English
		await langSelect.selectOption('en');
		await expect(langSelect).toHaveValue('en');
		await expect(page.locator('label[for="options-scope"]')).toHaveText(/Scope/);

		// Clean up
		await page.locator('button:has-text("✕ 閉じる"), button:has-text("✕ Close")').click();
	});
});
