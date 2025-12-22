import { Buffer } from 'buffer';
import * as utils from './utils';
import { ExtendedBuffer } from 'extended-buffer';
import type { PwBufferOptions } from './PwBufferOptions';

export class PwBuffer extends ExtendedBuffer {
  protected createInstance(options?: PwBufferOptions): this {
    const ThisClass = this.constructor as unknown as new (opts?: PwBufferOptions) => this;
    return new ThisClass(options);
  }

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
    let value = this.readUIntBE(1);

    switch (value & 0xE0) {
      case 0xE0: {
        try {
          return this.readUIntBE(4);
        } catch (e) {
          this._pointer--;
        }
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
  }

  public writeCUInt(value: number, unshift?: boolean): this {
    utils.writeCUIntToPwBuffer(this, value, unshift);
    return this;
  }

  public readPwString(): string {
    return this.readString(this.readCUInt(), 'utf16le');
  }

  public writePwString(string: string, unshift?: boolean): this {
    const bytes = Buffer.from(string, 'utf16le');

    if (unshift) {
      return this.writeNativeBuffer(bytes, true).writeCUInt(bytes.length, true);
    }

    return this.writeCUInt(bytes.length).writeNativeBuffer(bytes);
  }

  public readPwOctets(): this {
    let byteLength = this.readCUInt();

    return this.readBuffer(byteLength, false, {
      capacity: 0,
      capacityStep: 0
    });
  }

  public writePwOctets(octets: ExtendedBuffer | Buffer, unshift?: boolean): this {
    if (unshift) {
      return this.writeBuffer(octets, true).writeCUInt(octets.length, true);
    }

    return this.writeCUInt(octets.length).writeBuffer(octets);
  }
}
