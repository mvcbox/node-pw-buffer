import { MppcDecompressor } from './mppc';
import { PwBufferTypeError } from './errors';
import { Transform, TransformOptions } from 'stream';

export class MppcDecompressorTransform extends Transform  {
  protected readonly _mppcDecompressor: MppcDecompressor;

  public constructor(transformOptions?: TransformOptions) {
    super(Object.assign<TransformOptions, TransformOptions>({
      decodeStrings: true
    }, transformOptions ?? {}));

    this._mppcDecompressor = new MppcDecompressor();
  }

  public _transform(chunk: Buffer, encoding: string, callback: Function): void {
    try {
      if (chunk instanceof Buffer) {
        callback(null, this._mppcDecompressor.update(chunk));
      } else {
        callback(new PwBufferTypeError('INVALID_CHUNK_TYPE'));
      }
    } catch (e) {
      callback(e);
    }
  }
}
