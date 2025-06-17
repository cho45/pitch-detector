/**
 * Statistical functions for pYIN implementation
 * Provides Beta distribution and Boltzmann distribution calculations
 */

/**
 * Beta function using Gamma function approximation
 * B(a,b) = Γ(a)Γ(b)/Γ(a+b)
 */
function beta(a, b) {
    return gamma(a) * gamma(b) / gamma(a + b);
}

/**
 * Gamma function using Lanczos approximation
 * Good approximation for Re(z) > 0.5
 */
function gamma(z) {
    // Lanczos coefficients for g=7
    const g = 7;
    const c = [
        0.99999999999980993,
        676.5203681218851,
        -1259.1392167224028,
        771.32342877765313,
        -176.61502916214059,
        12.507343278686905,
        -0.13857109526572012,
        9.9843695780195716e-6,
        1.5056327351493116e-7
    ];

    if (z < 0.5) {
        return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    }

    z -= 1;
    let x = c[0];
    for (let i = 1; i < g + 2; i++) {
        x += c[i] / (z + i);
    }
    
    const t = z + g + 0.5;
    const sqrt2pi = Math.sqrt(2 * Math.PI);
    return sqrt2pi * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

/**
 * Incomplete beta function using continued fraction
 * I_x(a,b) = B_x(a,b) / B(a,b)
 */
function incompleteBeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    
    // Use continued fraction method
    const bt = Math.exp(
        a * Math.log(x) + b * Math.log(1 - x) - Math.log(beta(a, b))
    );
    
    if (x < (a + 1) / (a + b + 2)) {
        return bt * betacf(x, a, b) / a;
    } else {
        return 1 - bt * betacf(1 - x, b, a) / b;
    }
}

/**
 * Continued fraction for incomplete beta function
 */
function betacf(x, a, b, maxIterations = 100, eps = 3e-7) {
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - qab * x / qap;
    
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    let h = d;
    
    for (let m = 1; m <= maxIterations; m++) {
        const m2 = 2 * m;
        let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1 + aa * d;
        if (Math.abs(d) < 1e-30) d = 1e-30;
        c = 1 + aa / c;
        if (Math.abs(c) < 1e-30) c = 1e-30;
        d = 1 / d;
        h *= d * c;
        
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1 + aa * d;
        if (Math.abs(d) < 1e-30) d = 1e-30;
        c = 1 + aa / c;
        if (Math.abs(c) < 1e-30) c = 1e-30;
        d = 1 / d;
        const del = d * c;
        h *= del;
        
        if (Math.abs(del - 1) < eps) break;
    }
    
    return h;
}

/**
 * Beta distribution CDF
 * @param {number} x - Value (0 <= x <= 1)
 * @param {number} a - Alpha parameter
 * @param {number} b - Beta parameter
 * @returns {number} Cumulative probability
 */
export function betaCdf(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    
    // For beta(2, 18), use closed form: CDF(x) = 1 - (1-x)^18 * (1 + 17*x)
    if (a === 2 && b === 18) {
        const oneMinusX = 1 - x;
        const oneMinusXPow18 = Math.pow(oneMinusX, 18);
        return 1 - oneMinusXPow18 * (1 + 17 * x);
    }
    
    return incompleteBeta(x, a, b);
}

/**
 * Boltzmann distribution PMF
 * @param {number} k - State (0, 1, 2, ...)
 * @param {number} a - Parameter (> 0)
 * @param {number} n - Total number of states
 * @returns {number} Probability mass
 */
export function boltzmannPmf(k, a, n) {
    if (k < 0 || k >= n) return 0;
    
    // Calculate normalization constant
    let sum = 0;
    for (let i = 0; i < n; i++) {
        sum += Math.exp(-a * i);
    }
    
    return Math.exp(-a * k) / sum;
}

/**
 * Generate threshold array for pYIN
 * @param {number} nThresholds - Number of thresholds
 * @returns {Float32Array} Threshold array from 0 to 1
 */
export function generateThresholds(nThresholds) {
    const thresholds = new Float32Array(nThresholds + 1);
    for (let i = 0; i <= nThresholds; i++) {
        thresholds[i] = nThresholds === 0 ? 0 : i / nThresholds;
    }
    return thresholds;
}

/**
 * Calculate beta distribution probabilities for thresholds
 * @param {Float32Array} thresholds - Threshold array
 * @param {number} a - Beta alpha parameter
 * @param {number} b - Beta beta parameter
 * @returns {Float32Array} Probability differences
 */
export function calculateBetaProbabilities(thresholds, a, b) {
    const cdf = new Float32Array(thresholds.length);
    for (let i = 0; i < thresholds.length; i++) {
        cdf[i] = betaCdf(thresholds[i], a, b);
    }
    
    // Calculate differences (np.diff equivalent)
    const probs = new Float32Array(thresholds.length - 1);
    for (let i = 0; i < probs.length; i++) {
        probs[i] = cdf[i + 1] - cdf[i];
    }
    
    return probs;
}