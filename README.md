# Perfect World binary utils

A small TypeScript/Node.js library built on top of [extended-buffer](https://github.com/mvcbox/node-extended-buffer) that adds helpers commonly found in some Perfect World / PW-style binary protocols:

- **CUInt** (compressed unsigned integer) encoding/decoding
- **PW strings**: `CUInt` byte-length prefix + `utf16le` payload
- **PW octets**: `CUInt` byte-length prefix + raw bytes
- **MPPC** compressor/decompressor (stream-friendly) plus optional Node.js `Transform` wrappers

## Install

```bash
npm i pw-buffer
```

## Quick start

```ts
import { PwBuffer } from 'pw-buffer';

const b = new PwBuffer();

b.writeCUInt(123);
b.writePwString('Hello');
b.writePwOctets(Buffer.from([1, 2, 3]));

// Read back
b.setPointer(0);
console.log(b.readCUInt());      // 123
console.log(b.readPwString());   // "Hello"
console.log(b.readPwOctets().nativeBufferView); // <Buffer 01 02 03>
```

## What is `PwBuffer`?

`PwBuffer` extends `ExtendedBuffer` from the `extended-buffer` package. That means you get all of `ExtendedBuffer` features (growable buffer, internal read pointer, append/prepend writes, etc.), plus PW-specific helpers.

### Append vs prepend (`unshift`)

Most write methods support an optional `unshift?: boolean` flag:

- `unshift = false` (default): append to the end
- `unshift = true`: prepend to the start

This is useful when you want to write a payload first and then prepend headers (length, opcode, etc.).

Example: build a length-prefixed packet

```ts
import { PwBuffer } from 'pw-buffer';

const pkt = new PwBuffer();

pkt.writePwString('Alice');       // body
pkt.writePwString('Bob');         //

// Prepend total byte length (example protocol convention)
pkt.writeCUInt(pkt.length, true); // length
pkt.writeCUInt(0x1234, true);     // opcode

console.log(pkt.nativeBufferView);
```

## API

The package exports:

```ts
export * from './utils';
export { PwBuffer } from './PwBuffer';
export type { PwBufferOptions } from './PwBufferOptions';
export { MppcCompressor, MppcDecompressor } from './mppc';
export { MppcCompressorTransform } from './MppcCompressorTransform';
export { MppcDecompressorTransform } from './MppcDecompressorTransform';
```

### `PwBuffer(options?: PwBufferOptions)`

`PwBufferOptions` is currently the same as `ExtendedBufferOptions`:

- `capacity?: number` – initial capacity (bytes)
- `capacityStep?: number` – resize step (bytes)

Example:

```ts
import { PwBuffer } from 'pw-buffer';

const b = new PwBuffer({ capacity: 64 * 1024, capacityStep: 16 * 1024 });
```

### `isReadableCUInt(): boolean`

Checks whether a full `CUInt` value can be read at the current read pointer without running out of data.

This is handy when you parse a stream and may receive partial frames.

```ts
if (b.isReadableCUInt()) {
  const len = b.readCUInt();
  // ...
}
```

### `readCUInt(): number`

Reads a **compressed unsigned integer** at the current read pointer.

- Returns a JavaScript `number` in the range **0…0xFFFFFFFF**.
- Advances the read pointer.

If there are not enough readable bytes, underlying `extended-buffer` reads may throw.

### `writeCUInt(value: number, unshift?: boolean): this`

Writes a **compressed unsigned integer**.

- `value` must be an **integer** in **0…0xFFFFFFFF**.
- If the value is outside the allowed range, it throws an `ExtendedBufferRangeError('CUINT_VALUE_OUT_OF_RANGE')`.

```ts
b.writeCUInt(1);
b.writeCUInt(127);
b.writeCUInt(128);
b.writeCUInt(0xFFFFFFFF);
```

### CUInt encoding format

CUInt uses a leading-bit pattern to choose the byte width:

| Range | Encoded bytes | Notes                           |
|------:|:-------------:|---------------------------------|
| `0x00000000 … 0x0000007F` | 1 | `0xxxxxxx`                      |
| `0x00000080 … 0x00003FFF` | 2 | stored as `value \| 0x8000`     |
| `0x00004000 … 0x1FFFFFFF` | 4 | stored as `value \| 0xC0000000` |
| `0x20000000 … 0xFFFFFFFF` | 5 | marker `0xE0` + 4-byte BE value |

> Implementation note: in the 5-byte case, the first byte is the marker `0xE0`, followed by the 32-bit big-endian value.

### `readPwString(): string`

Reads a PW string:

1. Reads a `CUInt` **byte length** `N`
2. Reads `N` bytes and decodes them as `utf16le`

```ts
b.setPointer(0);
const s = b.readPwString();
```

### `writePwString(value: string, unshift?: boolean): this`

Writes a PW string:

1. Encodes the string to bytes using `utf16le`
2. Writes `CUInt(byteLength)`
3. Writes the bytes

```ts
b.writePwString('Hello');
```

### `readPwOctets(): PwBuffer`

Reads PW octets:

1. Reads a `CUInt` **byte length** `N`
2. Reads `N` raw bytes
3. Returns a **new** `PwBuffer` containing only those bytes

```ts
const oct = b.readPwOctets();
console.log(oct.length);
console.log(oct.nativeBufferView);
```

### `writePwOctets(octets: ExtendedBuffer | Buffer, unshift?: boolean): this`

Writes PW octets:

1. Writes `CUInt(octets.length)`
2. Writes raw `octets` bytes

```ts
b.writePwOctets(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
```

## MPPC compression

The library includes a streaming MPPC compressor and decompressor:

- `MppcCompressor.update(chunk: Buffer): Buffer`
- `MppcDecompressor.update(chunk: Buffer): Buffer`

Both are **stateful**. Create a new instance per independent stream/connection.

### Basic usage

```ts
import { MppcCompressor, MppcDecompressor } from 'pw-buffer';

const input = Buffer.from('hello hello hello', 'utf8');

const c = new MppcCompressor();
const compressed = c.update(input);

const d = new MppcDecompressor();
const decompressed = d.update(compressed);

console.log(decompressed.toString('utf8')); // "hello hello hello"
```

### Streaming usage (chunked)

```ts
import { MppcCompressor, MppcDecompressor } from 'pw-buffer';

const c = new MppcCompressor();
const d = new MppcDecompressor();

const part1 = Buffer.from('hello ', 'utf8');
const part2 = Buffer.from('world', 'utf8');

const c1 = c.update(part1);
const c2 = c.update(part2);

const out1 = d.update(c1);
const out2 = d.update(c2);

console.log(Buffer.concat([out1, out2]).toString('utf8')); // "hello world"
```

## MPPC `Transform` streams

If you prefer Node.js stream piping, you can use the provided transforms:

- `MppcCompressorTransform`
- `MppcDecompressorTransform`

```ts
import fs from 'node:fs';
import { MppcCompressorTransform, MppcDecompressorTransform } from 'pw-buffer';

// Compress a file
fs.createReadStream('input.bin')
  .pipe(new MppcCompressorTransform())
  .pipe(fs.createWriteStream('input.bin.mppc'));

// Decompress a file
fs.createReadStream('input.bin.mppc')
  .pipe(new MppcDecompressorTransform())
  .pipe(fs.createWriteStream('input.bin'));
```

## Error handling tips

- Before reading from a buffer fed by a socket/stream, prefer guard checks such as `isReadable(size)` (from `ExtendedBuffer`) and `isReadableCUInt()`.
- `writeCUInt()` validates the value is an integer and within `0…0xFFFFFFFF`.
- If you need the full set of buffer operations (pointer control, reading/writing primitives, etc.), refer to the upstream [extended-buffer](https://github.com/mvcbox/node-extended-buffer) documentation.

## License

MIT (see the package metadata).
