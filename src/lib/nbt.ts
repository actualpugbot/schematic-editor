import { decompressSync, gzipSync } from 'fflate';

type NbtValue = unknown;

export type NbtCompound = Record<string, unknown>;
export interface NbtDocument {
  name: string;
  value: NbtCompound;
}

const enum Tag {
  End = 0,
  Byte = 1,
  Short = 2,
  Int = 3,
  Long = 4,
  Float = 5,
  Double = 6,
  ByteArray = 7,
  String = 8,
  List = 9,
  Compound = 10,
  IntArray = 11,
  LongArray = 12,
}

class NbtReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  readRoot(): { name: string; value: NbtCompound } {
    const type = this.readByte();
    if (type !== Tag.Compound) {
      throw new Error('NBT root must be a compound tag.');
    }

    const name = this.readString();
    return { name, value: this.readCompound() };
  }

  private readTag(type: number): NbtValue {
    switch (type) {
      case Tag.Byte:
        return this.readSignedByte();
      case Tag.Short:
        return this.readShort();
      case Tag.Int:
        return this.readInt();
      case Tag.Long:
        return this.readLong();
      case Tag.Float:
        return this.readFloat();
      case Tag.Double:
        return this.readDouble();
      case Tag.ByteArray:
        return this.readByteArray();
      case Tag.String:
        return this.readString();
      case Tag.List:
        return this.readList();
      case Tag.Compound:
        return this.readCompound();
      case Tag.IntArray:
        return this.readIntArray();
      case Tag.LongArray:
        return this.readLongArray();
      default:
        throw new Error(`Unsupported NBT tag type ${type}.`);
    }
  }

  private readCompound(): NbtCompound {
    const compound: NbtCompound = {};
    const types = new Map<string, Tag>();

    while (true) {
      const type = this.readByte();
      if (type === Tag.End) {
        compoundTagTypes.set(compound, types);
        return compound;
      }

      const name = this.readString();
      types.set(name, type);
      compound[name] = this.readTag(type);
    }
  }

  private readList(): NbtValue[] {
    const itemType = this.readByte();
    const length = this.readInt();
    const list: NbtValue[] = [];
    listTagTypes.set(list, itemType);

    for (let index = 0; index < length; index += 1) {
      list.push(this.readTag(itemType));
    }

    return list;
  }

  private readByteArray(): Int8Array {
    const length = this.readInt();
    this.ensure(length);
    const value = new Int8Array(this.bytes.buffer, this.bytes.byteOffset + this.offset, length).slice();
    this.offset += length;
    return value;
  }

  private readIntArray(): Int32Array {
    const length = this.readInt();
    const value = new Int32Array(length);

    for (let index = 0; index < length; index += 1) {
      value[index] = this.readInt();
    }

    return value;
  }

  private readLongArray(): BigInt64Array {
    const length = this.readInt();
    const value = new BigInt64Array(length);

    for (let index = 0; index < length; index += 1) {
      value[index] = this.readLong();
    }

    return value;
  }

  private readString(): string {
    const length = this.readUnsignedShort();
    this.ensure(length);
    const value = new TextDecoder().decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  private readByte(): number {
    this.ensure(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  private readSignedByte(): number {
    this.ensure(1);
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  private readShort(): number {
    this.ensure(2);
    const value = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return value;
  }

  private readUnsignedShort(): number {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  private readInt(): number {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  private readLong(): bigint {
    this.ensure(8);
    const value = this.view.getBigInt64(this.offset, false);
    this.offset += 8;
    return value;
  }

  private readFloat(): number {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return value;
  }

  private readDouble(): number {
    this.ensure(8);
    const value = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return value;
  }

  private ensure(length: number) {
    if (this.offset + length > this.bytes.byteLength) {
      throw new Error('Unexpected end of NBT data.');
    }
  }
}

const compoundTagTypes = new WeakMap<NbtCompound, Map<string, Tag>>();
const listTagTypes = new WeakMap<unknown[], Tag>();

export function parseNbt(buffer: ArrayBuffer): NbtDocument {
  const original = new Uint8Array(buffer);
  const bytes = maybeDecompress(original);
  return new NbtReader(bytes).readRoot();
}

function maybeDecompress(bytes: Uint8Array): Uint8Array {
  try {
    return decompressSync(bytes);
  } catch {
    return bytes;
  }
}

export function writeNbt(document: NbtDocument, options: { compressed?: boolean } = {}): Uint8Array {
  const writer = new NbtWriter();
  writer.writeRoot(document.name, document.value);
  const bytes = writer.finish();
  return options.compressed === false ? bytes : gzipSync(bytes);
}

class NbtWriter {
  private bytes: number[] = [];
  private readonly encoder = new TextEncoder();

  writeRoot(name: string, value: NbtCompound) {
    this.writeByte(Tag.Compound);
    this.writeString(name);
    this.writeCompound(value);
  }

  finish(): Uint8Array {
    return new Uint8Array(this.bytes);
  }

  private writeNamedTag(name: string, value: NbtValue, type: Tag) {
    this.writeByte(type);
    this.writeString(name);
    this.writePayload(value, type);
  }

  private writePayload(value: NbtValue, type: Tag) {
    switch (type) {
      case Tag.Byte:
        this.writeByte(asNumber(value));
        return;
      case Tag.Short:
        this.writeShort(asNumber(value));
        return;
      case Tag.Int:
        this.writeInt(asNumber(value));
        return;
      case Tag.Long:
        this.writeLong(typeof value === 'bigint' ? value : BigInt(asNumber(value)));
        return;
      case Tag.Float:
        this.writeFloat(asNumber(value));
        return;
      case Tag.Double:
        this.writeDouble(asNumber(value));
        return;
      case Tag.ByteArray:
        this.writeByteArray(value);
        return;
      case Tag.String:
        this.writeString(asString(value));
        return;
      case Tag.List:
        this.writeList(Array.isArray(value) ? value : []);
        return;
      case Tag.Compound:
        this.writeCompound(isCompound(value) ? value : {});
        return;
      case Tag.IntArray:
        this.writeIntArray(value);
        return;
      case Tag.LongArray:
        this.writeLongArray(value);
        return;
      default:
        throw new Error(`Unsupported NBT tag type ${type}.`);
    }
  }

  private writeCompound(compound: NbtCompound) {
    const knownTypes = compoundTagTypes.get(compound);

    for (const [name, value] of Object.entries(compound)) {
      if (value === undefined) continue;
      this.writeNamedTag(name, value, knownTypes?.get(name) ?? inferTagType(value));
    }

    this.writeByte(Tag.End);
  }

  private writeList(list: unknown[]) {
    const itemType = listTagTypes.get(list) ?? inferListType(list);
    this.writeByte(itemType);
    this.writeInt(list.length);

    for (const value of list) {
      this.writePayload(value, itemType);
    }
  }

  private writeByteArray(value: NbtValue) {
    const array = value instanceof Int8Array
      ? value
      : value instanceof Uint8Array
        ? new Int8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Int8Array();

    this.writeInt(array.length);
    for (const byte of array) this.writeByte(byte);
  }

  private writeIntArray(value: NbtValue) {
    const array = value instanceof Int32Array ? value : new Int32Array();
    this.writeInt(array.length);
    for (const item of array) this.writeInt(item);
  }

  private writeLongArray(value: NbtValue) {
    const array = value instanceof BigInt64Array ? value : new BigInt64Array();
    this.writeInt(array.length);
    for (const item of array) this.writeLong(item);
  }

  private writeString(value: string) {
    const encoded = this.encoder.encode(value);
    if (encoded.length > 0xffff) {
      throw new Error('NBT strings cannot be longer than 65,535 bytes.');
    }
    this.writeUnsignedShort(encoded.length);
    this.writeBytes(encoded);
  }

  private writeByte(value: number) {
    this.bytes.push(value & 0xff);
  }

  private writeShort(value: number) {
    this.writeByte(value >> 8);
    this.writeByte(value);
  }

  private writeUnsignedShort(value: number) {
    this.writeShort(value);
  }

  private writeInt(value: number) {
    this.writeByte(value >> 24);
    this.writeByte(value >> 16);
    this.writeByte(value >> 8);
    this.writeByte(value);
  }

  private writeLong(value: bigint) {
    for (let shift = 56n; shift >= 0n; shift -= 8n) {
      this.writeByte(Number((value >> shift) & 0xffn));
    }
  }

  private writeFloat(value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, false);
    this.writeBytes(bytes);
  }

  private writeDouble(value: number) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, false);
    this.writeBytes(bytes);
  }

  private writeBytes(bytes: Uint8Array) {
    for (const byte of bytes) this.writeByte(byte);
  }
}

function inferTagType(value: NbtValue): Tag {
  if (typeof value === 'string') return Tag.String;
  if (typeof value === 'bigint') return Tag.Long;
  if (typeof value === 'number') return Number.isInteger(value) ? Tag.Int : Tag.Double;
  if (value instanceof Int8Array || value instanceof Uint8Array) return Tag.ByteArray;
  if (value instanceof Int32Array) return Tag.IntArray;
  if (value instanceof BigInt64Array) return Tag.LongArray;
  if (Array.isArray(value)) return Tag.List;
  if (isCompound(value)) return Tag.Compound;
  throw new Error('Cannot write unsupported NBT value.');
}

function inferListType(list: unknown[]): Tag {
  return list.length > 0 ? inferTagType(list[0]) : Tag.End;
}

export function isCompound(value: unknown): value is NbtCompound {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value));
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  return fallback;
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asByteArray(value: unknown): Uint8Array | null {
  if (value instanceof Int8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  return null;
}

export function asIntArray(value: unknown): Int32Array | null {
  return value instanceof Int32Array ? value : null;
}

export function asLongArray(value: unknown): BigInt64Array | null {
  return value instanceof BigInt64Array ? value : null;
}

export function asList(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}
