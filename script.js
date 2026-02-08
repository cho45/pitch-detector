
import { PitchDetector } from "./lib/pitchy.js";
import { YINDetector, createYINDetector } from "./lib/yin.js";
import { PYINDetector, createPYINDetector } from "./lib/pyin.js";
import { MPMDetector, createMPMDetector } from "./lib/mpm.js";
import { i18n, t } from "./lib/i18n.js";

/**
 * AGC AudioWorklet Node Wrapper
 * Manages AudioWorkletNode for real-time automatic gain control
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
			// Load the AGC processor worklet
			await this.audioContext.audioWorklet.addModule('./agc-processor.js');

			// Create the AudioWorkletNode
			this.workletNode = new AudioWorkletNode(this.audioContext, 'agc-processor', {
				processorOptions: {
					targetLevel: this.targetLevel,
					attackTime: this.attackTime,
					releaseTime: this.releaseTime,
					maxGain: this.maxGain,
					minGain: this.minGain
				}
			});

			// Listen for messages from the processor
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

Vue.createApp({
	data() {
		return {
			status: t("tap_to_start"),
			currentLanguage: i18n.language,

			// https://en.wikipedia.org/wiki/Scientific_pitch_notation
			// center C is note number 60
			// center A is note number 69 and 440Hz
			freqOfA4: 440,
			// 88 keys = A0(21) - C8(108)
			startNote: 60 - 24,
			endNote: 60 + 24,

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

			// Pitch detection algorithm selection
			pitchAlgorithm: "pyin", // "pitchy", "yin", "pyin", or "mpm"

			// AGC settings
			agcEnabled: true,
			agcTargetLevel: 0.3,
			agcAttackTime: 0.003,
			agcReleaseTime: 0.1,

			openSetting: false,

			// Audio state
			audioContext: null,
			agc: null,
			detector: null,

			// UI visibility control
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
		noteLength() {
			return this.endNote - this.startNote;
		},

		parsedScale() {
			const [keyNote, type] = this.scale.split(/,/);
			return [+keyNote, type];
		},
	},

	watch: {
		showScope() {
			this.resize();
		},

		scale() {
			this.initCanvas();
		},

		selectedName() {
			this.initCanvas();
		},

		freqOfA4() {
			this.initCanvas();
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
		// Watch all setting properties and save to localStorage
		const settingsToWatch = [
			'freqOfA4', 'startNote', 'endNote', 'scale', 'showScope',
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
		this.initCanvas();

		window.addEventListener('resize', () => {
			this.resize();
		});

		// Add global event listeners for UI interaction
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
		// Remove global event listeners
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

		initCanvas: function () {
			// this.scopeCanvas = this.$refs.scopeCanvas;

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

			ctx.clearRect(0, 0, width, height);

			for (let n = 0, len = this.noteLength; n < len; n++) {
				const y = height / len * (len - n);
				const note = this.startNote + n;
				// console.log(note, nameOfNote(note));

				/*
				if (note === 60) {
					// middle C
					ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
					ctx.lineWidth   = 2 * window.devicePixelRatio;
				}
				*/

				if ((note % 12) === this.parsedScale[0]) {
					// key
					ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
					ctx.lineWidth = 2 * window.devicePixelRatio;
				} else
					if (this.isScaleTone(note)) {
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
				ctx.fillStyle = this.isScaleTone(note) ? "rgba(255, 255, 255, 0.99)" : "rgba(255, 255, 255, 0.55)";
				ctx.textBaseline = 'middle';
				ctx.fillText(this.nameOfNote(note), 0, y);
			}

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
			this.audioContext = new AudioContext({
				latencyHint: 'interactive',
				sampleRate: 44100,
			});

			let source;
			if (window.__PITCH_DETECTOR_INJECT_SOURCE__) {
				console.log('💉 Injecting test audio source');
				source = await window.__PITCH_DETECTOR_INJECT_SOURCE__(this.audioContext);
			} else {
				const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
				source = this.audioContext.createMediaStreamSource(stream);
			}

			// Create and initialize AGC AudioWorklet
			this.agc = new AGCAudioWorklet(
				this.audioContext,
				this.agcTargetLevel,
				this.agcAttackTime,
				this.agcReleaseTime
			);

			const analyser = this.audioContext.createAnalyser();

			try {
				await this.agc.init();

				// Always connect audio graph: source -> AGC AudioWorklet -> analyser
				source.connect(this.agc.getNode());
				this.agc.getNode().connect(analyser);

				// Set initial enabled state
				const enabledParam = this.agc.getNode().parameters.get('enabled');
				enabledParam.value = this.agcEnabled ? 1 : 0;

				console.log('🎚️ AGC AudioWorklet connected in audio graph');
			} catch (error) {
				console.error('❌ AGC AudioWorklet initialization failed:', error);
				// Fallback to direct connection
				source.connect(analyser);
				console.log('⚠️ Fallback: direct audio connection without AGC');
			}

			if (0) {
				const osc = this.audioContext.createOscillator();
				osc.type = 'sine';
				osc.frequency.value = this.noteToHz(60);
				osc.start();
				osc.connect(analyser);
			}


			analyser.fftSize = 4096;
			analyser.smoothingTimeConstant = 0.1;


			const PART = 4;
			const PART_LENGTH = analyser.fftSize / PART;
			const sampleRate = this.audioContext.sampleRate;

			// Initialize detector with current algorithm
			this.initDetector();

			const scopeCtx = this.$refs.scope.getContext("2d");
			const scopeWidth = this.$refs.scope.width;
			const scopeHeight = this.$refs.scope.height;
			console.log({ scopeWidth, scopeHeight });

			const audioData = new Float32Array(analyser.fftSize);

			// Performance monitoring
			let frameCount = 0;
			let totalPitchTime = 0;

			const draw = () => {
				// Stop animation loop if audio context is closed
				if (!this.audioContext) {
					return;
				}

				analyser.getFloatTimeDomainData(audioData);

				// Note: AGC processing is now handled by AudioWorkletNode in real-time

				let detector = this.detector;
				for (let p = 0; p < PART; p++) {
					const start = PART_LENGTH * p;

					// Measure pitch detection performance
					const pitchStart = performance.now();
					const [freq, clarity] = detector.findPitch(audioData.subarray(start, start + PART_LENGTH), sampleRate);
					const pitchTime = performance.now() - pitchStart;
					totalPitchTime += pitchTime;
					frameCount++;

					// Log performance every 100 frames
					if (frameCount % 100 === 0) {
						console.log(`📊 ${this.detector.constructor.name} avg detection time: ${(totalPitchTime / frameCount).toFixed(3)}ms/frame`);
						frameCount = 0;
						totalPitchTime = 0;
					}

					const note = this.hzToNote(freq);
					// console.log({clarity, freq, note});
					const y = this.mainHeight / this.noteLength * (this.noteLength - (note - this.startNote));

					// draw dot
					this.graphCtx.drawImage(
						this.$refs.graph,
						// source
						1, 0, this.$refs.graph.width - 1, this.$refs.graph.height,
						// dest
						0, 0, this.$refs.graph.width - 1, this.$refs.graph.height
					);
					this.graphCtx.fillStyle = "#000000";
					this.graphCtx.fillRect(this.mainWidth - 4, 0, 4, this.mainHeight);
					this.graphCtx.fillStyle = `rgba(255, 0, 0, ${clarity})`;
					this.graphCtx.fillRect(this.mainWidth - 4, y - 4, 8, 8);


					// draw info
					const fit = this.noteToHz(Math.round(note));
					this.targetFreq = fit;
					this.actualFreq = freq;
					this.clarity = clarity;
					this.note = note;
					this.freqError = this.differenceInCent(fit, freq);

					this.up = this.freqError < -5;
					this.down = this.freqError > 5;

					// draw scope
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
				}


				requestAnimationFrame(draw);
			};
			requestAnimationFrame(draw);

			// Ensure UI hide timer starts after recording begins
			this.startUIHideTimer();
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

		resize: function () {
			if (this.resizeTimer) clearInterval(this.resizeTimer);
			this.resizeTimer = setTimeout(() => {
				console.log('resize');
				this.initCanvas();
			}, 250);
		},

		// Pitch detector initialization
		initDetector: function () {
			if (!this.audioContext) {
				console.log('🔄 AudioContext not available, detector will be initialized on start');
				return;
			}

			const PART_LENGTH = 4096 / 4; // Same as in start() method
			const sampleRate = this.audioContext.sampleRate;

			// Clean up existing detector if any
			if (this.detector) {
				console.log('🔄 Replacing existing detector:', this.detector.constructor.name);
			}

			// Create detector based on selected algorithm
			if (this.pitchAlgorithm === 'yin') {
				this.detector = new YINDetector(sampleRate, PART_LENGTH, 0.2);
				console.log('🎵 Using YIN pitch detection algorithm');
			} else if (this.pitchAlgorithm === 'pyin') {
				this.detector = new PYINDetector(sampleRate, PART_LENGTH);
				console.log('🎵 Using PYIN pitch detection algorithm');
			} else if (this.pitchAlgorithm === 'mpm') {
				this.detector = new MPMDetector(sampleRate, PART_LENGTH, 0.93);
				console.log('🎵 Using MPM pitch detection algorithm');
			} else {
				this.detector = PitchDetector.forFloat32Array(PART_LENGTH);
				console.log('🎵 Using Pitchy pitch detection algorithm');
			}

			console.log('🔄 Detector initialized:', this.detector.constructor.name);
		},

		// UI visibility control methods
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
				startNote: this.startNote,
				endNote: this.endNote,
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
		}
	}
}).mount("#app");


