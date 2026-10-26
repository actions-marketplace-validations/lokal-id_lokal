// For typechecking the packages/mcp document readers as part of the extension: their `Buffer` is the shim.
import type { Buffer as BufferShim, Bytes } from './buffer.ts';

declare global {
  type Buffer = Bytes;
  const Buffer: typeof BufferShim;
}

export {};
