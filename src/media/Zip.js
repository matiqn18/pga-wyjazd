'use strict';
const fs = require('fs');

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const UTF8_FLAG = 1 << 11;

/** Data i czas w formacie DOS (lokalny czas serwera, dokładność 2 s). */
function dosTime(t) {
  const d = new Date(t);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Czeka, aż strumień przyjmie więcej danych albo się zamknie (bez zostawiania nasłuchów). */
function drainOrClose(out) {
  return new Promise(resolve => {
    const done = () => {
      out.off('drain', done);
      out.off('close', done);
      resolve();
    };
    out.on('drain', done);
    out.on('close', done);
  });
}

/** Pole dodatkowe ZIP64 (0x0001) z podanymi wartościami 8-bajtowymi. */
function zip64Extra(values) {
  const buf = Buffer.alloc(4 + values.length * 8);
  buf.writeUInt16LE(0x0001, 0);
  buf.writeUInt16LE(values.length * 8, 2);
  values.forEach((v, i) => buf.writeBigUInt64LE(BigInt(v), 4 + i * 8));
  return buf;
}

function localHeader(entry) {
  const big = entry.size >= MAX32;
  const extra = big ? zip64Extra([entry.size, entry.size]) : Buffer.alloc(0);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(big ? 45 : 20, 4);
  head.writeUInt16LE(UTF8_FLAG, 6);
  head.writeUInt16LE(0, 8); // bez kompresji: zdjęcia i filmy i tak są skompresowane
  head.writeUInt16LE(entry.dos.time, 10);
  head.writeUInt16LE(entry.dos.date, 12);
  head.writeUInt32LE(entry.crc, 14);
  head.writeUInt32LE(big ? MAX32 : entry.size, 18);
  head.writeUInt32LE(big ? MAX32 : entry.size, 22);
  head.writeUInt16LE(entry.nameBuf.length, 26);
  head.writeUInt16LE(extra.length, 28);
  return Buffer.concat([head, entry.nameBuf, extra]);
}

function centralHeader(entry) {
  const bigSize = entry.size >= MAX32;
  const bigOffset = entry.offset >= MAX32;
  const values = [...(bigSize ? [entry.size, entry.size] : []), ...(bigOffset ? [entry.offset] : [])];
  const extra = values.length ? zip64Extra(values) : Buffer.alloc(0);
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE((3 << 8) | 45, 4); // Unix, wersja 4.5
  head.writeUInt16LE(values.length ? 45 : 20, 6);
  head.writeUInt16LE(UTF8_FLAG, 8);
  head.writeUInt16LE(0, 10);
  head.writeUInt16LE(entry.dos.time, 12);
  head.writeUInt16LE(entry.dos.date, 14);
  head.writeUInt32LE(entry.crc, 16);
  head.writeUInt32LE(bigSize ? MAX32 : entry.size, 20);
  head.writeUInt32LE(bigSize ? MAX32 : entry.size, 24);
  head.writeUInt16LE(entry.nameBuf.length, 28);
  head.writeUInt16LE(extra.length, 30);
  head.writeUInt32LE((0o100644 << 16) >>> 0, 38); // zwykły plik rw-r--r--
  head.writeUInt32LE(bigOffset ? MAX32 : entry.offset, 42);
  return Buffer.concat([head, entry.nameBuf, extra]);
}

function endRecords(count, cdOffset, cdSize) {
  const parts = [];
  const zip64 = count >= MAX16 || cdOffset >= MAX32 || cdSize >= MAX32;
  if (zip64) {
    const rec = Buffer.alloc(56);
    rec.writeUInt32LE(0x06064b50, 0);
    rec.writeBigUInt64LE(44n, 4);
    rec.writeUInt16LE((3 << 8) | 45, 12);
    rec.writeUInt16LE(45, 14);
    rec.writeBigUInt64LE(BigInt(count), 24);
    rec.writeBigUInt64LE(BigInt(count), 32);
    rec.writeBigUInt64LE(BigInt(cdSize), 40);
    rec.writeBigUInt64LE(BigInt(cdOffset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);
    locator.writeUInt32LE(1, 16);
    parts.push(rec, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(count, MAX16), 8);
  end.writeUInt16LE(Math.min(count, MAX16), 10);
  end.writeUInt32LE(Math.min(cdSize, MAX32), 12);
  end.writeUInt32LE(Math.min(cdOffset, MAX32), 16);
  parts.push(end);
  return Buffer.concat(parts);
}

/**
 * Archiwum ZIP bez kompresji (STORE), składane w locie prosto z plików na dysku.
 * Rozmiary i CRC są znane z góry (liczone przy wysyłaniu), więc znamy też dokładną
 * długość całego archiwum – przeglądarka pokazuje postęp pobierania.
 * Powyżej 4 GB (plik, przesunięcie albo całość) używa rozszerzeń ZIP64.
 *
 * `files`: [{ path, name, size, crc, at }] – `name` to ścieżka w archiwum.
 */
class Zip {
  constructor(files) {
    let offset = 0;
    this.entries = files.map(f => {
      const entry = { ...f, nameBuf: Buffer.from(f.name, 'utf8'), dos: dosTime(f.at), offset };
      entry.header = localHeader(entry);
      offset += entry.header.length + entry.size;
      return entry;
    });
    const central = Buffer.concat(this.entries.map(centralHeader));
    this.tail = Buffer.concat([central, endRecords(this.entries.length, offset, central.length)]);
    this.length = offset + this.tail.length;
  }

  /** Wysyła archiwum do strumienia; przerywa, gdy odbiorca się rozłączy. */
  async pipe(out) {
    const write = async buf => {
      if (out.destroyed) throw new Error('Odbiorca się rozłączył.');
      if (!out.write(buf)) await drainOrClose(out);
    };
    for (const entry of this.entries) {
      await write(entry.header);
      let sent = 0;
      for await (const chunk of fs.createReadStream(entry.path, { highWaterMark: 1 << 20 })) {
        sent += chunk.length;
        await write(chunk);
      }
      if (sent !== entry.size) throw new Error(`Plik zmienił rozmiar: ${entry.path}`);
    }
    await write(this.tail);
    out.end();
  }
}

module.exports = Zip;
