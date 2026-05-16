import { decompressSync } from 'fflate';

type NbtValue = unknown;

export type NbtCompound = Record<string, unknown>;

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

    while (true) {
      const type = this.readByte();
      if (type === Tag.End) {
        return compound;
      }

      const name = this.readString();
      compound[name] = this.readTag(type);
    }
  }

  private readList(): NbtValue[] {
    const itemType = this.readByte();
    const length = this.readInt();
    const list: NbtValue[] = [];

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

export function parseNbt(buffer: ArrayBuffer): { name: string; value: NbtCompound } {
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
