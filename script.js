
import { PitchDetector } from "./lib/pitchy.mjs";
import { YINDetector, createYINDetector } from "./lib/yin.js";

Vue.createApp({
	data() {
		return {
			status: "Tap to start",

			// https://en.wikipedia.org/wiki/Scientific_pitch_notation
			// center C is note number 60
			// center A is note number 69 and 440Hz
			freqOfA4 : 440,
			// 88 keys = A0(21) - C8(108)
			startNote : 60 - 24,
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

			// YIN/Pitchy algorithm selection
			pitchAlgorithm: "pitchy", // "pitchy" or "yin"

			openSetting: false,

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
			// Note: Detector will be recreated on next start() call
		}
	},

	mounted() {
		console.log("mounted");
		this.initCanvas();

		window.addEventListener('resize', () => {
			this.resize();
		});
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
				const names = this.noteName.find( (i) => i.name === this.selectedName );
				const name = names.values[note % 12];
				return name + octave;
			}
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
					ctx.lineWidth   = 2 * window.devicePixelRatio;
				} else
				if (this.isScaleTone(note)) {
					ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
					ctx.lineWidth   = 1 * window.devicePixelRatio;
				} else {
					ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
					ctx.lineWidth   = 1 * window.devicePixelRatio;
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

			this.status = "Recording";
			this.audioContext = new AudioContext({
				latencyHint: 'interactive',
				sampleRate: 44100,
			});

			const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
			const source = this.audioContext.createMediaStreamSource(stream);
			const compressor = this.audioContext.createDynamicsCompressor();
			compressor.threshold.value = -60;
			compressor.knee.value = 0;
			compressor.ratio.value = 20;
			compressor.attack.value = 0;
			compressor.release.value = 0.25;
			const gain = this.audioContext.createGain();
			gain.gain.value = 20;

			const analyser = this.audioContext.createAnalyser();

			source.connect(compressor);
			compressor.connect(gain);
			gain.connect(analyser);

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
			
			// Create detector based on selected algorithm
			let detector;
			if (this.pitchAlgorithm === 'yin') {
				const yinDetector = new YINDetector(sampleRate, PART_LENGTH, 0.1, false);
				detector = {
					findPitch: (audioBuffer, sr) => yinDetector.findPitch(audioBuffer, sr)
				};
				console.log('🎵 Using YIN pitch detection algorithm');
			} else {
				detector = PitchDetector.forFloat32Array(PART_LENGTH);
				console.log('🎵 Using Pitchy pitch detection algorithm');
			}

			const scopeCtx = this.$refs.scope.getContext("2d");
			const scopeWidth = this.$refs.scope.width;
			const scopeHeight = this.$refs.scope.height;
			console.log({scopeWidth, scopeHeight});

			const dataArray = new Uint8Array(analyser.frequencyBinCount);
			const audioData = new Float32Array(analyser.fftSize);
			const sampleRate = this.audioContext.sampleRate;
			
			// Performance monitoring
			let frameCount = 0;
			let totalPitchTime = 0;
			
			const draw = () => {
				analyser.getFloatTimeDomainData(audioData);

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
						const avgTime = totalPitchTime / frameCount;
						console.log(`📊 ${this.pitchAlgorithm.toUpperCase()} avg detection time: ${avgTime.toFixed(3)}ms/frame`);
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
					const fit  = this.noteToHz(Math.round(note));
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
		},

		resize: function ()  {
			if (this.resizeTimer) clearInterval(this.resizeTimer);
			this.resizeTimer = setTimeout(() => {
				console.log('resize');
				this.initCanvas();
			}, 250);
		}
	}
}).mount("#app");


