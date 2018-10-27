'use strict';

const ExtendedBuffer = require('extended-buffer');

class PwBuffer extends ExtendedBuffer
{
    /**
     * @returns {boolean}
     */
    isReadableCUInt() {
        if (!this.isReadable(1)) {
            return false;
        }

        let value = this.readUInt8();
        --this._pointer;

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
     * @returns {number}
     */
    readCUInt(noAssert) {
        let value = this.readUInt8(noAssert);

        switch (value & 0xE0) {
            case 0xE0:
                return this.readUInt32BE(noAssert);
            case 0xC0:
                --this._pointer;
                return this.readUInt32BE(noAssert) & 0x1FFFFFFF;
            case 0x80:
            case 0xA0:
                --this._pointer;
                return this.readUInt16BE(noAssert) & 0x3FFF;
        }

        return value;
    }

    /**
     * @param {PwBuffer} buffer
     * @param {number} value
     * @param {boolean} noAssert
     * @returns {PwBuffer}
     * @private
     */
    _writeCUIntToBuffer(buffer, value, noAssert) {
        let tmp;

        if (value < 0x80) {
            buffer.writeUInt8(value, false, noAssert);
        } else if (value < 0x4000) {
            tmp = value | 0x8000;

            if (tmp < 0) {
                buffer.writeInt16BE(tmp, false, noAssert);
            } else {
                buffer.writeUInt16BE(tmp, false, noAssert);
            }
        } else if (value < 0x20000000) {
            tmp = value | 0xC0000000;

            if (tmp < 0) {
                buffer.writeInt32BE(tmp, false, noAssert);
            } else {
                buffer.writeUInt32BE(tmp, false, noAssert);
            }
        } else {
            buffer.writeUInt8(0xE0, false, noAssert).writeUInt32BE(value, false, noAssert);
        }

        return this;
    }

    /**
     * @param {number} value
     * @param {boolean} unshift
     * @param {boolean} noAssert
     * @returns {PwBuffer}
     */
    writeCUInt(value, unshift, noAssert) {
        if (unshift) {
            let buffer = new this.constructor({
                maxBufferLength: 10
            });

            return this._writeCUIntToBuffer(buffer, value, noAssert)._writeNativeBuffer(buffer.buffer, true);
        }

        return this._writeCUIntToBuffer(this, value, noAssert);
    }

    /**
     * @param {boolean} noAssert
     * @returns {string}
     */
    readPwString(noAssert) {
        return this.readString(this.readCUInt(noAssert), 'utf16le');
    }

    /**
     * @param {string} string
     * @param {boolean} unshift
     * @param {boolean} noAssert
     * @returns {PwBuffer}
     */
    writePwString(string, unshift, noAssert) {
        if (unshift) {
            return this.writeString(string, 'utf16le', true).writeCUInt(Buffer.byteLength(string, 'utf16le'), true, noAssert);
        }

        return this.writeCUInt(Buffer.byteLength(string, 'utf16le'), false, noAssert).writeString(string, 'utf16le', false);
    }

    /**
     * @param {boolean} noAssert
     * @returns {PwBuffer}
     */
    readPwOctets(noAssert) {
        let byteLength = this.readCUInt(noAssert);
        return this.readBuffer(byteLength, false, {
            maxBufferLength: byteLength
        });
    }

    /**
     * @param {PwBuffer|ExtendedBuffer|Buffer} octets
     * @param {boolean} unshift
     * @param {boolean} noAssert
     * @returns {PwBuffer}
     */
    writePwOctets(octets, unshift, noAssert) {
        if (unshift) {
            return this.writeBuffer(octets, true).writeCUInt(octets.length, true, noAssert);
        }

        return this.writeCUInt(octets.length, false, noAssert).writeBuffer(octets, false);
    }
}

module.exports = PwBuffer;
