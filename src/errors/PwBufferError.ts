import { ExtendedBufferError } from 'extended-buffer';

export class PwBufferError extends ExtendedBufferError {
  public constructor(message?: string) {
    super(message);
    this.name = new.target.name;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }
}
