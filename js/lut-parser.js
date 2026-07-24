/**
 * LUT Parser - parses .cube 3D LUT files
 */
class LutParser {
  /**
   * Parse a .cube file text content.
   * Returns { title, size, domainMin, domainMax, data }
   *   data is Float32Array of length size*size*size*3
   * @param {string} text
   * @param {string} filename - for metadata
   */
  static parse(text, filename) {
    const lines = text.split(/\r?\n/);
    let title = filename || 'Untitled';
    let size = 33;
    const domainMin = [0, 0, 0];
    const domainMax = [1, 1, 1];
    const dataLines = [];
    let inData = false;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;

      if (line.startsWith('TITLE')) {
        const m = line.match(/TITLE\s+"(.+?)"/);
        if (m) title = m[1];
        continue;
      }

      if (line.startsWith('LUT_3D_SIZE')) {
        size = parseInt(line.split(/\s+/)[1], 10);
        if (isNaN(size) || size < 2) size = 33;
        continue;
      }

      if (line.startsWith('LUT_1D_SIZE') || line.startsWith('LUT_1D_INPUT_RANGE')) {
        console.warn('1D LUT not supported');
        continue;
      }

      if (line.startsWith('DOMAIN_MIN')) {
        const parts = line.split(/\s+/).slice(1).map(Number);
        if (parts.length === 3) {
          domainMin[0] = parts[0];
          domainMin[1] = parts[1];
          domainMin[2] = parts[2];
        }
        continue;
      }

      if (line.startsWith('DOMAIN_MAX')) {
        const parts = line.split(/\s+/).slice(1).map(Number);
        if (parts.length === 3) {
          domainMax[0] = parts[0];
          domainMax[1] = parts[1];
          domainMax[2] = parts[2];
        }
        continue;
      }

      // Check if it's a data line (3 numbers)
      const nums = line.split(/\s+/).map(Number);
      if (nums.length >= 3 && nums.every(n => !isNaN(n))) {
        dataLines.push([nums[0], nums[1], nums[2]]);
      }
    }

    const expected = size * size * size;
    if (dataLines.length < expected) {
      console.warn(`Expected ${expected} entries, got ${dataLines.length}. Padding.`);
      while (dataLines.length < expected) {
        dataLines.push([0, 0, 0]);
      }
    }

    // Pack into Float32Array for WebGL
    const data = new Float32Array(expected * 3);
    for (let i = 0; i < expected; i++) {
      const off = i * 3;
      data[off] = dataLines[i][0];
      data[off + 1] = dataLines[i][1];
      data[off + 2] = dataLines[i][2];
    }

    return { title: filename, embeddedTitle: title, size, domainMin, domainMax, data };
  }
}
