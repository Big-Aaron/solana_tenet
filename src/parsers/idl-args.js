import bs58 from "bs58";

const DISCRIMINATOR_LEN = 8;

function cursor(buf) {
  let offset = 0;
  const need = (size) => {
    if (offset + size > buf.length) {
      throw new RangeError("instruction data is shorter than the IDL args");
    }
  };
  return {
    u8() {
      need(1);
      return buf[offset++];
    },
    u16() {
      need(2);
      const value = buf.readUInt16LE(offset);
      offset += 2;
      return value;
    },
    u32() {
      need(4);
      const value = buf.readUInt32LE(offset);
      offset += 4;
      return value;
    },
    i8() {
      need(1);
      const value = buf.readInt8(offset);
      offset += 1;
      return value;
    },
    i16() {
      need(2);
      const value = buf.readInt16LE(offset);
      offset += 2;
      return value;
    },
    i32() {
      need(4);
      const value = buf.readInt32LE(offset);
      offset += 4;
      return value;
    },
    f32() {
      need(4);
      const value = buf.readFloatLE(offset);
      offset += 4;
      return value;
    },
    f64() {
      need(8);
      const value = buf.readDoubleLE(offset);
      offset += 8;
      return value;
    },
    int(bytes, signed) {
      need(bytes);
      let value = 0n;
      for (let i = 0; i < bytes; i += 1) {
        value |= BigInt(buf[offset + i]) << (8n * BigInt(i));
      }
      offset += bytes;
      if (!signed) {
        return value;
      }
      const width = 8n * BigInt(bytes);
      const sign = 1n << (width - 1n);
      return value >= sign ? value - (1n << width) : value;
    },
    bytes(size) {
      need(size);
      const slice = buf.subarray(offset, offset + size);
      offset += size;
      return slice;
    },
    done() {
      return offset === buf.length;
    },
    get limit() {
      return buf.length;
    },
  };
}

function definedName(type) {
  if (typeof type.defined === "string") {
    return type.defined;
  }
  return type.defined?.name ?? null;
}

function fieldType(field) {
  if (typeof field === "string") {
    return field;
  }
  if (field && typeof field === "object" && field.type != null && field.name == null) {
    return field.type;
  }
  return field;
}

function readFields(cur, fields, types) {
  if (!Array.isArray(fields) || fields.length === 0) {
    return null;
  }
  const named = fields.every((field) => field && typeof field === "object" && typeof field.name === "string");
  if (named) {
    const value = {};
    for (const field of fields) {
      value[field.name] = readType(cur, field.type, types);
    }
    return value;
  }
  const values = fields.map((field) => readType(cur, fieldType(field), types));
  return values.length === 1 ? values[0] : values;
}

function readEnum(cur, variants, types) {
  const index = cur.u8();
  const variant = variants?.[index];
  if (!variant?.name) {
    throw new Error(`unknown enum variant ${index}`);
  }
  const body = readFields(cur, variant.fields, types);
  return body == null ? variant.name : { [variant.name]: body };
}

function readDefined(cur, resolved, types) {
  if (typeof resolved === "string" || resolved.kind == null) {
    return readType(cur, resolved, types);
  }
  if (resolved.kind === "struct" || resolved.kind === "account") {
    return readFields(cur, resolved.fields, types) ?? {};
  }
  if (resolved.kind === "enum") {
    return readEnum(cur, resolved.variants, types);
  }
  throw new Error(`unsupported IDL type kind ${resolved.kind}`);
}

function readPrimitive(cur, type) {
  switch (type) {
    case "bool": {
      const value = cur.u8();
      if (value > 1) {
        throw new Error(`invalid bool ${value}`);
      }
      return value === 1;
    }
    case "u8":
      return cur.u8();
    case "i8":
      return cur.i8();
    case "u16":
      return cur.u16();
    case "i16":
      return cur.i16();
    case "u32":
      return cur.u32();
    case "i32":
      return cur.i32();
    case "f32":
      return cur.f32();
    case "f64":
      return cur.f64();
    case "u64":
      return cur.int(8, false);
    case "i64":
      return cur.int(8, true);
    case "u128":
      return cur.int(16, false);
    case "i128":
      return cur.int(16, true);
    case "pubkey":
    case "publicKey":
      return bs58.encode(cur.bytes(32));
    case "string": {
      const size = cur.u32();
      return cur.bytes(size).toString("utf8");
    }
    case "bytes": {
      const size = cur.u32();
      return `0x${cur.bytes(size).toString("hex")}`;
    }
    default:
      throw new Error(`unsupported IDL type ${type}`);
  }
}

function readOption(cur, inner, types, prefix) {
  const tag = prefix === 4 ? cur.u32() : cur.u8();
  if (tag === 0) {
    return null;
  }
  if (tag === 1) {
    return readType(cur, inner, types);
  }
  throw new Error(`invalid option tag ${tag}`);
}

function readType(cur, type, types) {
  if (typeof type === "string") {
    return readPrimitive(cur, type);
  }
  if (!type || typeof type !== "object") {
    throw new Error("unsupported IDL type");
  }
  if (type.option != null) {
    return readOption(cur, type.option, types, 1);
  }
  if (type.coption != null) {
    return readOption(cur, type.coption, types, 4);
  }
  if (type.vec != null) {
    const length = cur.u32();
    if (length > cur.limit) {
      throw new RangeError("instruction data is shorter than the IDL args");
    }
    const items = [];
    for (let i = 0; i < length; i += 1) {
      items.push(readType(cur, type.vec, types));
    }
    return items;
  }
  if (type.array != null) {
    const [inner, length] = type.array;
    if (!Number.isInteger(length) || length < 0) {
      throw new Error("IDL array length is invalid");
    }
    const items = [];
    for (let i = 0; i < length; i += 1) {
      items.push(readType(cur, inner, types));
    }
    return items;
  }
  if (type.defined != null) {
    const name = definedName(type);
    const resolved = name ? types.get(name) : null;
    if (!resolved) {
      throw new Error(`unknown IDL type ${name ?? "?"}`);
    }
    return readDefined(cur, resolved, types);
  }
  throw new Error(`unsupported IDL type ${JSON.stringify(type)}`);
}

/**
 * Borsh-decode instruction args that follow the 8-byte discriminator.
 * Throws when the bytes do not match `args`.
 */
export function decodeIdlArgs(types, args, data) {
  const cur = cursor(Buffer.from(data).subarray(DISCRIMINATOR_LEN));
  const fields = {};
  for (const arg of args ?? []) {
    if (!arg?.name) {
      throw new Error("Anchor arg is missing a name");
    }
    fields[arg.name] = readType(cur, arg.type, types);
  }
  if (!cur.done()) {
    throw new Error("instruction data is longer than the IDL args");
  }
  return fields;
}
