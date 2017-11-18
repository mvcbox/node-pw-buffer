'use strict';

const ExtendedBuffer = require('extended-buffer');

class PwBuffer extends ExtendedBuffer
{
    /**
     * @return {boolean}
     */
    isReadableCUInt() {
        if (!this.isReadable(1)) {
            return false;
        }

        let value = this.readUInt8();
        this.offset(-1);

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

    /**
     * @param {boolean} noAssert
     * @return {number}
     */
    readCUInt(noAssert) {
        let value = this.readUInt8(noAssert);

        switch (value & 0xE0) {
            case 0xE0:
                return this.readUInt32BE(noAssert);
            case 0xC0:
                return this.offset(-1).readUInt32BE(noAssert) & 0x1FFFFFFF;
            case 0x80:
            case 0xA0:
                return this.offset(-1).readUInt16BE(noAssert) & 0x3FFF;
        }

        return value;
    }

    /**
     * @param {number} value
     * @param {boolean} unshift
     * @param {boolean} noAssert
     * @return {PwBuffer}
     */
    writeCUInt(value, unshift, noAssert) {
        if (unshift) {
            let buffer = new this.constructor({
                maxBufferLength: 10
            });

            if (value <= 0x7F) {
                buffer.writeUInt8(value, false, noAssert);
            } else if (value <= 0x3FFF) {
                buffer.writeUInt16BE(value | 0x8000, false, noAssert);
            } else if (value <= 0x1FFFFFFF) {
                buffer.writeUInt32BE(value | 0xC0000000, false, noAssert);
            } else {
                buffer.writeUInt8(0xE0, false, noAssert).writeUInt32BE(value, false, noAssert);
            }

            return this._writeNativeBuffer(buffer.buffer, true);
        }

        if (value <= 0x7F) {
            this.writeUInt8(value, false, noAssert);
        } else if (value <= 0x3FFF) {
            this.writeUInt16BE(value | 0x8000, false, noAssert);
        } else if (value <= 0x1FFFFFFF) {
            this.writeUInt32BE(value | 0xC0000000, false, noAssert);
        } else {
            this.writeUInt8(0xE0, false, noAssert).writeUInt32BE(value, false, noAssert);
        }

        return this;
    }
}

module.exports = PwBuffer;
