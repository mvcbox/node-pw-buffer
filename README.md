# node-pw-buffer
PW Buffer

```typescript
import { ExtendedBuffer, ExtendedBufferOptions } from 'extended-buffer';
export interface PwBufferOptions extends ExtendedBufferOptions {
}
export declare class PwBuffer extends ExtendedBuffer {
    isReadableCUInt(): boolean;
    readCUInt(noAssert?: boolean): number;
    _writeCUIntToBuffer(buffer: this, value: number, noAssert?: boolean): this;
    writeCUInt(value: number, unshift?: boolean, noAssert?: boolean): this;
    readPwString(noAssert?: boolean): string;
    writePwString(string: string, unshift?: boolean, noAssert?: boolean): this;
    readPwOctets(noAssert?: boolean): this;
    writePwOctets(octets: this | Buffer, unshift?: boolean, noAssert?: boolean): this;
}
```
