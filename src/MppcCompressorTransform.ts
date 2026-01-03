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

  public _transform(chunk: Buffer | string, encoding: string, callback: Function): void {
    try {
      if (chunk instanceof Buffer) {
        this.push(this._mppcCompressor.update(chunk));
        callback();
      } else if (typeof chunk === 'string') {
        this.push(this._mppcCompressor.update(Buffer.from(chunk, encoding)));
        callback();
      } else {
        callback(new PwBufferTypeError('INVALID_CHUNK_TYPE'));
      }
    } catch (e) {
      callback(e);
    }
  }
}
