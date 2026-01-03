import { PwBufferRangeError } from '../errors';
import { assertInteger, ExtendedBuffer } from 'extended-buffer';

export function writeCUIntToPwBuffer(buffer: ExtendedBuffer, value: number, unshift?: boolean): void {
  assertInteger(value);

  if (value < 0 || value > 0xFFFFFFFF) {
    throw new PwBufferRangeError('CUINT_VALUE_OUT_OF_RANGE');
  }

  if (value < 0x80) {
    buffer.writeUIntBE(value & 0xFF, 1, unshift);
  } else if (value < 0x4000) {
    buffer.writeUIntBE((value | 0x8000) & 0xFFFF, 2, unshift);
  } else if (value < 0x20000000) {
    buffer.writeUIntBE((value | 0xC0000000) >>> 0, 4, unshift);
  } else {
    if (unshift) {
      buffer.allocStart(5).writeUIntBE(value >>> 0, 4, true).writeUIntBE(0xE0, 1, true);
    } else {
      buffer.allocEnd(5).writeUIntBE(0xE0, 1).writeUIntBE(value >>> 0, 4);
    }
  }
}
