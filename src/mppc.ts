import { Buffer } from 'buffer';
import { nativeBufferSubarray } from 'extended-buffer';

const MPPC_HIST_LEN = 8192;

function readU32BEWithPadding(buf: Buffer, offset: number): number {
	const b0 = offset < buf.length ? buf[offset] : 0;
	const b1 = offset + 1 < buf.length ? buf[offset + 1] : 0;
	const b2 = offset + 2 < buf.length ? buf[offset + 2] : 0;
	const b3 = offset + 3 < buf.length ? buf[offset + 3] : 0;
	return (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0);
}

class BitWriter {
	private out: number[] = [];
	private bitBuf: bigint = 0n;
	private bitCount = 0; // number of bits currently in bitBuf

	writeBits(value: number, bits: number) {
		if (bits <= 0) return;
		if (bits > 31) throw new Error(`BitWriter.writeBits: bits=${bits} too large`);
		const mask = bits === 31 ? 0x7fffffff : (1 << bits) - 1;
		const v = value & mask;
		this.bitBuf = (this.bitBuf << BigInt(bits)) | BigInt(v >>> 0);
		this.bitCount += bits;
		while (this.bitCount >= 8) {
			const shift = this.bitCount - 8;
			const byte = Number((this.bitBuf >> BigInt(shift)) & 0xffn);
			this.out.push(byte);
			this.bitCount -= 8;
			if (this.bitCount === 0) this.bitBuf = 0n;
			else this.bitBuf &= (1n << BigInt(this.bitCount)) - 1n;
		}
	}

	alignToByteWithZeroPadding() {
		const mod = this.bitCount & 7;
		if (mod) this.writeBits(0, 8 - mod);
	}

	flushBytes(): Buffer {
		if (!this.out.length) return Buffer.alloc(0);
		const b = Buffer.from(this.out);
		this.out = [];
		return b;
	}

	getPendingBitCount(): number {
		return this.bitCount;
	}
}

export class MppcDecompressor {
	private history = new Uint8Array(MPPC_HIST_LEN);
	private histPtr = 0;
	private bitOffset = 0; // 0..7
	private legacy = Buffer.alloc(0); // pending compressed bytes

	update(chunk: Buffer): Buffer {
		if (chunk.length) this.legacy = Buffer.concat([this.legacy, chunk]);

		let rptr = 0;
		let l = this.bitOffset;
		let blen = 7;
		const blenTotal = this.legacy.length * 8 - l;

		let adjustL = 0;
		let adjustRptr = 0;

		const outParts: Buffer[] = [];
		let histHead = this.histPtr;

		const passbits = (n: number): boolean => {
			l += n;
			blen += n;
			if (blen < blenTotal) return true;
			l = adjustL;
			rptr = adjustRptr;
			return false;
		};

		const fetch = (): number => {
			rptr += l >>> 3;
			l &= 7;
			return ((readU32BEWithPadding(this.legacy, rptr) << l) >>> 0);
		};

		while (blenTotal > blen) {
			adjustL = l;
			adjustRptr = rptr;
			let val = fetch();

			if (val < 0x80000000) {
				if (!passbits(8)) break;
				this.history[this.histPtr++] = (val >>> 24) & 0xff;
				continue;
			}
			if (val < 0xc0000000) {
				if (!passbits(9)) break;
				this.history[this.histPtr++] = (((val >>> 23) | 0x80) & 0xff) >>> 0;
				continue;
			}

			let off = 0;
			if (val >= 0xf0000000) {
				if (!passbits(10)) break;
				off = (val >>> 22) & 0x3f;
				if (off === 0) {
					const advance = 8 - (l & 7);
					if (advance < 8) {
						if (!passbits(advance)) break;
					}
					if (this.histPtr > histHead) outParts.push(Buffer.from(this.history.subarray(histHead, this.histPtr)));
					if (this.histPtr === MPPC_HIST_LEN) this.histPtr = 0;
					histHead = this.histPtr;
					continue;
				}
			} else if (val >= 0xe0000000) {
				if (!passbits(12)) break;
				off = ((val >>> 20) & 0xff) + 64;
			} else if (val >= 0xc0000000) {
				if (!passbits(16)) break;
				off = ((val >>> 16) & 0x1fff) + 320;
			}

			val = fetch();
			let len = 0;
			if (val < 0x80000000) {
				if (!passbits(1)) break;
				len = 3;
			} else if (val < 0xc0000000) {
				if (!passbits(4)) break;
				len = 4 | ((val >>> 28) & 3);
			} else if (val < 0xe0000000) {
				if (!passbits(6)) break;
				len = 8 | ((val >>> 26) & 7);
			} else if (val < 0xf0000000) {
				if (!passbits(8)) break;
				len = 16 | ((val >>> 24) & 15);
			} else if (val < 0xf8000000) {
				if (!passbits(10)) break;
				len = 32 | ((val >>> 22) & 0x1f);
			} else if (val < 0xfc000000) {
				if (!passbits(12)) break;
				len = 64 | ((val >>> 20) & 0x3f);
			} else if (val < 0xfe000000) {
				if (!passbits(14)) break;
				len = 128 | ((val >>> 18) & 0x7f);
			} else if (val < 0xff000000) {
				if (!passbits(16)) break;
				len = 256 | ((val >>> 16) & 0xff);
			} else if (val < 0xff800000) {
				if (!passbits(18)) break;
				len = 0x200 | ((val >>> 14) & 0x1ff);
			} else if (val < 0xffc00000) {
				if (!passbits(20)) break;
				len = 0x400 | ((val >>> 12) & 0x3ff);
			} else if (val < 0xffe00000) {
				if (!passbits(22)) break;
				len = 0x800 | ((val >>> 10) & 0x7ff);
			} else if (val < 0xfff00000) {
				if (!passbits(24)) break;
				len = 0x1000 | ((val >>> 8) & 0xfff);
			} else {
				l = adjustL;
				rptr = adjustRptr;
				break;
			}

			const src = this.histPtr - off;
			const dstEnd = this.histPtr + len;
			if (src < 0 || dstEnd > MPPC_HIST_LEN) break;

			for (let i = 0; i < len; i++) this.history[this.histPtr + i] = this.history[src + i];
			this.histPtr = dstEnd;
		}

		if (this.histPtr > histHead) outParts.push(Buffer.from(this.history.subarray(histHead, this.histPtr)));

		this.legacy = nativeBufferSubarray(this.legacy, rptr);
		this.bitOffset = l;
		return outParts.length ? Buffer.concat(outParts) : Buffer.alloc(0);
	}
}

export class MppcCompressor {
	private history = new Uint8Array(MPPC_HIST_LEN);
	private histPtr = 0;
	private readonly bw = new BitWriter();
	private readonly dict = new Map<number, number[]>();

	private key3(b0: number, b1: number, b2: number): number {
		return ((b0 & 0xff) << 16) | ((b1 & 0xff) << 8) | (b2 & 0xff);
	}

	private addPosToDict_(pos: number) {
		if (pos < 0 || pos + 2 >= this.histPtr) return;
		const key = this.key3(this.history[pos]!, this.history[pos + 1]!, this.history[pos + 2]!);
		let arr = this.dict.get(key);
		if (!arr) {
			arr = [];
			this.dict.set(key, arr);
		}
		arr.push(pos);
		// Keep only recent positions (controls CPU/memory).
		if (arr.length > 64) arr.splice(0, arr.length - 64);
	}

	private pushHistoryByte_(b: number) {
		this.history[this.histPtr] = b & 0xff;
		this.histPtr++;
		this.addPosToDict_(this.histPtr - 3);
	}

	private writeLiteral_(b: number) {
		if ((b & 0x80) === 0) {
			this.bw.writeBits(b & 0xff, 8);
			return;
		}
		// 9-bit literal: 10xxxxxxx (only 7 bits are carried; top bit is implied 1).
		this.bw.writeBits(0x100 | (b & 0x7f), 9);
	}

	private writeOffset_(off: number) {
		if (off < 0) throw new Error(`MPPC offset underflow: ${off}`);
		if (off < 64) {
			// 1111 + 6 bits
			this.bw.writeBits((0b1111 << 6) | (off & 0x3f), 10);
			return;
		}
		if (off < 320) {
			// 1110 + 8 bits
			this.bw.writeBits((0b1110 << 8) | ((off - 64) & 0xff), 12);
			return;
		}
		// 110 + 13 bits
		this.bw.writeBits((0b110 << 13) | ((off - 320) & 0x1fff), 16);
	}

	private writeLength_(len: number) {
		if (len < 3) throw new Error(`MPPC length too small: ${len}`);
		if (len === 3) return void this.bw.writeBits(0, 1);
		if (len <= 7) return void this.bw.writeBits((0b10 << 2) | (len - 4), 4);
		if (len <= 15) return void this.bw.writeBits((0b110 << 3) | (len - 8), 6);
		if (len <= 31) return void this.bw.writeBits((0b1110 << 4) | (len - 16), 8);
		if (len <= 63) return void this.bw.writeBits((0b11110 << 5) | (len - 32), 10);
		if (len <= 127) return void this.bw.writeBits((0b111110 << 6) | (len - 64), 12);
		if (len <= 255) return void this.bw.writeBits((0b1111110 << 7) | (len - 128), 14);
		if (len <= 511) return void this.bw.writeBits((0b11111110 << 8) | (len - 256), 16);
		if (len <= 1023) return void this.bw.writeBits((0b111111110 << 9) | (len - 512), 18);
		if (len <= 2047) return void this.bw.writeBits((0b1111111110 << 10) | (len - 1024), 20);
		if (len <= 4095) return void this.bw.writeBits((0b11111111110 << 11) | (len - 2048), 22);
		if (len <= 8191) return void this.bw.writeBits((0b111111111110 << 12) | (len - 4096), 24);
		throw new Error(`MPPC length too large: ${len}`);
	}

	private writeFlushMarker_() {
		// Special marker: offset=0 (1111 000000) + pad to byte boundary.
		this.writeOffset_(0);
		this.bw.alignToByteWithZeroPadding();
	}

	private resetSegment_() {
		this.histPtr = 0;
		this.dict.clear();
	}

	update(chunk: Buffer): Buffer {
    const flushBoundary = true;
		const parts: Buffer[] = [];

		let i = 0;
		while (i < chunk.length) {
			if (this.histPtr === MPPC_HIST_LEN) {
				this.writeFlushMarker_();
				parts.push(this.bw.flushBytes());
				this.resetSegment_();
			}

			const remainingHist = MPPC_HIST_LEN - this.histPtr;
			const remainingIn = chunk.length - i;
			const limit = remainingIn < remainingHist ? remainingIn : remainingHist;

			if (limit <= 0) break;

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
						if (off <= 0 || off > this.histPtr) continue;
						if (off === 0) continue;
						if (off > 0x1fff + 320) continue;

						const maxLen = Math.min(limit, this.histPtr - pos, 8191);
						let l = 3;
						while (l < maxLen && this.history[pos + l] === chunk[i + l]) l++;
						if (l > bestLen) {
							bestLen = l;
							bestOff = off;
							if (bestLen === maxLen) break;
						}
						if (++checked >= 32) break;
					}
				}
			}

			if (bestLen >= 3 && bestOff > 0) {
				this.writeOffset_(bestOff);
				this.writeLength_(bestLen);
				for (let k = 0; k < bestLen; k++) this.pushHistoryByte_(chunk[i + k]!);
				i += bestLen;
			} else {
				const b = chunk[i]!;
				this.writeLiteral_(b);
				this.pushHistoryByte_(b);
				i++;
			}

			const flushed = this.bw.flushBytes();
			if (flushed.length) parts.push(flushed);
		}

		if (flushBoundary) {
			this.writeFlushMarker_();
			const flushed = this.bw.flushBytes();
			if (flushed.length) parts.push(flushed);
			if (this.histPtr === MPPC_HIST_LEN) this.resetSegment_();
		}

		if (!parts.length) return Buffer.alloc(0);
		return parts.length === 1 ? parts[0]! : Buffer.concat(parts);
	}
}
