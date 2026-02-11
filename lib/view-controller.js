
export class ViewController {
	/**
	 * @param {Object} options
	 * @param {number} [options.initialNote=60] 初期中心ノート番号 (中央C)
	 * @param {number} [options.displayRange=36] 表示範囲（半音単位、デフォルト3オクターブ）
	 * @param {number} [options.speed=5.0] スクロール速度（指数減衰定数）
	 */
	constructor(options = {}) {
		this.currentCenterNote = options.initialNote ?? 60;
		this.targetCenterNote = this.currentCenterNote;
		this.displayRange = options.displayRange ?? 36; // 3 octaves
		this.speed = options.speed ?? 5.0;
	}

	/**
	 * 時間経過による表示状態の更新
	 * @param {number} dt 経過時間（秒）
	 */
	update(dt) {
		// 指数平滑化 (目標に向かって減衰)
		// current(t+dt) = target + (current(t) - target) * exp(-k * dt)
		const decay = Math.exp(-this.speed * dt);
		this.currentCenterNote = this.targetCenterNote + (this.currentCenterNote - this.targetCenterNote) * decay;
	}

	/**
	 * 検出されたピッチを設定
	 * @param {number} note 検出されたノート番号
	 */
	setDetectedPitch(note) {
		if (typeof note === 'number' && !isNaN(note)) {
			this.targetCenterNote = note;
		}
	}

	/**
	 * 無音が検出されたことを通知
	 * ビューは最後に検出された位置で停止します。
	 */
	setSilence() {
		// 何もしない。targetCenterNoteは最後に検出されたノートのまま維持される。
		// ビューはその位置に到達するまでスクロールし続ける。
	}

	/**
	 * 描画用のレンダリング状態を取得
	 * @returns {Object} { startNote, endNote, centerNote }
	 */
	getRenderState() {
		const halfRange = this.displayRange / 2;
		return {
			centerNote: this.currentCenterNote,
			startNote: this.currentCenterNote - halfRange,
			endNote: this.currentCenterNote + halfRange
		};
	}
}
