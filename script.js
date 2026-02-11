
import { PitchDetector } from "./lib/pitchy.js";
import { YINDetector, createYINDetector } from "./lib/yin.js";
import { PYINDetector, createPYINDetector } from "./lib/pyin.js";
import { MPMDetector, createMPMDetector } from "./lib/mpm.js";
import { ViewController } from "./lib/view-controller.js";
import { i18n, t } from "./lib/i18n.js";

/**
 * AGC AudioWorklet ノードラッパー
 * リアルタイム自動ゲイン制御のための AudioWorkletNode を管理
 */
class AGCAudioWorklet {
	constructor(audioContext, targetLevel = 0.3, attackTime = 0.003, releaseTime = 0.1) {
		this.audioContext = audioContext;
		this.targetLevel = targetLevel;
		this.attackTime = attackTime;
		this.releaseTime = releaseTime;
		this.maxGain = 50.0;
		this.minGain = 0.1;
		this.workletNode = null;
		this.isReady = false;
	}

	/**
	 * Initialize the AudioWorklet
	 * @returns {Promise<void>}
	 */
	async init() {
		try {
			// AGC プロセッサワークレットの読み込み
			await this.audioContext.audioWorklet.addModule('./agc-processor.js');

			// AudioWorkletNode の作成
			this.workletNode = new AudioWorkletNode(this.audioContext, 'agc-processor', {
				processorOptions: {
					targetLevel: this.targetLevel,
					attackTime: this.attackTime,
					releaseTime: this.releaseTime,
					maxGain: this.maxGain,
					minGain: this.minGain
				}
			});

			// プロセッサからのメッセージを監視
			this.workletNode.port.onmessage = (event) => {
				this.handleProcessorMessage(event.data);
			};

			this.isReady = true;
			console.log('🎚️ AGC AudioWorklet initialized successfully');

		} catch (error) {
			console.error('❌ Failed to initialize AGC AudioWorklet:', error);
			throw error;
		}
	}

	/**
	 * Handle messages from the AudioWorklet processor
	 * @param {Object} data - Message data
	 */
	handleProcessorMessage(data) {
		switch (data.type) {
			case 'agcStats':
				console.log(`🎚️ AGC Stats: RMS=${data.stats.rms}, Envelope=${data.stats.envelope}, Gain=${data.stats.gain}x`);
				break;
			case 'parametersUpdated':
				console.log('🎚️ AGC parameters updated in processor');
				break;
			default:
				console.log('🎚️ AGC processor message:', data);
		}
	}

	/**
	 * Get the AudioWorkletNode for connecting in audio graph
	 * @returns {AudioWorkletNode|null} The worklet node
	 */
	getNode() {
		return this.workletNode;
	}

	/**
	 * Update AGC parameters
	 * @param {Object} params - Parameters to update
	 */
	updateParameters(params) {
		if (!this.workletNode) {
			console.warn('🎚️ AGC worklet not initialized, caching parameters');
			// Cache parameters for when worklet is ready
			if (params.targetLevel !== undefined) this.targetLevel = params.targetLevel;
			if (params.attackTime !== undefined) this.attackTime = params.attackTime;
			if (params.releaseTime !== undefined) this.releaseTime = params.releaseTime;
			if (params.maxGain !== undefined) this.maxGain = params.maxGain;
			if (params.minGain !== undefined) this.minGain = params.minGain;
			return;
		}

		// Send parameters to the processor
		this.workletNode.port.postMessage(params);

		// Update local cache
		if (params.targetLevel !== undefined) this.targetLevel = params.targetLevel;
		if (params.attackTime !== undefined) this.attackTime = params.attackTime;
		if (params.releaseTime !== undefined) this.releaseTime = params.releaseTime;
		if (params.maxGain !== undefined) this.maxGain = params.maxGain;
		if (params.minGain !== undefined) this.minGain = params.minGain;
	}

	/**
	 * Check if the worklet is ready for use
	 * @returns {boolean} True if ready
	 */
	ready() {
		return this.isReady && this.workletNode !== null;
	}
}

const PITCH_DETECTION_SAMPLE_RATE = 24000;

const app = Vue.createApp({
	data() {
		return {
			status: t("tap_to_start"),
			currentLanguage: i18n.language,

			// https://en.wikipedia.org/wiki/Scientific_pitch_notation
			// 中央Cはノート番号60
			// 中央Aはノート番号69、440Hz
			freqOfA4: 440,
			// 88鍵 = A0(21) - C8(108)
			// displayRange: 36 (3オクターブ)
			displayRange: 36,
			viewController: null,

			// startNote/endNote は動的になったため data から削除

			scale: "0,major",

			showScope: false,

			freqError: 0,
			clarity: 0,
			note: 0,
			targetFreq: 0,
			actualFreq: 0,
			up: false,
			down: false,
			selectedName: "CDEFGAB",

			// ピッチ検出アルゴリズムの選択
			pitchAlgorithm: "pyin", // "pitchy", "yin", "pyin", or "mpm"

			// AGC設定
			agcEnabled: true,
			agcTargetLevel: 0.3,
			agcAttackTime: 0.003,
			agcReleaseTime: 0.1,

			openSetting: false,

			// オーディオ状態
			audioContext: null,
			agc: null,
			detector: null,

			// UI表示制御
			uiVisible: true,
			uiHideTimer: null,

			noteName: [
				{
					name: "CDEFGAB",
					values: [
						"C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"
					]
				},
				{
					name: "CDEFGAH",
					values: [
						"C", "Cis", "D", "Dis", "E", "F", "Fis", "G", "Gis", "A", "Ais", "H"
					]
				},
				{
					name: "DoReMiFaSoLaTi",
					values: [
						"Do", "Do♯", "Re", "Re♯", "Mi", "Fa", "Fa♯", "So", "So♯", "La", "La♯", "Ti"
					]
				},
				{
					name: "ドレミファソラシ",
					values: [
						"ド", "ド♯", "レ", "レ♯", "ミ", "ファ", "ファ♯", "ソ", "ソ♯", "ラ", "ラ♯", "シ"
					]
				},
				{
					name: "ハニホヘトイロ",
					values: [
						"ハ", "嬰ハ", "ニ", "嬰ニ", "ホ", "ヘ", "嬰ヘ", "ト", "嬰ト", "イ", "嬰イ", "ロ"
					]
				},
				{
					name: "Hz",
					values: []
				},
			],
		}
	},

	computed: {
		parsedScale() {
			const [keyNote, type] = this.scale.split(/,/);
			return [+keyNote, type];
		},
	},

	watch: {
		freqOfA4() {
			// this.setupCanvas(); // redraw needed
		},

		pitchAlgorithm() {
			console.log(`🔄 Switching to ${this.pitchAlgorithm} algorithm`);
			// Immediately recreate detector if audio context is available
			this.initDetector();
		},

		agcTargetLevel() {
			if (this.agc) {
				this.agc.updateParameters({ targetLevel: this.agcTargetLevel });
				console.log(`🎚️ AGC target level updated: ${this.agcTargetLevel.toFixed(2)}`);
			}
		},

		agcAttackTime() {
			if (this.agc) {
				this.agc.updateParameters({ attackTime: this.agcAttackTime });
				console.log(`🎚️ AGC attack time updated: ${(this.agcAttackTime * 1000).toFixed(1)}ms`);
			}
		},

		agcReleaseTime() {
			if (this.agc) {
				this.agc.updateParameters({ releaseTime: this.agcReleaseTime });
				console.log(`🎚️ AGC release time updated: ${(this.agcReleaseTime * 1000).toFixed(0)}ms`);
			}
		},

		agcEnabled() {
			console.log(`🎚️ AGC ${this.agcEnabled ? 'enabled' : 'disabled'}`);
			// Update AGC enabled parameter in real-time
			if (this.audioContext && this.agc && this.agc.getNode()) {
				const enabledParam = this.agc.getNode().parameters.get('enabled');
				if (enabledParam) {
					enabledParam.value = this.agcEnabled ? 1 : 0;
					console.log('🎚️ AGC enabled parameter updated in real-time');
				}
			}
		},
		currentLanguage() {
			i18n.setLanguage(this.currentLanguage);
			this.status = this.audioContext ? t("recording") : t("tap_to_start");
			this.initCanvas();
		},
	},

	created() {
		this.loadSettings();
		// 全ての設定プロパティを監視し、localStorageに保存
		const settingsToWatch = [
			'freqOfA4', 'displayRange', 'scale', 'showScope',
			'selectedName', 'pitchAlgorithm', 'agcEnabled',
			'agcTargetLevel', 'agcAttackTime', 'agcReleaseTime'
		];
		settingsToWatch.forEach(prop => {
			this.$watch(prop, () => {
				this.saveSettings();
			});
		});
	},

	mounted() {
		console.log("mounted");

		// ViewControllerの初期化
		this.viewController = new ViewController({
			initialNote: 69, // A4
			displayRange: this.displayRange,
			speed: 5.0
		});

		this.setupCanvas();

		// アニメーションループの開始
		let lastTime = performance.now();
		const loop = (time) => {
			const dt = (time - lastTime) / 1000;
			lastTime = time;

			this.update(dt);
			this.draw(dt);

			requestAnimationFrame(loop);
		};
		requestAnimationFrame(loop);

		window.addEventListener('resize', () => {
			this.resize();
		});

		// UI操作のためのグローバルイベントリスナーを追加
		this.handleMouseMove = () => {
			this.onUIInteraction();
		};

		this.handleTouchStart = () => {
			this.onUIInteraction();
		};

		document.body.addEventListener('mousemove', this.handleMouseMove);
		document.body.addEventListener('touchstart', this.handleTouchStart);
		console.log('Global UI interaction listeners added');
	},

	beforeUnmount() {
		// グローバルイベントリスナーの削除
		if (this.handleMouseMove) {
			document.body.removeEventListener('mousemove', this.handleMouseMove);
		}
		if (this.handleTouchStart) {
			document.body.removeEventListener('touchstart', this.handleTouchStart);
		}
		console.log('Global UI interaction listeners removed');
	},

	methods: {
		noteToHz: function (note) {
			return this.freqOfA4 * Math.pow(2, (note - 69) / 12);
		},

		hzToNote: function (hz) {
			return 12 * Math.log2(hz / this.freqOfA4) + 69;
		},

		nameOfNote: function (note) {
			note = Math.round(note);
			const octave = Math.floor(note / 12) - 1;
			if (this.selectedName === 'Hz') {
				return this.noteToHz(note).toFixed(1);
			} else {
				const names = this.noteName.find((i) => i.name === this.selectedName);
				const name = names.values[note % 12];
				return name + octave;
			}
		},

		t: function (key) {
			return t(key);
		},

		isScaleTone: function (note) {
			const [keyNote, type] = this.parsedScale;
			const pos = (note - keyNote) % 12;
			if (type === 'major') {
				return [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1][pos] === 1;
			} else
				if (type === 'minor') {
					return [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0][pos] === 1;
				}
		},

		differenceInCent: function (a, b) {
			return 1200 * Math.log2(b / a);
		},



		resize: function () {
			if (this.resizeTimer) clearInterval(this.resizeTimer);
			this.resizeTimer = setTimeout(() => {
				console.log('resize');
				this.setupCanvas();
			}, 250);
		},

		update: function (dt) {
			if (this.viewController) {
				this.viewController.update(dt);
			}
		},

		/**
		 * Main draw loop called every frame
		 */
		draw: function (dt) {
			if (!this.mainCtx || !this.viewController) return;

			const { startNote, endNote, centerNote } = this.viewController.getRenderState();
			// Calculate 'noteLength' equivalent for drawing
			const noteLength = endNote - startNote; // Should be equal to displayRange

			// Clear & Draw Grid
			const ctx = this.mainCtx;
			const width = this.mainWidth;
			const height = this.mainHeight;

			ctx.clearRect(0, 0, width, height);

			for (let n = 0; n <= noteLength; n++) {
				// Draw based on startNote
				// startNote might be float, so we need to align to integer notes?
				// To draw grid lines for integer notes:
				// Iterate from ceil(startNote) to floor(endNote)

				const gridNote = Math.floor(startNote) + n;
				if (gridNote > endNote) break;

				// Position Y
				// y = height / len * (len - (note - start))
				//   = height * (1 - (note - start) / len)
				const y = height * (1 - (gridNote - startNote) / noteLength);

				if ((gridNote % 12) === this.parsedScale[0]) {
					// key
					ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
					ctx.lineWidth = 2 * window.devicePixelRatio;
				} else if (this.isScaleTone(gridNote)) {
					ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
					ctx.lineWidth = 1 * window.devicePixelRatio;
				} else {
					ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
					ctx.lineWidth = 1 * window.devicePixelRatio;
				}

				ctx.beginPath();
				ctx.moveTo(25 * window.devicePixelRatio, y);
				ctx.lineTo(width, y);
				ctx.stroke();
				ctx.font = `${12 * window.devicePixelRatio}px sans-serif`;
				ctx.fillStyle = this.isScaleTone(gridNote) ? "rgba(255, 255, 255, 0.99)" : "rgba(255, 255, 255, 0.55)";
				ctx.textBaseline = 'middle';
				ctx.fillText(this.nameOfNote(gridNote), 0, y);
			}

			// グラフスクロールの描画
			// 毎フレームグラフを左に1px移動 (約60fps)
			// かつ垂直方向の移動を補正
			if (this.graphCtx && this.$refs.graph) {
				const ppn = height / noteLength; // ノートあたりのピクセル数
				// Noteの前フレームからの差分を取得
				const lastStart = this._lastStartNote ?? startNote;
				const deltaNote = startNote - lastStart;
				this._lastStartNote = startNote;

				// サブピクセル移動量を蓄積
				if (!this._dyAccum) this._dyAccum = 0;
				this._dyAccum += deltaNote * ppn;

				// 整数ピクセル分だけ移動
				const moveY = Math.round(this._dyAccum);

				if (moveY !== 0) {
					// 蓄積値から移動分を引く
					this._dyAccum -= moveY;
				}

				// 左に1pxスクロールし、垂直方向にシフト
				this.graphCtx.globalCompositeOperation = 'copy';
				this.graphCtx.drawImage(
					this.$refs.graph,
					1, 0, width - 1, height, // ソース (右へ1pxシフトではない、右側の部分を取得して左へ移動)
					// (1,0) を (0, moveY) に移動したい
					// Source: x=1, y=0, w=width-1, h=height
					// Dest: x=0, y=moveY, w=width-1, h=height

					// dy が正の場合 (startNote が増加、ビューが上に移動)、古い点 (絶対ピッチ) は下に移動する。
					// つまり dy が正で正しい (y は下に向かって増加)。

					0, moveY, width - 1, height
				);
				this.graphCtx.globalCompositeOperation = 'source-over';

				// 検知がある場合、新しい点を描画
				if (this.clarity > 0.0) { // 描画のための任意の閾値
					const currentNote = this.note; // handleAudioChunk で更新される
					// y = height - (note - startNote) * ppn
					const ptY = height - (currentNote - startNote) * ppn;

					this.graphCtx.fillStyle = `rgba(255, 0, 0, ${this.clarity})`;
					this.graphCtx.fillRect(width - 2, ptY - 2, 4, 4);
				}


			}
		},

		setupCanvas: function () {
			// this.scopeCanvas = this.$refs.scopeCanvas;
			if (!this.$refs.main) return;

			const canvas = this.$refs.main;
			canvas.style.width = null;
			canvas.style.height = null;
			canvas.width = 0;
			canvas.height = 0;

			const width = canvas.offsetParent.offsetWidth * window.devicePixelRatio;
			const height = canvas.offsetParent.offsetHeight * window.devicePixelRatio;

			canvas.style.width = canvas.offsetParent.offsetWidth + 'px';
			canvas.style.height = canvas.offsetParent.offsetHeight + 'px';
			canvas.width = width;
			canvas.height = height;

			const ctx = canvas.getContext("2d");
			// Clear logic moved to draw()

			this.mainCtx = ctx;
			this.mainWidth = width;
			this.mainHeight = height;

			this.$refs.graph.style.width = canvas.style.width;
			this.$refs.graph.style.height = canvas.style.height;
			this.$refs.graph.width = width;
			this.$refs.graph.height = height;
			this.graphCtx = this.$refs.graph.getContext('2d');
		},
		start: async function () {
			if (this.audioContext) return;

			console.log('Recording started');
			this.status = t("recording");

			// latencyHint: 'interactive' は応答性に重要
			this.audioContext = new AudioContext({
				latencyHint: 'interactive',
			});

			let source;
			if (window.__PITCH_DETECTOR_INJECT_SOURCE__) {
				console.log('💉 テスト用音源を注入 (Injecting test audio source)');
				source = await window.__PITCH_DETECTOR_INJECT_SOURCE__(this.audioContext);
			} else {
				const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
				source = this.audioContext.createMediaStreamSource(stream);
			}

			// 1. AGC AudioWorklet の初期化
			this.agc = new AGCAudioWorklet(
				this.audioContext,
				this.agcTargetLevel,
				this.agcAttackTime,
				this.agcReleaseTime
			);

			// 2. StreamProcessor の初期化 (10kHzリサンプリング & 連続チャンク)
			try {
				await this.agc.init();
				await this.audioContext.audioWorklet.addModule('./stream-processor.js');

				const streamNode = new AudioWorkletNode(this.audioContext, 'stream-processor', {
					processorOptions: {
						targetSampleRate: PITCH_DETECTION_SAMPLE_RATE
					}
				});
				const analyser = this.audioContext.createAnalyser();

				// オーディオグラフ: Source -> AGC -> StreamProcessor -> Analyser (スコープ用)
				source.connect(this.agc.getNode());
				this.agc.getNode().connect(streamNode);
				streamNode.connect(analyser);

				// AGC有効状態の初期設定
				const enabledParam = this.agc.getNode().parameters.get('enabled');
				if (enabledParam) enabledParam.value = this.agcEnabled ? 1 : 0;

				console.log('🎚️ Audio graph connected: source -> AGC -> StreamProcessor -> Analyser');

				// 3. 検出器の初期化 (この時点では常に10kHz)
				this.initDetector();

				// StreamProcessor からのオーディオチャンクを監視
				streamNode.port.onmessage = (event) => {
					if (event.data.type === 'audioChunk') {
						this.handleAudioChunk(event.data.buffer, event.data.sampleRate);
					}
				};

				// スコープ描画のセットアップ
				analyser.fftSize = 4096;
				const scopeCtx = this.$refs.scope.getContext("2d");
				const scopeWidth = this.$refs.scope.width;
				const scopeHeight = this.$refs.scope.height;
				const audioData = new Float32Array(analyser.fftSize);

				const draw = () => {
					if (!this.audioContext) return;
					analyser.getFloatTimeDomainData(audioData);

					// Draw scope
					scopeCtx.fillStyle = "#000000";
					scopeCtx.fillRect(0, 0, scopeWidth, scopeHeight);
					scopeCtx.strokeStyle = "#fff";
					scopeCtx.beginPath();
					scopeCtx.moveTo(0, scopeHeight / 2);
					for (var i = 0, len = audioData.length; i < len; i++) {
						scopeCtx.lineTo(
							scopeWidth / len * i,
							(audioData[i] / 2) * scopeHeight + scopeHeight / 2
						);
					}
					scopeCtx.stroke();
					requestAnimationFrame(draw);
				};
				requestAnimationFrame(draw);

			} catch (error) {
				console.error('❌ AudioWorklet initialization failed:', error);
				this.status = "Error: " + error.message;
				this.stop();
				return;
			}

			this.startUIHideTimer();
		},

		/**
		 * StreamProcessor からの連続オーディオチャンクを処理
		 * 固定10kHzレートでピッチ検出を実行
		 */
		handleAudioChunk: function (buffer, sampleRate) {
			if (!this.detector || !this.audioRingBuffer) return;

			// 1. 新しいチャンクのために既存データをシフト
			// (最適化: ネイティブの copyWithin は高速)
			const overlap = this.audioRingBuffer.length - buffer.length;
			this.audioRingBuffer.copyWithin(0, buffer.length);

			// 2. 末尾に新しいチャンクを追加
			this.audioRingBuffer.set(buffer, overlap);

			// 初回充填チェック
			if (!this.isBufferFull) {
				this.audioRingBufferPtr += buffer.length;
				if (this.audioRingBufferPtr >= this.audioRingBuffer.length) {
					this.isBufferFull = true;
				} else {
					return; // Wait until buffer is full
				}
			}

			// 3. スライディングウィンドウ全体でピッチ検出を実行
			const pitchStart = performance.now();
			const [freq, clarity] = this.detector.findPitch(this.audioRingBuffer, sampleRate);
			const pitchTime = performance.now() - pitchStart;

			// パフォーマンス監視
			if (!this._pCount) this._pCount = 0;
			if (!this._pTime) this._pTime = 0;
			this._pTime += pitchTime;
			this._pCount++;
			if (this._pCount % 60 === 0) {
				// 約1秒ごとにログ出力 (60フレーム)
				console.log(`📊 ${this.detector.constructor.name} avg: ${(this._pTime / this._pCount).toFixed(3)}ms/frame (${(sampleRate / 1000).toFixed(1)}kHz)`);
				this._pCount = 0;
				this._pTime = 0;
			}

			// UI用の状態更新
			this.actualFreq = freq;
			this.clarity = clarity;
			const note = this.hzToNote(freq);
			this.note = note;

			if (this.viewController) {
				if (clarity > 0.9) { // トラッキングのための高い明瞭度閾値
					this.viewController.setDetectedPitch(note);
				} else {
					this.viewController.setSilence();
				}
			}

			const fit = this.noteToHz(Math.round(note));
			this.targetFreq = fit;
			this.freqError = this.differenceInCent(fit, freq);
			this.up = this.freqError < -5;
			this.down = this.freqError > 5;

			// Graph updating moved to draw()
		},

		stop: async function () {
			console.log('Stop called');
			if (this.audioContext) {
				await this.audioContext.close();
				this.audioContext = null;
				this.agc = null;
				this.detector = null;
				this.status = t("tap_to_start");
				console.log('🛑 Audio context stopped');

				// Reset UI states
				this.clarity = 0;
				this.note = 0;
				this.up = false;
				this.down = false;
				this.freqError = 0;
				this.actualFreq = 0;
				this.targetFreq = 0;

				// Show UI and clear timer when recording stops
				this.showUI();
				this.clearUIHideTimer();
			}
		},



		// ピッチ検出器の初期化
		initDetector: function () {
			const sampleRate = PITCH_DETECTION_SAMPLE_RATE; // StreamProcessor から固定24kHz
			const PART_LENGTH = 2048;  // 検出ウィンドウサイズ
			const maxFreq = 4200;      // ピアノC8以上をカバー

			// 既存の検出器があればクリーンアップ
			if (this.detector) {
				console.log('🔄 Replacing existing detector:', this.detector.constructor.name);
			}

			// 選択されたアルゴリズムに基づいて検出器を作成
			if (this.pitchAlgorithm === 'yin') {
				this.detector = new YINDetector(sampleRate, PART_LENGTH, 0.2);
				console.log('🎵 Using YIN pitch detection algorithm');
			} else if (this.pitchAlgorithm === 'pyin') {
				this.detector = new PYINDetector(sampleRate, PART_LENGTH, 80, maxFreq);
				console.log('🎵 Using PYIN pitch detection algorithm');
			} else if (this.pitchAlgorithm === 'mpm') {
				this.detector = new MPMDetector(sampleRate, PART_LENGTH, 0.93);
				console.log('🎵 Using MPM pitch detection algorithm');
			} else {
				this.detector = PitchDetector.forFloat32Array(PART_LENGTH);
				console.log('🎵 Using Pitchy pitch detection algorithm');
			}

			console.log('🔄 Detector initialized:', this.detector.constructor.name);

			// スライディングウィンドウ検出用のリングバッファ初期化
			// 少なくとも PART_LENGTH サンプル必要
			// 2048 は 1024 ウィンドウとオーバーラップに対して安全
			this.audioRingBuffer = new Float32Array(PART_LENGTH);
			this.audioRingBufferPtr = 0;
			this.isBufferFull = false;
		},

		// UI表示制御メソッド
		startUIHideTimer: function () {
			this.clearUIHideTimer();
			if (this.openSetting) return; // Settings dialog is open, don't start timer

			this.uiHideTimer = setTimeout(() => {
				this.hideUI();
			}, 3000); // Hide after 3 seconds
		},

		clearUIHideTimer: function () {
			if (this.uiHideTimer) {
				clearTimeout(this.uiHideTimer);
				this.uiHideTimer = null;
			}
		},

		hideUI: function () {
			if (this.audioContext && !this.openSetting) {
				this.uiVisible = false;
				console.log('UI hidden');
			}
		},

		showUI: function () {
			this.uiVisible = true;
			if (this.audioContext) {
				this.startUIHideTimer();
			}
		},

		onUIInteraction: function () {
			if (this.audioContext) {
				this.showUI();
			}
		},

		openSettings: function () {
			const dialog = this.$refs.settingsDialog;
			if (dialog) {
				this.openSetting = true;
				dialog.showModal();
				this.clearUIHideTimer();
				this.uiVisible = true;
				console.log('Settings dialog opened');
			}
		},

		closeSettings: function () {
			const dialog = this.$refs.settingsDialog;
			if (dialog) {
				dialog.close();
				this.openSetting = false;
				this.startUIHideTimer();
				console.log('Settings dialog closed');
			}
		},

		loadSettings: function () {
			const saved = localStorage.getItem('pitch-detector-settings');
			if (saved) {
				try {
					const settings = JSON.parse(saved);
					Object.assign(this, settings);
					console.log('⚙️ Settings loaded from localStorage');
				} catch (e) {
					console.error('❌ Failed to load settings from localStorage:', e);
				}
			}
		},

		saveSettings: function () {
			const settings = {
				freqOfA4: this.freqOfA4,
				displayRange: this.displayRange,
				scale: this.scale,
				showScope: this.showScope,
				selectedName: this.selectedName,
				pitchAlgorithm: this.pitchAlgorithm,
				agcEnabled: this.agcEnabled,
				agcTargetLevel: this.agcTargetLevel,
				agcAttackTime: this.agcAttackTime,
				agcReleaseTime: this.agcReleaseTime
			};
			localStorage.setItem('pitch-detector-settings', JSON.stringify(settings));
			console.log('⚙️ Settings saved to localStorage');
		},

		clearSettings: function () {
			if (confirm(t('confirm_clear_settings'))) {
				localStorage.removeItem('pitch-detector-settings');
				localStorage.removeItem('pitch-detector-language');
				console.log('⚙️ Settings cleared from localStorage');
				location.reload();
			}
		},

		clearCache: async function () {
			if (confirm(t('confirm_clear_cache'))) {
				if ('serviceWorker' in navigator) {
					const registrations = await navigator.serviceWorker.getRegistrations();
					for (const registration of registrations) {
						await registration.unregister();
					}
				}
				if ('caches' in window) {
					const keys = await caches.keys();
					await Promise.all(keys.map(key => caches.delete(key)));
				}
				alert(t('cache_cleared'));
				location.reload();
			}
		}
	}
}).mount("#app");
window.app = app;

if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('./sw.js')
			.then((registration) => {
				console.log('ServiceWorker registration successful with scope: ', registration.scope);
			}, (err) => {
				console.log('ServiceWorker registration failed: ', err);
			});
	});
}


