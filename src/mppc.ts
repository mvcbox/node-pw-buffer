import { Buffer } from 'buffer';
import { nativeBufferSubarray } from 'extended-buffer';

const MPPC_HIST_LEN = 8192;

function readU32BEWithPadding(buffer: Buffer, offset: number): number {
  const b0 = offset < buffer.length ? buffer[offset]! : 0;
  const b1 = offset + 1 < buffer.length ? buffer[offset + 1]! : 0;
  const b2 = offset + 2 < buffer.length ? buffer[offset + 2]! : 0;
  const b3 = offset + 3 < buffer.length ? buffer[offset + 3]! : 0;
  return (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0);
}

class BitWriter {
  private out: number[] = [];
  private bitBuf = 0;
  private bitCount = 0;

  public writeBits(value: number, bits: number): void {
    if (bits <= 0) {
      return;
    }

    if (bits > 31) {
      throw new Error(`BitWriter.writeBits: bits=${bits} too large`);
    }

    // Keep only requested bit-width.
    const mask = bits === 31 ? 0x7FFFFFFF : (1 << bits) - 1;
    const v = (value & mask) >>> 0;

    // `bitBuf` is intentionally kept small between calls (<= 7 pending bits).
    // During this call it can briefly grow to <= 38 bits, which fits into
    // a JS Number exactly (safe integer limit is 53 bits).
    this.bitBuf = (this.bitBuf * (2 ** bits)) + v;
    this.bitCount += bits;

    while (this.bitCount >= 8) {
      const shift = this.bitCount - 8;
      const byte = Math.floor(this.bitBuf / (2 ** shift)) & 0xFF;
      this.out.push(byte);

      this.bitCount -= 8;

      if (this.bitCount === 0) {
        this.bitBuf = 0;
      } else {
        this.bitBuf = this.bitBuf % (2 ** this.bitCount);
      }
    }
  }

  public alignToByteWithZeroPadding(): void {
    const mod = this.bitCount & 7;

    if (mod) {
      this.writeBits(0, 8 - mod);
    }
  }

  public flushBytes(): Buffer {
    if (!this.out.length) {
      return Buffer.alloc(0);
    }

    const buffer = Buffer.from(this.out);
    this.out = [];
    return buffer;
  }

  public getPendingBitCount(): number {
    return this.bitCount;
  }
}

export class MppcDecompressor {
  private history = new Uint8Array(MPPC_HIST_LEN);
  private histPtr = 0;
  private bitOffset = 0; // 0..7
  private legacy = Buffer.alloc(0); // pending compressed bytes

  public update(chunk: Buffer): Buffer {
    if (chunk.length) {
      this.legacy = Buffer.concat([this.legacy, chunk]);
    }

    let rptr = 0;
    let bitShift = this.bitOffset;
    let consumedBits = 7;
    const totalBits = this.legacy.length * 8 - bitShift;

    let savedBitShift = 0;
    let savedRptr = 0;

    const outParts: Buffer[] = [];
    let histHead = this.histPtr;

    const passBits = (n: number): boolean => {
      bitShift += n;
      consumedBits += n;

      if (consumedBits < totalBits) {
        return true;
      }

      bitShift = savedBitShift;
      rptr = savedRptr;
      return false;
    };

    const fetch = (): number => {
      rptr += bitShift >>> 3;
      bitShift &= 7;
      return ((readU32BEWithPadding(this.legacy, rptr) << bitShift) >>> 0);
    };

    while (totalBits > consumedBits) {
      savedBitShift = bitShift;
      savedRptr = rptr;

      let val = fetch();

      // 8-bit literal: 0xxxxxxx
      if (val < 0x80000000) {
        if (!passBits(8)) {
          break;
        }

        this.history[this.histPtr++] = (val >>> 24) & 0xFF;
        continue;
      }

      // 9-bit literal: 10xxxxxxx
      if (val < 0xC0000000) {
        if (!passBits(9)) {
          break;
        }

        this.history[this.histPtr++] = (((val >>> 23) | 0x80) & 0xFF) >>> 0;
        continue;
      }

      // Copy token: offset + length
      let off = 0;

      if (val >= 0xF0000000) {
        // 1111 + 6 bits
        if (!passBits(10)) {
          break;
        }

        off = (val >>> 22) & 0x3F;

        // Flush marker: offset=0
        if (off === 0) {
          const advance = 8 - (bitShift & 7);

          if (advance < 8) {
            if (!passBits(advance)) {
              break;
            }
          }

          if (this.histPtr > histHead) {
            outParts.push(Buffer.from(this.history.subarray(histHead, this.histPtr)));
          }

          if (this.histPtr === MPPC_HIST_LEN) {
            this.histPtr = 0;
          }

          histHead = this.histPtr;
          continue;
        }
      } else if (val >= 0xE0000000) {
        // 1110 + 8 bits
        if (!passBits(12)) {
          break;
        }

        off = ((val >>> 20) & 0xFF) + 64;
      } else if (val >= 0xC0000000) {
        // 110 + 13 bits
        if (!passBits(16)) {
          break;
        }

        off = ((val >>> 16) & 0x1FFF) + 320;
      }

      val = fetch();
      let len = 0;

      if (val < 0x80000000) {
        if (!passBits(1)) {
          break;
        }

        len = 3;
      } else if (val < 0xC0000000) {
        if (!passBits(4)) {
          break;
        }

        len = 4 | ((val >>> 28) & 3);
      } else if (val < 0xE0000000) {
        if (!passBits(6)) {
          break;
        }

        len = 8 | ((val >>> 26) & 7);
      } else if (val < 0xF0000000) {
        if (!passBits(8)) {
          break;
        }

        len = 16 | ((val >>> 24) & 15);
      } else if (val < 0xF8000000) {
        if (!passBits(10)) {
          break;
        }

        len = 32 | ((val >>> 22) & 0x1F);
      } else if (val < 0xFC000000) {
        if (!passBits(12)) {
          break;
        }

        len = 64 | ((val >>> 20) & 0x3F);
      } else if (val < 0xFE000000) {
        if (!passBits(14)) {
          break;
        }

        len = 128 | ((val >>> 18) & 0x7F);
      } else if (val < 0xFF000000) {
        if (!passBits(16)) {
          break;
        }

        len = 256 | ((val >>> 16) & 0xFF);
      } else if (val < 0xFF800000) {
        if (!passBits(18)) {
          break;
        }

        len = 0x200 | ((val >>> 14) & 0x1FF);
      } else if (val < 0xFFC00000) {
        if (!passBits(20)) {
          break;
        }

        len = 0x400 | ((val >>> 12) & 0x3FF);
      } else if (val < 0xFFE00000) {
        if (!passBits(22)) {
          break;
        }

        len = 0x800 | ((val >>> 10) & 0x7FF);
      } else if (val < 0xFFF00000) {
        if (!passBits(24)) {
          break;
        }

        len = 0x1000 | ((val >>> 8) & 0xFFF);
      } else {
        // Not enough bits available.
        bitShift = savedBitShift;
        rptr = savedRptr;
        break;
      }

      const src = this.histPtr - off;
      const dstEnd = this.histPtr + len;

      if (src < 0 || dstEnd > MPPC_HIST_LEN) {
        break;
      }

      for (let i = 0; i < len; i++) {
        this.history[this.histPtr + i] = this.history[src + i]!;
      }

      this.histPtr = dstEnd;
    }

    if (this.histPtr > histHead) {
      outParts.push(Buffer.from(this.history.subarray(histHead, this.histPtr)));
    }

    this.legacy = nativeBufferSubarray(this.legacy, rptr);
    this.bitOffset = bitShift;
    return outParts.length ? Buffer.concat(outParts) : Buffer.alloc(0);
  }
}

export class MppcCompressor {
  private history = new Uint8Array(MPPC_HIST_LEN);
  private histPtr = 0;
  private readonly bw = new BitWriter();
  private readonly dict = new Map<number, number[]>();

  private key3(b0: number, b1: number, b2: number): number {
    return ((b0 & 0xFF) << 16) | ((b1 & 0xFF) << 8) | (b2 & 0xFF);
  }

  private addPosToDict(pos: number): void {
    if (pos < 0 || pos + 2 >= this.histPtr) {
      return;
    }

    const key = this.key3(this.history[pos]!, this.history[pos + 1]!, this.history[pos + 2]!);
    let arr = this.dict.get(key);

    if (!arr) {
      arr = [];
      this.dict.set(key, arr);
    }

    arr.push(pos);

    // Keep only recent positions (controls CPU/memory).
    if (arr.length > 64) {
      arr.splice(0, arr.length - 64);
    }
  }

  private pushHistoryByte(b: number): void {
    this.history[this.histPtr] = b & 0xFF;
    this.histPtr++;
    this.addPosToDict(this.histPtr - 3);
  }

  private writeLiteral(b: number): void {
    if ((b & 0x80) === 0) {
      this.bw.writeBits(b & 0xFF, 8);
      return;
    }

    // 9-bit literal: 10xxxxxxx (only 7 bits are carried; top bit is implied 1).
    this.bw.writeBits(0x100 | (b & 0x7F), 9);
  }

  private writeOffset(off: number): void {
    if (off < 0) {
      throw new Error(`MPPC offset underflow: ${off}`);
    }

    if (off < 64) {
      // 1111 + 6 bits
      this.bw.writeBits((0b1111 << 6) | (off & 0x3F), 10);
      return;
    }

    if (off < 320) {
      // 1110 + 8 bits
      this.bw.writeBits((0b1110 << 8) | ((off - 64) & 0xFF), 12);
      return;
    }

    // 110 + 13 bits
    this.bw.writeBits((0b110 << 13) | ((off - 320) & 0x1FFF), 16);
  }

  private writeLength(len: number): void {
    if (len < 3) {
      throw new Error(`MPPC length too small: ${len}`);
    }

    if (len === 3) {
      this.bw.writeBits(0, 1);
      return;
    }

    if (len <= 7) {
      this.bw.writeBits((0b10 << 2) | (len - 4), 4);
      return;
    }

    if (len <= 15) {
      this.bw.writeBits((0b110 << 3) | (len - 8), 6);
      return;
    }

    if (len <= 31) {
      this.bw.writeBits((0b1110 << 4) | (len - 16), 8);
      return;
    }

    if (len <= 63) {
      this.bw.writeBits((0b11110 << 5) | (len - 32), 10);
      return;
    }

    if (len <= 127) {
      this.bw.writeBits((0b111110 << 6) | (len - 64), 12);
      return;
    }

    if (len <= 255) {
      this.bw.writeBits((0b1111110 << 7) | (len - 128), 14);
      return;
    }

    if (len <= 511) {
      this.bw.writeBits((0b11111110 << 8) | (len - 256), 16);
      return;
    }

    if (len <= 1023) {
      this.bw.writeBits((0b111111110 << 9) | (len - 512), 18);
      return;
    }

    if (len <= 2047) {
      this.bw.writeBits((0b1111111110 << 10) | (len - 1024), 20);
      return;
    }

    if (len <= 4095) {
      this.bw.writeBits((0b11111111110 << 11) | (len - 2048), 22);
      return;
    }

    if (len <= 8191) {
      this.bw.writeBits((0b111111111110 << 12) | (len - 4096), 24);
      return;
    }

    throw new Error(`MPPC length too large: ${len}`);
  }

  private writeFlushMarker(): void {
    // Special marker: offset=0 (1111 000000) + pad to byte boundary.
    this.writeOffset(0);
    this.bw.alignToByteWithZeroPadding();
  }

  private resetSegment(): void {
    this.histPtr = 0;
    this.dict.clear();
  }

  public update(chunk: Buffer): Buffer {
    const flushBoundary = true;
    const parts: Buffer[] = [];

    let i = 0;

    while (i < chunk.length) {
      if (this.histPtr === MPPC_HIST_LEN) {
        this.writeFlushMarker();
        parts.push(this.bw.flushBytes());
        this.resetSegment();
      }

      const remainingHist = MPPC_HIST_LEN - this.histPtr;
      const remainingIn = chunk.length - i;
      const limit = remainingIn < remainingHist ? remainingIn : remainingHist;

      if (limit <= 0) {
        break;
      }

      // Try to find a match (min 3 bytes) in current segment history.
      let bestLen = 0;
      let bestOff = 0;

      if (limit >= 3 && this.histPtr >= 3) {
        const key = this.key3(chunk[i]!, chunk[i + 1]!, chunk[i + 2]!);
        const candidates = this.dict.get(key);

        if (candidates?.length) {
          let checked = 0;

          for (let c = candidates.length - 1; c >= 0; c--) {
            const pos = candidates[c]!;
            const off = this.histPtr - pos;

            if (off <= 0 || off > this.histPtr) {
              continue;
            }

            if (off > 0x1FFF + 320) {
              continue;
            }

            const maxLen = Math.min(limit, this.histPtr - pos, 8191);
            let l = 3;

            while (l < maxLen && this.history[pos + l] === chunk[i + l]) {
              l++;
            }

            if (l > bestLen) {
              bestLen = l;
              bestOff = off;

              if (bestLen === maxLen) {
                break;
              }
            }

            if (++checked >= 32) {
              break;
            }
          }
        }
      }

      if (bestLen >= 3 && bestOff > 0) {
        this.writeOffset(bestOff);
        this.writeLength(bestLen);

        for (let k = 0; k < bestLen; k++) {
          this.pushHistoryByte(chunk[i + k]!);
        }

        i += bestLen;
      } else {
        const b = chunk[i]!;
        this.writeLiteral(b);
        this.pushHistoryByte(b);
        i++;
      }

      const flushed = this.bw.flushBytes();

      if (flushed.length) {
        parts.push(flushed);
      }
    }

    if (flushBoundary) {
      this.writeFlushMarker();
      const flushed = this.bw.flushBytes();

      if (flushed.length) {
        parts.push(flushed);
      }

      if (this.histPtr === MPPC_HIST_LEN) {
        this.resetSegment();
      }
    }

    if (!parts.length) {
      return Buffer.alloc(0);
    }

    return parts.length === 1 ? parts[0]! : Buffer.concat(parts);
  }
}
