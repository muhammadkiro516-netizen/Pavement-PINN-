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

import { photoGpsPosition } from '../../server/services/photoValidation';

/** Minimal big-endian EXIF with a GPS IFD: lat 5°25'48" S, lon 105°15'36" E (Bandar Lampung). */
function jpegWithGps(): string {
  const tiff = Buffer.alloc(140);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // IFD0 at 8
  tiff.writeUInt16BE(1, 8); // one entry: GPS IFD pointer
  tiff.writeUInt16BE(0x8825, 10); tiff.writeUInt16BE(4, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt32BE(26, 18);
  const gps = 26;
  tiff.writeUInt16BE(4, gps);
  const entry = (k: number, tag: number, type: number, count: number, value: number | string) => {
    const e = gps + 2 + k * 12;
    tiff.writeUInt16BE(tag, e); tiff.writeUInt16BE(type, e + 2); tiff.writeUInt32BE(count, e + 4);
    if (typeof value === 'string') tiff.write(value, e + 8, 'latin1'); else tiff.writeUInt32BE(value, e + 8);
  };
  entry(0, 1, 2, 2, 'S');
  entry(1, 2, 5, 3, 80);
  entry(2, 3, 2, 2, 'E');
  entry(3, 4, 5, 3, 104);
  const rat = (off: number, [a, b, c]: number[]) => [a, b, c].forEach((v, i) => { tiff.writeUInt32BE(v, off + i * 8); tiff.writeUInt32BE(1, off + i * 8 + 4); });
  rat(80, [5, 25, 48]);
  rat(104, [105, 15, 36]);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(app1.length + 2, 2);
  return `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8]), head, app1, Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]).toString('base64')}`;
}

test('camera GPS is read from EXIF (to refuse photos taken elsewhere) and gone after stripping', () => {
  const photo = jpegWithGps();
  const [lat, lon] = photoGpsPosition(photo)!;
  assert.ok(Math.abs(lat - -5.43) < 1e-3 && Math.abs(lon - 105.26) < 1e-3, `${lat},${lon}`);
  assert.equal(photoGpsPosition(stripPhotoMetadata(photo)), null);
  assert.equal(photoGpsPosition('data:image/png;base64,iVBORw0KGgo='), null);
});
