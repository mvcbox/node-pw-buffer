import { MppcCompressor } from './mppc';
import { Transform, TransformOptions } from 'stream';

export class MppcCompressorTransform extends Transform  {
  protected readonly _mppcCompressor: MppcCompressor;

  public constructor(transformOptions?: TransformOptions) {
    super(transformOptions);
    this._mppcCompressor = new MppcCompressor();
  }

  public _transform(chunk: Buffer | null, encoding: string, callback: Function): void {
    callback(null, chunk ? this._mppcCompressor.update(chunk) : null);
  }
}
