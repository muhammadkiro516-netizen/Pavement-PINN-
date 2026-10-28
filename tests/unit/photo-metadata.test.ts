/** Privacy: camera metadata is removed from stored photos; the image data is kept. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripPhotoMetadata } from '../../server/services/photoValidation';

const seg = (marker: number, payload: Buffer) => {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
};

test('JPEG: EXIF (APP1) and comments are dropped, APP0 and the scan data are kept', () => {
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0')),
    seg(0xe1, Buffer.from('Exif\0\0GPS-6.2,106.8')),
    seg(0xfe, Buffer.from('owner: Sari')),
    seg(0xdb, Buffer.from('quant')),
    Buffer.from([0xff, 0xda, 0, 4, 1, 2, 9, 9, 9, 0xff, 0xd9])
  ]);
  const out = Buffer.from(stripPhotoMetadata(`data:image/jpeg;base64,${jpeg.toString('base64')}`).split(',')[1], 'base64');
  assert.ok(!out.includes(Buffer.from('GPS')));
  assert.ok(!out.includes(Buffer.from('owner')));
  assert.ok(out.includes(Buffer.from('JFIF')));
  assert.ok(out.includes(Buffer.from('quant')));
  assert.deepEqual(out.subarray(-5), Buffer.from([9, 9, 9, 0xff, 0xd9]));
});

test('PNG: text and eXIf chunks are dropped; other values pass through', () => {
  const chunk = (type: string, data: string) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), Buffer.from(data), Buffer.alloc(4)]);
  };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', 'hdr'), chunk('tEXt', 'GPS'), chunk('IEND', '')]);
  const out = Buffer.from(stripPhotoMetadata(`data:image/png;base64,${png.toString('base64')}`).split(',')[1], 'base64');
  assert.ok(!out.includes(Buffer.from('GPS')));
  assert.ok(out.includes(Buffer.from('IHDR')));
  assert.equal(stripPhotoMetadata('https://example.org/a.jpg'), 'https://example.org/a.jpg');
});
