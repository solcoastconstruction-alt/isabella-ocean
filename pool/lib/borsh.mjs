// Minimal Borsh writer/reader for the SPL stake-pool program's instruction and
// account layouts. Borsh: little-endian integers, enums = u8 variant index,
// String = u32 byte length + UTF-8 bytes, Option<T> = u8 tag (0 None, 1 Some) + T.
import { PublicKey } from '@solana/web3.js';

const U64_MAX = (1n << 64n) - 1n;

export function toU64(v, what = 'u64') {
  const b = typeof v === 'bigint' ? v : BigInt(v);
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new Error(`${what}: ${v} is not a safe integer; pass a BigInt`);
  if (b < 0n || b > U64_MAX) throw new Error(`${what}: ${v} out of range`);
  return b;
}

export class BorshWriter {
  constructor() { this.parts = []; }
  u8(v) {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`u8 out of range: ${v}`);
    this.parts.push(Buffer.from([v]));
    return this;
  }
  bool(v) { return this.u8(v ? 1 : 0); }
  u32(v) {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`u32 out of range: ${v}`);
    const b = Buffer.alloc(4); b.writeUInt32LE(v); this.parts.push(b);
    return this;
  }
  u64(v, what) {
    const b = Buffer.alloc(8); b.writeBigUInt64LE(toU64(v, what)); this.parts.push(b);
    return this;
  }
  // state.rs: struct Fee { denominator: u64, numerator: u64 } — denominator FIRST.
  fee({ numerator, denominator }) {
    this.u64(denominator, 'fee.denominator');
    this.u64(numerator, 'fee.numerator');
    return this;
  }
  string(s) {
    const b = Buffer.from(s, 'utf8');
    this.u32(b.length);
    this.parts.push(b);
    return this;
  }
  pubkey(pk) { this.parts.push(new PublicKey(pk).toBuffer()); return this; }
  done() { return Buffer.concat(this.parts); }
}

export class BorshReader {
  constructor(buf, offset = 0) { this.b = Buffer.from(buf); this.o = offset; }
  need(n) { if (this.o + n > this.b.length) throw new Error(`read past end at ${this.o}+${n} (len ${this.b.length})`); }
  u8() { this.need(1); return this.b[this.o++]; }
  bool() { const v = this.u8(); if (v > 1) throw new Error(`bad bool ${v}`); return v === 1; }
  u32() { this.need(4); const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  u64() { this.need(8); const v = this.b.readBigUInt64LE(this.o); this.o += 8; return v; }
  i64() { this.need(8); const v = this.b.readBigInt64LE(this.o); this.o += 8; return v; }
  pubkey() { this.need(32); const p = new PublicKey(this.b.subarray(this.o, this.o + 32)); this.o += 32; return p; }
  fee() { const denominator = this.u64(); const numerator = this.u64(); return { numerator, denominator }; }
  optionPubkey() {
    const t = this.u8();
    if (t === 0) return null;
    if (t === 1) return this.pubkey();
    throw new Error(`bad Option tag ${t}`);
  }
  // state.rs: enum FutureEpoch<T> { None, One(T), Two(T) } — One = applies at the next
  // epoch boundary's update, Two = after two boundaries.
  futureFee() {
    const t = this.u8();
    if (t === 0) return null;
    if (t === 1 || t === 2) return { fee: this.fee(), boundariesLeft: t };
    throw new Error(`bad FutureEpoch tag ${t}`);
  }
  string() { const n = this.u32(); this.need(n); const s = this.b.subarray(this.o, this.o + n).toString('utf8'); this.o += n; return s; }
}
