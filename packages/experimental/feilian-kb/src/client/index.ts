// @ts-nocheck
/**
 * Feilian Knowledge browser half, vendored from `dsh-feilian-kb@0.2.7`.
 *
 * Only the outer `window.__ModuleLoader__.load` wrapper and the trailing
 * `module.exports` assignment changed: the loader wrapper is generated at build
 * time from the package name, and the plugin object is the module default export.
 * See README.md for the full list of local modifications.
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/qrcode/lib/can-promise.js
var require_can_promise = __commonJS({
  "node_modules/qrcode/lib/can-promise.js"(exports, module2) {
    module2.exports = function() {
      return typeof Promise === "function" && Promise.prototype && Promise.prototype.then;
    };
  }
});

// node_modules/qrcode/lib/core/utils.js
var require_utils = __commonJS({
  "node_modules/qrcode/lib/core/utils.js"(exports) {
    var toSJISFunction;
    var CODEWORDS_COUNT = [
      0,
      // Not used
      26,
      44,
      70,
      100,
      134,
      172,
      196,
      242,
      292,
      346,
      404,
      466,
      532,
      581,
      655,
      733,
      815,
      901,
      991,
      1085,
      1156,
      1258,
      1364,
      1474,
      1588,
      1706,
      1828,
      1921,
      2051,
      2185,
      2323,
      2465,
      2611,
      2761,
      2876,
      3034,
      3196,
      3362,
      3532,
      3706
    ];
    exports.getSymbolSize = function getSymbolSize(version) {
      if (!version) throw new Error('"version" cannot be null or undefined');
      if (version < 1 || version > 40) throw new Error('"version" should be in range from 1 to 40');
      return version * 4 + 17;
    };
    exports.getSymbolTotalCodewords = function getSymbolTotalCodewords(version) {
      return CODEWORDS_COUNT[version];
    };
    exports.getBCHDigit = function(data) {
      let digit = 0;
      while (data !== 0) {
        digit++;
        data >>>= 1;
      }
      return digit;
    };
    exports.setToSJISFunction = function setToSJISFunction(f) {
      if (typeof f !== "function") {
        throw new Error('"toSJISFunc" is not a valid function.');
      }
      toSJISFunction = f;
    };
    exports.isKanjiModeEnabled = function() {
      return typeof toSJISFunction !== "undefined";
    };
    exports.toSJIS = function toSJIS(kanji) {
      return toSJISFunction(kanji);
    };
  }
});

// node_modules/qrcode/lib/core/error-correction-level.js
var require_error_correction_level = __commonJS({
  "node_modules/qrcode/lib/core/error-correction-level.js"(exports) {
    exports.L = { bit: 1 };
    exports.M = { bit: 0 };
    exports.Q = { bit: 3 };
    exports.H = { bit: 2 };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "l":
        case "low":
          return exports.L;
        case "m":
        case "medium":
          return exports.M;
        case "q":
        case "quartile":
          return exports.Q;
        case "h":
        case "high":
          return exports.H;
        default:
          throw new Error("Unknown EC Level: " + string);
      }
    }
    exports.isValid = function isValid(level) {
      return level && typeof level.bit !== "undefined" && level.bit >= 0 && level.bit < 4;
    };
    exports.from = function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    };
  }
});

// node_modules/qrcode/lib/core/bit-buffer.js
var require_bit_buffer = __commonJS({
  "node_modules/qrcode/lib/core/bit-buffer.js"(exports, module2) {
    function BitBuffer() {
      this.buffer = [];
      this.length = 0;
    }
    BitBuffer.prototype = {
      get: function(index) {
        const bufIndex = Math.floor(index / 8);
        return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) === 1;
      },
      put: function(num, length) {
        for (let i = 0; i < length; i++) {
          this.putBit((num >>> length - i - 1 & 1) === 1);
        }
      },
      getLengthInBits: function() {
        return this.length;
      },
      putBit: function(bit) {
        const bufIndex = Math.floor(this.length / 8);
        if (this.buffer.length <= bufIndex) {
          this.buffer.push(0);
        }
        if (bit) {
          this.buffer[bufIndex] |= 128 >>> this.length % 8;
        }
        this.length++;
      }
    };
    module2.exports = BitBuffer;
  }
});

// node_modules/qrcode/lib/core/bit-matrix.js
var require_bit_matrix = __commonJS({
  "node_modules/qrcode/lib/core/bit-matrix.js"(exports, module2) {
    function BitMatrix(size) {
      if (!size || size < 1) {
        throw new Error("BitMatrix size must be defined and greater than 0");
      }
      this.size = size;
      this.data = new Uint8Array(size * size);
      this.reservedBit = new Uint8Array(size * size);
    }
    BitMatrix.prototype.set = function(row, col, value, reserved) {
      const index = row * this.size + col;
      this.data[index] = value;
      if (reserved) this.reservedBit[index] = true;
    };
    BitMatrix.prototype.get = function(row, col) {
      return this.data[row * this.size + col];
    };
    BitMatrix.prototype.xor = function(row, col, value) {
      this.data[row * this.size + col] ^= value;
    };
    BitMatrix.prototype.isReserved = function(row, col) {
      return this.reservedBit[row * this.size + col];
    };
    module2.exports = BitMatrix;
  }
});

// node_modules/qrcode/lib/core/alignment-pattern.js
var require_alignment_pattern = __commonJS({
  "node_modules/qrcode/lib/core/alignment-pattern.js"(exports) {
    var getSymbolSize = require_utils().getSymbolSize;
    exports.getRowColCoords = function getRowColCoords(version) {
      if (version === 1) return [];
      const posCount = Math.floor(version / 7) + 2;
      const size = getSymbolSize(version);
      const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
      const positions = [size - 7];
      for (let i = 1; i < posCount - 1; i++) {
        positions[i] = positions[i - 1] - intervals;
      }
      positions.push(6);
      return positions.reverse();
    };
    exports.getPositions = function getPositions(version) {
      const coords = [];
      const pos = exports.getRowColCoords(version);
      const posLength = pos.length;
      for (let i = 0; i < posLength; i++) {
        for (let j = 0; j < posLength; j++) {
          if (i === 0 && j === 0 || // top-left
          i === 0 && j === posLength - 1 || // bottom-left
          i === posLength - 1 && j === 0) {
            continue;
          }
          coords.push([pos[i], pos[j]]);
        }
      }
      return coords;
    };
  }
});

// node_modules/qrcode/lib/core/finder-pattern.js
var require_finder_pattern = __commonJS({
  "node_modules/qrcode/lib/core/finder-pattern.js"(exports) {
    var getSymbolSize = require_utils().getSymbolSize;
    var FINDER_PATTERN_SIZE = 7;
    exports.getPositions = function getPositions(version) {
      const size = getSymbolSize(version);
      return [
        // top-left
        [0, 0],
        // top-right
        [size - FINDER_PATTERN_SIZE, 0],
        // bottom-left
        [0, size - FINDER_PATTERN_SIZE]
      ];
    };
  }
});

// node_modules/qrcode/lib/core/mask-pattern.js
var require_mask_pattern = __commonJS({
  "node_modules/qrcode/lib/core/mask-pattern.js"(exports) {
    exports.Patterns = {
      PATTERN000: 0,
      PATTERN001: 1,
      PATTERN010: 2,
      PATTERN011: 3,
      PATTERN100: 4,
      PATTERN101: 5,
      PATTERN110: 6,
      PATTERN111: 7
    };
    var PenaltyScores = {
      N1: 3,
      N2: 3,
      N3: 40,
      N4: 10
    };
    exports.isValid = function isValid(mask) {
      return mask != null && mask !== "" && !isNaN(mask) && mask >= 0 && mask <= 7;
    };
    exports.from = function from(value) {
      return exports.isValid(value) ? parseInt(value, 10) : void 0;
    };
    exports.getPenaltyN1 = function getPenaltyN1(data) {
      const size = data.size;
      let points = 0;
      let sameCountCol = 0;
      let sameCountRow = 0;
      let lastCol = null;
      let lastRow = null;
      for (let row = 0; row < size; row++) {
        sameCountCol = sameCountRow = 0;
        lastCol = lastRow = null;
        for (let col = 0; col < size; col++) {
          let module3 = data.get(row, col);
          if (module3 === lastCol) {
            sameCountCol++;
          } else {
            if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
            lastCol = module3;
            sameCountCol = 1;
          }
          module3 = data.get(col, row);
          if (module3 === lastRow) {
            sameCountRow++;
          } else {
            if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
            lastRow = module3;
            sameCountRow = 1;
          }
        }
        if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
        if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
      }
      return points;
    };
    exports.getPenaltyN2 = function getPenaltyN2(data) {
      const size = data.size;
      let points = 0;
      for (let row = 0; row < size - 1; row++) {
        for (let col = 0; col < size - 1; col++) {
          const last = data.get(row, col) + data.get(row, col + 1) + data.get(row + 1, col) + data.get(row + 1, col + 1);
          if (last === 4 || last === 0) points++;
        }
      }
      return points * PenaltyScores.N2;
    };
    exports.getPenaltyN3 = function getPenaltyN3(data) {
      const size = data.size;
      let points = 0;
      let bitsCol = 0;
      let bitsRow = 0;
      for (let row = 0; row < size; row++) {
        bitsCol = bitsRow = 0;
        for (let col = 0; col < size; col++) {
          bitsCol = bitsCol << 1 & 2047 | data.get(row, col);
          if (col >= 10 && (bitsCol === 1488 || bitsCol === 93)) points++;
          bitsRow = bitsRow << 1 & 2047 | data.get(col, row);
          if (col >= 10 && (bitsRow === 1488 || bitsRow === 93)) points++;
        }
      }
      return points * PenaltyScores.N3;
    };
    exports.getPenaltyN4 = function getPenaltyN4(data) {
      let darkCount = 0;
      const modulesCount = data.data.length;
      for (let i = 0; i < modulesCount; i++) darkCount += data.data[i];
      const k = Math.abs(Math.ceil(darkCount * 100 / modulesCount / 5) - 10);
      return k * PenaltyScores.N4;
    };
    function getMaskAt(maskPattern, i, j) {
      switch (maskPattern) {
        case exports.Patterns.PATTERN000:
          return (i + j) % 2 === 0;
        case exports.Patterns.PATTERN001:
          return i % 2 === 0;
        case exports.Patterns.PATTERN010:
          return j % 3 === 0;
        case exports.Patterns.PATTERN011:
          return (i + j) % 3 === 0;
        case exports.Patterns.PATTERN100:
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case exports.Patterns.PATTERN101:
          return i * j % 2 + i * j % 3 === 0;
        case exports.Patterns.PATTERN110:
          return (i * j % 2 + i * j % 3) % 2 === 0;
        case exports.Patterns.PATTERN111:
          return (i * j % 3 + (i + j) % 2) % 2 === 0;
        default:
          throw new Error("bad maskPattern:" + maskPattern);
      }
    }
    exports.applyMask = function applyMask(pattern, data) {
      const size = data.size;
      for (let col = 0; col < size; col++) {
        for (let row = 0; row < size; row++) {
          if (data.isReserved(row, col)) continue;
          data.xor(row, col, getMaskAt(pattern, row, col));
        }
      }
    };
    exports.getBestMask = function getBestMask(data, setupFormatFunc) {
      const numPatterns = Object.keys(exports.Patterns).length;
      let bestPattern = 0;
      let lowerPenalty = Infinity;
      for (let p = 0; p < numPatterns; p++) {
        setupFormatFunc(p);
        exports.applyMask(p, data);
        const penalty = exports.getPenaltyN1(data) + exports.getPenaltyN2(data) + exports.getPenaltyN3(data) + exports.getPenaltyN4(data);
        exports.applyMask(p, data);
        if (penalty < lowerPenalty) {
          lowerPenalty = penalty;
          bestPattern = p;
        }
      }
      return bestPattern;
    };
  }
});

// node_modules/qrcode/lib/core/error-correction-code.js
var require_error_correction_code = __commonJS({
  "node_modules/qrcode/lib/core/error-correction-code.js"(exports) {
    var ECLevel = require_error_correction_level();
    var EC_BLOCKS_TABLE = [
      // L  M  Q  H
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      2,
      2,
      1,
      2,
      2,
      4,
      1,
      2,
      4,
      4,
      2,
      4,
      4,
      4,
      2,
      4,
      6,
      5,
      2,
      4,
      6,
      6,
      2,
      5,
      8,
      8,
      4,
      5,
      8,
      8,
      4,
      5,
      8,
      11,
      4,
      8,
      10,
      11,
      4,
      9,
      12,
      16,
      4,
      9,
      16,
      16,
      6,
      10,
      12,
      18,
      6,
      10,
      17,
      16,
      6,
      11,
      16,
      19,
      6,
      13,
      18,
      21,
      7,
      14,
      21,
      25,
      8,
      16,
      20,
      25,
      8,
      17,
      23,
      25,
      9,
      17,
      23,
      34,
      9,
      18,
      25,
      30,
      10,
      20,
      27,
      32,
      12,
      21,
      29,
      35,
      12,
      23,
      34,
      37,
      12,
      25,
      34,
      40,
      13,
      26,
      35,
      42,
      14,
      28,
      38,
      45,
      15,
      29,
      40,
      48,
      16,
      31,
      43,
      51,
      17,
      33,
      45,
      54,
      18,
      35,
      48,
      57,
      19,
      37,
      51,
      60,
      19,
      38,
      53,
      63,
      20,
      40,
      56,
      66,
      21,
      43,
      59,
      70,
      22,
      45,
      62,
      74,
      24,
      47,
      65,
      77,
      25,
      49,
      68,
      81
    ];
    var EC_CODEWORDS_TABLE = [
      // L  M  Q  H
      7,
      10,
      13,
      17,
      10,
      16,
      22,
      28,
      15,
      26,
      36,
      44,
      20,
      36,
      52,
      64,
      26,
      48,
      72,
      88,
      36,
      64,
      96,
      112,
      40,
      72,
      108,
      130,
      48,
      88,
      132,
      156,
      60,
      110,
      160,
      192,
      72,
      130,
      192,
      224,
      80,
      150,
      224,
      264,
      96,
      176,
      260,
      308,
      104,
      198,
      288,
      352,
      120,
      216,
      320,
      384,
      132,
      240,
      360,
      432,
      144,
      280,
      408,
      480,
      168,
      308,
      448,
      532,
      180,
      338,
      504,
      588,
      196,
      364,
      546,
      650,
      224,
      416,
      600,
      700,
      224,
      442,
      644,
      750,
      252,
      476,
      690,
      816,
      270,
      504,
      750,
      900,
      300,
      560,
      810,
      960,
      312,
      588,
      870,
      1050,
      336,
      644,
      952,
      1110,
      360,
      700,
      1020,
      1200,
      390,
      728,
      1050,
      1260,
      420,
      784,
      1140,
      1350,
      450,
      812,
      1200,
      1440,
      480,
      868,
      1290,
      1530,
      510,
      924,
      1350,
      1620,
      540,
      980,
      1440,
      1710,
      570,
      1036,
      1530,
      1800,
      570,
      1064,
      1590,
      1890,
      600,
      1120,
      1680,
      1980,
      630,
      1204,
      1770,
      2100,
      660,
      1260,
      1860,
      2220,
      720,
      1316,
      1950,
      2310,
      750,
      1372,
      2040,
      2430
    ];
    exports.getBlocksCount = function getBlocksCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
    exports.getTotalCodewordsCount = function getTotalCodewordsCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
  }
});

// node_modules/qrcode/lib/core/galois-field.js
var require_galois_field = __commonJS({
  "node_modules/qrcode/lib/core/galois-field.js"(exports) {
    var EXP_TABLE = new Uint8Array(512);
    var LOG_TABLE = new Uint8Array(256);
    (function initTables() {
      let x = 1;
      for (let i = 0; i < 255; i++) {
        EXP_TABLE[i] = x;
        LOG_TABLE[x] = i;
        x <<= 1;
        if (x & 256) {
          x ^= 285;
        }
      }
      for (let i = 255; i < 512; i++) {
        EXP_TABLE[i] = EXP_TABLE[i - 255];
      }
    })();
    exports.log = function log(n) {
      if (n < 1) throw new Error("log(" + n + ")");
      return LOG_TABLE[n];
    };
    exports.exp = function exp(n) {
      return EXP_TABLE[n];
    };
    exports.mul = function mul(x, y) {
      if (x === 0 || y === 0) return 0;
      return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
    };
  }
});

// node_modules/qrcode/lib/core/polynomial.js
var require_polynomial = __commonJS({
  "node_modules/qrcode/lib/core/polynomial.js"(exports) {
    var GF = require_galois_field();
    exports.mul = function mul(p1, p2) {
      const coeff = new Uint8Array(p1.length + p2.length - 1);
      for (let i = 0; i < p1.length; i++) {
        for (let j = 0; j < p2.length; j++) {
          coeff[i + j] ^= GF.mul(p1[i], p2[j]);
        }
      }
      return coeff;
    };
    exports.mod = function mod(divident, divisor) {
      let result = new Uint8Array(divident);
      while (result.length - divisor.length >= 0) {
        const coeff = result[0];
        for (let i = 0; i < divisor.length; i++) {
          result[i] ^= GF.mul(divisor[i], coeff);
        }
        let offset = 0;
        while (offset < result.length && result[offset] === 0) offset++;
        result = result.slice(offset);
      }
      return result;
    };
    exports.generateECPolynomial = function generateECPolynomial(degree) {
      let poly = new Uint8Array([1]);
      for (let i = 0; i < degree; i++) {
        poly = exports.mul(poly, new Uint8Array([1, GF.exp(i)]));
      }
      return poly;
    };
  }
});

// node_modules/qrcode/lib/core/reed-solomon-encoder.js
var require_reed_solomon_encoder = __commonJS({
  "node_modules/qrcode/lib/core/reed-solomon-encoder.js"(exports, module2) {
    var Polynomial = require_polynomial();
    function ReedSolomonEncoder(degree) {
      this.genPoly = void 0;
      this.degree = degree;
      if (this.degree) this.initialize(this.degree);
    }
    ReedSolomonEncoder.prototype.initialize = function initialize(degree) {
      this.degree = degree;
      this.genPoly = Polynomial.generateECPolynomial(this.degree);
    };
    ReedSolomonEncoder.prototype.encode = function encode(data) {
      if (!this.genPoly) {
        throw new Error("Encoder not initialized");
      }
      const paddedData = new Uint8Array(data.length + this.degree);
      paddedData.set(data);
      const remainder = Polynomial.mod(paddedData, this.genPoly);
      const start = this.degree - remainder.length;
      if (start > 0) {
        const buff = new Uint8Array(this.degree);
        buff.set(remainder, start);
        return buff;
      }
      return remainder;
    };
    module2.exports = ReedSolomonEncoder;
  }
});

// node_modules/qrcode/lib/core/version-check.js
var require_version_check = __commonJS({
  "node_modules/qrcode/lib/core/version-check.js"(exports) {
    exports.isValid = function isValid(version) {
      return !isNaN(version) && version >= 1 && version <= 40;
    };
  }
});

// node_modules/qrcode/lib/core/regex.js
var require_regex = __commonJS({
  "node_modules/qrcode/lib/core/regex.js"(exports) {
    var numeric = "[0-9]+";
    var alphanumeric = "[A-Z $%*+\\-./:]+";
    var kanji = "(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";
    kanji = kanji.replace(/u/g, "\\u");
    var byte = "(?:(?![A-Z0-9 $%*+\\-./:]|" + kanji + ")(?:.|[\r\n]))+";
    exports.KANJI = new RegExp(kanji, "g");
    exports.BYTE_KANJI = new RegExp("[^A-Z0-9 $%*+\\-./:]+", "g");
    exports.BYTE = new RegExp(byte, "g");
    exports.NUMERIC = new RegExp(numeric, "g");
    exports.ALPHANUMERIC = new RegExp(alphanumeric, "g");
    var TEST_KANJI = new RegExp("^" + kanji + "$");
    var TEST_NUMERIC = new RegExp("^" + numeric + "$");
    var TEST_ALPHANUMERIC = new RegExp("^[A-Z0-9 $%*+\\-./:]+$");
    exports.testKanji = function testKanji(str) {
      return TEST_KANJI.test(str);
    };
    exports.testNumeric = function testNumeric(str) {
      return TEST_NUMERIC.test(str);
    };
    exports.testAlphanumeric = function testAlphanumeric(str) {
      return TEST_ALPHANUMERIC.test(str);
    };
  }
});

// node_modules/qrcode/lib/core/mode.js
var require_mode = __commonJS({
  "node_modules/qrcode/lib/core/mode.js"(exports) {
    var VersionCheck = require_version_check();
    var Regex = require_regex();
    exports.NUMERIC = {
      id: "Numeric",
      bit: 1 << 0,
      ccBits: [10, 12, 14]
    };
    exports.ALPHANUMERIC = {
      id: "Alphanumeric",
      bit: 1 << 1,
      ccBits: [9, 11, 13]
    };
    exports.BYTE = {
      id: "Byte",
      bit: 1 << 2,
      ccBits: [8, 16, 16]
    };
    exports.KANJI = {
      id: "Kanji",
      bit: 1 << 3,
      ccBits: [8, 10, 12]
    };
    exports.MIXED = {
      bit: -1
    };
    exports.getCharCountIndicator = function getCharCountIndicator(mode, version) {
      if (!mode.ccBits) throw new Error("Invalid mode: " + mode);
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid version: " + version);
      }
      if (version >= 1 && version < 10) return mode.ccBits[0];
      else if (version < 27) return mode.ccBits[1];
      return mode.ccBits[2];
    };
    exports.getBestModeForData = function getBestModeForData(dataStr) {
      if (Regex.testNumeric(dataStr)) return exports.NUMERIC;
      else if (Regex.testAlphanumeric(dataStr)) return exports.ALPHANUMERIC;
      else if (Regex.testKanji(dataStr)) return exports.KANJI;
      else return exports.BYTE;
    };
    exports.toString = function toString(mode) {
      if (mode && mode.id) return mode.id;
      throw new Error("Invalid mode");
    };
    exports.isValid = function isValid(mode) {
      return mode && mode.bit && mode.ccBits;
    };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "numeric":
          return exports.NUMERIC;
        case "alphanumeric":
          return exports.ALPHANUMERIC;
        case "kanji":
          return exports.KANJI;
        case "byte":
          return exports.BYTE;
        default:
          throw new Error("Unknown mode: " + string);
      }
    }
    exports.from = function from(value, defaultValue) {
      if (exports.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    };
  }
});

// node_modules/qrcode/lib/core/version.js
var require_version = __commonJS({
  "node_modules/qrcode/lib/core/version.js"(exports) {
    var Utils = require_utils();
    var ECCode = require_error_correction_code();
    var ECLevel = require_error_correction_level();
    var Mode = require_mode();
    var VersionCheck = require_version_check();
    var G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
    var G18_BCH = Utils.getBCHDigit(G18);
    function getBestVersionForDataLength(mode, length, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, mode)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    function getReservedBitsCount(mode, version) {
      return Mode.getCharCountIndicator(mode, version) + 4;
    }
    function getTotalBitsFromDataArray(segments, version) {
      let totalBits = 0;
      segments.forEach(function(data) {
        const reservedBits = getReservedBitsCount(data.mode, version);
        totalBits += reservedBits + data.getBitsLength();
      });
      return totalBits;
    }
    function getBestVersionForMixedData(segments, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        const length = getTotalBitsFromDataArray(segments, currentVersion);
        if (length <= exports.getCapacity(currentVersion, errorCorrectionLevel, Mode.MIXED)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    exports.from = function from(value, defaultValue) {
      if (VersionCheck.isValid(value)) {
        return parseInt(value, 10);
      }
      return defaultValue;
    };
    exports.getCapacity = function getCapacity(version, errorCorrectionLevel, mode) {
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid QR Code version");
      }
      if (typeof mode === "undefined") mode = Mode.BYTE;
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (mode === Mode.MIXED) return dataTotalCodewordsBits;
      const usableBits = dataTotalCodewordsBits - getReservedBitsCount(mode, version);
      switch (mode) {
        case Mode.NUMERIC:
          return Math.floor(usableBits / 10 * 3);
        case Mode.ALPHANUMERIC:
          return Math.floor(usableBits / 11 * 2);
        case Mode.KANJI:
          return Math.floor(usableBits / 13);
        case Mode.BYTE:
        default:
          return Math.floor(usableBits / 8);
      }
    };
    exports.getBestVersionForData = function getBestVersionForData(data, errorCorrectionLevel) {
      let seg;
      const ecl = ECLevel.from(errorCorrectionLevel, ECLevel.M);
      if (Array.isArray(data)) {
        if (data.length > 1) {
          return getBestVersionForMixedData(data, ecl);
        }
        if (data.length === 0) {
          return 1;
        }
        seg = data[0];
      } else {
        seg = data;
      }
      return getBestVersionForDataLength(seg.mode, seg.getLength(), ecl);
    };
    exports.getEncodedBits = function getEncodedBits(version) {
      if (!VersionCheck.isValid(version) || version < 7) {
        throw new Error("Invalid QR Code version");
      }
      let d = version << 12;
      while (Utils.getBCHDigit(d) - G18_BCH >= 0) {
        d ^= G18 << Utils.getBCHDigit(d) - G18_BCH;
      }
      return version << 12 | d;
    };
  }
});

// node_modules/qrcode/lib/core/format-info.js
var require_format_info = __commonJS({
  "node_modules/qrcode/lib/core/format-info.js"(exports) {
    var Utils = require_utils();
    var G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
    var G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
    var G15_BCH = Utils.getBCHDigit(G15);
    exports.getEncodedBits = function getEncodedBits(errorCorrectionLevel, mask) {
      const data = errorCorrectionLevel.bit << 3 | mask;
      let d = data << 10;
      while (Utils.getBCHDigit(d) - G15_BCH >= 0) {
        d ^= G15 << Utils.getBCHDigit(d) - G15_BCH;
      }
      return (data << 10 | d) ^ G15_MASK;
    };
  }
});

// node_modules/qrcode/lib/core/numeric-data.js
var require_numeric_data = __commonJS({
  "node_modules/qrcode/lib/core/numeric-data.js"(exports, module2) {
    var Mode = require_mode();
    function NumericData(data) {
      this.mode = Mode.NUMERIC;
      this.data = data.toString();
    }
    NumericData.getBitsLength = function getBitsLength(length) {
      return 10 * Math.floor(length / 3) + (length % 3 ? length % 3 * 3 + 1 : 0);
    };
    NumericData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    NumericData.prototype.getBitsLength = function getBitsLength() {
      return NumericData.getBitsLength(this.data.length);
    };
    NumericData.prototype.write = function write(bitBuffer) {
      let i, group, value;
      for (i = 0; i + 3 <= this.data.length; i += 3) {
        group = this.data.substr(i, 3);
        value = parseInt(group, 10);
        bitBuffer.put(value, 10);
      }
      const remainingNum = this.data.length - i;
      if (remainingNum > 0) {
        group = this.data.substr(i);
        value = parseInt(group, 10);
        bitBuffer.put(value, remainingNum * 3 + 1);
      }
    };
    module2.exports = NumericData;
  }
});

// node_modules/qrcode/lib/core/alphanumeric-data.js
var require_alphanumeric_data = __commonJS({
  "node_modules/qrcode/lib/core/alphanumeric-data.js"(exports, module2) {
    var Mode = require_mode();
    var ALPHA_NUM_CHARS = [
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
      "P",
      "Q",
      "R",
      "S",
      "T",
      "U",
      "V",
      "W",
      "X",
      "Y",
      "Z",
      " ",
      "$",
      "%",
      "*",
      "+",
      "-",
      ".",
      "/",
      ":"
    ];
    function AlphanumericData(data) {
      this.mode = Mode.ALPHANUMERIC;
      this.data = data;
    }
    AlphanumericData.getBitsLength = function getBitsLength(length) {
      return 11 * Math.floor(length / 2) + 6 * (length % 2);
    };
    AlphanumericData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    AlphanumericData.prototype.getBitsLength = function getBitsLength() {
      return AlphanumericData.getBitsLength(this.data.length);
    };
    AlphanumericData.prototype.write = function write(bitBuffer) {
      let i;
      for (i = 0; i + 2 <= this.data.length; i += 2) {
        let value = ALPHA_NUM_CHARS.indexOf(this.data[i]) * 45;
        value += ALPHA_NUM_CHARS.indexOf(this.data[i + 1]);
        bitBuffer.put(value, 11);
      }
      if (this.data.length % 2) {
        bitBuffer.put(ALPHA_NUM_CHARS.indexOf(this.data[i]), 6);
      }
    };
    module2.exports = AlphanumericData;
  }
});

// node_modules/qrcode/lib/core/byte-data.js
var require_byte_data = __commonJS({
  "node_modules/qrcode/lib/core/byte-data.js"(exports, module2) {
    var Mode = require_mode();
    function ByteData(data) {
      this.mode = Mode.BYTE;
      if (typeof data === "string") {
        this.data = new TextEncoder().encode(data);
      } else {
        this.data = new Uint8Array(data);
      }
    }
    ByteData.getBitsLength = function getBitsLength(length) {
      return length * 8;
    };
    ByteData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    ByteData.prototype.getBitsLength = function getBitsLength() {
      return ByteData.getBitsLength(this.data.length);
    };
    ByteData.prototype.write = function(bitBuffer) {
      for (let i = 0, l = this.data.length; i < l; i++) {
        bitBuffer.put(this.data[i], 8);
      }
    };
    module2.exports = ByteData;
  }
});

// node_modules/qrcode/lib/core/kanji-data.js
var require_kanji_data = __commonJS({
  "node_modules/qrcode/lib/core/kanji-data.js"(exports, module2) {
    var Mode = require_mode();
    var Utils = require_utils();
    function KanjiData(data) {
      this.mode = Mode.KANJI;
      this.data = data;
    }
    KanjiData.getBitsLength = function getBitsLength(length) {
      return length * 13;
    };
    KanjiData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    KanjiData.prototype.getBitsLength = function getBitsLength() {
      return KanjiData.getBitsLength(this.data.length);
    };
    KanjiData.prototype.write = function(bitBuffer) {
      let i;
      for (i = 0; i < this.data.length; i++) {
        let value = Utils.toSJIS(this.data[i]);
        if (value >= 33088 && value <= 40956) {
          value -= 33088;
        } else if (value >= 57408 && value <= 60351) {
          value -= 49472;
        } else {
          throw new Error(
            "Invalid SJIS character: " + this.data[i] + "\nMake sure your charset is UTF-8"
          );
        }
        value = (value >>> 8 & 255) * 192 + (value & 255);
        bitBuffer.put(value, 13);
      }
    };
    module2.exports = KanjiData;
  }
});

// node_modules/dijkstrajs/dijkstra.js
var require_dijkstra = __commonJS({
  "node_modules/dijkstrajs/dijkstra.js"(exports, module2) {
    "use strict";
    var dijkstra = {
      single_source_shortest_paths: function(graph, s, d) {
        var predecessors = {};
        var costs = {};
        costs[s] = 0;
        var open = dijkstra.PriorityQueue.make();
        open.push(s, 0);
        var closest, u, v, cost_of_s_to_u, adjacent_nodes, cost_of_e, cost_of_s_to_u_plus_cost_of_e, cost_of_s_to_v, first_visit;
        while (!open.empty()) {
          closest = open.pop();
          u = closest.value;
          cost_of_s_to_u = closest.cost;
          adjacent_nodes = graph[u] || {};
          for (v in adjacent_nodes) {
            if (adjacent_nodes.hasOwnProperty(v)) {
              cost_of_e = adjacent_nodes[v];
              cost_of_s_to_u_plus_cost_of_e = cost_of_s_to_u + cost_of_e;
              cost_of_s_to_v = costs[v];
              first_visit = typeof costs[v] === "undefined";
              if (first_visit || cost_of_s_to_v > cost_of_s_to_u_plus_cost_of_e) {
                costs[v] = cost_of_s_to_u_plus_cost_of_e;
                open.push(v, cost_of_s_to_u_plus_cost_of_e);
                predecessors[v] = u;
              }
            }
          }
        }
        if (typeof d !== "undefined" && typeof costs[d] === "undefined") {
          var msg = ["Could not find a path from ", s, " to ", d, "."].join("");
          throw new Error(msg);
        }
        return predecessors;
      },
      extract_shortest_path_from_predecessor_list: function(predecessors, d) {
        var nodes = [];
        var u = d;
        var predecessor;
        while (u) {
          nodes.push(u);
          predecessor = predecessors[u];
          u = predecessors[u];
        }
        nodes.reverse();
        return nodes;
      },
      find_path: function(graph, s, d) {
        var predecessors = dijkstra.single_source_shortest_paths(graph, s, d);
        return dijkstra.extract_shortest_path_from_predecessor_list(
          predecessors,
          d
        );
      },
      /**
       * A very naive priority queue implementation.
       */
      PriorityQueue: {
        make: function(opts) {
          var T = dijkstra.PriorityQueue, t = {}, key;
          opts = opts || {};
          for (key in T) {
            if (T.hasOwnProperty(key)) {
              t[key] = T[key];
            }
          }
          t.queue = [];
          t.sorter = opts.sorter || T.default_sorter;
          return t;
        },
        default_sorter: function(a, b) {
          return a.cost - b.cost;
        },
        /**
         * Add a new item to the queue and ensure the highest priority element
         * is at the front of the queue.
         */
        push: function(value, cost) {
          var item = { value, cost };
          this.queue.push(item);
          this.queue.sort(this.sorter);
        },
        /**
         * Return the highest priority element in the queue.
         */
        pop: function() {
          return this.queue.shift();
        },
        empty: function() {
          return this.queue.length === 0;
        }
      }
    };
    if (typeof module2 !== "undefined") {
      module2.exports = dijkstra;
    }
  }
});

// node_modules/qrcode/lib/core/segments.js
var require_segments = __commonJS({
  "node_modules/qrcode/lib/core/segments.js"(exports) {
    var Mode = require_mode();
    var NumericData = require_numeric_data();
    var AlphanumericData = require_alphanumeric_data();
    var ByteData = require_byte_data();
    var KanjiData = require_kanji_data();
    var Regex = require_regex();
    var Utils = require_utils();
    var dijkstra = require_dijkstra();
    function getStringByteLength(str) {
      return unescape(encodeURIComponent(str)).length;
    }
    function getSegments(regex, mode, str) {
      const segments = [];
      let result;
      while ((result = regex.exec(str)) !== null) {
        segments.push({
          data: result[0],
          index: result.index,
          mode,
          length: result[0].length
        });
      }
      return segments;
    }
    function getSegmentsFromString(dataStr) {
      const numSegs = getSegments(Regex.NUMERIC, Mode.NUMERIC, dataStr);
      const alphaNumSegs = getSegments(Regex.ALPHANUMERIC, Mode.ALPHANUMERIC, dataStr);
      let byteSegs;
      let kanjiSegs;
      if (Utils.isKanjiModeEnabled()) {
        byteSegs = getSegments(Regex.BYTE, Mode.BYTE, dataStr);
        kanjiSegs = getSegments(Regex.KANJI, Mode.KANJI, dataStr);
      } else {
        byteSegs = getSegments(Regex.BYTE_KANJI, Mode.BYTE, dataStr);
        kanjiSegs = [];
      }
      const segs = numSegs.concat(alphaNumSegs, byteSegs, kanjiSegs);
      return segs.sort(function(s1, s2) {
        return s1.index - s2.index;
      }).map(function(obj) {
        return {
          data: obj.data,
          mode: obj.mode,
          length: obj.length
        };
      });
    }
    function getSegmentBitsLength(length, mode) {
      switch (mode) {
        case Mode.NUMERIC:
          return NumericData.getBitsLength(length);
        case Mode.ALPHANUMERIC:
          return AlphanumericData.getBitsLength(length);
        case Mode.KANJI:
          return KanjiData.getBitsLength(length);
        case Mode.BYTE:
          return ByteData.getBitsLength(length);
      }
    }
    function mergeSegments(segs) {
      return segs.reduce(function(acc, curr) {
        const prevSeg = acc.length - 1 >= 0 ? acc[acc.length - 1] : null;
        if (prevSeg && prevSeg.mode === curr.mode) {
          acc[acc.length - 1].data += curr.data;
          return acc;
        }
        acc.push(curr);
        return acc;
      }, []);
    }
    function buildNodes(segs) {
      const nodes = [];
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        switch (seg.mode) {
          case Mode.NUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.ALPHANUMERIC, length: seg.length },
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.ALPHANUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.KANJI:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
            break;
          case Mode.BYTE:
            nodes.push([
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
        }
      }
      return nodes;
    }
    function buildGraph(nodes, version) {
      const table = {};
      const graph = { start: {} };
      let prevNodeIds = ["start"];
      for (let i = 0; i < nodes.length; i++) {
        const nodeGroup = nodes[i];
        const currentNodeIds = [];
        for (let j = 0; j < nodeGroup.length; j++) {
          const node = nodeGroup[j];
          const key = "" + i + j;
          currentNodeIds.push(key);
          table[key] = { node, lastCount: 0 };
          graph[key] = {};
          for (let n = 0; n < prevNodeIds.length; n++) {
            const prevNodeId = prevNodeIds[n];
            if (table[prevNodeId] && table[prevNodeId].node.mode === node.mode) {
              graph[prevNodeId][key] = getSegmentBitsLength(table[prevNodeId].lastCount + node.length, node.mode) - getSegmentBitsLength(table[prevNodeId].lastCount, node.mode);
              table[prevNodeId].lastCount += node.length;
            } else {
              if (table[prevNodeId]) table[prevNodeId].lastCount = node.length;
              graph[prevNodeId][key] = getSegmentBitsLength(node.length, node.mode) + 4 + Mode.getCharCountIndicator(node.mode, version);
            }
          }
        }
        prevNodeIds = currentNodeIds;
      }
      for (let n = 0; n < prevNodeIds.length; n++) {
        graph[prevNodeIds[n]].end = 0;
      }
      return { map: graph, table };
    }
    function buildSingleSegment(data, modesHint) {
      let mode;
      const bestMode = Mode.getBestModeForData(data);
      mode = Mode.from(modesHint, bestMode);
      if (mode !== Mode.BYTE && mode.bit < bestMode.bit) {
        throw new Error('"' + data + '" cannot be encoded with mode ' + Mode.toString(mode) + ".\n Suggested mode is: " + Mode.toString(bestMode));
      }
      if (mode === Mode.KANJI && !Utils.isKanjiModeEnabled()) {
        mode = Mode.BYTE;
      }
      switch (mode) {
        case Mode.NUMERIC:
          return new NumericData(data);
        case Mode.ALPHANUMERIC:
          return new AlphanumericData(data);
        case Mode.KANJI:
          return new KanjiData(data);
        case Mode.BYTE:
          return new ByteData(data);
      }
    }
    exports.fromArray = function fromArray(array) {
      return array.reduce(function(acc, seg) {
        if (typeof seg === "string") {
          acc.push(buildSingleSegment(seg, null));
        } else if (seg.data) {
          acc.push(buildSingleSegment(seg.data, seg.mode));
        }
        return acc;
      }, []);
    };
    exports.fromString = function fromString(data, version) {
      const segs = getSegmentsFromString(data, Utils.isKanjiModeEnabled());
      const nodes = buildNodes(segs);
      const graph = buildGraph(nodes, version);
      const path = dijkstra.find_path(graph.map, "start", "end");
      const optimizedSegs = [];
      for (let i = 1; i < path.length - 1; i++) {
        optimizedSegs.push(graph.table[path[i]].node);
      }
      return exports.fromArray(mergeSegments(optimizedSegs));
    };
    exports.rawSplit = function rawSplit(data) {
      return exports.fromArray(
        getSegmentsFromString(data, Utils.isKanjiModeEnabled())
      );
    };
  }
});

// node_modules/qrcode/lib/core/qrcode.js
var require_qrcode = __commonJS({
  "node_modules/qrcode/lib/core/qrcode.js"(exports) {
    var Utils = require_utils();
    var ECLevel = require_error_correction_level();
    var BitBuffer = require_bit_buffer();
    var BitMatrix = require_bit_matrix();
    var AlignmentPattern = require_alignment_pattern();
    var FinderPattern = require_finder_pattern();
    var MaskPattern = require_mask_pattern();
    var ECCode = require_error_correction_code();
    var ReedSolomonEncoder = require_reed_solomon_encoder();
    var Version = require_version();
    var FormatInfo = require_format_info();
    var Mode = require_mode();
    var Segments = require_segments();
    function setupFinderPattern(matrix, version) {
      const size = matrix.size;
      const pos = FinderPattern.getPositions(version);
      for (let i = 0; i < pos.length; i++) {
        const row = pos[i][0];
        const col = pos[i][1];
        for (let r = -1; r <= 7; r++) {
          if (row + r <= -1 || size <= row + r) continue;
          for (let c = -1; c <= 7; c++) {
            if (col + c <= -1 || size <= col + c) continue;
            if (r >= 0 && r <= 6 && (c === 0 || c === 6) || c >= 0 && c <= 6 && (r === 0 || r === 6) || r >= 2 && r <= 4 && c >= 2 && c <= 4) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    function setupTimingPattern(matrix) {
      const size = matrix.size;
      for (let r = 8; r < size - 8; r++) {
        const value = r % 2 === 0;
        matrix.set(r, 6, value, true);
        matrix.set(6, r, value, true);
      }
    }
    function setupAlignmentPattern(matrix, version) {
      const pos = AlignmentPattern.getPositions(version);
      for (let i = 0; i < pos.length; i++) {
        const row = pos[i][0];
        const col = pos[i][1];
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (r === -2 || r === 2 || c === -2 || c === 2 || r === 0 && c === 0) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    function setupVersionInfo(matrix, version) {
      const size = matrix.size;
      const bits = Version.getEncodedBits(version);
      let row, col, mod;
      for (let i = 0; i < 18; i++) {
        row = Math.floor(i / 3);
        col = i % 3 + size - 8 - 3;
        mod = (bits >> i & 1) === 1;
        matrix.set(row, col, mod, true);
        matrix.set(col, row, mod, true);
      }
    }
    function setupFormatInfo(matrix, errorCorrectionLevel, maskPattern) {
      const size = matrix.size;
      const bits = FormatInfo.getEncodedBits(errorCorrectionLevel, maskPattern);
      let i, mod;
      for (i = 0; i < 15; i++) {
        mod = (bits >> i & 1) === 1;
        if (i < 6) {
          matrix.set(i, 8, mod, true);
        } else if (i < 8) {
          matrix.set(i + 1, 8, mod, true);
        } else {
          matrix.set(size - 15 + i, 8, mod, true);
        }
        if (i < 8) {
          matrix.set(8, size - i - 1, mod, true);
        } else if (i < 9) {
          matrix.set(8, 15 - i - 1 + 1, mod, true);
        } else {
          matrix.set(8, 15 - i - 1, mod, true);
        }
      }
      matrix.set(size - 8, 8, 1, true);
    }
    function setupData(matrix, data) {
      const size = matrix.size;
      let inc = -1;
      let row = size - 1;
      let bitIndex = 7;
      let byteIndex = 0;
      for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (!matrix.isReserved(row, col - c)) {
              let dark = false;
              if (byteIndex < data.length) {
                dark = (data[byteIndex] >>> bitIndex & 1) === 1;
              }
              matrix.set(row, col - c, dark);
              bitIndex--;
              if (bitIndex === -1) {
                byteIndex++;
                bitIndex = 7;
              }
            }
          }
          row += inc;
          if (row < 0 || size <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    }
    function createData(version, errorCorrectionLevel, segments) {
      const buffer = new BitBuffer();
      segments.forEach(function(data) {
        buffer.put(data.mode.bit, 4);
        buffer.put(data.getLength(), Mode.getCharCountIndicator(data.mode, version));
        data.write(buffer);
      });
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (buffer.getLengthInBits() + 4 <= dataTotalCodewordsBits) {
        buffer.put(0, 4);
      }
      while (buffer.getLengthInBits() % 8 !== 0) {
        buffer.putBit(0);
      }
      const remainingByte = (dataTotalCodewordsBits - buffer.getLengthInBits()) / 8;
      for (let i = 0; i < remainingByte; i++) {
        buffer.put(i % 2 ? 17 : 236, 8);
      }
      return createCodewords(buffer, version, errorCorrectionLevel);
    }
    function createCodewords(bitBuffer, version, errorCorrectionLevel) {
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewords = totalCodewords - ecTotalCodewords;
      const ecTotalBlocks = ECCode.getBlocksCount(version, errorCorrectionLevel);
      const blocksInGroup2 = totalCodewords % ecTotalBlocks;
      const blocksInGroup1 = ecTotalBlocks - blocksInGroup2;
      const totalCodewordsInGroup1 = Math.floor(totalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup1 = Math.floor(dataTotalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup2 = dataCodewordsInGroup1 + 1;
      const ecCount = totalCodewordsInGroup1 - dataCodewordsInGroup1;
      const rs = new ReedSolomonEncoder(ecCount);
      let offset = 0;
      const dcData = new Array(ecTotalBlocks);
      const ecData = new Array(ecTotalBlocks);
      let maxDataSize = 0;
      const buffer = new Uint8Array(bitBuffer.buffer);
      for (let b = 0; b < ecTotalBlocks; b++) {
        const dataSize = b < blocksInGroup1 ? dataCodewordsInGroup1 : dataCodewordsInGroup2;
        dcData[b] = buffer.slice(offset, offset + dataSize);
        ecData[b] = rs.encode(dcData[b]);
        offset += dataSize;
        maxDataSize = Math.max(maxDataSize, dataSize);
      }
      const data = new Uint8Array(totalCodewords);
      let index = 0;
      let i, r;
      for (i = 0; i < maxDataSize; i++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          if (i < dcData[r].length) {
            data[index++] = dcData[r][i];
          }
        }
      }
      for (i = 0; i < ecCount; i++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          data[index++] = ecData[r][i];
        }
      }
      return data;
    }
    function createSymbol(data, version, errorCorrectionLevel, maskPattern) {
      let segments;
      if (Array.isArray(data)) {
        segments = Segments.fromArray(data);
      } else if (typeof data === "string") {
        let estimatedVersion = version;
        if (!estimatedVersion) {
          const rawSegments = Segments.rawSplit(data);
          estimatedVersion = Version.getBestVersionForData(rawSegments, errorCorrectionLevel);
        }
        segments = Segments.fromString(data, estimatedVersion || 40);
      } else {
        throw new Error("Invalid data");
      }
      const bestVersion = Version.getBestVersionForData(segments, errorCorrectionLevel);
      if (!bestVersion) {
        throw new Error("The amount of data is too big to be stored in a QR Code");
      }
      if (!version) {
        version = bestVersion;
      } else if (version < bestVersion) {
        throw new Error(
          "\nThe chosen QR Code version cannot contain this amount of data.\nMinimum version required to store current data is: " + bestVersion + ".\n"
        );
      }
      const dataBits = createData(version, errorCorrectionLevel, segments);
      const moduleCount = Utils.getSymbolSize(version);
      const modules = new BitMatrix(moduleCount);
      setupFinderPattern(modules, version);
      setupTimingPattern(modules);
      setupAlignmentPattern(modules, version);
      setupFormatInfo(modules, errorCorrectionLevel, 0);
      if (version >= 7) {
        setupVersionInfo(modules, version);
      }
      setupData(modules, dataBits);
      if (isNaN(maskPattern)) {
        maskPattern = MaskPattern.getBestMask(
          modules,
          setupFormatInfo.bind(null, modules, errorCorrectionLevel)
        );
      }
      MaskPattern.applyMask(maskPattern, modules);
      setupFormatInfo(modules, errorCorrectionLevel, maskPattern);
      return {
        modules,
        version,
        errorCorrectionLevel,
        maskPattern,
        segments
      };
    }
    exports.create = function create(data, options) {
      if (typeof data === "undefined" || data === "") {
        throw new Error("No input text");
      }
      let errorCorrectionLevel = ECLevel.M;
      let version;
      let mask;
      if (typeof options !== "undefined") {
        errorCorrectionLevel = ECLevel.from(options.errorCorrectionLevel, ECLevel.M);
        version = Version.from(options.version);
        mask = MaskPattern.from(options.maskPattern);
        if (options.toSJISFunc) {
          Utils.setToSJISFunction(options.toSJISFunc);
        }
      }
      return createSymbol(data, version, errorCorrectionLevel, mask);
    };
  }
});

// node_modules/qrcode/lib/renderer/utils.js
var require_utils2 = __commonJS({
  "node_modules/qrcode/lib/renderer/utils.js"(exports) {
    function hex2rgba(hex) {
      if (typeof hex === "number") {
        hex = hex.toString();
      }
      if (typeof hex !== "string") {
        throw new Error("Color should be defined as hex string");
      }
      let hexCode = hex.slice().replace("#", "").split("");
      if (hexCode.length < 3 || hexCode.length === 5 || hexCode.length > 8) {
        throw new Error("Invalid hex color: " + hex);
      }
      if (hexCode.length === 3 || hexCode.length === 4) {
        hexCode = Array.prototype.concat.apply([], hexCode.map(function(c) {
          return [c, c];
        }));
      }
      if (hexCode.length === 6) hexCode.push("F", "F");
      const hexValue = parseInt(hexCode.join(""), 16);
      return {
        r: hexValue >> 24 & 255,
        g: hexValue >> 16 & 255,
        b: hexValue >> 8 & 255,
        a: hexValue & 255,
        hex: "#" + hexCode.slice(0, 6).join("")
      };
    }
    exports.getOptions = function getOptions(options) {
      if (!options) options = {};
      if (!options.color) options.color = {};
      const margin = typeof options.margin === "undefined" || options.margin === null || options.margin < 0 ? 4 : options.margin;
      const width = options.width && options.width >= 21 ? options.width : void 0;
      const scale = options.scale || 4;
      return {
        width,
        scale: width ? 4 : scale,
        margin,
        color: {
          dark: hex2rgba(options.color.dark || "#000000ff"),
          light: hex2rgba(options.color.light || "#ffffffff")
        },
        type: options.type,
        rendererOpts: options.rendererOpts || {}
      };
    };
    exports.getScale = function getScale(qrSize, opts) {
      return opts.width && opts.width >= qrSize + opts.margin * 2 ? opts.width / (qrSize + opts.margin * 2) : opts.scale;
    };
    exports.getImageWidth = function getImageWidth(qrSize, opts) {
      const scale = exports.getScale(qrSize, opts);
      return Math.floor((qrSize + opts.margin * 2) * scale);
    };
    exports.qrToImageData = function qrToImageData(imgData, qr, opts) {
      const size = qr.modules.size;
      const data = qr.modules.data;
      const scale = exports.getScale(size, opts);
      const symbolSize = Math.floor((size + opts.margin * 2) * scale);
      const scaledMargin = opts.margin * scale;
      const palette = [opts.color.light, opts.color.dark];
      for (let i = 0; i < symbolSize; i++) {
        for (let j = 0; j < symbolSize; j++) {
          let posDst = (i * symbolSize + j) * 4;
          let pxColor = opts.color.light;
          if (i >= scaledMargin && j >= scaledMargin && i < symbolSize - scaledMargin && j < symbolSize - scaledMargin) {
            const iSrc = Math.floor((i - scaledMargin) / scale);
            const jSrc = Math.floor((j - scaledMargin) / scale);
            pxColor = palette[data[iSrc * size + jSrc] ? 1 : 0];
          }
          imgData[posDst++] = pxColor.r;
          imgData[posDst++] = pxColor.g;
          imgData[posDst++] = pxColor.b;
          imgData[posDst] = pxColor.a;
        }
      }
    };
  }
});

// node_modules/qrcode/lib/renderer/canvas.js
var require_canvas = __commonJS({
  "node_modules/qrcode/lib/renderer/canvas.js"(exports) {
    var Utils = require_utils2();
    function clearCanvas(ctx, canvas, size) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!canvas.style) canvas.style = {};
      canvas.height = size;
      canvas.width = size;
      canvas.style.height = size + "px";
      canvas.style.width = size + "px";
    }
    function getCanvasElement() {
      try {
        return document.createElement("canvas");
      } catch (e) {
        throw new Error("You need to specify a canvas element");
      }
    }
    exports.render = function render(qrData, canvas, options) {
      let opts = options;
      let canvasEl = canvas;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!canvas) {
        canvasEl = getCanvasElement();
      }
      opts = Utils.getOptions(opts);
      const size = Utils.getImageWidth(qrData.modules.size, opts);
      const ctx = canvasEl.getContext("2d");
      const image = ctx.createImageData(size, size);
      Utils.qrToImageData(image.data, qrData, opts);
      clearCanvas(ctx, canvasEl, size);
      ctx.putImageData(image, 0, 0);
      return canvasEl;
    };
    exports.renderToDataURL = function renderToDataURL(qrData, canvas, options) {
      let opts = options;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!opts) opts = {};
      const canvasEl = exports.render(qrData, canvas, opts);
      const type = opts.type || "image/png";
      const rendererOpts = opts.rendererOpts || {};
      return canvasEl.toDataURL(type, rendererOpts.quality);
    };
  }
});

// node_modules/qrcode/lib/renderer/svg-tag.js
var require_svg_tag = __commonJS({
  "node_modules/qrcode/lib/renderer/svg-tag.js"(exports) {
    var Utils = require_utils2();
    function getColorAttrib(color, attrib) {
      const alpha = color.a / 255;
      const str = attrib + '="' + color.hex + '"';
      return alpha < 1 ? str + " " + attrib + '-opacity="' + alpha.toFixed(2).slice(1) + '"' : str;
    }
    function svgCmd(cmd, x, y) {
      let str = cmd + x;
      if (typeof y !== "undefined") str += " " + y;
      return str;
    }
    function qrToPath(data, size, margin) {
      let path = "";
      let moveBy = 0;
      let newRow = false;
      let lineLength = 0;
      for (let i = 0; i < data.length; i++) {
        const col = Math.floor(i % size);
        const row = Math.floor(i / size);
        if (!col && !newRow) newRow = true;
        if (data[i]) {
          lineLength++;
          if (!(i > 0 && col > 0 && data[i - 1])) {
            path += newRow ? svgCmd("M", col + margin, 0.5 + row + margin) : svgCmd("m", moveBy, 0);
            moveBy = 0;
            newRow = false;
          }
          if (!(col + 1 < size && data[i + 1])) {
            path += svgCmd("h", lineLength);
            lineLength = 0;
          }
        } else {
          moveBy++;
        }
      }
      return path;
    }
    exports.render = function render(qrData, options, cb) {
      const opts = Utils.getOptions(options);
      const size = qrData.modules.size;
      const data = qrData.modules.data;
      const qrcodesize = size + opts.margin * 2;
      const bg = !opts.color.light.a ? "" : "<path " + getColorAttrib(opts.color.light, "fill") + ' d="M0 0h' + qrcodesize + "v" + qrcodesize + 'H0z"/>';
      const path = "<path " + getColorAttrib(opts.color.dark, "stroke") + ' d="' + qrToPath(data, size, opts.margin) + '"/>';
      const viewBox = 'viewBox="0 0 ' + qrcodesize + " " + qrcodesize + '"';
      const width = !opts.width ? "" : 'width="' + opts.width + '" height="' + opts.width + '" ';
      const svgTag = '<svg xmlns="http://www.w3.org/2000/svg" ' + width + viewBox + ' shape-rendering="crispEdges">' + bg + path + "</svg>\n";
      if (typeof cb === "function") {
        cb(null, svgTag);
      }
      return svgTag;
    };
  }
});

// node_modules/qrcode/lib/browser.js
var require_browser = __commonJS({
  "node_modules/qrcode/lib/browser.js"(exports) {
    var canPromise = require_can_promise();
    var QRCode2 = require_qrcode();
    var CanvasRenderer = require_canvas();
    var SvgRenderer = require_svg_tag();
    function renderCanvas(renderFunc, canvas, text, opts, cb) {
      const args = [].slice.call(arguments, 1);
      const argsNum = args.length;
      const isLastArgCb = typeof args[argsNum - 1] === "function";
      if (!isLastArgCb && !canPromise()) {
        throw new Error("Callback required as last argument");
      }
      if (isLastArgCb) {
        if (argsNum < 2) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 2) {
          cb = text;
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 3) {
          if (canvas.getContext && typeof cb === "undefined") {
            cb = opts;
            opts = void 0;
          } else {
            cb = opts;
            opts = text;
            text = canvas;
            canvas = void 0;
          }
        }
      } else {
        if (argsNum < 1) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 1) {
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 2 && !canvas.getContext) {
          opts = text;
          text = canvas;
          canvas = void 0;
        }
        return new Promise(function(resolve, reject) {
          try {
            const data = QRCode2.create(text, opts);
            resolve(renderFunc(data, canvas, opts));
          } catch (e) {
            reject(e);
          }
        });
      }
      try {
        const data = QRCode2.create(text, opts);
        cb(null, renderFunc(data, canvas, opts));
      } catch (e) {
        cb(e);
      }
    }
    exports.create = QRCode2.create;
    exports.toCanvas = renderCanvas.bind(null, CanvasRenderer.render);
    exports.toDataURL = renderCanvas.bind(null, CanvasRenderer.renderToDataURL);
    exports.toString = renderCanvas.bind(null, function(data, _, opts) {
      return SvgRenderer.render(data, opts);
    });
  }
});

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
/** The Feilian browser plugin: `apply` registers the sidebar page. */
export default __toCommonJS(index_exports);
var import_react = __toESM(require("react"), 1);
var import_qrcode = __toESM(require_browser(), 1);
var API_PREFIX = "api/feilian-kb";
var STYLE_ID = "feilian-kb-ui-style";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  .fk-root {
    --fk-bg: #f6f8fb;
    --fk-surface: #ffffff;
    --fk-surface-2: #f1f4f9;
    --fk-border: #e4e9f0;
    --fk-border-strong: #d5dce6;
    --fk-text: #101828;
    --fk-muted: #667085;
    --fk-subtle: #98a2b3;
    --fk-primary: #2563eb;
    --fk-primary-hover: #1d4ed8;
    --fk-primary-soft: #eaf1ff;
    --fk-green: #12b76a;
    --fk-amber: #f79009;
    --fk-red: #f04438;
    --fk-radius: 16px;
    --fk-radius-sm: 10px;
    color-scheme: light;
    display: flex;
    flex-direction: column;
    min-height: 100%;
    height: 100%;
    box-sizing: border-box;
    background: var(--fk-bg);
    color: var(--fk-text);
    font: inherit;
    position: relative;
    overflow: hidden;
  }
  @media (prefers-color-scheme: dark) {
    .fk-root {
      --fk-bg: #0e131b;
      --fk-surface: #151c26;
      --fk-surface-2: #1b2430;
      --fk-border: #263243;
      --fk-border-strong: #344257;
      --fk-text: #eef2f7;
      --fk-muted: #9aa8ba;
      --fk-subtle: #718096;
      --fk-primary: #5b8cf7;
      --fk-primary-hover: #7aa2ff;
      --fk-primary-soft: #1b2a45;
      color-scheme: dark;
    }
  }
  .fk-scroll { overflow: auto; scrollbar-width: thin; }
  .fk-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    height: 34px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--fk-border);
    background: var(--fk-surface); color: var(--fk-text); font: inherit; font-size: 13px;
    font-weight: 600; cursor: pointer; white-space: nowrap;
  }
  .fk-btn:hover { background: var(--fk-surface-2); }
  .fk-btn:disabled { opacity: .5; cursor: default; }
  .fk-btn-primary { background: var(--fk-primary); border-color: var(--fk-primary); color: #fff; }
  .fk-btn-primary:hover { background: var(--fk-primary-hover); }
  .fk-btn-soft { background: var(--fk-primary-soft); border-color: transparent; color: var(--fk-primary); }
  .fk-btn-icon { width: 34px; padding: 0; }
  .fk-btn-sm { height: 28px; padding: 0 9px; font-size: 12px; border-radius: 8px; }
  .fk-input, .fk-select, .fk-textarea {
    width: 100%; box-sizing: border-box; border: 1px solid var(--fk-border);
    background: var(--fk-surface); color: var(--fk-text); border-radius: 10px;
    padding: 9px 11px; font: inherit; font-size: 13px; outline: none;
  }
  .fk-input:focus, .fk-select:focus, .fk-textarea:focus { border-color: var(--fk-primary); box-shadow: 0 0 0 3px var(--fk-primary-soft); }
  .fk-textarea { resize: vertical; min-height: 88px; line-height: 1.6; }
  .fk-label { display: grid; gap: 6px; margin-bottom: 13px; font-size: 12px; font-weight: 600; color: var(--fk-muted); }
  .fk-login { flex: 1; display: grid; place-items: center; padding: 32px 20px; overflow: auto; }
  .fk-login-card {
    width: min(420px, 100%); background: var(--fk-surface); border: 1px solid var(--fk-border);
    border-radius: 20px; padding: 28px; box-shadow: 0 24px 60px rgba(16,24,40,.08);
  }
  .fk-device-wait {
    border: 1px solid var(--fk-border); border-radius: 14px; padding: 14px;
    background: var(--fk-surface-2); display: grid; gap: 6px;
  }
  .fk-device-code {
    font: 700 24px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: 2px; text-align: center; padding: 10px 8px; border-radius: 10px;
    background: var(--fk-surface); border: 1px dashed var(--fk-border-strong); color: var(--fk-text);
  }
  .fk-brand-row { display: flex; align-items: center; gap: 12px; }
  .fk-brand-mark {
    width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: #fff;
    background: linear-gradient(135deg, #2f7df6 0%, #12b8a6 100%);
    box-shadow: 0 8px 20px rgba(47,125,246,.25);
  }
  .fk-title { font-size: 19px; font-weight: 720; letter-spacing: -.2px; }
  .fk-sub { color: var(--fk-muted); font-size: 12px; line-height: 1.6; }
  .fk-header { padding: 18px 24px 0; flex: none; }
  .fk-header-top { display: flex; align-items: center; gap: 12px; }
  .fk-header-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .fk-update-pill {
    display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 10px;
    border-radius: 999px; border: 1px solid color-mix(in srgb, var(--fk-primary) 28%, transparent);
    background: var(--fk-primary-soft); color: var(--fk-primary); font: inherit; font-size: 12px;
    font-weight: 700; cursor: pointer; white-space: nowrap;
  }
  .fk-update-pill:hover { border-color: var(--fk-primary); }
  .fk-kb-select {
    height: 34px; max-width: 320px; border: 1px solid var(--fk-border); border-radius: 9px;
    background: var(--fk-surface); color: var(--fk-text); font: inherit; font-size: 13px; font-weight: 600;
    padding: 0 10px;
  }
  .fk-stats { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
  .fk-stat {
    display: inline-flex; align-items: baseline; gap: 6px; padding: 6px 10px; border-radius: 9px;
    background: var(--fk-surface); border: 1px solid var(--fk-border); color: var(--fk-muted); font-size: 12px;
  }
  .fk-stat strong { color: var(--fk-text); font-size: 13px; }
  .fk-tabs { display: flex; gap: 2px; margin-top: 16px; border-bottom: 1px solid var(--fk-border); flex: none; }
  .fk-tab {
    display: inline-flex; align-items: center; gap: 7px; padding: 10px 13px; border: 0; background: transparent;
    color: var(--fk-muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
    border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .fk-tab:hover { color: var(--fk-text); }
  .fk-tab-active { color: var(--fk-primary); border-bottom-color: var(--fk-primary); }
  .fk-count { font-size: 11px; color: var(--fk-subtle); font-weight: 500; }
  .fk-main { flex: 1; min-height: 0; padding: 16px 24px 22px; }
  .fk-split { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 14px; height: 100%; min-height: 0; }
  .fk-panel {
    background: var(--fk-surface); border: 1px solid var(--fk-border); border-radius: var(--fk-radius);
    min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden;
  }
  .fk-panel-head {
    display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--fk-border);
    flex: none;
  }
  .fk-panel-title { font-size: 13px; font-weight: 700; }
  .fk-panel-body { min-height: 0; flex: 1; }
  .fk-search { flex: 1; min-width: 0; }
  .fk-tree { padding: 8px; }
  .fk-group { margin-bottom: 2px; }
  .fk-group-head {
    display: flex; align-items: center; gap: 7px; padding: 7px 8px; border-radius: 8px;
    cursor: pointer; color: var(--fk-text); font-size: 13px; font-weight: 650; user-select: none;
  }
  .fk-group-head:hover { background: var(--fk-surface-2); }
  .fk-group-chevron { transition: transform .15s ease; color: var(--fk-subtle); display: inline-flex; }
  .fk-group-chevron-open { transform: rotate(90deg); }
  .fk-item {
    display: flex; align-items: center; gap: 7px; padding: 6px 8px 6px 25px; border-radius: 8px;
    color: var(--fk-muted); font-size: 12.5px; cursor: pointer; line-height: 1.45;
  }
  .fk-item:hover { background: var(--fk-surface-2); color: var(--fk-text); }
  .fk-item-active { background: var(--fk-primary-soft); color: var(--fk-primary); font-weight: 600; }
  .fk-item-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fk-preview-head { padding: 16px 20px 13px; border-bottom: 1px solid var(--fk-border); flex: none; }
  .fk-preview-title { margin: 0; font-size: 17px; font-weight: 720; letter-spacing: -.2px; }
  .fk-preview-meta { margin-top: 5px; color: var(--fk-subtle); font-size: 12px; word-break: break-all; }
  .fk-preview-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .fk-preview-body { padding: 20px 24px 30px; font-size: 13.5px; line-height: 1.78; white-space: pre-wrap; word-break: break-word; }
  .fk-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; padding: 36px 24px; text-align: center; color: var(--fk-muted); }
  .fk-empty strong { color: var(--fk-text); font-size: 14px; }
  .fk-empty span { font-size: 12.5px; line-height: 1.6; max-width: 380px; }
  .fk-empty-icon { width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center; background: var(--fk-surface-2); color: var(--fk-subtle); }
  .fk-toast {
    position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 30;
    background: #101828; color: #fff; border-radius: 10px; padding: 9px 14px; font-size: 12.5px;
    box-shadow: 0 12px 30px rgba(16,24,40,.25); max-width: min(560px, 80%);
  }
  .fk-graph { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .fk-graph-toolbar { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--fk-border); flex-wrap: wrap; }
  .fk-legend { display: flex; gap: 6px; flex-wrap: wrap; }
  .fk-legend-item {
    display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--fk-border);
    background: var(--fk-surface); border-radius: 999px; padding: 4px 9px; font-size: 11.5px;
    color: var(--fk-muted); cursor: pointer;
  }
  .fk-legend-item-off { opacity: .38; }
  .fk-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
  .fk-graph-canvas { position: relative; flex: 1; min-height: 360px; }
  .fk-graph-svg { width: 100%; height: 100%; display: block; touch-action: none; }
  .fk-graph-node { cursor: pointer; }
  .fk-graph-label { font-size: 9px; fill: var(--fk-muted); pointer-events: none; }
  .fk-graph-detail {
    position: absolute; left: 14px; bottom: 14px; max-width: min(360px, calc(100% - 28px));
    background: var(--fk-surface); border: 1px solid var(--fk-border); border-radius: 12px;
    padding: 12px 14px; box-shadow: 0 14px 34px rgba(16,24,40,.16);
  }
  .fk-graph-detail strong { display: block; font-size: 13px; word-break: break-all; }
  .fk-graph-detail span { display: block; color: var(--fk-muted); font-size: 11.5px; margin-top: 3px; }
  .fk-bots { padding: 0; display: grid; gap: 12px; }
  .fk-bot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .fk-bot-card {
    border: 1px solid var(--fk-border); border-radius: 14px; background: var(--fk-surface);
    padding: 15px; display: flex; flex-direction: column; gap: 9px; min-width: 0;
  }
  .fk-bot-head { display: flex; align-items: flex-start; gap: 9px; }
  .fk-bot-avatar { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: var(--fk-primary-soft); color: var(--fk-primary); flex: none; }
  .fk-bot-name { font-size: 13.5px; font-weight: 700; }
  .fk-bot-meta { color: var(--fk-muted); font-size: 11.5px; line-height: 1.5; word-break: break-all; }
  .fk-bot-status { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; }
  .fk-bot-actions { display: flex; gap: 7px; flex-wrap: wrap; margin-top: auto; }
  .fk-seg { display: flex; gap: 5px; margin-bottom: 12px; padding: 4px; background: var(--fk-surface-2); border-radius: 10px; }
  .fk-seg-item { flex: 1; height: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--fk-muted); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .fk-seg-item-active { background: var(--fk-surface); color: var(--fk-primary); box-shadow: 0 1px 4px rgba(16,24,40,.08); }
  .fk-callback { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
  .fk-inline-code { flex: 1; min-width: 0; font-size: 10.5px; color: var(--fk-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--fk-surface-2); border-radius: 6px; padding: 3px 6px; }
  .fk-tutorial-tabs { display: flex; gap: 6px; margin-bottom: 14px; background: var(--fk-surface-2); padding: 4px; border-radius: 10px; width: fit-content; }
  .fk-tutorial-step { display: flex; gap: 9px; padding: 8px 0; border-bottom: 1px dashed var(--fk-border); }
  .fk-tutorial-step:last-child { border-bottom: 0; }
  .fk-tutorial-index { width: 20px; height: 20px; border-radius: 50%; background: var(--fk-primary-soft); color: var(--fk-primary); display: grid; place-items: center; font-size: 11px; font-weight: 700; flex: none; }
  .fk-tutorial-step span { font-size: 12.5px; line-height: 1.65; color: var(--fk-text); }
  .fk-tutorial-note { padding: 10px 12px; border-radius: 10px; background: var(--fk-surface-2); color: var(--fk-muted); font-size: 12px; line-height: 1.6; margin-top: 12px; }
  .fk-modal-backdrop { position: absolute; inset: 0; z-index: 50; background: rgba(16,24,40,.42); display: grid; place-items: center; padding: 20px; }
  .fk-modal {
    width: min(560px, 100%); max-height: calc(100% - 20px); overflow: auto; background: var(--fk-surface);
    border: 1px solid var(--fk-border); border-radius: 18px; padding: 22px; box-shadow: 0 28px 80px rgba(16,24,40,.28);
  }
  .fk-modal-head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 18px; }
  .fk-modal-title { font-size: 16px; font-weight: 720; }
  .fk-modal-close { margin-left: auto; }
  .fk-check { display: flex; align-items: flex-start; gap: 8px; padding: 7px 0; color: var(--fk-text); font-size: 12.5px; font-weight: 500; }
  .fk-check input { margin-top: 2px; accent-color: var(--fk-primary); }
  .fk-check small { display: block; color: var(--fk-muted); font-weight: 400; margin-top: 2px; line-height: 1.5; }
  .fk-divider { height: 1px; background: var(--fk-border); margin: 4px 0 14px; }
  .fk-drawer-backdrop { position: absolute; inset: 0; z-index: 40; background: rgba(16,24,40,.25); }
  .fk-drawer {
    position: absolute; top: 0; right: 0; bottom: 0; width: min(420px, 92%); background: var(--fk-surface);
    border-left: 1px solid var(--fk-border); box-shadow: -24px 0 60px rgba(16,24,40,.15);
    display: flex; flex-direction: column; z-index: 41;
  }
  .fk-drawer-head { display: flex; align-items: center; gap: 8px; padding: 16px 18px; border-bottom: 1px solid var(--fk-border); }
  .fk-drawer-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
  .fk-answer { border: 1px solid var(--fk-border); border-radius: 12px; background: var(--fk-surface-2); padding: 13px; font-size: 13px; line-height: 1.72; white-space: pre-wrap; }
  .fk-citation-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .fk-citation { border: 1px solid var(--fk-border); background: var(--fk-surface); border-radius: 999px; padding: 4px 9px; font-size: 11.5px; color: var(--fk-muted); cursor: pointer; }
  .fk-citation:hover { color: var(--fk-primary); border-color: var(--fk-primary); }
  .fk-skeleton { border-radius: 10px; background: linear-gradient(90deg, var(--fk-surface-2), var(--fk-border), var(--fk-surface-2)); background-size: 200% 100%; animation: fk-shimmer 1.4s infinite; }
  @keyframes fk-shimmer { 0% { background-position: 160% 0; } 100% { background-position: -60% 0; } }
  .fk-spin { animation: fk-rotate .9s linear infinite; }
  @keyframes fk-rotate { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
}
var ICONS = {
  book: ["M4 5.8A2.8 2.8 0 0 1 6.8 3H20v15.4H6.8A2.8 2.8 0 0 0 4 21.2V5.8Z", "M8 7.6h8M8 11h5.5"],
  folder: ["M3.5 7.2A2.2 2.2 0 0 1 5.7 5h4l2 2.4h6.6a2.2 2.2 0 0 1 2.2 2.2v7.2a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2V7.2Z"],
  file: ["M6 3.8h7l5 5V20a1.2 1.2 0 0 1-1.2 1.2H6A1.2 1.2 0 0 1 4.8 20V5A1.2 1.2 0 0 1 6 3.8Z", "M13 3.8V9h5"],
  graph: ["M5.5 7.5 12 4l6.5 3.5v9L12 20l-6.5-3.5v-9Z", "M5.5 7.5 12 11l6.5-3.5M12 11v9"],
  bot: ["M7 8.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z", "M12 4v4.5M9 13h.01M15 13h.01M9.5 16.5h5"],
  search: ["M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4Z", "m16.2 16.2 4.3 4.3"],
  refresh: ["M20 12a8 8 0 1 1-2.3-5.7", "M20 4v5h-5"],
  logout: ["M9 4H5.8A1.8 1.8 0 0 0 4 5.8v12.4A1.8 1.8 0 0 0 5.8 20H9", "M15 16l4-4-4-4M19 12H9"],
  chevron: ["m9 6 6 6-6 6"],
  send: ["m4 12 16-7-6.2 15-2.1-6.2L4 12Z", "m11.7 13.8 8.3 10.4"],
  close: ["M6 6l12 12M18 6 6 18"],
  plus: ["M12 5v14M5 12h14"],
  edit: ["M4 20h4.2L19 9.2a2.4 2.4 0 0 0-3.4-3.4L4.8 16.6V20Z", "m13.5 7.5 3 3"],
  check: ["m5 12.5 4.2 4.2L19 7"],
  external: ["M14 4h6v6", "M20 4 11 13", "M18 14v4.2A1.8 1.8 0 0 1 16.2 20H5.8A1.8 1.8 0 0 1 4 18.2V7.8A1.8 1.8 0 0 1 5.8 6H10"],
  copy: ["M8 8h10v12H8V8Z", "M6 16H4V4h12v2"],
  layers: ["m12 3 9 5-9 5-9-5 9-5Z", "m3 12 9 5 9-5", "m3 16 9 5 9-5"],
  spark: ["M12 3v4M12 17v4M3 12h4M17 12h4", "m5.6 5.6 2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"],
  users: ["M16 20v-1.8a3.8 3.8 0 0 0-3.8-3.8H6.8A3.8 3.8 0 0 0 3 18.2V20", "M9.5 10.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z", "M21 20v-1.8a3.8 3.8 0 0 0-2.8-3.7M15.5 3.5a3.6 3.6 0 0 1 0 7"],
  alert: ["M12 3.5 21 20H3L12 3.5Z", "M12 9v4.5M12 17h.01"],
  inbox: ["M4 5.5h16v13H4v-13Z", "M4 13h4l1.5 2h5L16 13h4"]
};
function Icon({ name, size = 16, className = "" }) {
  const paths = ICONS[name] || ICONS.file;
  return import_react.default.createElement(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      className,
      "aria-hidden": "true"
    },
    paths.map((d, index) => import_react.default.createElement("path", { key: index, d }))
  );
}
function FeilianIcon({ size = 18 }) {
  return import_react.default.createElement(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.7,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true"
    },
    import_react.default.createElement("path", { d: "M4 5.8A2.8 2.8 0 0 1 6.8 3H20v15.4H6.8A2.8 2.8 0 0 0 4 21.2V5.8Z" }),
    import_react.default.createElement("path", { d: "M8 7.6h8M8 11h5.5" }),
    import_react.default.createElement("path", { d: "M17.5 18.2v3.2l2-1.3 2 1.3v-3.2" })
  );
}
async function api(path, options = {}) {
  const response = await fetch(`${API_PREFIX}${path}`, {
    cache: "no-store",
    credentials: "same-origin",
    method: options.method || "GET",
    ...options.body ? { headers: { "content-type": "application/json" } } : {},
    ...options
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload || {};
}
function humanCount(value) {
  const n = Number(value) || 0;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}w`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}
var TYPE_COLORS = {
  Summary: "#2563eb",
  Concept: "#7c3aed",
  Person: "#e5484d",
  Organization: "#f79009",
  Product: "#12b76a",
  Place: "#0891b2",
  Work: "#db2777",
  Event: "#64748b",
  Other: "#98a2b3"
};
var TYPE_LABELS = {
  Summary: "\u6458\u8981",
  Concept: "\u6982\u5FF5",
  Person: "\u4EBA\u7269",
  Organization: "\u7EC4\u7EC7",
  Product: "\u4EA7\u54C1",
  Place: "\u5730\u70B9",
  Work: "\u4F5C\u54C1",
  Event: "\u4E8B\u4EF6",
  Other: "\u5176\u4ED6"
};
function groupPages(pageTitles) {
  const entries = Object.keys(pageTitles || {}).map((path) => ({
    path,
    title: pageTitles[path] || path
  }));
  const groups = [
    { key: "index", label: "\u5165\u53E3", items: [] },
    { key: "summaries", label: "\u6458\u8981", items: [] },
    { key: "concepts", label: "\u6982\u5FF5", items: [] },
    { key: "entities", label: "\u5B9E\u4F53", items: [] },
    { key: "reports", label: "\u62A5\u544A", items: [] },
    { key: "other", label: "\u5176\u4ED6", items: [] }
  ];
  const byKey = Object.fromEntries(groups.map((group) => [group.key, group]));
  for (const entry of entries) {
    if (entry.path === "index.md") byKey.index.items.push(entry);
    else if (entry.path.startsWith("summaries/")) byKey.summaries.items.push(entry);
    else if (entry.path.startsWith("concepts/")) byKey.concepts.items.push(entry);
    else if (entry.path.startsWith("entities/")) byKey.entities.items.push(entry);
    else if (entry.path.startsWith("reports/")) byKey.reports.items.push(entry);
    else byKey.other.items.push(entry);
  }
  for (const group of groups) {
    group.items.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  }
  return groups.filter((group) => group.items.length > 0);
}
function groupSources(sources) {
  const groups = /* @__PURE__ */ new Map();
  for (const source of sources || []) {
    const directory = source.source_directory || (source.display_path ? source.display_path.split("/").slice(0, -1).join("/") : "") || "\u6839\u76EE\u5F55";
    if (!groups.has(directory)) groups.set(directory, []);
    groups.get(directory).push(source);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], "zh-CN")).map(([directory, items]) => ({
    key: directory,
    label: directory,
    items: items.sort(
      (a, b) => (a.name || a.original_filename || "").localeCompare(
        b.name || b.original_filename || "",
        "zh-CN"
      )
    )
  }));
}
function sourceVersionId(source) {
  const versions = source?.versions || [];
  const current = versions.find((version) => version.version === source?.current_version);
  return source?.source_version_id || source?.current_version_id || current?.id || versions[0]?.id || "";
}
function EmptyState({ icon = "inbox", title, detail, action }) {
  return import_react.default.createElement(
    "div",
    { className: "fk-empty" },
    import_react.default.createElement(
      "div",
      { className: "fk-empty-icon" },
      import_react.default.createElement(Icon, { name: icon, size: 22 })
    ),
    import_react.default.createElement("strong", null, title),
    detail ? import_react.default.createElement("span", null, detail) : null,
    action || null
  );
}
function LoginView({ onSignedIn }) {
  const [phase, setPhase] = (0, import_react.useState)("idle");
  const [device, setDevice] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const timerRef = (0, import_react.useRef)(null);
  const stopPolling = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  (0, import_react.useEffect)(() => () => stopPolling(), []);
  const poll = (deviceCode) => {
    stopPolling();
    timerRef.current = window.setTimeout(async () => {
      try {
        const result = await api("/device/poll", {
          method: "POST",
          body: JSON.stringify({ device_code: deviceCode })
        });
        if (result.status === "pending") {
          poll(deviceCode);
          return;
        }
        if (result.signed_in) {
          stopPolling();
          setPhase("success");
          onSignedIn(result);
          return;
        }
        stopPolling();
        setPhase("idle");
        setError(result.error || "\u6388\u6743\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
      } catch (caught) {
        stopPolling();
        setPhase("idle");
        setError(caught.message || "\u6388\u6743\u72B6\u6001\u67E5\u8BE2\u5931\u8D25");
      }
    }, 2e3);
  };
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api("/device/start", {
        method: "POST",
        body: JSON.stringify({ device_name: "DeepSeek Harness" })
      });
      setDevice(result);
      setPhase("waiting");
      try {
        window.open(result.verification_uri_complete, "_blank", "noopener,noreferrer");
      } catch {
      }
      poll(result.device_code);
    } catch (caught) {
      setError(caught.message || "\u65E0\u6CD5\u53D1\u8D77\u6D4F\u89C8\u5668\u6388\u6743");
    } finally {
      setBusy(false);
    }
  };
  const openAgain = () => {
    if (!device?.verification_uri_complete) return;
    try {
      window.open(device.verification_uri_complete, "_blank", "noopener,noreferrer");
    } catch {
      setError("\u6D4F\u89C8\u5668\u62E6\u622A\u4E86\u65B0\u7A97\u53E3\uFF0C\u8BF7\u624B\u52A8\u6253\u5F00\u4E0B\u65B9\u6388\u6743\u5730\u5740");
    }
  };
  return import_react.default.createElement(
    "div",
    { className: "fk-login fk-scroll" },
    import_react.default.createElement(
      "div",
      { className: "fk-login-card" },
      import_react.default.createElement(
        "div",
        { className: "fk-brand-row" },
        import_react.default.createElement(
          "div",
          { className: "fk-brand-mark" },
          import_react.default.createElement(FeilianIcon, { size: 24 })
        ),
        import_react.default.createElement(
          "div",
          null,
          import_react.default.createElement("div", { className: "fk-title" }, "\u98DE\u94FE\u77E5\u8BC6\u5E93"),
          import_react.default.createElement(
            "div",
            { className: "fk-sub" },
            "\u4F01\u4E1A\u77E5\u8BC6\uFF0C\u76F4\u63A5\u5E26\u8FDB DeepSeek"
          )
        )
      ),
      import_react.default.createElement(
        "p",
        { className: "fk-sub", style: { margin: "18px 0 16px", fontSize: 13, lineHeight: 1.7 } },
        "\u7528\u6D4F\u89C8\u5668\u6388\u6743\u767B\u5F55\u3002\u5DF2\u7ECF\u5728\u98DE\u94FE\u767B\u5F55\u8FC7\u7684\u8BDD\uFF0C\u6253\u5F00\u6388\u6743\u9875\u786E\u8BA4\u8BBE\u5907\u5373\u53EF\uFF0C\u4E0D\u9700\u8981\u518D\u8F93\u5BC6\u7801\u3002"
      ),
      phase === "waiting" ? import_react.default.createElement(
        "div",
        { className: "fk-device-wait" },
        import_react.default.createElement(
          "div",
          { className: "fk-sub", style: { fontSize: 12.5 } },
          "\u8BF7\u5728\u6D4F\u89C8\u5668\u91CC\u786E\u8BA4\u8FD9\u6B21\u6388\u6743"
        ),
        import_react.default.createElement(
          "div",
          { className: "fk-device-code" },
          device?.user_code || ""
        ),
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "fk-btn fk-btn-primary",
            style: { width: "100%", height: 38, marginTop: 10 },
            onClick: openAgain
          },
          "\u91CD\u65B0\u6253\u5F00\u6388\u6743\u9875"
        ),
        import_react.default.createElement(
          "div",
          { className: "fk-sub", style: { marginTop: 10, fontSize: 12, lineHeight: 1.6 } },
          "\u6388\u6743\u9875\u663E\u793A\u300CDSH / DeepSeek Harness\u300D\u65F6\u70B9\u5141\u8BB8\uFF1B\u5B8C\u6210\u540E\u672C\u9875\u4F1A\u81EA\u52A8\u8FDB\u5165\u3002"
        ),
        device?.verification_uri_complete ? import_react.default.createElement(
          "div",
          {
            className: "fk-sub",
            style: { marginTop: 8, wordBreak: "break-all", fontSize: 11.5 }
          },
          device.verification_uri_complete
        ) : null
      ) : import_react.default.createElement(
        "button",
        {
          type: "button",
          className: "fk-btn fk-btn-primary",
          style: { width: "100%", height: 40 },
          disabled: busy,
          onClick: start
        },
        busy ? "\u6B63\u5728\u53D1\u8D77\u6388\u6743\u2026" : "\u6253\u5F00\u6D4F\u89C8\u5668\u6388\u6743"
      ),
      error ? import_react.default.createElement(
        "div",
        {
          className: "fk-sub",
          style: { color: "var(--fk-red)", marginTop: 12, fontSize: 12.5, lineHeight: 1.6 }
        },
        error
      ) : null,
      import_react.default.createElement(
        "div",
        {
          className: "fk-sub",
          style: {
            marginTop: 18,
            paddingTop: 14,
            borderTop: "1px solid var(--fk-border)",
            fontSize: 11.5,
            lineHeight: 1.7
          }
        },
        "\u767B\u5F55\u4E0D\u4F1A\u5728 DSH \u91CC\u4FDD\u5B58\u5BC6\u7801\u3002\u6388\u6743\u540E\u53EF\u4EE5\u5728\u98DE\u94FE\u540E\u53F0\u300C\u5DF2\u6388\u6743\u8BBE\u5907\u300D\u91CC\u770B\u5230 DSH \u8FD9\u53F0\u8BBE\u5907\uFF0C\u5E76\u968F\u65F6\u8E22\u51FA\u3002"
      )
    )
  );
}
function PagePreview({ page, busy, onOpenExternal }) {
  if (busy) {
    return import_react.default.createElement(
      "div",
      { className: "fk-preview-body" },
      import_react.default.createElement("div", { className: "fk-skeleton", style: { height: 18, width: "45%", marginBottom: 14 } }),
      import_react.default.createElement("div", { className: "fk-skeleton", style: { height: 12, width: "90%", marginBottom: 8 } }),
      import_react.default.createElement("div", { className: "fk-skeleton", style: { height: 12, width: "82%", marginBottom: 8 } }),
      import_react.default.createElement("div", { className: "fk-skeleton", style: { height: 12, width: "88%", marginBottom: 8 } }),
      import_react.default.createElement("div", { className: "fk-skeleton", style: { height: 12, width: "70%" } })
    );
  }
  if (!page) {
    return import_react.default.createElement(EmptyState, {
      icon: "book",
      title: "\u4ECE\u5DE6\u4FA7\u9009\u62E9\u4E00\u4E2A\u9875\u9762",
      detail: "\u8FD9\u91CC\u4F1A\u5C55\u793A\u7F16\u8BD1\u540E\u7684\u77E5\u8BC6\u9875\u9762\u3002\u4E5F\u53EF\u4EE5\u6309\u6458\u8981\u3001\u6982\u5FF5\u3001\u5B9E\u4F53\u3001\u62A5\u544A\u5206\u7EC4\u6D4F\u89C8\u3002"
    });
  }
  return import_react.default.createElement(
    import_react.default.Fragment,
    null,
    import_react.default.createElement(
      "div",
      { className: "fk-preview-head" },
      import_react.default.createElement("h2", { className: "fk-preview-title" }, page.title || page.path),
      import_react.default.createElement("div", { className: "fk-preview-meta" }, page.path),
      import_react.default.createElement(
        "div",
        { className: "fk-preview-actions" },
        onOpenExternal ? import_react.default.createElement(
          "button",
          { type: "button", className: "fk-btn fk-btn-sm", onClick: onOpenExternal },
          import_react.default.createElement(Icon, { name: "external", size: 13 }),
          "\u5728\u98DE\u94FE\u4E2D\u6253\u5F00"
        ) : null
      )
    ),
    import_react.default.createElement(
      "div",
      { className: "fk-preview-body fk-scroll" },
      page.content || "\uFF08\u7A7A\u9875\u9762\uFF09"
    )
  );
}
function SourcePreview({ source, busy, onOpenExternal }) {
  if (busy) {
    return import_react.default.createElement(
      "div",
      { className: "fk-preview-body" },
      import_react.default.createElement("div", { className: "fk-skeleton", style: { height: 18, width: "45%", marginBottom: 14 } }),
      import_react.default.createElement("div", { className: "fk-skeleton", style: { height: 12, width: "86%", marginBottom: 8 } }),
      import_react.default.createElement("div", { className: "fk-skeleton", style: { height: 12, width: "72%", marginBottom: 8 } }),
      import_react.default.createElement("div", { className: "fk-skeleton", style: { height: 12, width: "80%" } })
    );
  }
  if (!source) {
    return import_react.default.createElement(EmptyState, {
      icon: "file",
      title: "\u4ECE\u5DE6\u4FA7\u9009\u62E9\u4E00\u4E2A\u6765\u6E90\u6587\u4EF6",
      detail: "\u8FD9\u91CC\u4F1A\u5C55\u793A\u6765\u6E90\u6587\u4EF6\u7684\u6587\u672C\u9884\u89C8\uFF1B\u56FE\u7247\u3001\u97F3\u89C6\u9891\u7B49\u4E8C\u8FDB\u5236\u6587\u4EF6\u8BF7\u5728\u98DE\u94FE\u4E2D\u6253\u5F00\u3002"
    });
  }
  return import_react.default.createElement(
    import_react.default.Fragment,
    null,
    import_react.default.createElement(
      "div",
      { className: "fk-preview-head" },
      import_react.default.createElement("h2", { className: "fk-preview-title" }, source.name),
      import_react.default.createElement(
        "div",
        { className: "fk-preview-meta" },
        [source.path, source.extension, source.version ? `v${source.version}` : ""].filter(Boolean).join(" \xB7 ")
      ),
      import_react.default.createElement(
        "div",
        { className: "fk-preview-actions" },
        import_react.default.createElement(
          "span",
          {
            className: "fk-stat",
            style: { padding: "3px 8px", fontSize: 11.5 }
          },
          source.status === "active" ? "\u5DF2\u63A5\u5165" : source.status || "\u6765\u6E90"
        ),
        onOpenExternal ? import_react.default.createElement(
          "button",
          { type: "button", className: "fk-btn fk-btn-sm", onClick: onOpenExternal },
          import_react.default.createElement(Icon, { name: "external", size: 13 }),
          "\u5728\u98DE\u94FE\u4E2D\u6253\u5F00"
        ) : null
      )
    ),
    import_react.default.createElement(
      "div",
      { className: "fk-preview-body fk-scroll" },
      source.content || "\uFF08\u6CA1\u6709\u53EF\u9884\u89C8\u7684\u6587\u672C\u5185\u5BB9\uFF09"
    )
  );
}
function TreePanel({ title, count, search, onSearch, groups, activeKey, onSelect, emptyTitle, emptyDetail }) {
  const [collapsed, setCollapsed] = (0, import_react.useState)({});
  const filtered = (0, import_react.useMemo)(() => {
    const query = search.trim().toLowerCase();
    if (!query) return groups;
    return groups.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => `${item.title || item.name || ""} ${item.path || ""} ${item.directory || ""}`.toLowerCase().includes(query)
      )
    })).filter((group) => group.items.length > 0);
  }, [groups, search]);
  if (!groups.length) {
    return import_react.default.createElement(
      "div",
      { className: "fk-panel" },
      import_react.default.createElement(
        "div",
        { className: "fk-panel-head" },
        import_react.default.createElement("div", { className: "fk-panel-title" }, title)
      ),
      import_react.default.createElement(EmptyState, {
        icon: "inbox",
        title: emptyTitle,
        detail: emptyDetail
      })
    );
  }
  return import_react.default.createElement(
    "div",
    { className: "fk-panel" },
    import_react.default.createElement(
      "div",
      { className: "fk-panel-head" },
      import_react.default.createElement("div", { className: "fk-panel-title" }, title),
      import_react.default.createElement("span", { className: "fk-count" }, count),
      import_react.default.createElement(
        "div",
        { className: "fk-search", style: { marginLeft: "auto" } },
        import_react.default.createElement("input", {
          className: "fk-input",
          style: { height: 30, padding: "0 9px" },
          placeholder: "\u641C\u7D22\u2026",
          value: search,
          onChange: (event) => onSearch(event.target.value)
        })
      )
    ),
    import_react.default.createElement(
      "div",
      { className: "fk-tree fk-panel-body fk-scroll" },
      filtered.map((group) => {
        const isCollapsed = Boolean(collapsed[group.key]);
        return import_react.default.createElement(
          "div",
          { className: "fk-group", key: group.key },
          import_react.default.createElement(
            "div",
            {
              className: "fk-group-head",
              onClick: () => setCollapsed((current) => ({
                ...current,
                [group.key]: !current[group.key]
              }))
            },
            import_react.default.createElement(
              "span",
              {
                className: `fk-group-chevron ${isCollapsed ? "" : "fk-group-chevron-open"}`
              },
              import_react.default.createElement(Icon, { name: "chevron", size: 12 })
            ),
            import_react.default.createElement(Icon, {
              name: group.key === "index" ? "book" : "folder",
              size: 14
            }),
            import_react.default.createElement("span", null, group.label),
            import_react.default.createElement("span", { className: "fk-count" }, group.items.length)
          ),
          isCollapsed ? null : group.items.map((item) => {
            const key = item.path || item.id || item.name;
            return import_react.default.createElement(
              "div",
              {
                key,
                className: `fk-item ${activeKey === key ? "fk-item-active" : ""}`,
                onClick: () => onSelect(item),
                title: item.path || item.name
              },
              import_react.default.createElement(Icon, {
                name: group.key === "index" ? "book" : "file",
                size: 13
              }),
              import_react.default.createElement(
                "span",
                { className: "fk-item-text" },
                item.title || item.name
              )
            );
          })
        );
      })
    )
  );
}
function layoutGraph(nodes, edges, width = 1e3, height = 680) {
  const count = nodes.length;
  if (!count) return [];
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const positions = nodes.map((node, i) => {
    const angle = i / count * Math.PI * 2;
    const radius = 150 + i % 4 * 65;
    return {
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      degree: 0
    };
  });
  const pairs = [];
  for (const edge of edges) {
    const a = index.get(edge.source);
    const b = index.get(edge.target);
    if (a == null || b == null || a === b) continue;
    pairs.push([a, b]);
    positions[a].degree += 1;
    positions[b].degree += 1;
  }
  const maxPairs = Math.min(pairs.length, 9e3);
  for (let step = 0; step < 110; step += 1) {
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 26e3) continue;
        const d = Math.sqrt(d2);
        const force = 760 / d2;
        const fx = dx / d * force;
        const fy = dy / d * force;
        positions[i].vx -= fx;
        positions[i].vy -= fy;
        positions[j].vx += fx;
        positions[j].vy += fy;
      }
    }
    for (let e = 0; e < maxPairs; e += 1) {
      const [a, b] = pairs[e];
      const dx = positions[b].x - positions[a].x;
      const dy = positions[b].y - positions[a].y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const force = (d - 100) * 22e-4;
      const fx = dx / d * force;
      const fy = dy / d * force;
      positions[a].vx += fx;
      positions[a].vy += fy;
      positions[b].vx -= fx;
      positions[b].vy -= fy;
    }
    for (const p of positions) {
      p.x += p.vx * 0.55;
      p.y += p.vy * 0.55;
      p.vx *= 0.55;
      p.vy *= 0.55;
      p.x = Math.max(26, Math.min(width - 26, p.x));
      p.y = Math.max(26, Math.min(height - 26, p.y));
    }
  }
  return positions;
}
function GraphView({ graph, loading, error, onReload, onOpenPage }) {
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const types = (0, import_react.useMemo)(() => {
    const set = new Set(typesFromGraph(graph));
    for (const node of nodes) set.add(node.type || "Other");
    return Array.from(set);
  }, [graph, nodes]);
  const [hiddenTypes, setHiddenTypes] = (0, import_react.useState)(() => /* @__PURE__ */ new Set());
  const [search, setSearch] = (0, import_react.useState)("");
  const [selected, setSelected] = (0, import_react.useState)(null);
  const [zoom, setZoom] = (0, import_react.useState)(1);
  const [pan, setPan] = (0, import_react.useState)({ x: 0, y: 0 });
  const [dragging, setDragging] = (0, import_react.useState)(null);
  const positions = (0, import_react.useMemo)(() => layoutGraph(nodes, edges), [nodes, edges]);
  const index = (0, import_react.useMemo)(() => {
    const map = /* @__PURE__ */ new Map();
    nodes.forEach((node, i) => map.set(node.id, i));
    return map;
  }, [nodes]);
  const visible = (0, import_react.useMemo)(
    () => nodes.filter((node) => !hiddenTypes.has(node.type || "Other")),
    [nodes, hiddenTypes]
  );
  const visibleIds = (0, import_react.useMemo)(() => new Set(visible.map((node) => node.id)), [visible]);
  const visibleEdges = (0, import_react.useMemo)(
    () => edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [edges, visibleIds]
  );
  const topLabels = (0, import_react.useMemo)(() => {
    return new Set(
      [...visible].sort((a, b) => (positions[index.get(b.id)]?.degree || 0) - (positions[index.get(a.id)]?.degree || 0)).slice(0, 34).map((node) => node.id)
    );
  }, [visible, positions, index]);
  const matched = (0, import_react.useMemo)(() => {
    const query = search.trim().toLowerCase();
    if (!query) return /* @__PURE__ */ new Set();
    return new Set(
      visible.filter((node) => node.id.toLowerCase().includes(query)).map((node) => node.id)
    );
  }, [visible, search]);
  if (loading) {
    return import_react.default.createElement(
      "div",
      { className: "fk-panel", style: { flex: 1 } },
      import_react.default.createElement(EmptyState, {
        icon: "graph",
        title: "\u6B63\u5728\u52A0\u8F7D\u77E5\u8BC6\u56FE\u8C31\u2026",
        detail: "\u56FE\u8C31\u9700\u8981\u4E0A\u6E38\u8BA1\u7B97\uFF0C\u7B2C\u4E00\u6B21\u6253\u5F00\u901A\u5E38\u9700\u8981\u51E0\u79D2\u5230\u5341\u51E0\u79D2\u3002",
        action: import_react.default.createElement("div", { className: "fk-skeleton", style: { width: 220, height: 10 } })
      })
    );
  }
  if (error) {
    return import_react.default.createElement(
      "div",
      { className: "fk-panel", style: { flex: 1 } },
      import_react.default.createElement(EmptyState, {
        icon: "alert",
        title: "\u77E5\u8BC6\u56FE\u8C31\u52A0\u8F7D\u5931\u8D25",
        detail: error,
        action: import_react.default.createElement(
          "button",
          { type: "button", className: "fk-btn fk-btn-soft", onClick: onReload },
          import_react.default.createElement(Icon, { name: "refresh", size: 14 }),
          "\u91CD\u8BD5"
        )
      })
    );
  }
  if (!nodes.length) {
    return import_react.default.createElement(
      "div",
      { className: "fk-panel", style: { flex: 1 } },
      import_react.default.createElement(EmptyState, {
        icon: "graph",
        title: "\u8FD9\u4E2A\u77E5\u8BC6\u5E93\u8FD8\u6CA1\u6709\u56FE\u8C31",
        detail: "\u5148\u5728\u98DE\u94FE\u540E\u53F0\u5B8C\u6210\u77E5\u8BC6\u7F16\u6392\uFF0C\u56FE\u8C31\u4F1A\u968F\u7F16\u8BD1\u7ED3\u679C\u751F\u6210\u3002",
        action: import_react.default.createElement(
          "button",
          { type: "button", className: "fk-btn fk-btn-soft", onClick: onReload },
          import_react.default.createElement(Icon, { name: "refresh", size: 14 }),
          "\u5237\u65B0"
        )
      })
    );
  }
  const selectedPosition = selected ? positions[index.get(selected.id)] : null;
  const transform = `translate(${pan.x} ${pan.y}) scale(${zoom})`;
  const width = 1e3;
  const height = 680;
  return import_react.default.createElement(
    "div",
    { className: "fk-panel", style: { flex: 1, minHeight: 420 } },
    import_react.default.createElement(
      "div",
      { className: "fk-graph-toolbar" },
      import_react.default.createElement(
        "div",
        { className: "fk-legend" },
        types.map(
          (type) => import_react.default.createElement(
            "button",
            {
              type: "button",
              key: type,
              className: `fk-legend-item ${hiddenTypes.has(type) ? "fk-legend-item-off" : ""}`,
              onClick: () => setHiddenTypes((current) => {
                const next = new Set(current);
                if (next.has(type)) next.delete(type);
                else next.add(type);
                return next;
              })
            },
            import_react.default.createElement("span", {
              className: "fk-dot",
              style: { background: TYPE_COLORS[type] || TYPE_COLORS.Other }
            }),
            TYPE_LABELS[type] || type
          )
        )
      ),
      import_react.default.createElement(
        "div",
        { style: { marginLeft: "auto", display: "flex", gap: 6 } },
        import_react.default.createElement("input", {
          className: "fk-input",
          style: { width: 170, height: 30, padding: "0 9px" },
          placeholder: "\u641C\u7D22\u8282\u70B9\u2026",
          value: search,
          onChange: (event) => setSearch(event.target.value)
        }),
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "fk-btn fk-btn-sm",
            onClick: () => setZoom((value) => Math.min(2.6, value * 1.18))
          },
          "+"
        ),
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "fk-btn fk-btn-sm",
            onClick: () => setZoom((value) => Math.max(0.45, value / 1.18))
          },
          "\u2212"
        ),
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "fk-btn fk-btn-sm",
            onClick: () => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }
          },
          "\u91CD\u7F6E"
        ),
        import_react.default.createElement(
          "button",
          { type: "button", className: "fk-btn fk-btn-sm", onClick: onReload },
          import_react.default.createElement(Icon, { name: "refresh", size: 13 })
        )
      )
    ),
    import_react.default.createElement(
      "div",
      { className: "fk-graph-canvas" },
      import_react.default.createElement(
        "svg",
        {
          className: "fk-graph-svg",
          viewBox: `0 0 ${width} ${height}`,
          onWheel: (event) => {
            event.preventDefault();
            const next = Math.max(0.45, Math.min(2.6, zoom * (event.deltaY < 0 ? 1.08 : 0.92)));
            setZoom(next);
          },
          onPointerDown: (event) => {
            if (event.target.closest(".fk-graph-node")) return;
            setDragging({ x: event.clientX, y: event.clientY, pan });
          },
          onPointerMove: (event) => {
            if (!dragging) return;
            setPan({
              x: dragging.pan.x + (event.clientX - dragging.x),
              y: dragging.pan.y + (event.clientY - dragging.y)
            });
          },
          onPointerUp: () => setDragging(null),
          onPointerLeave: () => setDragging(null)
        },
        import_react.default.createElement(
          "g",
          { transform },
          visibleEdges.slice(0, 9e3).map((edge, i) => {
            const a = positions[index.get(edge.source)];
            const b = positions[index.get(edge.target)];
            if (!a || !b) return null;
            return import_react.default.createElement("line", {
              key: `e-${i}`,
              x1: a.x,
              y1: a.y,
              x2: b.x,
              y2: b.y,
              stroke: "currentColor",
              strokeOpacity: 0.12,
              strokeWidth: 0.7
            });
          }),
          visible.map((node) => {
            const position = positions[index.get(node.id)];
            if (!position) return null;
            const color = TYPE_COLORS[node.type] || TYPE_COLORS.Other;
            const radius = 3.5 + Math.min(7.5, position.degree / 9);
            const isSelected = selected?.id === node.id;
            const isMatched = matched.has(node.id);
            return import_react.default.createElement(
              "g",
              {
                key: node.id,
                className: "fk-graph-node",
                onClick: () => setSelected(node),
                onDoubleClick: () => onOpenPage(node.id)
              },
              import_react.default.createElement("circle", {
                cx: position.x,
                cy: position.y,
                r: isSelected ? radius + 4 : isMatched ? radius + 3 : radius,
                fill: color,
                fillOpacity: isSelected ? 1 : 0.88,
                stroke: isSelected ? "#fff" : "none",
                strokeWidth: isSelected ? 2 : 0
              })
            );
          }),
          visible.filter((node) => topLabels.has(node.id) || matched.has(node.id)).map((node) => {
            const position = positions[index.get(node.id)];
            if (!position) return null;
            const label = node.id.replace(/^.*\//, "").replace(/\.md$/, "").slice(0, 26);
            return import_react.default.createElement(
              "text",
              {
                key: `l-${node.id}`,
                x: position.x + 6,
                y: position.y - 5,
                className: "fk-graph-label",
                fill: matched.has(node.id) ? "var(--fk-primary)" : "var(--fk-muted)",
                fontWeight: matched.has(node.id) ? 700 : 400
              },
              label
            );
          })
        )
      ),
      selected && selectedPosition ? import_react.default.createElement(
        "div",
        { className: "fk-graph-detail" },
        import_react.default.createElement("strong", null, selected.id.replace(/^.*\//, "")),
        import_react.default.createElement(
          "span",
          null,
          `${TYPE_LABELS[selected.type] || selected.type || "\u8282\u70B9"} \xB7 ${selectedPosition.degree} \u6761\u5173\u7CFB`
        ),
        import_react.default.createElement(
          "span",
          { style: { wordBreak: "break-all" } },
          selected.id
        ),
        selected.id.includes("/") || selected.id.endsWith(".md") ? import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "fk-btn fk-btn-sm",
            style: { marginTop: 8 },
            onClick: () => onOpenPage(selected.id)
          },
          import_react.default.createElement(Icon, { name: "book", size: 13 }),
          "\u6253\u5F00\u9875\u9762"
        ) : null
      ) : null
    )
  );
}
function typesFromGraph(graph) {
  return Array.isArray(graph?.types) ? graph.types : [];
}
var PLATFORM_META = {
  feishu: {
    label: "\u98DE\u4E66",
    mode: "\u957F\u8FDE\u63A5",
    hint: "\u98DE\u4E66\u5F00\u653E\u5E73\u53F0 \u2192 \u4F01\u4E1A\u81EA\u5EFA\u5E94\u7528 \u2192 App ID / App Secret"
  },
  lark: {
    label: "Lark",
    mode: "\u957F\u8FDE\u63A5",
    hint: "Lark \u5F00\u653E\u5E73\u53F0 \u2192 \u4F01\u4E1A\u81EA\u5EFA\u5E94\u7528 \u2192 App ID / App Secret\uFF08\u56FD\u9645\u7248\u98DE\u4E66\uFF09"
  },
  dingtalk: {
    label: "\u9489\u9489",
    mode: "Webhook",
    hint: "\u9489\u9489\u5F00\u653E\u5E73\u53F0 \u2192 \u4F01\u4E1A\u5185\u90E8\u5E94\u7528 \u2192 AppKey / AppSecret / Robot Code"
  },
  wecom: {
    label: "\u4F01\u4E1A\u5FAE\u4FE1",
    mode: "\u7FA4\u901A\u77E5",
    hint: "\u4F01\u4E1A\u5FAE\u4FE1\u7FA4 \u2192 \u7FA4\u673A\u5668\u4EBA \u2192 Webhook \u5730\u5740\uFF08\u4EC5\u901A\u77E5\uFF09"
  },
  weixin: {
    label: "\u5FAE\u4FE1",
    mode: "\u626B\u7801\u7ED1\u5B9A",
    hint: "\u4E2A\u4EBA\u5FAE\u4FE1\u626B\u7801\u7ED1\u5B9A\uFF0C\u76F4\u63A5\u5728\u5FAE\u4FE1\u79C1\u804A\u91CC\u95EE\u7B54\uFF1B\u4E0D\u9700\u8981 App ID / App Secret"
  },
  telegram: {
    label: "Telegram",
    mode: "Bot Token",
    hint: "Telegram \u91CC\u627E @BotFather \u2192 /newbot \u2192 \u590D\u5236 Bot Token"
  }
};
function TelegramBindDialog({ bot, knowledgeBases, onClose, onBound, onToast, onNeedLogin }) {
  const editing = Boolean(bot?.id);
  const [form, setForm] = (0, import_react.useState)({
    name: bot?.name || "Telegram \u673A\u5668\u4EBA",
    token: "",
    knowledge_base_ids: bot?.knowledge_base_ids?.length ? bot.knowledge_base_ids : knowledgeBases[0]?.id ? [knowledgeBases[0].id] : [],
    system_prompt: bot?.system_prompt || "",
    write_enabled: Boolean(bot?.write_enabled)
  });
  const [phase, setPhase] = (0, import_react.useState)("form");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)("");
  const toggleKb = (id) => {
    setForm((current) => {
      const set = new Set(current.knowledge_base_ids);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...current, knowledge_base_ids: Array.from(set) };
    });
  };
  const bind = async () => {
    if (!form.name.trim()) {
      setError("\u8BF7\u586B\u5199\u673A\u5668\u4EBA\u540D\u79F0");
      return;
    }
    if (!form.token.trim()) {
      setError("\u8BF7\u586B\u5199 Bot Token");
      return;
    }
    if (!form.knowledge_base_ids.length) {
      setError("\u81F3\u5C11\u6388\u6743\u4E00\u4E2A\u77E5\u8BC6\u5E93");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/telegram/bind", {
        method: "POST",
        body: JSON.stringify({
          ...editing ? { id: bot.id } : {},
          name: form.name.trim(),
          token: form.token.trim(),
          knowledge_base_ids: form.knowledge_base_ids,
          system_prompt: form.system_prompt,
          write_enabled: Boolean(form.write_enabled)
        })
      });
      setPhase("success");
      onToast?.(`Telegram \u673A\u5668\u4EBA\u300C${form.name.trim()}\u300D\u7ED1\u5B9A\u6210\u529F`);
      onBound?.();
    } catch (caught) {
      if (caught.status === 401) onNeedLogin?.();
      else setError(caught.message || "Telegram \u7ED1\u5B9A\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  return import_react.default.createElement(
    "div",
    {
      className: "fk-modal-backdrop",
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) onClose();
      }
    },
    import_react.default.createElement(
      "div",
      { className: "fk-modal" },
      import_react.default.createElement(
        "div",
        { className: "fk-modal-head" },
        import_react.default.createElement(
          "div",
          null,
          import_react.default.createElement(
            "div",
            { className: "fk-modal-title" },
            editing ? "\u91CD\u65B0\u7ED1\u5B9A Telegram" : "\u7ED1\u5B9A Telegram"
          ),
          import_react.default.createElement(
            "div",
            { className: "fk-sub", style: { marginTop: 3 } },
            "Telegram Bot Token \u53EA\u5199\u5165\u4FDD\u5B58\uFF0C\u4E0D\u56DE\u663E\uFF1B\u7ED1\u5B9A\u540E\u7531\u98DE\u94FE\u540E\u53F0\u957F\u8F6E\u8BE2\u3002"
          )
        ),
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "fk-btn fk-btn-icon fk-modal-close",
            onClick: onClose,
            "aria-label": "\u5173\u95ED"
          },
          import_react.default.createElement(Icon, { name: "close", size: 15 })
        )
      ),
      phase === "success" ? import_react.default.createElement(
        "div",
        { style: { textAlign: "center", padding: "16px 6px 8px" } },
        import_react.default.createElement(Icon, { name: "check", size: 40 }),
        import_react.default.createElement(
          "div",
          { style: { fontSize: 16, fontWeight: 700, marginTop: 8 } },
          "Telegram \u7ED1\u5B9A\u6210\u529F"
        ),
        import_react.default.createElement(
          "div",
          { className: "fk-sub", style: { marginTop: 6, lineHeight: 1.7 } },
          `\u73B0\u5728\u53EF\u4EE5\u5728 Telegram \u91CC\u7ED9\u300C${form.name.trim()}\u300D\u53D1\u6D88\u606F\u63D0\u95EE\u3002`
        ),
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "fk-btn fk-btn-primary",
            style: { marginTop: 14 },
            onClick: onClose
          },
          "\u5B8C\u6210"
        )
      ) : import_react.default.createElement(
        import_react.default.Fragment,
        null,
        import_react.default.createElement(
          "label",
          { className: "fk-label" },
          "\u673A\u5668\u4EBA\u540D\u79F0",
          import_react.default.createElement("input", {
            className: "fk-input",
            value: form.name,
            placeholder: "\u4F8B\u5982\uFF1A\u5C0F\u96C5 Telegram",
            onChange: (event) => setForm({ ...form, name: event.target.value })
          })
        ),
        import_react.default.createElement(
          "label",
          { className: "fk-label" },
          editing ? "\u65B0\u7684 Bot Token\uFF08\u91CD\u65B0\u7ED1\u5B9A\u5FC5\u586B\uFF09" : "Bot Token",
          import_react.default.createElement("input", {
            className: "fk-input",
            type: "password",
            value: form.token,
            placeholder: "123456789:AA...",
            onChange: (event) => setForm({ ...form, token: event.target.value })
          }),
          import_react.default.createElement(
            "div",
            { className: "fk-sub", style: { marginTop: 4 } },
            "\u5728 Telegram \u641C\u7D22 @BotFather \u2192 /newbot \u2192 \u590D\u5236 Bot Token\u3002"
          )
        ),
        import_react.default.createElement(
          "div",
          { className: "fk-label" },
          "\u6388\u6743\u77E5\u8BC6\u5E93",
          import_react.default.createElement(
            "div",
            {
              style: {
                border: "1px solid var(--fk-border)",
                borderRadius: 10,
                padding: "4px 10px",
                maxHeight: 170,
                overflow: "auto"
              }
            },
            knowledgeBases.map(
              (kb) => import_react.default.createElement(
                "label",
                { className: "fk-check", key: kb.id },
                import_react.default.createElement("input", {
                  type: "checkbox",
                  checked: form.knowledge_base_ids.includes(kb.id),
                  onChange: () => toggleKb(kb.id)
                }),
                import_react.default.createElement(
                  "span",
                  null,
                  kb.name,
                  import_react.default.createElement("small", null, kb.openkb_status || "\u77E5\u8BC6\u5E93")
                )
              )
            )
          )
        ),
        import_react.default.createElement(
          "label",
          { className: "fk-label" },
          "\u7CFB\u7EDF\u63D0\u793A\u8BCD",
          import_react.default.createElement("textarea", {
            className: "fk-textarea",
            rows: 4,
            value: form.system_prompt,
            placeholder: "\u4F8B\u5982\uFF1A\u4F60\u662F\u5170\u4EAD\u96C5\u5C45\u7684\u5BA2\u670D\u52A9\u624B\uFF0C\u56DE\u7B54\u8981\u7B80\u6D01\u3001\u5F15\u7528\u77E5\u8BC6\u5E93\u6765\u6E90\uFF0C\u4E0D\u8981\u7F16\u9020\u3002",
            onChange: (event) => setForm({ ...form, system_prompt: event.target.value })
          })
        ),
        import_react.default.createElement(
          "label",
          { className: "fk-check" },
          import_react.default.createElement("input", {
            type: "checkbox",
            checked: form.write_enabled,
            onChange: (event) => setForm({ ...form, write_enabled: event.target.checked })
          }),
          import_react.default.createElement(
            "span",
            null,
            "\u5141\u8BB8\u673A\u5668\u4EBA\u5199\u56DE\u77E5\u8BC6\u5E93",
            import_react.default.createElement("small", null, "\u5199\u56DE\u4F1A\u8FDB\u5165\u6765\u6E90\u4E0A\u4F20\u6216\u53D8\u66F4\u5BA1\u6279\u6D41\u7A0B\u3002")
          )
        ),
        import_react.default.createElement(
          "div",
          { className: "fk-tutorial-note", style: { marginTop: 12, lineHeight: 1.7 } },
          "Telegram \u7FA4\u804A\u9ED8\u8BA4\u53EA\u63A5\u6536 @\u673A\u5668\u4EBA \u6216\u547D\u4EE4\u6D88\u606F\uFF1B\u9700\u8981\u80FD\u8BBF\u95EE api.telegram.org\u3002"
        ),
        error ? import_react.default.createElement(
          "div",
          { className: "fk-sub", style: { color: "var(--fk-red)", marginTop: 10 } },
          error
        ) : null,
        import_react.default.createElement("div", { className: "fk-divider", style: { marginTop: 16 } }),
        import_react.default.createElement(
          "div",
          { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
          import_react.default.createElement(
            "button",
            { type: "button", className: "fk-btn", onClick: onClose },
            "\u53D6\u6D88"
          ),
          import_react.default.createElement(
            "button",
            {
              type: "button",
              className: "fk-btn fk-btn-primary",
              disabled: busy,
              onClick: bind
            },
            busy ? "\u7ED1\u5B9A\u4E2D\u2026" : editing ? "\u91CD\u65B0\u7ED1\u5B9A" : "\u7ED1\u5B9A Telegram"
          )
        )
      )
    )
  );
}
function WeixinBindDialog({ bot, knowledgeBases, onClose, onBound, onToast, onNeedLogin }) {
  const editing = Boolean(bot?.id);
  const [form, setForm] = (0, import_react.useState)({
    name: bot?.name || "\u5FAE\u4FE1\u673A\u5668\u4EBA",
    knowledge_base_ids: bot?.knowledge_base_ids?.length ? bot.knowledge_base_ids : knowledgeBases[0]?.id ? [knowledgeBases[0].id] : [],
    system_prompt: bot?.system_prompt || "",
    write_enabled: Boolean(bot?.write_enabled)
  });
  const [phase, setPhase] = (0, import_react.useState)("form");
  const [qr, setQr] = (0, import_react.useState)(null);
  const [qrImage, setQrImage] = (0, import_react.useState)("");
  const [status, setStatus] = (0, import_react.useState)("pending");
  const [error, setError] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const timerRef = (0, import_react.useRef)(null);
  const stopPolling = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  (0, import_react.useEffect)(() => () => stopPolling(), []);
  const toggleKb = (id) => {
    setForm((current) => {
      const set = new Set(current.knowledge_base_ids);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...current, knowledge_base_ids: Array.from(set) };
    });
  };
  const poll = (qrcode) => {
    stopPolling();
    timerRef.current = setTimeout(async () => {
      try {
        const result = await api(
          `/weixin/qr/status?qrcode=${encodeURIComponent(qrcode)}`
        );
        setStatus(result.status || "pending");
        if (result.status === "success") {
          stopPolling();
          setPhase("success");
          onToast?.("\u5FAE\u4FE1\u673A\u5668\u4EBA\u7ED1\u5B9A\u6210\u529F");
          onBound?.();
          return;
        }
        if (result.status === "expired" || result.status === "error") {
          setPhase("form");
          setError(result.message || "\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210");
          setQr(null);
          setQrImage("");
          return;
        }
        poll(qrcode);
      } catch (caught) {
        if (caught.status === 404) {
          setPhase("form");
          setError("\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210");
          return;
        }
        if (caught.status === 401) {
          onNeedLogin?.();
          return;
        }
        setError(caught.message || "\u626B\u7801\u72B6\u6001\u67E5\u8BE2\u5931\u8D25");
        timerRef.current = setTimeout(() => poll(qrcode), 3e3);
      }
    }, 2e3);
  };
  const generate = async () => {
    if (!form.name.trim()) {
      setError("\u8BF7\u586B\u5199\u673A\u5668\u4EBA\u540D\u79F0");
      return;
    }
    if (!form.knowledge_base_ids.length) {
      setError("\u81F3\u5C11\u6388\u6743\u4E00\u4E2A\u77E5\u8BC6\u5E93");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api("/weixin/qr", {
        method: "POST",
        body: JSON.stringify({
          ...editing ? { id: bot.id } : {},
          name: form.name.trim(),
          knowledge_base_ids: form.knowledge_base_ids,
          system_prompt: form.system_prompt,
          write_enabled: Boolean(form.write_enabled)
        })
      });
      setQr(result);
      setPhase("qr");
      setStatus("pending");
      try {
        const dataUrl = await import_qrcode.default.toDataURL(result.qr_url, {
          width: 520,
          margin: 1,
          color: { dark: "#111827", light: "#ffffff" }
        });
        setQrImage(dataUrl);
      } catch {
        setError("\u4E8C\u7EF4\u7801\u751F\u6210\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
      }
      poll(result.qrcode);
    } catch (caught) {
      if (caught.status === 401) onNeedLogin?.();
      else setError(caught.message || "\u4E8C\u7EF4\u7801\u751F\u6210\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  const statusText = status === "scanned" ? "\u5DF2\u626B\u7801\uFF0C\u8BF7\u5728\u624B\u673A\u4E0A\u786E\u8BA4" : status === "success" ? "\u7ED1\u5B9A\u6210\u529F" : status === "expired" ? "\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F" : "\u7B49\u5F85\u626B\u7801";
  return /* @__PURE__ */ import_react.default.createElement(
    "div",
    {
      className: "fk-modal-backdrop",
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) {
          stopPolling();
          onClose();
        }
      }
    },
    /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-modal", style: { maxWidth: 590 } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-modal-head" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-modal-title" }, editing ? "\u91CD\u65B0\u7ED1\u5B9A\u5FAE\u4FE1" : "\u7ED1\u5B9A\u5FAE\u4FE1\u673A\u5668\u4EBA"), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-sub", style: { marginTop: 3 } }, "\u4E2A\u4EBA\u5FAE\u4FE1\u626B\u7801\u767B\u5F55\uFF0C\u4E0D\u662F\u4F01\u4E1A\u5FAE\u4FE1\uFF1B\u7ED1\u5B9A\u540E\u76F4\u63A5\u5728\u5FAE\u4FE1\u79C1\u804A\u91CC\u63D0\u95EE\u3002")), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "fk-btn fk-btn-icon fk-modal-close",
        onClick: () => {
          stopPolling();
          onClose();
        },
        "aria-label": "\u5173\u95ED"
      },
      /* @__PURE__ */ import_react.default.createElement(Icon, { name: "close", size: 15 })
    )), phase === "success" ? /* @__PURE__ */ import_react.default.createElement("div", { style: { textAlign: "center", padding: "18px 6px 8px" } }, /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        style: {
          width: 56,
          height: 56,
          borderRadius: 28,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--fk-primary-soft)",
          color: "var(--fk-primary)",
          marginBottom: 12
        }
      },
      /* @__PURE__ */ import_react.default.createElement(Icon, { name: "check", size: 26 })
    ), /* @__PURE__ */ import_react.default.createElement("div", { style: { fontSize: 16, fontWeight: 700 } }, "\u5FAE\u4FE1\u7ED1\u5B9A\u6210\u529F"), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-sub", style: { marginTop: 6, lineHeight: 1.7 } }, "\u73B0\u5728\u53EF\u4EE5\u5728\u5FAE\u4FE1\u91CC\u76F4\u63A5\u7ED9\u300C", form.name.trim(), "\u300D\u53D1\u6D88\u606F\u63D0\u95EE\uFF1B \u673A\u5668\u4EBA\u4F1A\u6309\u5DF2\u6388\u6743\u7684\u77E5\u8BC6\u5E93\u56DE\u7B54\u3002\u5FAE\u4FE1\u91CC\u6682\u4E0D\u652F\u6301\u56FE\u7247\u548C\u89C6\u9891\u4EFB\u52A1\u5361\u3002"), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "fk-btn fk-btn-primary",
        style: { marginTop: 16 },
        onClick: onClose
      },
      "\u5B8C\u6210"
    )) : phase === "qr" ? /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        style: {
          display: "flex",
          gap: 18,
          alignItems: "center",
          flexWrap: "wrap",
          padding: "6px 0 4px"
        }
      },
      /* @__PURE__ */ import_react.default.createElement(
        "div",
        {
          style: {
            width: 248,
            height: 248,
            padding: 10,
            borderRadius: 16,
            border: "1px solid var(--fk-border)",
            background: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 auto"
          }
        },
        qrImage ? /* @__PURE__ */ import_react.default.createElement(
          "img",
          {
            src: qrImage,
            alt: "\u5FAE\u4FE1\u7ED1\u5B9A\u4E8C\u7EF4\u7801",
            style: { width: 228, height: 228, display: "block" }
          }
        ) : /* @__PURE__ */ import_react.default.createElement("span", { className: "fk-sub" }, "\u6B63\u5728\u751F\u6210\u4E8C\u7EF4\u7801\u2026")
      ),
      /* @__PURE__ */ import_react.default.createElement("div", { style: { flex: 1, minWidth: 200 } }, /* @__PURE__ */ import_react.default.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, statusText), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-sub", style: { marginTop: 8, lineHeight: 1.7 } }, "\u6253\u5F00\u624B\u673A\u5FAE\u4FE1 \u2192 \u626B\u4E00\u626B \u2192 \u626B\u63CF\u5DE6\u4FA7\u4E8C\u7EF4\u7801 \u2192 \u5728\u624B\u673A\u4E0A\u786E\u8BA4\u767B\u5F55\u3002 \u4E8C\u7EF4\u7801\u7EA6 2 \u5206\u949F\u5185\u6709\u6548\u3002"), /* @__PURE__ */ import_react.default.createElement(
        "div",
        {
          className: "fk-sub",
          style: { marginTop: 10, lineHeight: 1.6, color: "var(--fk-amber)" }
        },
        "\u4E2A\u4EBA\u5FAE\u4FE1\u673A\u5668\u4EBA\u53D7\u5FAE\u4FE1\u5E73\u53F0\u89C4\u5219\u7EA6\u675F\uFF1B\u5982\u679C\u63D0\u793A\u98CE\u9669\uFF0C\u8BF7\u6539\u7528\u4F01\u4E1A\u5FAE\u4FE1\u6216\u98DE\u4E66\u3002"
      ))
    ), error ? /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-sub", style: { color: "var(--fk-red)", marginTop: 10 } }, error) : null, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-divider", style: { marginTop: 16 } }), /* @__PURE__ */ import_react.default.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 8 } }, /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "fk-btn",
        onClick: () => {
          stopPolling();
          setPhase("form");
          setQr(null);
          setQrImage("");
          setError("");
        }
      },
      "\u8FD4\u56DE\u4FEE\u6539"
    ), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "fk-btn fk-btn-primary",
        disabled: busy,
        onClick: generate
      },
      busy ? "\u751F\u6210\u4E2D\u2026" : "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801"
    ))) : /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("label", { className: "fk-label" }, "\u673A\u5668\u4EBA\u540D\u79F0", /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        className: "fk-input",
        value: form.name,
        placeholder: "\u4F8B\u5982\uFF1A\u5C0F\u96C5",
        onChange: (event) => setForm({ ...form, name: event.target.value })
      }
    )), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-label" }, "\u6388\u6743\u77E5\u8BC6\u5E93", /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        style: {
          border: "1px solid var(--fk-border)",
          borderRadius: 10,
          padding: "4px 10px",
          maxHeight: 180,
          overflow: "auto"
        }
      },
      knowledgeBases.map((kb) => /* @__PURE__ */ import_react.default.createElement("label", { className: "fk-check", key: kb.id }, /* @__PURE__ */ import_react.default.createElement(
        "input",
        {
          type: "checkbox",
          checked: form.knowledge_base_ids.includes(kb.id),
          onChange: () => toggleKb(kb.id)
        }
      ), /* @__PURE__ */ import_react.default.createElement("span", null, kb.name, /* @__PURE__ */ import_react.default.createElement("small", null, kb.openkb_status || "\u77E5\u8BC6\u5E93"))))
    )), /* @__PURE__ */ import_react.default.createElement("label", { className: "fk-label" }, "\u7CFB\u7EDF\u63D0\u793A\u8BCD", /* @__PURE__ */ import_react.default.createElement(
      "textarea",
      {
        className: "fk-textarea",
        rows: 4,
        value: form.system_prompt,
        placeholder: "\u4F8B\u5982\uFF1A\u4F60\u662F\u5170\u4EAD\u96C5\u5C45\u7684\u5BA2\u670D\u52A9\u624B\uFF0C\u56DE\u7B54\u8981\u7B80\u6D01\u3001\u5F15\u7528\u77E5\u8BC6\u5E93\u6765\u6E90\uFF0C\u4E0D\u8981\u7F16\u9020\u3002",
        onChange: (event) => setForm({ ...form, system_prompt: event.target.value })
      }
    )), /* @__PURE__ */ import_react.default.createElement("label", { className: "fk-check" }, /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        type: "checkbox",
        checked: form.write_enabled,
        onChange: (event) => setForm({ ...form, write_enabled: event.target.checked })
      }
    ), /* @__PURE__ */ import_react.default.createElement("span", null, "\u5141\u8BB8\u673A\u5668\u4EBA\u5199\u56DE\u77E5\u8BC6\u5E93", /* @__PURE__ */ import_react.default.createElement("small", null, "\u5199\u56DE\u4F1A\u8FDB\u5165\u6765\u6E90\u4E0A\u4F20\u6216\u53D8\u66F4\u5BA1\u6279\u6D41\u7A0B\uFF0C\u4E0D\u4F1A\u76F4\u63A5\u53D1\u5E03\u3002"))), /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        className: "fk-tutorial-note",
        style: { marginTop: 12, lineHeight: 1.7 }
      },
      "\u5FAE\u4FE1\u4E2A\u4EBA\u53F7\u901A\u8FC7\u626B\u7801\u7ED1\u5B9A\uFF0C\u4E0D\u9700\u8981 App ID / App Secret\u3002\u7ED1\u5B9A\u540E\u4EC5\u652F\u6301\u79C1\u804A\u6587\u5B57\u95EE\u7B54\uFF1B \u7FA4\u804A\u3001\u56FE\u7247\u3001\u6587\u4EF6\u3001\u89C6\u9891\u4EFB\u52A1\u5361\u8BF7\u4F7F\u7528\u98DE\u4E66\u6216\u9489\u9489\u673A\u5668\u4EBA\u3002"
    ), error ? /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-sub", style: { color: "var(--fk-red)", marginTop: 10 } }, error) : null, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-divider", style: { marginTop: 16 } }), /* @__PURE__ */ import_react.default.createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } }, /* @__PURE__ */ import_react.default.createElement("button", { type: "button", className: "fk-btn", onClick: onClose }, "\u53D6\u6D88"), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "fk-btn fk-btn-primary",
        disabled: busy,
        onClick: generate
      },
      busy ? "\u751F\u6210\u4E2D\u2026" : "\u751F\u6210\u7ED1\u5B9A\u4E8C\u7EF4\u7801"
    ))))
  );
}
function BotEditor({ bot, knowledgeBases, onClose, onSaved }) {
  const editing = Boolean(bot?.id);
  const initialPlatform = bot?.platform && PLATFORM_META[bot.platform] ? bot.platform : "feishu";
  const [platform, setPlatform] = (0, import_react.useState)(initialPlatform);
  const [form, setForm] = (0, import_react.useState)({
    name: bot?.name || "",
    app_id: bot?.app_id || "",
    app_secret: "",
    robot_code: bot?.robot_code || "",
    signing_secret: "",
    notification_webhook_url: "",
    knowledge_base_ids: bot?.knowledge_base_ids?.length ? bot.knowledge_base_ids : knowledgeBases[0]?.id ? [knowledgeBases[0].id] : [],
    system_prompt: bot?.system_prompt || "",
    write_enabled: Boolean(bot?.write_enabled)
  });
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)("");
  const isWecom = platform === "wecom";
  const isDingtalk = platform === "dingtalk";
  const isWeixin = platform === "weixin";
  const isTelegram = platform === "telegram";
  const isLark = platform === "lark";
  const meta = PLATFORM_META[platform] || PLATFORM_META.feishu;
  const toggleKb = (id) => {
    setForm((current) => {
      const set = new Set(current.knowledge_base_ids);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...current, knowledge_base_ids: Array.from(set) };
    });
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const body = {
        id: bot?.id,
        platform,
        name: form.name.trim(),
        ...isWecom ? form.notification_webhook_url.trim() ? { notification_webhook_url: form.notification_webhook_url.trim() } : {} : isWeixin || isTelegram ? {
          knowledge_base_ids: form.knowledge_base_ids,
          system_prompt: form.system_prompt,
          write_enabled: Boolean(form.write_enabled)
        } : {
          app_id: form.app_id.trim(),
          ...form.app_secret.trim() ? { app_secret: form.app_secret.trim() } : {},
          knowledge_base_ids: form.knowledge_base_ids,
          system_prompt: form.system_prompt,
          write_enabled: Boolean(form.write_enabled),
          ...isDingtalk ? {
            robot_code: form.robot_code.trim(),
            ...form.signing_secret.trim() ? { signing_secret: form.signing_secret.trim() } : {}
          } : {}
        }
      };
      await api("/connectors/save", {
        method: "POST",
        body: JSON.stringify(body)
      });
      onSaved();
    } catch (caught) {
      setError(caught.message || "\u4FDD\u5B58\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  const valid = Boolean(form.name.trim()) && (isWecom ? editing || Boolean(form.notification_webhook_url.trim()) : isWeixin || isTelegram ? form.knowledge_base_ids.length > 0 : Boolean(form.app_id.trim()) && form.knowledge_base_ids.length > 0 && (editing ? true : Boolean(form.app_secret.trim()) && (!isDingtalk || Boolean(form.robot_code.trim()) && Boolean(form.signing_secret.trim()))));
  return /* @__PURE__ */ import_react.default.createElement(
    "div",
    {
      className: "fk-modal-backdrop",
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) onClose();
      }
    },
    /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-modal" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-modal-head" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-modal-title" }, editing ? "\u7F16\u8F91\u673A\u5668\u4EBA" : "\u6DFB\u52A0\u673A\u5668\u4EBA"), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-sub", style: { marginTop: 3 } }, editing ? `\u5F53\u524D\u5E73\u53F0\uFF1A${meta.label} \xB7 ${meta.mode}` : "\u9009\u62E9\u5E73\u53F0\u540E\u586B\u5199\u5BF9\u5E94\u51ED\u8BC1\uFF1B\u654F\u611F\u51ED\u8BC1\u53EA\u5199\u5165\uFF0C\u4E0D\u56DE\u663E\u3002")), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "fk-btn fk-btn-icon fk-modal-close",
        onClick: onClose,
        "aria-label": "\u5173\u95ED"
      },
      /* @__PURE__ */ import_react.default.createElement(Icon, { name: "close", size: 15 })
    )), editing || isWeixin || isTelegram ? null : /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-seg" }, Object.entries(PLATFORM_META).filter(([key]) => !["weixin", "telegram"].includes(key)).map(([key, item]) => /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        key,
        type: "button",
        className: `fk-seg-item ${platform === key ? "fk-seg-item-active" : ""}`,
        onClick: () => setPlatform(key)
      },
      item.label
    ))), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-sub", style: { marginBottom: 14, lineHeight: 1.6 } }, meta.hint), /* @__PURE__ */ import_react.default.createElement("label", { className: "fk-label" }, "\u673A\u5668\u4EBA\u540D\u79F0", /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        className: "fk-input",
        value: form.name,
        placeholder: isWecom ? "\u4F8B\u5982\uFF1A\u5170\u4EAD\u96C5\u5C45\u7FA4\u901A\u77E5" : "\u4F8B\u5982\uFF1A\u5C0F\u96C5",
        onChange: (event) => setForm({ ...form, name: event.target.value })
      }
    )), isWecom ? /* @__PURE__ */ import_react.default.createElement("label", { className: "fk-label" }, editing ? "\u7FA4\u673A\u5668\u4EBA Webhook \u5730\u5740\uFF08\u7559\u7A7A\u4FDD\u6301\u4E0D\u53D8\uFF09" : "\u7FA4\u673A\u5668\u4EBA Webhook \u5730\u5740", /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        className: "fk-input",
        value: form.notification_webhook_url,
        placeholder: editing ? "\u5DF2\u914D\u7F6E\uFF0C\u7559\u7A7A\u4E0D\u4FEE\u6539" : "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...",
        onChange: (event) => setForm({ ...form, notification_webhook_url: event.target.value })
      }
    )) : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, isWeixin || isTelegram ? /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-tutorial-note", style: { marginBottom: 12, lineHeight: 1.7 } }, isTelegram ? "Telegram \u901A\u8FC7 Bot Token \u7ED1\u5B9A\uFF1B\u8FD9\u91CC\u53EA\u8C03\u6574\u77E5\u8BC6\u5E93\u548C\u56DE\u590D\u7B56\u7565\u3002\u9700\u8981\u6362\u7ED1\u65F6\uFF0C\u5173\u95ED\u672C\u7A97\u53E3\uFF0C\u5728\u5361\u7247\u4E0A\u70B9\u300C\u91CD\u65B0\u7ED1\u5B9A\u300D\u3002" : "\u5FAE\u4FE1\u901A\u8FC7\u626B\u7801\u7ED1\u5B9A\uFF1B\u8FD9\u91CC\u53EA\u8C03\u6574\u77E5\u8BC6\u5E93\u548C\u56DE\u590D\u7B56\u7565\u3002\u9700\u8981\u6362\u7ED1\u5FAE\u4FE1\u65F6\uFF0C\u5173\u95ED\u672C\u7A97\u53E3\uFF0C\u5728\u5361\u7247\u4E0A\u70B9\u300C\u91CD\u65B0\u626B\u7801\u300D\u3002") : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("label", { className: "fk-label" }, isDingtalk ? "\u9489\u9489 AppKey\uFF08App ID\uFF09" : isLark ? "Lark App ID" : "\u98DE\u4E66 App ID", /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        className: "fk-input",
        value: form.app_id,
        placeholder: isDingtalk ? "dingxxxxxxxx" : "cli_xxxxxxxxx",
        onChange: (event) => setForm({ ...form, app_id: event.target.value })
      }
    )), /* @__PURE__ */ import_react.default.createElement("label", { className: "fk-label" }, editing ? `${isDingtalk ? "\u9489\u9489 AppSecret" : isLark ? "Lark App Secret" : "\u98DE\u4E66 App Secret"}\uFF08\u7559\u7A7A\u4FDD\u6301\u4E0D\u53D8\uFF09` : isDingtalk ? "\u9489\u9489 AppSecret" : isLark ? "Lark App Secret" : "\u98DE\u4E66 App Secret", /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        className: "fk-input",
        type: "password",
        value: form.app_secret,
        placeholder: editing ? "\u5DF2\u914D\u7F6E\uFF0C\u7559\u7A7A\u4E0D\u4FEE\u6539" : "\u7C98\u8D34\u5E94\u7528\u51ED\u8BC1",
        onChange: (event) => setForm({ ...form, app_secret: event.target.value })
      }
    )), isDingtalk ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("label", { className: "fk-label" }, "Robot Code", /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        className: "fk-input",
        value: form.robot_code,
        placeholder: "\u673A\u5668\u4EBA\u8BBE\u7F6E\u4E2D\u7684 Robot Code",
        onChange: (event) => setForm({ ...form, robot_code: event.target.value })
      }
    )), /* @__PURE__ */ import_react.default.createElement("label", { className: "fk-label" }, editing ? "\u4E8B\u4EF6\u7B7E\u540D/\u52A0\u5BC6\u5BC6\u94A5\uFF08\u7559\u7A7A\u4FDD\u6301\u4E0D\u53D8\uFF09" : "\u4E8B\u4EF6\u7B7E\u540D/\u52A0\u5BC6\u5BC6\u94A5", /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        className: "fk-input",
        type: "password",
        value: form.signing_secret,
        placeholder: editing ? "\u5DF2\u914D\u7F6E\uFF0C\u7559\u7A7A\u4E0D\u4FEE\u6539" : "\u9489\u9489\u5F00\u653E\u5E73\u53F0\u4E8B\u4EF6\u8BA2\u9605\u7684\u52A0\u7B7E\u5BC6\u94A5",
        onChange: (event) => setForm({ ...form, signing_secret: event.target.value })
      }
    ))) : null), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-label" }, "\u6388\u6743\u77E5\u8BC6\u5E93", /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        style: {
          border: "1px solid var(--fk-border)",
          borderRadius: 10,
          padding: "4px 10px",
          maxHeight: 160,
          overflow: "auto"
        }
      },
      knowledgeBases.map((kb) => /* @__PURE__ */ import_react.default.createElement("label", { className: "fk-check", key: kb.id }, /* @__PURE__ */ import_react.default.createElement(
        "input",
        {
          type: "checkbox",
          checked: form.knowledge_base_ids.includes(kb.id),
          onChange: () => toggleKb(kb.id)
        }
      ), /* @__PURE__ */ import_react.default.createElement("span", null, kb.name, /* @__PURE__ */ import_react.default.createElement("small", null, kb.openkb_status || "\u77E5\u8BC6\u5E93"))))
    )), /* @__PURE__ */ import_react.default.createElement("label", { className: "fk-label" }, "\u7CFB\u7EDF\u63D0\u793A\u8BCD", /* @__PURE__ */ import_react.default.createElement(
      "textarea",
      {
        className: "fk-textarea",
        rows: 4,
        value: form.system_prompt,
        placeholder: "\u4F8B\u5982\uFF1A\u4F60\u662F\u5170\u4EAD\u96C5\u5C45\u7684\u5BA2\u670D\u52A9\u624B\uFF0C\u56DE\u7B54\u8981\u7B80\u6D01\u3001\u5F15\u7528\u77E5\u8BC6\u5E93\u6765\u6E90\uFF0C\u4E0D\u8981\u7F16\u9020\u3002",
        onChange: (event) => setForm({ ...form, system_prompt: event.target.value })
      }
    )), /* @__PURE__ */ import_react.default.createElement("label", { className: "fk-check" }, /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        type: "checkbox",
        checked: form.write_enabled,
        onChange: (event) => setForm({ ...form, write_enabled: event.target.checked })
      }
    ), /* @__PURE__ */ import_react.default.createElement("span", null, "\u5141\u8BB8\u673A\u5668\u4EBA\u5199\u56DE\u77E5\u8BC6\u5E93", /* @__PURE__ */ import_react.default.createElement("small", null, "\u5199\u56DE\u4F1A\u8FDB\u5165\u6765\u6E90\u4E0A\u4F20\u6216\u53D8\u66F4\u5BA1\u6279\u6D41\u7A0B\uFF0C\u4E0D\u4F1A\u76F4\u63A5\u53D1\u5E03\u3002")))), isWecom ? /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-tutorial-note", style: { marginTop: 4 } }, "\u4F01\u4E1A\u5FAE\u4FE1\u5F53\u524D\u4EC5\u652F\u6301\u7FA4\u673A\u5668\u4EBA Webhook \u901A\u77E5\uFF08\u53D1\u9001\u6D88\u606F\uFF09\uFF0C\u4E0D\u652F\u6301\u95EE\u7B54\u3002\u9700\u8981\u95EE\u7B54\u8BF7\u4F7F\u7528\u98DE\u4E66\u3001\u9489\u9489\u6216\u5FAE\u4FE1\u4E2A\u4EBA\u53F7\u673A\u5668\u4EBA\u3002") : null, error ? /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-sub", style: { color: "var(--fk-red)", marginTop: 10 } }, error) : null, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-divider", style: { marginTop: 16 } }), /* @__PURE__ */ import_react.default.createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } }, /* @__PURE__ */ import_react.default.createElement("button", { type: "button", className: "fk-btn", onClick: onClose }, "\u53D6\u6D88"), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "fk-btn fk-btn-primary",
        disabled: busy || !valid,
        onClick: save
      },
      busy ? "\u4FDD\u5B58\u4E2D\u2026" : editing ? "\u4FDD\u5B58\u4FEE\u6539" : "\u6DFB\u52A0\u673A\u5668\u4EBA"
    )))
  );
}
function BotTutorial({ onClose }) {
  const [tab, setTab] = (0, import_react.useState)("feishu");
  const steps = {
    feishu: [
      "\u6253\u5F00\u98DE\u4E66\u5F00\u653E\u5E73\u53F0 \u2192 \u5F00\u53D1\u8005\u540E\u53F0 \u2192 \u521B\u5EFA\u4F01\u4E1A\u81EA\u5EFA\u5E94\u7528\u3002",
      "\u51ED\u8BC1\u4E0E\u57FA\u7840\u4FE1\u606F \u2192 \u590D\u5236 App ID \u548C App Secret\u3002",
      "\u6DFB\u52A0\u5E94\u7528\u80FD\u529B \u2192 \u673A\u5668\u4EBA\uFF1B\u4E8B\u4EF6\u4E0E\u56DE\u8C03 \u2192 \u4F7F\u7528\u957F\u8FDE\u63A5\u63A5\u6536\u4E8B\u4EF6\uFF0C\u8BA2\u9605 im.message.receive_v1\u3002",
      "\u6743\u9650\u7BA1\u7406\u5F00\u901A im:message\u3001im:message:send_as_bot\u3001im:chat \u7B49\u6743\u9650\uFF1B\u521B\u5EFA\u7248\u672C\u5E76\u63D0\u4EA4\u7BA1\u7406\u5458\u5BA1\u6838\u3002",
      "\u5728\u63D2\u4EF6\u91CC\u9009\u98DE\u4E66\uFF0C\u586B App ID / App Secret\uFF0C\u6388\u6743\u77E5\u8BC6\u5E93\uFF0C\u4FDD\u5B58\uFF1B\u4FDD\u5B58\u540E\u70B9\u300C\u6D4B\u8BD5\u8FDE\u63A5\u300D\u542F\u52A8\u957F\u8FDE\u63A5\u3002"
    ],
    dingtalk: [
      "\u6253\u5F00\u9489\u9489\u5F00\u653E\u5E73\u53F0 \u2192 \u5F00\u53D1\u8005\u540E\u53F0 \u2192 \u521B\u5EFA\u4F01\u4E1A\u5185\u90E8\u5E94\u7528\u3002",
      "\u51ED\u8BC1\u4E0E\u57FA\u7840\u4FE1\u606F \u2192 \u590D\u5236 AppKey\uFF08\u4F5C\u4E3A App ID\uFF09\u548C AppSecret\u3002",
      "\u6DFB\u52A0\u5E94\u7528\u80FD\u529B \u2192 \u673A\u5668\u4EBA \u2192 \u673A\u5668\u4EBA\u8BBE\u7F6E\u91CC\u83B7\u53D6 Robot Code\u3002",
      "\u4E8B\u4EF6\u8BA2\u9605 \u2192 \u914D\u7F6E HTTP \u56DE\u8C03\u5730\u5740\uFF1A\u4FDD\u5B58\u673A\u5668\u4EBA\u540E\uFF0C\u5728\u672C\u9875\u5361\u7247\u4E0A\u590D\u5236\u300C\u56DE\u8C03\u5730\u5740\u300D\u7C98\u8D34\u5230\u8FD9\u91CC\uFF1B\u540C\u65F6\u751F\u6210/\u590D\u5236\u4E8B\u4EF6\u7B7E\u540D\u5BC6\u94A5\u3002",
      "\u53D1\u5E03\u5E94\u7528\u5E76\u5728\u4F01\u4E1A\u5185\u53EF\u89C1\uFF1B\u628A\u673A\u5668\u4EBA\u62C9\u8FDB\u76EE\u6807\u7FA4\u3002",
      "\u5728\u63D2\u4EF6\u91CC\u9009\u9489\u9489\uFF0C\u586B App ID / App Secret / Robot Code / \u4E8B\u4EF6\u7B7E\u540D\u5BC6\u94A5\uFF0C\u6388\u6743\u77E5\u8BC6\u5E93\uFF0C\u4FDD\u5B58\u3002"
    ],
    wecom: [
      "\u5728\u4F01\u4E1A\u5FAE\u4FE1\u91CC\u6253\u5F00\u76EE\u6807\u7FA4 \u2192 \u7FA4\u8BBE\u7F6E \u2192 \u7FA4\u673A\u5668\u4EBA \u2192 \u6DFB\u52A0\u673A\u5668\u4EBA\u3002",
      "\u590D\u5236\u673A\u5668\u4EBA\u7684 Webhook \u5730\u5740\uFF08https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...\uFF09\u3002",
      "\u5728\u63D2\u4EF6\u91CC\u9009\u4F01\u4E1A\u5FAE\u4FE1\uFF0C\u7C98\u8D34 Webhook\uFF0C\u4FDD\u5B58\u5373\u53EF\u53D1\u9001\u7FA4\u901A\u77E5\u3002",
      "\u6CE8\u610F\uFF1A\u4F01\u4E1A\u5FAE\u4FE1\u5F53\u524D\u53EA\u652F\u6301\u7FA4\u901A\u77E5\uFF0C\u4E0D\u652F\u6301\u95EE\u7B54\uFF1B\u95EE\u7B54\u8BF7\u4F7F\u7528\u98DE\u4E66\u3001\u9489\u9489\u6216\u5FAE\u4FE1\u4E2A\u4EBA\u53F7\u673A\u5668\u4EBA\u3002"
    ],
    weixin: [
      "\u5728\u673A\u5668\u4EBA\u9875\u70B9\u300C\u626B\u7801\u7ED1\u5B9A\u5FAE\u4FE1\u300D\uFF0C\u5148\u9009\u6388\u6743\u77E5\u8BC6\u5E93\u3001\u586B\u5199\u673A\u5668\u4EBA\u540D\u79F0\u548C\u7CFB\u7EDF\u63D0\u793A\u8BCD\u3002",
      "\u70B9\u300C\u751F\u6210\u7ED1\u5B9A\u4E8C\u7EF4\u7801\u300D\uFF0C\u7528\u624B\u673A\u5FAE\u4FE1 \u2192 \u626B\u4E00\u626B \u2192 \u626B\u63CF\u4E8C\u7EF4\u7801\u3002",
      "\u5728\u624B\u673A\u4E0A\u786E\u8BA4\u767B\u5F55\uFF1B\u9875\u9762\u663E\u793A\u300C\u5FAE\u4FE1\u7ED1\u5B9A\u6210\u529F\u300D\u540E\uFF0C\u76F4\u63A5\u79C1\u804A\u8FD9\u4E2A\u5FAE\u4FE1\u673A\u5668\u4EBA\u5373\u53EF\u63D0\u95EE\u3002",
      "\u6362\u7ED1\u6216 token \u5931\u6548\u65F6\uFF0C\u5728\u5FAE\u4FE1\u673A\u5668\u4EBA\u5361\u7247\u4E0A\u70B9\u300C\u91CD\u65B0\u626B\u7801\u300D\u3002",
      "\u6CE8\u610F\uFF1A\u8FD9\u662F\u4E2A\u4EBA\u5FAE\u4FE1 iLink \u673A\u5668\u4EBA\uFF0C\u4E0D\u662F\u4F01\u4E1A\u5FAE\u4FE1\uFF1B\u4EC5\u652F\u6301\u79C1\u804A\u6587\u5B57\u95EE\u7B54\uFF0C\u53D7\u5FAE\u4FE1\u5E73\u53F0\u89C4\u5219\u7EA6\u675F\u3002"
    ],
    lark: [
      "\u6253\u5F00 Lark \u5F00\u653E\u5E73\u53F0 \u2192 \u5F00\u53D1\u8005\u540E\u53F0 \u2192 \u521B\u5EFA\u4F01\u4E1A\u81EA\u5EFA\u5E94\u7528\uFF08\u56FD\u9645\u7248 Lark\uFF0C\u57DF\u540D open.larksuite.com\uFF09\u3002",
      "\u51ED\u8BC1\u4E0E\u57FA\u7840\u4FE1\u606F \u2192 \u590D\u5236 App ID \u548C App Secret\u3002",
      "\u6DFB\u52A0\u5E94\u7528\u80FD\u529B \u2192 \u673A\u5668\u4EBA\uFF1B\u4E8B\u4EF6\u4E0E\u56DE\u8C03 \u2192 \u4F7F\u7528\u957F\u8FDE\u63A5\u63A5\u6536\u4E8B\u4EF6\uFF0C\u8BA2\u9605 im.message.receive_v1\u3002",
      "\u5728\u63D2\u4EF6\u91CC\u9009 Lark\uFF0C\u586B App ID / App Secret\uFF0C\u6388\u6743\u77E5\u8BC6\u5E93\uFF0C\u4FDD\u5B58\uFF1B\u4FDD\u5B58\u540E\u70B9\u300C\u6D4B\u8BD5\u8FDE\u63A5\u300D\u542F\u52A8\u957F\u8FDE\u63A5\u3002",
      "Lark \u4E0E\u98DE\u4E66 API \u5F62\u72B6\u4E00\u81F4\uFF0C\u53EA\u662F\u57DF\u540D\u4E0D\u540C\uFF1B\u5DF2\u6709\u98DE\u4E66\u5E94\u7528\u4E0D\u80FD\u76F4\u63A5\u590D\u7528\uFF0C\u9700\u8981\u5728 Lark \u4FA7\u5355\u72EC\u521B\u5EFA\u5E94\u7528\u3002"
    ],
    telegram: [
      "\u5728 Telegram \u641C\u7D22 @BotFather \u2192 \u53D1\u9001 /newbot\uFF0C\u6309\u63D0\u793A\u521B\u5EFA\u673A\u5668\u4EBA\u3002",
      "\u590D\u5236 BotFather \u8FD4\u56DE\u7684 Bot Token\uFF08\u5F62\u5982 123456789:AA...\uFF09\u3002",
      "\u5728\u673A\u5668\u4EBA\u9875\u70B9\u300C\u7ED1\u5B9A Telegram\u300D\uFF0C\u586B\u540D\u79F0\u3001Bot Token\uFF0C\u6388\u6743\u77E5\u8BC6\u5E93\u3002",
      "\u7ED1\u5B9A\u540E\u76F4\u63A5\u79C1\u804A\u673A\u5668\u4EBA\uFF0C\u6216\u628A\u5B83\u62C9\u8FDB\u7FA4\uFF1B\u7FA4\u804A\u9ED8\u8BA4\u53EA\u54CD\u5E94 @\u673A\u5668\u4EBA \u548C\u547D\u4EE4\u3002",
      "Bot Token \u6CC4\u9732\u65F6\u5728 @BotFather \u91CC /revoke\uFF0C\u7136\u540E\u5728\u98DE\u94FE\u91CD\u65B0\u7ED1\u5B9A\u3002"
    ]
  };
  return import_react.default.createElement(
    "div",
    {
      className: "fk-modal-backdrop",
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) onClose();
      }
    },
    import_react.default.createElement(
      "div",
      { className: "fk-modal" },
      import_react.default.createElement(
        "div",
        { className: "fk-modal-head" },
        import_react.default.createElement(
          "div",
          null,
          import_react.default.createElement("div", { className: "fk-modal-title" }, "\u673A\u5668\u4EBA\u8FDE\u63A5\u6559\u7A0B"),
          import_react.default.createElement(
            "div",
            { className: "fk-sub", style: { marginTop: 3 } },
            "\u6309\u5E73\u53F0\u9009\u62E9\u5BF9\u5E94\u6B65\u9AA4\uFF1B\u51ED\u8BC1\u53EA\u4FDD\u5B58\u5728\u670D\u52A1\u7AEF\u3002"
          )
        ),
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "fk-btn fk-btn-icon fk-modal-close",
            onClick: onClose,
            "aria-label": "\u5173\u95ED"
          },
          import_react.default.createElement(Icon, { name: "close", size: 15 })
        )
      ),
      import_react.default.createElement(
        "div",
        { className: "fk-tutorial-tabs" },
        Object.entries(PLATFORM_META).map(
          ([key, item]) => import_react.default.createElement(
            "button",
            {
              key,
              type: "button",
              className: `fk-seg-item ${tab === key ? "fk-seg-item-active" : ""}`,
              style: { flex: "none", padding: "0 14px" },
              onClick: () => setTab(key)
            },
            item.label
          )
        )
      ),
      import_react.default.createElement(
        "div",
        null,
        steps[tab].map(
          (step, index) => import_react.default.createElement(
            "div",
            { className: "fk-tutorial-step", key: index },
            import_react.default.createElement("span", { className: "fk-tutorial-index" }, index + 1),
            import_react.default.createElement("span", null, step)
          )
        )
      ),
      import_react.default.createElement(
        "div",
        { className: "fk-tutorial-note" },
        tab === "wecom" ? "\u4F01\u4E1A\u5FAE\u4FE1\u662F\u7FA4\u901A\u77E5 Webhook\uFF0C\u4E0D\u662F\u95EE\u7B54\u673A\u5668\u4EBA\u3002\u98DE\u4E66/\u9489\u9489/\u5FAE\u4FE1\u4E2A\u4EBA\u53F7\u624D\u662F\u5BF9\u8BDD\u95EE\u7B54\u673A\u5668\u4EBA\u3002" : tab === "weixin" ? "\u5FAE\u4FE1\u4E2A\u4EBA\u53F7\u901A\u8FC7\u626B\u7801\u7ED1\u5B9A\uFF0C\u4E0D\u9700\u8981 App ID\uFF1B\u4EC5\u652F\u6301\u79C1\u804A\u6587\u5B57\u95EE\u7B54\uFF0C\u53D7\u5FAE\u4FE1\u5E73\u53F0\u89C4\u5219\u7EA6\u675F\u3002" : tab === "lark" ? "Lark \u662F\u98DE\u4E66\u56FD\u9645\u7248\uFF0C\u4F7F\u7528 open.larksuite.com\uFF1B\u5E94\u7528\u9700\u8981\u5355\u72EC\u521B\u5EFA\uFF0C\u4E0D\u80FD\u590D\u7528\u98DE\u4E66\u5E94\u7528\u3002" : tab === "telegram" ? "Telegram \u9700\u8981 BotFather \u7684 Bot Token\uFF1B\u7FA4\u804A\u9ED8\u8BA4\u53EA\u54CD\u5E94 @\u673A\u5668\u4EBA \u548C\u547D\u4EE4\u6D88\u606F\u3002" : tab === "dingtalk" ? "\u9489\u9489\u4F7F\u7528 Webhook \u56DE\u8C03\uFF1A\u4FDD\u5B58\u673A\u5668\u4EBA\u540E\uFF0C\u52A1\u5FC5\u628A\u5361\u7247\u4E0A\u7684\u300C\u56DE\u8C03\u5730\u5740\u300D\u590D\u5236\u5230\u9489\u9489\u5F00\u653E\u5E73\u53F0\u7684\u4E8B\u4EF6\u8BA2\u9605\u91CC\u3002" : "\u98DE\u4E66\u957F\u8FDE\u63A5\u4E0D\u9700\u8981\u56DE\u8C03\u5730\u5740\uFF1B\u4FDD\u5B58\u540E\u70B9\u300C\u6D4B\u8BD5\u8FDE\u63A5\u300D\u5373\u53EF\u5EFA\u7ACB\u8FDE\u63A5\u3002"
      )
    )
  );
}
function BotsView({ connectors, loading, error, onReload, knowledgeBases, onToast, onNeedLogin }) {
  const [editor, setEditor] = (0, import_react.useState)(null);
  const [weixinBind, setWeixinBind] = (0, import_react.useState)(null);
  const [telegramBind, setTelegramBind] = (0, import_react.useState)(null);
  const [tutorialOpen, setTutorialOpen] = (0, import_react.useState)(false);
  const [busyId, setBusyId] = (0, import_react.useState)("");
  const test = async (connector) => {
    setBusyId(connector.id);
    try {
      const result = await api("/connectors/test", {
        method: "POST",
        body: JSON.stringify({ id: connector.id })
      });
      onToast(
        result.ok ? `\u300C${connector.name}\u300D\u8FDE\u63A5\u6B63\u5E38` : `\u300C${connector.name}\u300D\u8FDE\u63A5\u5931\u8D25\uFF1A${result.error || "\u672A\u77E5\u9519\u8BEF"}`
      );
      onReload();
    } catch (caught) {
      if (caught.status === 401) onNeedLogin();
      else onToast(caught.message || "\u6D4B\u8BD5\u5931\u8D25");
    } finally {
      setBusyId("");
    }
  };
  const unbind = async (connector) => {
    const isTelegram = connector.platform === "telegram";
    const label = isTelegram ? "Telegram" : "\u5FAE\u4FE1";
    if (typeof window !== "undefined" && !window.confirm(`\u786E\u5B9A\u89E3\u9664\u300C${connector.name}\u300D\u7684${label}\u7ED1\u5B9A\u5417\uFF1F`)) {
      return;
    }
    setBusyId(connector.id);
    try {
      await api(isTelegram ? "/telegram/unbind" : "/weixin/unbind", {
        method: "POST",
        body: JSON.stringify({ id: connector.id })
      });
      onToast(`${label}\u7ED1\u5B9A\u5DF2\u89E3\u9664`);
      onReload();
    } catch (caught) {
      if (caught.status === 401) onNeedLogin();
      else onToast(caught.message || "\u89E3\u9664\u7ED1\u5B9A\u5931\u8D25");
    } finally {
      setBusyId("");
    }
  };
  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast(label);
    } catch {
      onToast("\u6D4F\u89C8\u5668\u672A\u6388\u4E88\u590D\u5236\u6743\u9650\uFF0C\u8BF7\u624B\u52A8\u590D\u5236");
    }
  };
  if (loading) {
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-panel", style: { flex: 1 } }, /* @__PURE__ */ import_react.default.createElement(
      EmptyState,
      {
        icon: "bot",
        title: "\u6B63\u5728\u8BFB\u53D6\u529E\u516C\u673A\u5668\u4EBA\u2026",
        detail: "\u673A\u5668\u4EBA\u914D\u7F6E\u4F7F\u7528\u540C\u4E00\u767B\u5F55\u7684\u77ED\u671F\u6210\u5458\u51ED\u636E\u3002"
      }
    ));
  }
  if (error) {
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-panel", style: { flex: 1 } }, /* @__PURE__ */ import_react.default.createElement(
      EmptyState,
      {
        icon: "alert",
        title: "\u65E0\u6CD5\u8BFB\u53D6\u529E\u516C\u673A\u5668\u4EBA",
        detail: error,
        action: /* @__PURE__ */ import_react.default.createElement("button", { type: "button", className: "fk-btn fk-btn-soft", onClick: onReload }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: "refresh", size: 14 }), "\u91CD\u8BD5")
      }
    ));
  }
  return /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-panel fk-scroll", style: { flex: 1 } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-panel-head" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-panel-title" }, "\u529E\u516C\u673A\u5668\u4EBA"), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-sub", style: { marginTop: 2 } }, "\u652F\u6301\u98DE\u4E66\u3001Lark\u3001\u9489\u9489\u3001\u4F01\u4E1A\u5FAE\u4FE1\u3001\u5FAE\u4FE1\u4E2A\u4EBA\u53F7\u548C Telegram\uFF1B\u914D\u7F6E\u4FDD\u5B58\u540E\u7ACB\u5373\u751F\u6548\u3002")), /* @__PURE__ */ import_react.default.createElement("div", { style: { marginLeft: "auto", display: "flex", gap: 7, flexWrap: "wrap" } }, /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      type: "button",
      className: "fk-btn fk-btn-sm",
      onClick: () => setTutorialOpen(true)
    },
    /* @__PURE__ */ import_react.default.createElement(Icon, { name: "book", size: 13 }),
    "\u8FDE\u63A5\u6559\u7A0B"
  ), /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      type: "button",
      className: "fk-btn fk-btn-sm",
      style: { color: "var(--fk-green)" },
      onClick: () => setWeixinBind({ connector: null })
    },
    /* @__PURE__ */ import_react.default.createElement(Icon, { name: "bot", size: 13 }),
    "\u626B\u7801\u7ED1\u5B9A\u5FAE\u4FE1"
  ), /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      type: "button",
      className: "fk-btn fk-btn-sm",
      onClick: () => setTelegramBind({ connector: null })
    },
    /* @__PURE__ */ import_react.default.createElement(Icon, { name: "bot", size: 13 }),
    "\u7ED1\u5B9A Telegram"
  ), /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      type: "button",
      className: "fk-btn fk-btn-primary fk-btn-sm",
      onClick: () => setEditor({ mode: "create" })
    },
    /* @__PURE__ */ import_react.default.createElement(Icon, { name: "plus", size: 13 }),
    "\u6DFB\u52A0\u673A\u5668\u4EBA"
  ))), /* @__PURE__ */ import_react.default.createElement("div", { style: { padding: 16 } }, connectors.length ? /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-grid" }, connectors.map((connector) => {
    const kbNames = (connector.knowledge_base_ids || []).map((id) => knowledgeBases.find((kb) => kb.id === id)?.name || id).slice(0, 4);
    const platformLabel = PLATFORM_META[connector.platform]?.label || (connector.platform === "website" ? "\u5B98\u7F51\u5BA2\u670D" : connector.platform || "\u673A\u5668\u4EBA");
    const isPublicApi = connector.connection_mode === "public_api";
    const isWeixin = connector.platform === "weixin";
    const isTelegram = connector.platform === "telegram";
    const isFeishuLong = ["feishu", "lark"].includes(connector.platform) && connector.connection_mode === "long_connection";
    const isWecom = connector.platform === "wecom";
    const isEditable = ["feishu", "lark", "dingtalk", "wecom", "weixin", "telegram"].includes(connector.platform) && !isPublicApi;
    const modeLabel = isWeixin ? "\u626B\u7801\u7ED1\u5B9A" : isTelegram ? "Bot Token" : isPublicApi ? "\u516C\u5F00 API" : connector.connection_mode === "long_connection" ? "\u957F\u8FDE\u63A5" : connector.connection_mode === "webhook" ? "Webhook" : connector.connection_mode;
    const online = connector.connection_status === "connected";
    const statusLabel = isPublicApi ? "\u516C\u5F00 API" : isWecom ? "\u7FA4\u901A\u77E5" : isWeixin ? online ? "\u5DF2\u7ED1\u5B9A" : connector.connection_status === "error" ? "\u5F85\u91CD\u65B0\u626B\u7801" : "\u5DF2\u89E3\u7ED1" : isTelegram ? online ? "\u5DF2\u7ED1\u5B9A" : "Token \u5931\u6548" : online ? "\u5728\u7EBF" : connector.connection_status === "not_applicable" ? "\u65E0\u9700\u8FDE\u63A5" : connector.connection_status || "\u5F85\u68C0\u6D4B";
    const statusColor = isPublicApi || isWecom ? "var(--fk-subtle)" : online ? "var(--fk-green)" : "var(--fk-amber)";
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-card", key: connector.id }, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-head" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-avatar" }, /* @__PURE__ */ import_react.default.createElement(Icon, { name: "bot", size: 18 })), /* @__PURE__ */ import_react.default.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-name" }, connector.name), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-meta" }, platformLabel, " \xB7 ", modeLabel)), /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        className: "fk-bot-status",
        style: { marginLeft: "auto", color: statusColor }
      },
      /* @__PURE__ */ import_react.default.createElement("span", { className: "fk-dot", style: { background: statusColor } }),
      statusLabel
    )), isWecom ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-meta" }, "Webhook\uFF1A", connector.notification_webhook_masked || "\u672A\u914D\u7F6E"), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-meta" }, "\u7528\u9014\uFF1A\u7FA4\u901A\u77E5\uFF08\u4E0D\u652F\u6301\u95EE\u7B54\uFF09")) : isWeixin ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-meta" }, "\u5FAE\u4FE1\uFF1A", online ? "\u5DF2\u7ED1\u5B9A\uFF0C\u53EF\u76F4\u63A5\u79C1\u804A\u63D0\u95EE" : "\u7B49\u5F85\u91CD\u65B0\u626B\u7801\u7ED1\u5B9A"), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-meta" }, "\u77E5\u8BC6\u5E93\uFF1A", kbNames.length ? kbNames.join("\u3001") : "\u672A\u6388\u6743"), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-meta", style: { color: "var(--fk-amber)" } }, "\u4E2A\u4EBA\u5FAE\u4FE1 \xB7 \u4EC5\u79C1\u804A\u6587\u5B57\u95EE\u7B54")) : isTelegram ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-meta" }, "Telegram\uFF1A", online ? `@${connector.app_id || "\u5DF2\u7ED1\u5B9A"}` : "\u7B49\u5F85\u91CD\u65B0\u7ED1\u5B9A"), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-meta" }, "Bot Token\uFF1A", connector.app_secret_masked || "\u672A\u914D\u7F6E"), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-meta" }, "\u77E5\u8BC6\u5E93\uFF1A", kbNames.length ? kbNames.join("\u3001") : "\u672A\u6388\u6743")) : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-meta" }, "App ID\uFF1A", connector.app_id || "\u672A\u914D\u7F6E"), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-meta" }, "App Secret\uFF1A", connector.app_secret_masked || "\u672A\u914D\u7F6E"), connector.platform === "dingtalk" ? /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-meta" }, "Robot Code\uFF1A", connector.robot_code || "\u672A\u914D\u7F6E") : null, /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-meta" }, "\u77E5\u8BC6\u5E93\uFF1A", kbNames.length ? kbNames.join("\u3001") : "\u672A\u6388\u6743")), connector.event_callback_url && !isPublicApi ? /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-callback" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "fk-inline-code", title: connector.event_callback_url }, connector.event_callback_url), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "fk-btn fk-btn-sm",
        onClick: () => void copy(connector.event_callback_url, "\u56DE\u8C03\u5730\u5740\u5DF2\u590D\u5236")
      },
      /* @__PURE__ */ import_react.default.createElement(Icon, { name: "copy", size: 12 }),
      "\u590D\u5236\u56DE\u8C03\u5730\u5740"
    )) : null, /* @__PURE__ */ import_react.default.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } }, /* @__PURE__ */ import_react.default.createElement("span", { className: "fk-stat", style: { padding: "3px 8px", fontSize: 11 } }, isWecom ? "\u4EC5\u901A\u77E5" : connector.write_enabled ? "\u53EF\u5199\u56DE" : "\u53EA\u8BFB"), connector.status !== "active" ? /* @__PURE__ */ import_react.default.createElement(
      "span",
      {
        className: "fk-stat",
        style: { padding: "3px 8px", fontSize: 11, color: "var(--fk-red)" }
      },
      "\u5DF2\u505C\u7528"
    ) : null), /* @__PURE__ */ import_react.default.createElement("div", { className: "fk-bot-actions" }, isFeishuLong || isWeixin || isTelegram ? /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "fk-btn fk-btn-sm",
        disabled: busyId === connector.id,
        onClick: () => void test(connector)
      },
      /* @__PURE__ */ import_react.default.createElement(Icon, { name: "check", size: 12 }),
      busyId === connector.id ? "\u6D4B\u8BD5\u4E2D\u2026" : "\u6D4B\u8BD5\u8FDE\u63A5"
    ) : null, isEditable ? /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "fk-btn fk-btn-sm",
        onClick: () => setEditor({ mode: "edit", connector })
      },
      /* @__PURE__ */ import_react.default.createElement(Icon, { name: "edit", size: 12 }),
      "\u7F16\u8F91"
    ) : null, isWeixin ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "fk-btn fk-btn-sm",
        onClick: () => setWeixinBind({ connector })
      },
      /* @__PURE__ */ import_react.default.createElement(Icon, { name: "refresh", size: 12 }),
      "\u91CD\u65B0\u626B\u7801"
    ), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "fk-btn fk-btn-sm",
        style: { color: "var(--fk-red)" },
        disabled: busyId === connector.id,
        onClick: () => void unbind(connector)
      },
      /* @__PURE__ */ import_react.default.createElement(Icon, { name: "close", size: 12 }),
      "\u89E3\u9664\u7ED1\u5B9A"
    )) : null, isTelegram ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "fk-btn fk-btn-sm",
        onClick: () => setTelegramBind({ connector })
      },
      /* @__PURE__ */ import_react.default.createElement(Icon, { name: "refresh", size: 12 }),
      "\u91CD\u65B0\u7ED1\u5B9A"
    ), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "fk-btn fk-btn-sm",
        style: { color: "var(--fk-red)" },
        disabled: busyId === connector.id,
        onClick: () => void unbind(connector)
      },
      /* @__PURE__ */ import_react.default.createElement(Icon, { name: "close", size: 12 }),
      "\u89E3\u9664\u7ED1\u5B9A"
    )) : null, !isEditable ? /* @__PURE__ */ import_react.default.createElement("span", { className: "fk-bot-meta", style: { alignSelf: "center" } }, "\u5728\u98DE\u94FE\u540E\u53F0\u914D\u7F6E") : null));
  })) : /* @__PURE__ */ import_react.default.createElement(
    EmptyState,
    {
      icon: "bot",
      title: "\u8FD8\u6CA1\u6709\u529E\u516C\u673A\u5668\u4EBA",
      detail: "\u6DFB\u52A0\u98DE\u4E66\u3001Lark\u3001\u9489\u9489\u3001\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA\uFF0C\u6216\u7ED1\u5B9A\u5FAE\u4FE1\u4E2A\u4EBA\u53F7 / Telegram\u3002",
      action: /* @__PURE__ */ import_react.default.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" } }, /* @__PURE__ */ import_react.default.createElement(
        "button",
        {
          type: "button",
          className: "fk-btn fk-btn-primary",
          onClick: () => setEditor({ mode: "create" })
        },
        /* @__PURE__ */ import_react.default.createElement(Icon, { name: "plus", size: 14 }),
        "\u6DFB\u52A0\u673A\u5668\u4EBA"
      ), /* @__PURE__ */ import_react.default.createElement(
        "button",
        {
          type: "button",
          className: "fk-btn",
          onClick: () => setWeixinBind({ connector: null })
        },
        /* @__PURE__ */ import_react.default.createElement(Icon, { name: "bot", size: 14 }),
        "\u626B\u7801\u7ED1\u5B9A\u5FAE\u4FE1"
      ), /* @__PURE__ */ import_react.default.createElement(
        "button",
        {
          type: "button",
          className: "fk-btn",
          onClick: () => setTelegramBind({ connector: null })
        },
        /* @__PURE__ */ import_react.default.createElement(Icon, { name: "bot", size: 14 }),
        "\u7ED1\u5B9A Telegram"
      ))
    }
  )), editor ? /* @__PURE__ */ import_react.default.createElement(
    BotEditor,
    {
      bot: editor.connector,
      knowledgeBases,
      onClose: () => setEditor(null),
      onSaved: () => {
        setEditor(null);
        onToast("\u673A\u5668\u4EBA\u914D\u7F6E\u5DF2\u4FDD\u5B58");
        onReload();
      }
    }
  ) : null, weixinBind ? /* @__PURE__ */ import_react.default.createElement(
    WeixinBindDialog,
    {
      bot: weixinBind.connector,
      knowledgeBases,
      onClose: () => setWeixinBind(null),
      onBound: onReload,
      onToast,
      onNeedLogin
    }
  ) : null, telegramBind ? /* @__PURE__ */ import_react.default.createElement(
    TelegramBindDialog,
    {
      bot: telegramBind.connector,
      knowledgeBases,
      onClose: () => setTelegramBind(null),
      onBound: onReload,
      onToast,
      onNeedLogin
    }
  ) : null, tutorialOpen ? /* @__PURE__ */ import_react.default.createElement(BotTutorial, { onClose: () => setTutorialOpen(false) }) : null);
}
function QueryDrawer({ session, activeKb, onClose, onOpenPage }) {
  const [question, setQuestion] = (0, import_react.useState)("");
  const [answer, setAnswer] = (0, import_react.useState)(null);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)("");
  const ask = async () => {
    const text = question.trim();
    if (!text || !activeKb) return;
    setBusy(true);
    setError("");
    try {
      const payload = await api("/query", {
        method: "POST",
        body: JSON.stringify({ kb_id: activeKb.id, question: text })
      });
      setAnswer(payload);
    } catch (caught) {
      setError(caught.message || "\u95EE\u7B54\u5931\u8D25");
    } finally {
      setBusy(false);
    }
  };
  return import_react.default.createElement(
    "div",
    { className: "fk-drawer-backdrop", onMouseDown: (event) => event.target === event.currentTarget && onClose() },
    import_react.default.createElement(
      "div",
      { className: "fk-drawer" },
      import_react.default.createElement(
        "div",
        { className: "fk-drawer-head" },
        import_react.default.createElement(Icon, { name: "spark", size: 17 }),
        import_react.default.createElement(
          "div",
          null,
          import_react.default.createElement("div", { className: "fk-panel-title" }, "\u95EE\u8FD9\u4E2A\u77E5\u8BC6\u5E93"),
          import_react.default.createElement(
            "div",
            { className: "fk-sub" },
            activeKb ? `${session.tenant?.name || ""} \xB7 ${activeKb.name}` : ""
          )
        ),
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "fk-btn fk-btn-icon",
            style: { marginLeft: "auto" },
            onClick: onClose,
            "aria-label": "\u5173\u95ED"
          },
          import_react.default.createElement(Icon, { name: "close", size: 15 })
        )
      ),
      import_react.default.createElement(
        "div",
        { className: "fk-drawer-body" },
        import_react.default.createElement("textarea", {
          className: "fk-textarea",
          rows: 3,
          value: question,
          placeholder: "\u4F8B\u5982\uFF1A\u516C\u53F8\u5DEE\u65C5\u8D39\u62A5\u9500\u6709\u4EC0\u4E48\u89C4\u5B9A\uFF1F",
          onChange: (event) => setQuestion(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void ask();
          }
        }),
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "fk-btn fk-btn-primary",
            style: { alignSelf: "flex-start" },
            disabled: busy || !question.trim() || !activeKb,
            onClick: ask
          },
          import_react.default.createElement(Icon, { name: "send", size: 14 }),
          busy ? "\u67E5\u8BE2\u4E2D\u2026" : "\u63D0\u95EE"
        ),
        error ? import_react.default.createElement(
          "div",
          { className: "fk-sub", style: { color: "var(--fk-red)" } },
          error
        ) : null,
        answer ? import_react.default.createElement(
          import_react.default.Fragment,
          null,
          import_react.default.createElement("div", { className: "fk-answer" }, answer.answer || ""),
          answer.citations?.length ? import_react.default.createElement(
            "div",
            null,
            import_react.default.createElement(
              "div",
              { className: "fk-sub", style: { marginBottom: 6 } },
              `\u5F15\u7528 ${answer.citations.length} \u4E2A\u6765\u6E90`
            ),
            import_react.default.createElement(
              "div",
              { className: "fk-citation-list" },
              answer.citations.map((citation, index) => {
                const label = citation.filename || citation.source || citation.path || `\u6765\u6E90 ${index + 1}`;
                return import_react.default.createElement(
                  "button",
                  {
                    key: index,
                    type: "button",
                    className: "fk-citation",
                    onClick: () => {
                      const path = citation.path || citation.source;
                      if (path) onOpenPage(path);
                    }
                  },
                  label
                );
              })
            )
          ) : null
        ) : null
      )
    )
  );
}
function Workspace({ session, onSignedOut }) {
  const knowledgeBases = session.knowledge_bases || [];
  const [activeKbId, setActiveKbId] = (0, import_react.useState)(knowledgeBases[0]?.id || "");
  const [tab, setTab] = (0, import_react.useState)("compiled");
  const [inventory, setInventory] = (0, import_react.useState)(null);
  const [sources, setSources] = (0, import_react.useState)([]);
  const [graph, setGraph] = (0, import_react.useState)(null);
  const [connectors, setConnectors] = (0, import_react.useState)([]);
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [error, setError] = (0, import_react.useState)("");
  const [graphLoading, setGraphLoading] = (0, import_react.useState)(false);
  const [graphError, setGraphError] = (0, import_react.useState)("");
  const [botsLoading, setBotsLoading] = (0, import_react.useState)(false);
  const [botsError, setBotsError] = (0, import_react.useState)("");
  const [page, setPage] = (0, import_react.useState)(null);
  const [pageBusy, setPageBusy] = (0, import_react.useState)(false);
  const [source, setSource] = (0, import_react.useState)(null);
  const [sourceBusy, setSourceBusy] = (0, import_react.useState)(false);
  const [searchPages, setSearchPages] = (0, import_react.useState)("");
  const [searchSources, setSearchSources] = (0, import_react.useState)("");
  const [toast, setToast] = (0, import_react.useState)("");
  const [queryOpen, setQueryOpen] = (0, import_react.useState)(false);
  const graphCache = (0, import_react.useRef)(/* @__PURE__ */ new Map());
  const connectorsLoaded = (0, import_react.useRef)(false);
  const activeKb = knowledgeBases.find((kb) => kb.id === activeKbId) || knowledgeBases[0] || null;
  const showToast = (0, import_react.useCallback)((message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);
  const updateInfo = session.update && session.update.update_available ? session.update : null;
  const copyUpdateLink = async () => {
    if (!updateInfo?.tarball) return;
    try {
      await navigator.clipboard.writeText(updateInfo.tarball);
      showToast(`\u65B0\u7248\u672C ${updateInfo.latest} \u5B89\u88C5\u5730\u5740\u5DF2\u590D\u5236\uFF0C\u8BF7\u5230 DSH \u63D2\u4EF6\u9875\u91CD\u65B0\u5B89\u88C5`);
    } catch {
      showToast(`\u65B0\u7248\u672C ${updateInfo.latest}\uFF1A${updateInfo.tarball}`);
    }
  };
  const loadKnowledgeBase = (0, import_react.useCallback)(async (kbId) => {
    if (!kbId) return;
    setLoading(true);
    setError("");
    try {
      const [inventoryPayload, sourcePayload] = await Promise.all([
        api(`/list?kb_id=${encodeURIComponent(kbId)}`),
        api(`/sources?kb_id=${encodeURIComponent(kbId)}`)
      ]);
      setInventory(inventoryPayload || {});
      setSources(Array.isArray(sourcePayload) ? sourcePayload : sourcePayload?.sources || []);
      setPage(null);
      setSource(null);
    } catch (caught) {
      if (caught.status === 401) {
        onSignedOut();
        return;
      }
      setError(caught.message || "\u65E0\u6CD5\u8BFB\u53D6\u77E5\u8BC6\u5E93");
    } finally {
      setLoading(false);
    }
  }, [onSignedOut]);
  (0, import_react.useEffect)(() => {
    void loadKnowledgeBase(activeKbId);
  }, [activeKbId, loadKnowledgeBase]);
  const loadGraph = (0, import_react.useCallback)(async (force = false) => {
    if (!activeKbId) return;
    const cached = graphCache.current.get(activeKbId);
    if (cached && !force) {
      setGraph(cached);
      return;
    }
    setGraphLoading(true);
    setGraphError("");
    try {
      const payload = await api(`/graph?kb_id=${encodeURIComponent(activeKbId)}`);
      graphCache.current.set(activeKbId, payload);
      setGraph(payload);
    } catch (caught) {
      if (caught.status === 401) {
        setGraphError("\u767B\u5F55\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u5148\u5728\u63D2\u4EF6\u91CC\u91CD\u65B0\u767B\u5F55");
      } else {
        setGraphError(caught.message || "\u56FE\u8C31\u52A0\u8F7D\u5931\u8D25");
      }
    } finally {
      setGraphLoading(false);
    }
  }, [activeKbId]);
  (0, import_react.useEffect)(() => {
    if (tab !== "graph" || !activeKbId) return;
    if (!graphCache.current.has(activeKbId)) void loadGraph();
    else setGraph(graphCache.current.get(activeKbId));
  }, [tab, activeKbId, loadGraph]);
  const loadConnectors = (0, import_react.useCallback)(async () => {
    setBotsLoading(true);
    setBotsError("");
    try {
      const payload = await api("/connectors");
      setConnectors(Array.isArray(payload) ? payload : payload?.connectors || []);
      connectorsLoaded.current = true;
    } catch (caught) {
      if (caught.status === 401) {
        setBotsError("\u767B\u5F55\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u5148\u9000\u51FA\u5E76\u91CD\u65B0\u767B\u5F55\uFF0C\u518D\u914D\u7F6E\u529E\u516C\u673A\u5668\u4EBA");
      } else {
        setBotsError(caught.message || "\u65E0\u6CD5\u8BFB\u53D6\u529E\u516C\u673A\u5668\u4EBA");
      }
    } finally {
      setBotsLoading(false);
    }
  }, []);
  (0, import_react.useEffect)(() => {
    if (tab === "bots" && !connectorsLoaded.current) void loadConnectors();
  }, [tab, loadConnectors]);
  const pages = (0, import_react.useMemo)(() => groupPages(inventory?.page_titles || {}), [inventory]);
  const sourceGroups = (0, import_react.useMemo)(() => groupSources(sources), [sources]);
  const pageCount = (0, import_react.useMemo)(
    () => pages.reduce((sum, group) => sum + group.items.length, 0),
    [pages]
  );
  const graphCount = graph?.nodes?.length || 0;
  const botCount = connectors.length;
  const openPage = async (path) => {
    if (!path) return;
    setTab("compiled");
    setPageBusy(true);
    setError("");
    try {
      const payload = await api("/page", {
        method: "POST",
        body: JSON.stringify({ kb_id: activeKbId, path })
      });
      setPage({
        path: payload.path || path,
        title: (inventory?.page_titles || {})[payload.path || path] || path,
        content: payload.content || ""
      });
    } catch (caught) {
      if (caught.status === 401) onSignedOut();
      else setError(caught.message || "\u65E0\u6CD5\u8BFB\u53D6\u9875\u9762");
    } finally {
      setPageBusy(false);
    }
  };
  const openSource = async (item) => {
    setTab("sources");
    setSourceBusy(true);
    setError("");
    try {
      const payload = await api("/source", {
        method: "POST",
        body: JSON.stringify({
          kb_id: activeKbId,
          version_id: sourceVersionId(item)
        })
      });
      setSource({
        key: item.id || item.path || item.name,
        name: item.name || item.original_filename || payload.preview_filename || "\u6765\u6E90\u6587\u4EF6",
        path: item.display_path || item.source_directory || "",
        extension: payload.format_extension || "",
        version: payload.version,
        status: item.status,
        content: payload.content || ""
      });
    } catch (caught) {
      if (caught.status === 401) onSignedOut();
      else setError(caught.message || "\u65E0\u6CD5\u8BFB\u53D6\u6765\u6E90\u9884\u89C8");
    } finally {
      setSourceBusy(false);
    }
  };
  const refresh = async () => {
    await loadKnowledgeBase(activeKbId);
    graphCache.current.delete(activeKbId);
    if (tab === "graph") void loadGraph(true);
    if (tab === "bots") void loadConnectors();
    showToast("\u5DF2\u5237\u65B0");
  };
  const openExternal = (path) => {
    const url = path ? `https://flylink.yituobo.com/#/browse?kb=${encodeURIComponent(activeKbId)}&path=${encodeURIComponent(path)}` : `https://flylink.yituobo.com/#/browse`;
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const tabs = [
    { key: "compiled", label: "\u7F16\u6392\u76EE\u5F55", icon: "layers", count: pageCount },
    { key: "sources", label: "\u6765\u6E90\u76EE\u5F55", icon: "folder", count: sources.length },
    { key: "graph", label: "\u77E5\u8BC6\u56FE\u8C31", icon: "graph", count: graphCount || void 0 },
    { key: "bots", label: "\u529E\u516C\u673A\u5668\u4EBA", icon: "bot", count: botCount || void 0 }
  ];
  return import_react.default.createElement(
    "div",
    { className: "fk-root" },
    import_react.default.createElement(
      "div",
      { className: "fk-header" },
      import_react.default.createElement(
        "div",
        { className: "fk-header-top" },
        import_react.default.createElement(
          "div",
          { className: "fk-brand-row" },
          import_react.default.createElement(
            "div",
            { className: "fk-brand-mark", style: { width: 34, height: 34, borderRadius: 10 } },
            import_react.default.createElement(FeilianIcon, { size: 20 })
          ),
          import_react.default.createElement(
            "div",
            null,
            import_react.default.createElement("div", { className: "fk-title" }, "\u98DE\u94FE\u77E5\u8BC6\u5E93"),
            import_react.default.createElement(
              "div",
              { className: "fk-sub" },
              `${session.tenant?.name || ""} \xB7 ${session.user?.display_name || session.user?.email || ""}`
            )
          )
        ),
        import_react.default.createElement(
          "select",
          {
            className: "fk-kb-select",
            style: { marginLeft: 8 },
            value: activeKbId,
            onChange: (event) => setActiveKbId(event.target.value),
            "aria-label": "\u5207\u6362\u77E5\u8BC6\u5E93"
          },
          knowledgeBases.map(
            (kb) => import_react.default.createElement("option", { key: kb.id, value: kb.id }, kb.name)
          )
        ),
        import_react.default.createElement(
          "div",
          { className: "fk-header-actions" },
          updateInfo ? import_react.default.createElement(
            "button",
            {
              type: "button",
              className: "fk-update-pill",
              onClick: () => void copyUpdateLink(),
              title: `\u5F53\u524D ${updateInfo.current}\uFF0C\u6700\u65B0 ${updateInfo.latest}\uFF1B\u70B9\u51FB\u590D\u5236\u5B89\u88C5\u5730\u5740\uFF0C\u5728 DSH \u63D2\u4EF6\u9875\u91CD\u65B0\u5B89\u88C5`
            },
            import_react.default.createElement(Icon, { name: "refresh", size: 12 }),
            `\u65B0\u7248\u672C ${updateInfo.latest}`
          ) : null,
          import_react.default.createElement(
            "button",
            { type: "button", className: "fk-btn fk-btn-icon", onClick: refresh, title: "\u5237\u65B0" },
            import_react.default.createElement(Icon, { name: "refresh", size: 15 })
          ),
          import_react.default.createElement(
            "button",
            {
              type: "button",
              className: "fk-btn fk-btn-primary",
              onClick: () => setQueryOpen(true),
              disabled: !activeKb
            },
            import_react.default.createElement(Icon, { name: "spark", size: 15 }),
            "\u95EE\u77E5\u8BC6\u5E93"
          ),
          import_react.default.createElement(
            "button",
            { type: "button", className: "fk-btn", onClick: onSignedOut },
            import_react.default.createElement(Icon, { name: "logout", size: 14 }),
            "\u9000\u51FA"
          )
        )
      ),
      import_react.default.createElement(
        "div",
        { className: "fk-stats" },
        import_react.default.createElement(
          "span",
          { className: "fk-stat" },
          import_react.default.createElement(Icon, { name: "folder", size: 13 }),
          "\u6765\u6E90",
          import_react.default.createElement("strong", null, humanCount(sources.length))
        ),
        import_react.default.createElement(
          "span",
          { className: "fk-stat" },
          import_react.default.createElement(Icon, { name: "layers", size: 13 }),
          "\u7F16\u6392\u9875\u9762",
          import_react.default.createElement("strong", null, humanCount(pageCount))
        ),
        graphCount ? import_react.default.createElement(
          "span",
          { className: "fk-stat" },
          import_react.default.createElement(Icon, { name: "graph", size: 13 }),
          "\u56FE\u8C31\u8282\u70B9",
          import_react.default.createElement("strong", null, humanCount(graphCount))
        ) : null,
        botCount ? import_react.default.createElement(
          "span",
          { className: "fk-stat" },
          import_react.default.createElement(Icon, { name: "bot", size: 13 }),
          "\u529E\u516C\u673A\u5668\u4EBA",
          import_react.default.createElement("strong", null, humanCount(botCount))
        ) : null,
        activeKb?.openkb_status ? import_react.default.createElement(
          "span",
          { className: "fk-stat", style: { marginLeft: "auto" } },
          import_react.default.createElement("span", {
            className: "fk-dot",
            style: {
              background: activeKb.openkb_status === "initialized" ? "var(--fk-green)" : "var(--fk-amber)"
            }
          }),
          activeKb.openkb_status === "initialized" ? "\u5F15\u64CE\u5C31\u7EEA" : activeKb.openkb_status
        ) : null
      ),
      import_react.default.createElement(
        "div",
        { className: "fk-tabs" },
        tabs.map(
          (item) => import_react.default.createElement(
            "button",
            {
              key: item.key,
              type: "button",
              className: `fk-tab ${tab === item.key ? "fk-tab-active" : ""}`,
              onClick: () => setTab(item.key)
            },
            import_react.default.createElement(Icon, { name: item.icon, size: 14 }),
            item.label,
            item.count != null ? import_react.default.createElement("span", { className: "fk-count" }, humanCount(item.count)) : null
          )
        )
      )
    ),
    import_react.default.createElement(
      "div",
      { className: "fk-main" },
      tab === "compiled" ? import_react.default.createElement(
        "div",
        { className: "fk-split" },
        import_react.default.createElement(TreePanel, {
          title: "\u7F16\u6392\u76EE\u5F55",
          count: humanCount(pageCount),
          search: searchPages,
          onSearch: setSearchPages,
          groups: pages,
          activeKey: page?.path,
          onSelect: (item) => void openPage(item.path),
          emptyTitle: loading ? "\u6B63\u5728\u8BFB\u53D6\u7F16\u6392\u76EE\u5F55\u2026" : "\u8FD8\u6CA1\u6709\u7F16\u6392\u9875\u9762",
          emptyDetail: loading ? "\u6B63\u5728\u4ECE\u77E5\u8BC6\u5F15\u64CE\u52A0\u8F7D\u9875\u9762\u7D22\u5F15\u3002" : "\u8FD9\u4E2A\u77E5\u8BC6\u5E93\u8FD8\u6CA1\u6709\u7F16\u8BD1\u9875\u9762\uFF0C\u5148\u5728\u98DE\u94FE\u540E\u53F0\u5B8C\u6210\u77E5\u8BC6\u7F16\u6392\uFF0C\u518D\u56DE\u6765\u5237\u65B0\u3002"
        }),
        import_react.default.createElement(
          "div",
          { className: "fk-panel" },
          import_react.default.createElement(PagePreview, {
            page,
            busy: pageBusy,
            onOpenExternal: page ? () => openExternal(page.path) : null
          })
        )
      ) : null,
      tab === "sources" ? import_react.default.createElement(
        "div",
        { className: "fk-split" },
        import_react.default.createElement(TreePanel, {
          title: "\u6765\u6E90\u76EE\u5F55",
          count: humanCount(sources.length),
          search: searchSources,
          onSearch: setSearchSources,
          groups: sourceGroups,
          activeKey: source?.key,
          onSelect: (item) => void openSource(item),
          emptyTitle: loading ? "\u6B63\u5728\u8BFB\u53D6\u6765\u6E90\u76EE\u5F55\u2026" : "\u8FD8\u6CA1\u6709\u6765\u6E90\u6587\u4EF6",
          emptyDetail: loading ? "\u6B63\u5728\u52A0\u8F7D\u6765\u6E90\u6587\u4EF6\u3002" : "\u5728\u98DE\u94FE\u540E\u53F0\u300C\u77E5\u8BC6\u5E93 \u2192 \u6765\u6E90\u300D\u4E0A\u4F20\u6587\u4EF6\u540E\uFF0C\u8FD9\u91CC\u4F1A\u540C\u6B65\u663E\u793A\u3002"
        }),
        import_react.default.createElement(
          "div",
          { className: "fk-panel" },
          import_react.default.createElement(SourcePreview, {
            source,
            busy: sourceBusy,
            onOpenExternal: source ? () => openExternal() : null
          })
        )
      ) : null,
      tab === "graph" ? import_react.default.createElement(GraphView, {
        graph,
        loading: graphLoading,
        error: graphError,
        onReload: () => void loadGraph(true),
        onOpenPage: (path) => void openPage(path)
      }) : null,
      tab === "bots" ? import_react.default.createElement(BotsView, {
        connectors,
        loading: botsLoading,
        error: botsError,
        onReload: () => void loadConnectors(),
        knowledgeBases,
        onToast: showToast,
        onNeedLogin: onSignedOut
      }) : null,
      error ? import_react.default.createElement(
        "div",
        {
          className: "fk-toast",
          style: { background: "var(--fk-red)" }
        },
        error
      ) : null
    ),
    queryOpen ? import_react.default.createElement(QueryDrawer, {
      session,
      activeKb,
      onClose: () => setQueryOpen(false),
      onOpenPage: (path) => {
        setQueryOpen(false);
        void openPage(path);
      }
    }) : null,
    toast ? import_react.default.createElement("div", { className: "fk-toast" }, toast) : null
  );
}
var inject = ["slots"];
function FeilianPage() {
  const [state, setState] = (0, import_react.useState)({ loading: true, signed_in: false });
  const refresh = (0, import_react.useCallback)(async () => {
    try {
      const payload = await api("/state");
      setState({ loading: false, ...payload });
    } catch (caught) {
      setState({ loading: false, signed_in: false, error: caught.message });
    }
  }, []);
  (0, import_react.useEffect)(() => {
    void refresh();
  }, [refresh]);
  const signedOut = (0, import_react.useCallback)(async () => {
    try {
      await api("/logout", { method: "POST" });
    } catch {
    }
    setState({ loading: false, signed_in: false });
  }, []);
  if (state.loading) {
    return import_react.default.createElement(
      "div",
      { className: "fk-root" },
      import_react.default.createElement(
        "div",
        { className: "fk-login" },
        import_react.default.createElement(
          "div",
          { className: "fk-login-card" },
          import_react.default.createElement("div", { className: "fk-skeleton", style: { height: 38, width: "55%", marginBottom: 16 } }),
          import_react.default.createElement("div", { className: "fk-skeleton", style: { height: 12, width: "90%", marginBottom: 10 } }),
          import_react.default.createElement("div", { className: "fk-skeleton", style: { height: 12, width: "75%" } })
        )
      )
    );
  }
  if (!state.signed_in) {
    return import_react.default.createElement(
      "div",
      { className: "fk-root" },
      import_react.default.createElement(LoginView, {
        onSignedIn: (payload) => setState({ loading: false, ...payload })
      })
    );
  }
  return import_react.default.createElement("div", { className: "fk-root" }, import_react.default.createElement(Workspace, { session: state, onSignedOut: signedOut }));
}
function apply(ctx) {
  ctx.slots.inject(
    "sidebar.panellist",
    () => ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: "feilian-kb",
        order: 30,
        label: () => "\u98DE\u94FE\u77E5\u8BC6\u5E93"
      },
      FeilianIcon
    )
  );
  ctx.slots.inject(
    "main",
    () => ctx.slots.register(
      {
        name: "main",
        key: "feilian-kb",
        inject: () => ({})
      },
      FeilianPage
    )
  );
}

