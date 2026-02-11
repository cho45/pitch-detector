
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
		"clear_cache": "キャッシュを削除",
		"confirm_clear_cache": "キャッシュを削除しますか？アプリケーションはリロードされます。",
		"cache_cleared": "キャッシュが削除されました。",
		"pitch_pyin_desc": "最も正確。HMMにより誤検出が極めて少ない。",
		"pitch_mpm_desc": "YINの改良版。ピーク選択が賢く、安定している。",
		"pitch_yin_desc": "標準的だが、特定の周波数で誤認が発生しやすい。",
		"pitch_pitchy_desc": "高速だが、ノイズに対して不安定になりやすい。",
		"advanced_settings": "アドバンスド設定",
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
		"clear_cache": "Clear Cache",
		"confirm_clear_cache": "Are you sure you want to clear the cache? The application will be reloaded.",
		"cache_cleared": "Cache cleared.",
		"pitch_pyin_desc": "Most accurate. HMM ensures very low false detections.",
		"pitch_mpm_desc": "Improved YIN. Smart peak selection, more stable.",
		"pitch_yin_desc": "Standard, but prone to octave errors at certain frequencies.",
		"pitch_pitchy_desc": "Fast, but can be unstable with noise.",
		"advanced_settings": "Advanced Settings",
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
