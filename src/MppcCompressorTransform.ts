import { MppcCompressor } from './mppc';
import { PwBufferTypeError } from './errors';
import { Transform, TransformOptions } from 'stream';

export class MppcCompressorTransform extends Transform  {
  protected readonly _mppcCompressor: MppcCompressor;

  public constructor(transformOptions?: TransformOptions) {
    super(Object.assign<TransformOptions, TransformOptions>({
      decodeStrings: true
    }, transformOptions ?? {}));

    this._mppcCompressor = new MppcCompressor();
  }

  public _transform(chunk: Buffer, encoding: string, callback: Function): void {
    try {
      if (chunk instanceof Buffer) {
        callback(null, this._mppcCompressor.update(chunk));
      } else {
        callback(new PwBufferTypeError('INVALID_CHUNK_TYPE'));
      }
    } catch (e) {
      callback(e);
    }
  }
}
