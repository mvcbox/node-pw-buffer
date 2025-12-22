import { MppcDecompressor } from './mppc';
import { Transform, TransformOptions } from 'stream';

export class MppcDecompressorTransform extends Transform  {
  protected readonly _mppcDecompressor: MppcDecompressor;

  public constructor(transformOptions?: TransformOptions) {
    super(transformOptions);
    this._mppcDecompressor = new MppcDecompressor();
  }

  public _transform(chunk: Buffer | null, encoding: string, callback: Function): void {
    callback(null, chunk ? this._mppcDecompressor.update(chunk) : null);
  }
}
