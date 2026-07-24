/**
 * LUT Processor - Canvas 2D with trilinear interpolation.
 * Index formula: idx = B*S² + G*S + R  (R-fastest, DaVinci Resolve compatible)
 */
class WebGLProcessor {
  init() { return true; }

  renderPreview(photo, lutData, lutSize, maxWidth, lutTitle) {
    const pw = photo.naturalWidth || photo.width;
    const ph = photo.naturalHeight || photo.height;
    if (pw < 2 || ph < 2) return null;
    const scale = Math.min(1, maxWidth / pw);
    const w = Math.round(pw * scale) || 1;
    const h = Math.round(ph * scale) || 1;

    const src = document.createElement('canvas');
    src.width = w; src.height = h;
    const ctx = src.getContext('2d');
    ctx.drawImage(photo, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const px = imgData.data;

    const S = lutSize, S1 = S - 1, S2 = S * S;

    // Precompute floor/ceil/fraction for byte→grid mapping
    const fl = new Uint8Array(256), ce = new Uint8Array(256), fr = new Float32Array(256);
    for (let v = 0; v < 256; v++) {
      const pos = v / 255 * S1;
      const f = Math.floor(pos);
      fl[v] = f;
      ce[v] = Math.min(f + 1, S1);
      fr[v] = pos - f;
    }

    // Precompute LUT output as bytes: index = B*S² + G*S + R
    const total = S * S * S;
    const oR = new Uint8Array(total), oG = new Uint8Array(total), oB = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      oR[i] = Math.round(Math.min(1, Math.max(0, lutData[i*3]))   * 255);
      oG[i] = Math.round(Math.min(1, Math.max(0, lutData[i*3+1])) * 255);
      oB[i] = Math.round(Math.min(1, Math.max(0, lutData[i*3+2])) * 255);
    }

    // Trilinear interpolation per pixel, all 3 channels in one pass
    for (let i = 0; i < px.length; i += 4) {
      const r0 = fl[px[i]], r1 = ce[px[i]], rf = fr[px[i]];
      const g0 = fl[px[i+1]], g1 = ce[px[i+1]], gf = fr[px[i+1]];
      const b0 = fl[px[i+2]], b1 = ce[px[i+2]], bf = fr[px[i+2]];

      // Base indices for the 4 (b,g) combos (shared across R,G,B)
      const b0g0 = b0 * S2 + g0 * S;
      const b0g1 = b0 * S2 + g1 * S;
      const b1g0 = b1 * S2 + g0 * S;
      const b1g1 = b1 * S2 + g1 * S;
      const ri0 = b0g0 + r0, ri1 = b1g0 + r0, ri2 = b0g1 + r0, ri3 = b1g1 + r0;
      const ci0 = b0g0 + r1, ci1 = b1g0 + r1, ci2 = b0g1 + r1, ci3 = b1g1 + r1;

      // R channel: 8 corners → lerp R→G→B
      const v000=oR[ri0], v001=oR[ri1], v010=oR[ri2], v011=oR[ri3];
      const v100=oR[ci0], v101=oR[ci1], v110=oR[ci2], v111=oR[ci3];
      const vr00 = v000 + (v100 - v000) * rf;
      const vr01 = v010 + (v110 - v010) * rf;
      const vr10 = v001 + (v101 - v001) * rf;
      const vr11 = v011 + (v111 - v011) * rf;
      const vrg0 = vr00 + (vr01 - vr00) * gf;
      const vrg1 = vr10 + (vr11 - vr10) * gf;
      px[i]   = Math.round(vrg0 + (vrg1 - vrg0) * bf);

      // G channel
      const w000=oG[ri0], w001=oG[ri1], w010=oG[ri2], w011=oG[ri3];
      const w100=oG[ci0], w101=oG[ci1], w110=oG[ci2], w111=oG[ci3];
      const wr00 = w000 + (w100 - w000) * rf;
      const wr01 = w010 + (w110 - w010) * rf;
      const wr10 = w001 + (w101 - w001) * rf;
      const wr11 = w011 + (w111 - w011) * rf;
      const wrg0 = wr00 + (wr01 - wr00) * gf;
      const wrg1 = wr10 + (wr11 - wr10) * gf;
      px[i+1] = Math.round(wrg0 + (wrg1 - wrg0) * bf);

      // B channel
      const x000=oB[ri0], x001=oB[ri1], x010=oB[ri2], x011=oB[ri3];
      const x100=oB[ci0], x101=oB[ci1], x110=oB[ci2], x111=oB[ci3];
      const xr00 = x000 + (x100 - x000) * rf;
      const xr01 = x010 + (x110 - x010) * rf;
      const xr10 = x001 + (x101 - x001) * rf;
      const xr11 = x011 + (x111 - x011) * rf;
      const xrg0 = xr00 + (xr01 - xr00) * gf;
      const xrg1 = xr10 + (xr11 - xr10) * gf;
      px[i+2] = Math.round(xrg0 + (xrg1 - xrg0) * bf);
    }

    ctx.putImageData(imgData, 0, 0);
    return src;
  }
}
