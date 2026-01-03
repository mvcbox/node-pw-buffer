import { Buffer } from 'buffer';
import * as utils from './utils';
import type { PwBufferOptions } from './PwBufferOptions';
import { ExtendedBuffer, ExtendedBufferOptions } from 'extended-buffer';

export class PwBuffer<PBO extends PwBufferOptions = PwBufferOptions> extends ExtendedBuffer<PBO> {
  public isReadableCUInt(): boolean {
    if (!this.isReadable(1)) {
      return false;
    }

    let value = this.readUIntBE(1);
    this._pointer--;

    switch (value & 0xE0) {
      case 0xE0:
        return this.isReadable(5);
      case 0xC0:
        return this.isReadable(4);
      case 0x80:
      case 0xA0:
        return this.isReadable(2);
    }

    return true;
  }

  public readCUInt(): number {
    const savedPointer = this.getPointer();

    try {
      const value = this.readUIntBE(1);

      switch (value & 0xE0) {
        case 0xE0: {
          return this.readUIntBE(4);
        }
        case 0xC0: {
          this._pointer--;
          return this.readUIntBE(4) & 0x1FFFFFFF;
        }
        case 0x80:
        case 0xA0: {
          this._pointer--;
          return this.readUIntBE(2) & 0x3FFF;
        }
      }

      return value;
    } catch (e) {
      this.setPointer(savedPointer);
      throw e;
    }
  }

  public writeCUInt(value: number, unshift?: boolean): this {
    const data = new PwBuffer({
      capacity: 5,
      capacityStep: 0
    });

    utils.writeCUIntToPwBuffer(data, value);
    return this.writeNativeBuffer(data.nativeBufferView, unshift);
  }

  public readPwString(): string {
    const savedPointer = this.getPointer();

    try {
      return this.readString(this.readCUInt(), 'utf16le');
    } catch (e) {
      this.setPointer(savedPointer);
      throw e;
    }
  }

  public writePwString(string: string, unshift?: boolean): this {
    const octets = Buffer.from(string, 'utf16le');
    return this.writePwOctets(octets, unshift);
  }

  public readPwOctets(): this {
    const savedPointer = this.getPointer();

    try {
      const byteLength = this.readCUInt();

      return this.readBuffer(byteLength, false, {
        capacity: byteLength,
        capacityStep: 0
      } as PBO);
    } catch (e) {
      this.setPointer(savedPointer);
      throw e;
    }
  }

  public writePwOctets(octets: ExtendedBuffer<ExtendedBufferOptions> | Buffer, unshift?: boolean): this {
    const data = (new PwBuffer({
      capacity: octets.length + 5,
      capacityStep: 0
    })).writeCUInt(octets.length).writeBuffer(octets);

    return this.writeNativeBuffer(data.nativeBufferView, unshift);
  }
}
