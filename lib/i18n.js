
const resources = {
	ja: {
		"title": "ピッチ検出器",
		"start_recording": "録音開始",
		"stop_recording": "録音停止",
		"settings": "設定",
		"close": "閉じる",
		"language": "言語",
		"scope": "オシロスコープ",
		"name": "音名表記",
		"scale": "スケール",
		"freq_of_a4": "A4の周波数",
		"algorithm": "アルゴリズム",
		"agc_enabled": "AGC (自動ゲイン制御)",
		"agc_target_level": "AGC ターゲットレベル",
		"agc_attack_time": "AGC アタックタイム (ms)",
		"agc_release_time": "AGC リリースタイム (ms)",
		"major": "長調 (Major)",
		"minor": "短調 (Minor)",
		"tap_to_start": "タップして開始",
		"recording": "録音中",
		"settings_icon": "⚙️ 設定",
		"close_icon": "✕ 閉じる",
		"settings_subtitle": "設定",
		"clear_settings": "設定をクリア",
		"confirm_clear_settings": "すべての設定を初期状態に戻しますか？",
	},
	en: {
		"title": "Pitch Detector",
		"start_recording": "Start Recording",
		"stop_recording": "Stop Recording",
		"settings": "Settings",
		"close": "Close",
		"language": "Language",
		"scope": "Scope",
		"name": "Name",
		"scale": "Scale",
		"freq_of_a4": "Freq. of A4",
		"algorithm": "Algorithm",
		"agc_enabled": "AGC (Automatic Gain Control)",
		"agc_target_level": "AGC Target Level",
		"agc_attack_time": "AGC Attack Time (ms)",
		"agc_release_time": "AGC Release Time (ms)",
		"major": "major",
		"minor": "minor (natural)",
		"tap_to_start": "Tap to start",
		"recording": "Recording",
		"settings_icon": "⚙️ Settings",
		"close_icon": "✕ Close",
		"settings_subtitle": "Settings",
		"clear_settings": "Clear Settings",
		"confirm_clear_settings": "Are you sure you want to reset all settings to default?",
	}
};

class I18n {
	constructor() {
		this.language = this.detectLanguage();
	}

	detectLanguage() {
		const saved = localStorage.getItem('pitch-detector-language');
		if (saved && resources[saved]) {
			return saved;
		}
		const browserLang = navigator.language.split('-')[0];
		return resources[browserLang] ? browserLang : 'en';
	}

	setLanguage(lang) {
		if (resources[lang]) {
			this.language = lang;
			localStorage.setItem('pitch-detector-language', lang);
		}
	}

	t(key) {
		const res = resources[this.language];
		return res[key] || key;
	}
}

export const i18n = new I18n();
export const t = (key) => i18n.t(key);
