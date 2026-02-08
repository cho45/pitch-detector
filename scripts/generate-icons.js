import fs from 'fs';
import path from 'path';
import { Resvg } from '@resvg/resvg-js';

/**
 * Generates an SVG string for the app icon using mathematical curves.
 * The design features a glowing sine wave on a dark background, 
 * reflecting the "Pitch Detector" theme.
 */
function generateIconSVG() {
	const size = 512;
	const center = size / 2;

	// Create a series of points for a "pitch" wave
	// We use a combination of sine waves to make it look organic
	let pathD = `M 64 ${center}`;
	for (let x = 64; x <= 448; x++) {
		const t = (x - 64) / 384;
		// Enveloping function to make it fade at edges
		const envelope = Math.sin(t * Math.PI);
		// Frequency variation
		const y = center + Math.sin(t * Math.PI * 6) * envelope * 80;
		pathD += ` L ${x} ${y}`;
	}

	return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#0f0f23;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#1a1a2e;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="waveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#4ecdc4;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#ff6b6b;stop-opacity:1" />
        </linearGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
    </defs>
    
    <!-- Background -->
    <rect width="${size}" height="${size}" fill="url(#bgGrad)"/>
    
    <!-- Tuning Fork (音叉) Emblem -->
    <g transform="translate(${center}, ${center - 20})" opacity="0.15" stroke="white" stroke-width="12" fill="none" stroke-linecap="round">
        <!-- Prongs -->
        <path d="M -40 -120 L -40 20 A 40 40 0 0 0 40 20 L 40 -120" />
        <!-- Stem -->
        <line x1="0" y1="60" x2="0" y2="140" />
    </g>

    <!-- Subtle Grid Lines -->
    <g stroke="white" stroke-width="1" opacity="0.05">
        <line x1="64" y1="${center}" x2="448" y2="${center}" />
        <line x1="${center}" y1="64" x2="${center}" y2="448" />
    </g>

    <!-- The Waveform -->
    <path d="${pathD}" fill="none" stroke="url(#waveGrad)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
    
    <!-- Centering Mark -->
    <circle cx="${center}" cy="${center}" r="4" fill="#4ecdc4" opacity="0.6" />
</svg>`;
}

async function main() {
	const svg = generateIconSVG();
	const outputDir = path.resolve('icons');

	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	// Save master SVG
	const svgPath = path.join(outputDir, 'icon.svg');
	fs.writeFileSync(svgPath, svg.trim());
	console.log(`✓ Generated ${svgPath}`);

	// Generate PNGs at various sizes
	const sizes = [192, 512];
	for (const size of sizes) {
		const resvg = new Resvg(svg, {
			fitTo: { mode: 'width', value: size }
		});
		const pngData = resvg.render();
		const pngBuffer = pngData.asPng();

		const fileName = `icon-${size}.png`;
		const filePath = path.join(outputDir, fileName);
		fs.writeFileSync(filePath, pngBuffer);
		console.log(`✓ Generated ${filePath} (${size}x${size})`);
	}
}

main().catch(err => {
	console.error('Failed to generate icons:', err);
	process.exit(1);
});
